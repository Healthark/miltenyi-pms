/**
 * RichText.tsx — renders the small Markdown subset used by free-text fields
 * (Admin announcements; annual goal descriptions).
 *
 * The text is STORED as Markdown source (authored via RichTextEditor). This
 * renders that source into React elements.
 *
 * Security: text is passed as React children, never as HTML — there is no
 * `dangerouslySetInnerHTML` here on purpose. Any markup a user types
 * (`<script>`, `<img onerror=…>`) renders as literal visible characters, so
 * this component cannot introduce an injection surface and needs no sanitizer.
 *
 * Supported subset — keep in sync with backend/app/core/rich_text.py:
 *   **bold**            → <strong>
 *   *italic*            → <em>
 *   "- ", "* ", "+ "    → bullet list
 *   "1. ", "1) "        → numbered list (honours the first item's number)
 *   single newline      → line break within a paragraph
 *   blank line          → new paragraph
 *
 * Deliberately NOT supported: headings (#), `_italic_`, links, code. The editor
 * never emits them, and a narrow subset keeps rendering predictable inside
 * table cells. Unrecognised markers simply render as literal text.
 *
 * Ported from the Healthark PMS (26 Sep 2026).
 */

import type { ReactNode } from "react";

/**
 * - `block` — full block rendering (paragraphs + lists) in a <div>. Default.
 * - `cell`  — same, tighter spacing, for a table <td>.
 * - `teaser` — markers stripped to plain text, inline only. Use where block
 *   elements would be invalid (inside a <button>) or where the caller
 *   line-clamps to a fixed number of lines.
 */
export type RichTextVariant = "block" | "cell" | "teaser";

interface RichTextProps {
  readonly value: string | null | undefined;
  readonly variant?: RichTextVariant;
  readonly className?: string;
}

const BULLET_RE = /^[ \t]*[-+*][ \t]+(.*)$/;
const ORDERED_RE = /^[ \t]*(\d+)[.)][ \t]+(.*)$/;
/** **bold** first so a doubled marker never matches the italic branch. */
const INLINE_RE = /\*\*(.+?)\*\*|\*([^*\n]+?)\*/g;

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[]; start: number };

/** Split Markdown source into paragraph / bullet-list / numbered-list blocks. */
function toBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let current: Block | null = null;

  const flush = () => {
    if (current) blocks.push(current);
    current = null;
  };

  for (const rawLine of src.split("\n")) {
    if (rawLine.trim().length === 0) {
      flush();
      continue;
    }

    const bullet = BULLET_RE.exec(rawLine);
    if (bullet) {
      if (current?.kind !== "ul") {
        flush();
        current = { kind: "ul", items: [] };
      }
      current.items.push(bullet[1]);
      continue;
    }

    const ordered = ORDERED_RE.exec(rawLine);
    if (ordered) {
      if (current?.kind !== "ol") {
        flush();
        current = { kind: "ol", items: [], start: Number(ordered[1]) || 1 };
      }
      current.items.push(ordered[2]);
      continue;
    }

    if (current?.kind !== "p") {
      flush();
      current = { kind: "p", lines: [] };
    }
    current.lines.push(rawLine);
  }
  flush();
  return blocks;
}

/** Turn inline **bold** / *italic* markers into elements. Plain text passes through. */
function parseInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  // Fresh lastIndex per call — INLINE_RE is module-scoped and /g is stateful.
  INLINE_RE.lastIndex = 0;
  while ((match = INLINE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    if (match[1] !== undefined) {
      nodes.push(
        <strong key={`${keyPrefix}-b${match.index}`} className="font-semibold">
          {match[1]}
        </strong>,
      );
    } else {
      nodes.push(
        <em key={`${keyPrefix}-i${match.index}`} className="italic">
          {match[2]}
        </em>,
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/**
 * Strip every supported marker, leaving plain text. Mirrors
 * `markdown_to_plain` in backend/app/core/rich_text.py. Exported for teasers,
 * aria-labels, character counters and anywhere else only a bare string will do.
 */
export function stripMarkdown(src: string): string {
  return src
    .replace(/^([ \t]*)[-+*][ \t]+/gm, "$1• ")
    .replace(/\*\*([\s\S]+?)\*\*/g, "$1")
    .replace(/(?<!\*)\*([^*\n]+?)\*(?!\*)/g, "$1");
}

export function RichText({ value, variant = "block", className }: RichTextProps) {
  if (!value || value.trim().length === 0) return null;

  if (variant === "teaser") {
    // Inline-only: safe inside a <button> or a line-clamped <p>. Newlines
    // collapse to spaces so a clamp shows real content instead of stopping at
    // the first line break.
    const plain = stripMarkdown(value).replace(/\s+/g, " ").trim();
    return <>{plain}</>;
  }

  const blocks = toBlocks(value);
  const gap = variant === "cell" ? "space-y-1" : "space-y-2";
  const listGap = variant === "cell" ? "space-y-0" : "space-y-0.5";

  return (
    <div className={[gap, className].filter(Boolean).join(" ")}>
      {blocks.map((block, blockIdx) => {
        if (block.kind === "ul") {
          return (
            <ul key={blockIdx} className={`list-disc pl-5 ${listGap}`}>
              {block.items.map((item, i) => (
                <li key={i}>{parseInline(item, `${blockIdx}-${i}`)}</li>
              ))}
            </ul>
          );
        }
        if (block.kind === "ol") {
          return (
            <ol
              key={blockIdx}
              start={block.start}
              className={`list-decimal pl-5 ${listGap}`}
            >
              {block.items.map((item, i) => (
                <li key={i}>{parseInline(item, `${blockIdx}-${i}`)}</li>
              ))}
            </ol>
          );
        }
        return (
          <p key={blockIdx}>
            {block.lines.map((line, i) => (
              <span key={i}>
                {i > 0 && <br />}
                {parseInline(line, `${blockIdx}-${i}`)}
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}
