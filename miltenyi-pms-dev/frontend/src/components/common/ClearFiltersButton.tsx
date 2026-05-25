/**
 * ClearFiltersButton — small reset control rendered alongside a
 * toolbar's filter group.
 *
 * Visibility rule: render NOTHING when no filter is active (`active`
 * is false). Keeping it hidden when there's nothing to clear avoids
 * tempting the user with a dead control and reserves the visual real
 * estate. The parent component decides what counts as "active" (each
 * page's filter model is a little different — sentinel values like
 * `"all"`, empty strings, `undefined`, etc.).
 *
 * UX is deliberately understated: ghost styling so it sits beside
 * primary controls (Export, Bulk Approve) without competing with them.
 */

import { X } from "lucide-react";

interface ClearFiltersButtonProps {
  /** True when at least one filter is currently narrowing the result
   *  set (and is therefore worth offering to reset). When false, the
   *  button doesn't render at all. */
  readonly active: boolean;
  /** Resets every filter (and the search query when applicable) back
   *  to its default. Implemented by the parent because filter shapes
   *  vary across pages. */
  readonly onClear: () => void;
  /** Optional override for the visible label. Defaults to
   *  "Clear filters" which fits most call sites. */
  readonly label?: string;
}

export function ClearFiltersButton({
  active,
  onClear,
  label = "Clear filters",
}: ClearFiltersButtonProps) {
  if (!active) return null;
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-white px-2.5 py-1.5 text-[12px] font-medium text-text-muted hover:bg-slate-50 hover:text-text-main transition-colors"
      title="Clear all filters and search"
    >
      <X className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
    </button>
  );
}
