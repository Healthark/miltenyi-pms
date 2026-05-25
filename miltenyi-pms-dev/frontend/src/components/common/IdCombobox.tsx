/**
 * IdCombobox.tsx — type-to-filter single-select picker for a list of
 * `{ id, name }` options. Used by UserModal for Function + Designation
 * where the GCC seed now ships ~35 designations and a plain <select>
 * is unwieldy.
 *
 * Mirrors the keyboard + click-outside behavior of `StringCombobox`
 * (and PM/Secondary picker `UserCombobox`) but operates on numeric ids
 * so the parent stays in `id` space without label-to-id reverse lookups.
 *
 * `null` value means "no selection" (the empty option). Clearing via
 * the X button emits `null` so callers can treat that as "unassigned".
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
  "w-full rounded-lg border border-border bg-white px-3 py-2 pr-8 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand";

export interface IdOption {
  readonly id: number;
  readonly name: string;
}

interface IdComboboxProps {
  readonly id: string;
  readonly options: readonly IdOption[];
  /** `null` means "no selection". */
  readonly value: number | null;
  readonly onChange: (id: number | null) => void;
  readonly placeholder?: string;
  /** Shown above the empty option when clicking through the dropdown
   *  empty-state suggestions. Defaults to "— None —" to match the
   *  original native <select> empty option label. */
  readonly emptyLabel?: string;
}

export function IdCombobox({
  id,
  options,
  value,
  onChange,
  placeholder = "Type to search…",
  emptyLabel = "— None —",
}: IdComboboxProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  // The selected option's name (or "") is what the user sees in the
  // input. Searching replaces this temporarily; closing reverts.
  const selectedName =
    value != null ? options.find((o) => o.id === value)?.name ?? "" : "";
  const [query, setQuery] = useState(selectedName);
  const [activeIdx, setActiveIdx] = useState(0);

  // Sync the displayed text with the bound value when either changes
  // externally OR the dropdown closes (drops uncommitted typing).
  // During-render compare instead of useEffect avoids the
  // render→effect→setState→render second pass.
  const [lastSeen, setLastSeen] = useState({ value, open });
  if (lastSeen.value !== value || lastSeen.open !== open) {
    setLastSeen({ value, open });
    if (!open) setQuery(selectedName);
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
    // No filter when empty OR when the input still shows the currently-
    // selected value (i.e. user just reopened the dropdown without
    // typing). Without the second clause, reopening after a selection
    // narrows the list to only the selected entry because `query`
    // equals the selected name. The moment the user types anything
    // different, the filter kicks in.
    if (!q || q === selectedName.trim().toLowerCase()) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q));
  }, [options, query, selectedName]);

  const commit = (opt: IdOption) => {
    onChange(opt.id);
    setQuery(opt.name);
    setOpen(false);
  };

  const clear = () => {
    onChange(null);
    setQuery("");
    inputRef.current?.focus();
  };

  const handleKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActiveIdx((i) => Math.min(i + 1, Math.max(filtered.length - 1, 0)));
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
      setQuery(selectedName);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
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
          // the selection without the user having to click the X.
          if (e.target.value === "") onChange(null);
        }}
        onKeyDown={handleKey}
      />
      {value != null ? (
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

      {open && (filtered.length > 0 || value != null) && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-white py-1 shadow-lg"
        >
          {/* Clear-selection row at the top of the list — matches the
              old <option value="">— None —</option> at the head of the
              native select. */}
          {value != null && (
            <li
              role="option"
              aria-selected={false}
              className="cursor-pointer truncate px-3 py-1.5 text-[13px] italic text-text-muted hover:bg-slate-50"
              onMouseDown={(e) => {
                e.preventDefault();
                clear();
                setOpen(false);
              }}
            >
              {emptyLabel}
            </li>
          )}
          {filtered.map((opt, idx) => {
            const isActive = idx === activeIdx;
            const isSelected = opt.id === value;
            return (
              <li
                key={opt.id}
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
                {opt.name}
              </li>
            );
          })}
        </ul>
      )}

      {open && filtered.length === 0 && value == null && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-text-muted shadow-lg">
          No matches.
        </div>
      )}
    </div>
  );
}
