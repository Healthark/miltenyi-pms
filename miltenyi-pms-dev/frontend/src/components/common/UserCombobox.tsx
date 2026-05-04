/**
 * UserCombobox.tsx — type-to-filter single-select user picker.
 *
 * Used by ProjectModal for "PM Reports To" and "Secondary Evaluator" where
 * the org may have hundreds of users and a plain <select> is unusable.
 *
 * Vanilla React + Tailwind, no external library. Keyboard navigable
 * (Arrow keys, Enter, Escape) and click-outside dismisses the list.
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { KeyboardEvent } from "react";
import { ChevronDown, Check, X } from "lucide-react";
import type { UserResponse } from "../../services/admin.service";

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 pr-8 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-text-muted mb-1";

export interface UserComboboxProps {
  readonly users: readonly UserResponse[];
  readonly value: number | null;
  readonly onChange: (userId: number | null) => void;
  readonly label: string;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly disabled?: boolean;
  readonly error?: string | null;
  /** Hide these user ids from the suggestion list. */
  readonly excludeIds?: readonly number[];
}

function userLabel(u: UserResponse): string {
  return `${u.full_name} (${u.role})`;
}

export function UserCombobox({
  users,
  value,
  onChange,
  label,
  placeholder = "Type to search…",
  required = false,
  disabled = false,
  error = null,
  excludeIds,
}: UserComboboxProps) {
  const id = useId();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);

  const selected = useMemo(
    () => users.find((u) => u.id === value) ?? null,
    [users, value],
  );

  // When `value` changes externally (e.g. form reset, edit mode hydrate),
  // keep the displayed text in sync.
  useEffect(() => {
    if (!open) setQuery(selected ? userLabel(selected) : "");
  }, [selected, open]);

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

  const excludeSet = useMemo(
    () => new Set(excludeIds ?? []),
    [excludeIds],
  );

  const filtered = useMemo(() => {
    const pool = users.filter((u) => !excludeSet.has(u.id) || u.id === value);
    const q = query.trim().toLowerCase();
    if (!q) return pool;
    return pool.filter((u) =>
      `${u.full_name} ${u.email} ${u.role}`.toLowerCase().includes(q),
    );
  }, [users, query, excludeSet, value]);

  const commit = (userId: number | null) => {
    onChange(userId);
    const u = users.find((x) => x.id === userId) ?? null;
    setQuery(u ? userLabel(u) : "");
    setOpen(false);
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
      if (open && filtered[activeIdx]) {
        e.preventDefault();
        commit(filtered[activeIdx].id);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery(selected ? userLabel(selected) : "");
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <label htmlFor={id} className={LABEL_CLS}>
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      <div className="relative">
        <input
          id={id}
          ref={inputRef}
          type="text"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-listbox`}
          disabled={disabled}
          className={`${INPUT_CLS} ${error ? "border-red-400 ring-1 ring-red-300" : ""}`}
          placeholder={placeholder}
          value={query}
          onFocus={() => {
            setOpen(true);
            setActiveIdx(0);
            if (selected) setQuery("");
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIdx(0);
          }}
          onKeyDown={handleKey}
        />
        {selected && !disabled ? (
          <button
            type="button"
            onClick={() => {
              commit(null);
              inputRef.current?.focus();
            }}
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
      </div>

      {open && filtered.length > 0 && (
        <ul
          id={`${id}-listbox`}
          role="listbox"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border border-border bg-white py-1 shadow-lg"
        >
          {filtered.map((u, idx) => {
            const isActive = idx === activeIdx;
            const isSelected = u.id === value;
            return (
              <li
                key={u.id}
                role="option"
                aria-selected={isSelected}
                className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${
                  isActive ? "bg-brand-light text-brand" : "text-text-main"
                }`}
                onMouseEnter={() => setActiveIdx(idx)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  commit(u.id);
                }}
              >
                {isSelected ? (
                  <Check className="h-3.5 w-3.5 text-brand" aria-hidden="true" />
                ) : (
                  <span className="w-3.5" />
                )}
                <span className="flex-1 truncate">{u.full_name}</span>
                <span className="text-xs text-text-muted">{u.role}</span>
              </li>
            );
          })}
        </ul>
      )}

      {open && filtered.length === 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-muted shadow-lg">
          No matching users.
        </div>
      )}

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
