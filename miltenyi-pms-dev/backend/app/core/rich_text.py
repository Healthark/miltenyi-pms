"""
rich_text — server-side rendering of the Markdown subset used by free-text
fields (Admin announcements; annual goal descriptions from part 3b on).

Text is authored in a deliberately small Markdown subset (bold, italic, bullet
lists, numbered lists, line breaks) via the frontend's RichTextEditor. What is
stored IS the Markdown source, so every consumer renders it for its own medium:

    * `markdown_to_plain` — strips the markers. Used by the bell rows, the
      Excel exports and the plain-text alternative part of outbound email.
    * `markdown_to_html`  — renders email-safe HTML blocks. Used by the
      notification / announcement email template.

React surfaces don't come through here — they render the same source into
elements via frontend/src/components/common/RichText.tsx.

Keep the supported subset in sync with
frontend/src/components/common/RichText.tsx. Headings (`#`) and `_italic_` are
deliberately NOT supported: the editor never emits them, so leaving them inert
avoids silently rewriting text a user typed literally.

Ported from the Healthark PMS (26 Sep 2026, annual-parity part 3).
"""

from __future__ import annotations

import re
from html import escape

# Bullet markers at line start ("- ", "* ", "+ ") -> a literal bullet glyph.
# Anchored per line via MULTILINE. Whitespace after the marker is required so a
# fully-bolded line ("**Ship it**") is never mistaken for a bullet.
_BULLET_RE = re.compile(r"^([ \t]*)[-+*][ \t]+", re.MULTILINE)

# **bold** — non-greedy, may span newlines. MUST run before the italic rule so
# the doubled markers aren't consumed one asterisk at a time.
_BOLD_RE = re.compile(r"\*\*(.+?)\*\*", re.DOTALL)

# *italic* — single asterisks only, never crossing a line break, and never
# adjacent to another asterisk (which would be leftover bold).
_ITALIC_RE = re.compile(r"(?<!\*)\*([^*\n]+?)\*(?!\*)")


def markdown_to_plain(text: str | None) -> str:
    """Strip the supported Markdown markers, leaving readable plain text.

    Line breaks are preserved — Excel renders them inside a wrapped cell.
    Bullets become "• " rather than staying "- " on purpose: a cell whose text
    starts with "-" trips the export's formula-injection guard and would pick up
    a stray leading apostrophe.

    Ordered lists ("1. step") are left alone — already readable as plain text.

    Text containing no markers is returned unchanged, so rows written before
    rich text existed export exactly as they do today.
    """
    if not text:
        return ""
    out = _BULLET_RE.sub(r"\1• ", text)
    out = _BOLD_RE.sub(r"\1", out)
    out = _ITALIC_RE.sub(r"\1", out)
    return out


def markdown_to_one_line(text: str | None, limit: int | None = None) -> str:
    """Plain text collapsed onto one line — for a bell row or a subject."""
    flat = " ".join(markdown_to_plain(text).split())
    if limit is not None and len(flat) > limit:
        return flat[: max(0, limit - 1)].rstrip() + "…"
    return flat


# ── HTML rendering (outbound email) ──────────────────────────────────
# Mirror of frontend/src/components/common/RichText.tsx, which renders the same
# source into React elements for the in-app surfaces. Email clients get HTML
# instead — with the styling inlined per element, because Outlook's Word engine
# does not inherit font/colour into <p>, <ul> or <li>.

_BULLET_LINE_RE = re.compile(r"^[ \t]*[-+*][ \t]+(.*)$")
_ORDERED_LINE_RE = re.compile(r"^[ \t]*(\d+)[.)][ \t]+(.*)$")

_P_STYLE = "margin:0 0 14px 0;font-size:14px;line-height:1.6;color:#0F172A;"
_LIST_STYLE = (
    "margin:0 0 14px 0;padding-left:22px;font-size:14px;line-height:1.6;color:#0F172A;"
)
_LI_STYLE = "margin:0 0 4px 0;"


def _inline_html(line: str) -> str:
    """Escape one line, then turn its **bold** / *italic* markers into tags.

    Escaping runs FIRST so any markup the author typed (`<script>`) is inert
    text by the time the marker rules see it; `escape` leaves asterisks alone,
    so the rules still match what the author wrote.
    """
    out = escape(line, quote=True)
    out = _BOLD_RE.sub(r"<strong>\1</strong>", out)
    out = _ITALIC_RE.sub(r"<em>\1</em>", out)
    return out


def markdown_to_html(text: str | None) -> str:
    """Render the supported Markdown subset as email-safe HTML blocks.

    Returns a run of top-level <p> / <ul> / <ol> elements (never a bare string),
    so callers must drop it into a block context — not inside a <p>. Text with
    no markers becomes a single styled paragraph, which is why every existing
    code-generated notification body renders exactly as it did before.

    Blank line -> new block. Single newline inside a paragraph -> <br>. Numbered
    lists honour the first item's number via `start`, matching RichText.tsx.
    """
    if not text or not text.strip():
        return ""

    blocks: list[str] = []
    para: list[str] = []
    items: list[str] = []
    list_tag = ""
    start = 1

    def flush() -> None:
        nonlocal para, items, list_tag, start
        if para:
            blocks.append(f'<p style="{_P_STYLE}">' + "<br>".join(para) + "</p>")
            para = []
        if items:
            attr = f' start="{start}"' if list_tag == "ol" and start != 1 else ""
            lis = "".join(f'<li style="{_LI_STYLE}">{i}</li>' for i in items)
            blocks.append(
                f'<{list_tag}{attr} style="{_LIST_STYLE}">{lis}</{list_tag}>'
            )
            items = []
            list_tag = ""
            start = 1

    for line in text.split("\n"):
        if not line.strip():
            flush()
            continue

        bullet = _BULLET_LINE_RE.match(line)
        if bullet:
            if list_tag != "ul":
                flush()
                list_tag = "ul"
            items.append(_inline_html(bullet.group(1)))
            continue

        ordered = _ORDERED_LINE_RE.match(line)
        if ordered:
            if list_tag != "ol":
                flush()
                list_tag = "ol"
                start = int(ordered.group(1)) or 1
            items.append(_inline_html(ordered.group(2)))
            continue

        if list_tag:
            flush()
        para.append(_inline_html(line))

    flush()
    return "".join(blocks)
