/**
 * StringCombobox.tsx — type-to-filter single-select picker for a flat
 * list of strings.
 *
 * Mirrors the UX of `UserCombobox` (PM picker in ProjectModal) but
 * works with plain `string[]` options — used by filter toolbars where
 * the data isn't a user record. Vanilla React + Tailwind, no library.
 *
 * Selecting an empty value (via clear `X`) emits `""` so callers can
 * map that to "all" / "no filter" semantics.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { ChevronDown, X } from "lucide-react";

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-white py-1.5 pl-3 pr-8 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand";

interface StringComboboxProps {
  readonly id: string;
  readonly options: readonly string[];
  /** Empty string means "no selection". */
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly placeholder?: string;
  readonly minWidth?: string;
}

export function StringCombobox({
  id,
  options,
  value,
  onChange,
  placeholder = "Type to search…",
  minWidth = "180px",
}: StringComboboxProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const [activeIdx, setActiveIdx] = useState(0);

  // Sync the displayed text with the bound `value` when (a) the parent
  // changes it externally or (b) the dropdown transitions to closed
  // (drops any uncommitted typing). React docs recommend doing the
  // comparison during render instead of in a useEffect — the effect
  // form would render → effect → setState → render again, while the
  // during-render compare just renders once with the right value.
  const [lastSeen, setLastSeen] = useState({ value, open });
  if (lastSeen.value !== value || lastSeen.open !== open) {
    setLastSeen({ value, open });
    if (!open) setQuery(value);
  }

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.toLowerCase().includes(q));
  }, [options, query]);

  const commit = (next: string) => {
    onChange(next);
    setQuery(next);
    setOpen(false);
  };

  const clear = () => {
    onChange("");
    setQuery("");
    inputRef.current?.focus();
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) =>
        Math.min(i + 1, Math.max(filtered.length - 1, 0)),
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && filtered[activeIdx] !== undefined) {
        e.preventDefault();
        commit(filtered[activeIdx]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery(value);
    }
  };

  return (
    <div ref={wrapRef} className="relative" style={{ minWidth }}>
      <input
        id={id}
        ref={inputRef}
        type="text"
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={`${id}-listbox`}
        className={INPUT_CLS}
        placeholder={placeholder}
        value={query}
        onFocus={() => {
          setOpen(true);
          setActiveIdx(0);
        }}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActiveIdx(0);
          // Empty input clears the bound value so the parent can drop
          // the filter without the user having to click the X.
          if (e.target.value === "") onChange("");
        }}
        onKeyDown={handleKey}
      />
      {value ? (
        <button
          type="button"
          onClick={clear}
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-text-muted hover:bg-slate-100"
          aria-label="Clear selection"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ) : (
        <ChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted"
          aria-hidden="true"
        />
      )}

      {open && filtered.length > 0 && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-white py-1 shadow-lg"
        >
          {filtered.map((opt, idx) => {
            const isActive = idx === activeIdx;
            const isSelected = opt === value;
            return (
              <li
                key={opt}
                role="option"
                aria-selected={isSelected}
                className={`cursor-pointer truncate px-3 py-1.5 text-[13px] ${
                  isActive
                    ? "bg-brand-light text-brand"
                    : isSelected
                      ? "text-brand"
                      : "text-text-main"
                }`}
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(opt);
                }}
              >
                {opt}
              </li>
            );
          })}
        </ul>
      )}

      {open && filtered.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-text-muted shadow-lg">
          No matches.
        </div>
      )}
    </div>
  );
}
