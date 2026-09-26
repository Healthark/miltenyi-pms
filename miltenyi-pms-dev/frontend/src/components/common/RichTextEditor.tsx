/**
 * RichTextEditor.tsx — textarea + formatting toolbar for the Markdown subset
 * that RichText renders.
 *
 * The stored value is Markdown SOURCE, so this is a plain <textarea> with
 * toolbar buttons that wrap/prefix the selection. No contentEditable, no HTML,
 * no editor library — which is why this needs no sanitizer and degrades to
 * readable text if the rendering layer is ever rolled back.
 *
 * Buttons and Ctrl/Cmd+B / Ctrl/Cmd+I toggle, so pressing twice unwraps.
 * Callers usually pair this with a live <RichText> preview.
 *
 * Ported from the Healthark PMS (26 Sep 2026).
 */

import { useEffect, useRef, type ReactNode } from "react";
import { Bold, Italic, List, ListOrdered } from "lucide-react";

interface RichTextEditorProps {
  readonly id: string;
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly rows?: number;
  readonly placeholder?: string;
  readonly maxLength?: number;
  readonly disabled?: boolean;
  /** Extra controls appended to the toolbar row. */
  readonly toolbarExtra?: ReactNode;
  /** Extra classes for the outer frame (e.g. a red border on error). */
  readonly className?: string;
}

const TOOLBAR_BTN =
  "rounded p-1.5 text-text-muted transition-colors hover:bg-brand/10 hover:text-brand disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-muted";

/** Expand [start,end) to cover the whole lines it touches. */
function lineBounds(text: string, start: number, end: number) {
  const from = text.lastIndexOf("\n", start - 1) + 1;
  const nextBreak = text.indexOf("\n", end);
  const to = nextBreak === -1 ? text.length : nextBreak;
  return { from, to };
}

export function RichTextEditor({
  id,
  value,
  onChange,
  rows = 6,
  placeholder,
  maxLength,
  disabled = false,
  toolbarExtra,
  className,
}: RichTextEditorProps) {
  const ref = useRef<HTMLTextAreaElement>(null);
  /** Selection to restore after a toolbar edit re-renders the controlled value. */
  const pendingSelection = useRef<[number, number] | null>(null);

  useEffect(() => {
    const sel = pendingSelection.current;
    const el = ref.current;
    if (!sel || !el) return;
    pendingSelection.current = null;
    el.focus();
    el.setSelectionRange(sel[0], sel[1]);
  }, [value]);

  const commit = (next: string, selStart: number, selEnd: number) => {
    pendingSelection.current = [selStart, selEnd];
    onChange(next);
  };

  /** Wrap (or unwrap) the selection in `marker`. */
  const toggleWrap = (marker: string) => {
    const el = ref.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end);
    const len = marker.length;

    // Already wrapped just inside the selection → unwrap.
    if (
      selected.length >= len * 2 &&
      selected.startsWith(marker) &&
      selected.endsWith(marker)
    ) {
      const inner = selected.slice(len, -len);
      commit(
        value.slice(0, start) + inner + value.slice(end),
        start,
        start + inner.length,
      );
      return;
    }

    // Already wrapped just outside the selection → unwrap.
    if (
      value.slice(start - len, start) === marker &&
      value.slice(end, end + len) === marker
    ) {
      commit(
        value.slice(0, start - len) + selected + value.slice(end + len),
        start - len,
        end - len,
      );
      return;
    }

    const next =
      value.slice(0, start) + marker + selected + marker + value.slice(end);
    // With no selection, drop the caret between the markers so typing is styled.
    commit(next, start + len, start + len + selected.length);
  };

  /** Toggle a list prefix across every line the selection touches. */
  const toggleList = (kind: "bullet" | "ordered") => {
    const el = ref.current;
    if (!el) return;
    const { from, to } = lineBounds(value, el.selectionStart, el.selectionEnd);
    const lines = value.slice(from, to).split("\n");
    const marker = /^[ \t]*([-+*]|\d+[.)])[ \t]+/;
    const allMarked = lines.every((l) => l.trim() === "" || marker.test(l));

    const rebuilt = lines
      .map((line, i) => {
        const bare = line.replace(marker, "");
        if (allMarked) return bare;
        if (bare.trim() === "") return bare;
        return kind === "bullet" ? `- ${bare}` : `${i + 1}. ${bare}`;
      })
      .join("\n");

    const next = value.slice(0, from) + rebuilt + value.slice(to);
    commit(next, from, from + rebuilt.length);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    const key = e.key.toLowerCase();
    if (key === "b") {
      e.preventDefault();
      toggleWrap("**");
    } else if (key === "i") {
      e.preventDefault();
      toggleWrap("*");
    }
  };

  return (
    <div
      className={`rounded-lg border border-border bg-white focus-within:ring-2 focus-within:ring-brand ${className ?? ""}`}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-0.5 border-b border-border px-2 py-1">
        <button
          type="button"
          className={TOOLBAR_BTN}
          onClick={() => toggleWrap("**")}
          disabled={disabled}
          aria-label="Bold"
          title="Bold (Ctrl+B)"
        >
          <Bold className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={TOOLBAR_BTN}
          onClick={() => toggleWrap("*")}
          disabled={disabled}
          aria-label="Italic"
          title="Italic (Ctrl+I)"
        >
          <Italic className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
        <button
          type="button"
          className={TOOLBAR_BTN}
          onClick={() => toggleList("bullet")}
          disabled={disabled}
          aria-label="Bullet list"
          title="Bullet list"
        >
          <List className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={TOOLBAR_BTN}
          onClick={() => toggleList("ordered")}
          disabled={disabled}
          aria-label="Numbered list"
          title="Numbered list"
        >
          <ListOrdered className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        {toolbarExtra}
        {maxLength !== undefined && (
          <span
            className={`ml-auto text-[11px] tabular-nums ${
              value.length > maxLength ? "font-semibold text-red-600" : "text-text-muted"
            }`}
          >
            {value.length.toLocaleString()}/{maxLength.toLocaleString()}
          </span>
        )}
      </div>

      <textarea
        id={id}
        ref={ref}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        maxLength={maxLength}
        disabled={disabled}
        className="w-full resize-y rounded-b-lg bg-transparent px-3 py-2 text-sm leading-relaxed text-text-main placeholder:text-text-muted focus:outline-none disabled:opacity-60"
      />
    </div>
  );
}
