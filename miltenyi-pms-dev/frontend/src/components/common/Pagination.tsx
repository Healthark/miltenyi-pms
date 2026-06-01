/**
 * Pagination — classic per-page selector + prev/next + page indicator.
 *
 * Drop-in toolbar for any paginated list. Presentation-only: the parent
 * owns `page` and `pageSize` state and reacts to the change callbacks.
 *
 * Layout (single row, three groups):
 *
 *   [Per page: 25 ▼]   Showing 51–75 of 247   [«] [‹]  Page 3 of 10  [›] [»]
 *
 * Design choices:
 *  - Page-size dropdown reuses the same Tailwind styling as the HR
 *    Dashboard's Cycle picker so visual language matches the rest of
 *    the app's filter dropdowns.
 *  - Only first/prev/next/last buttons — no per-page-number buttons.
 *    Rationale: at per-page=10 a 1000-row table is 100 pages and a
 *    numbered list becomes unusable. "Page X of Y" + first/last covers
 *    the worst case; a "Jump to page" input can land later if asked.
 *  - Empty state (`total === 0`): renders "No {entityLabel} match
 *    these filters" and hides the dropdown + nav controls so the
 *    toolbar doesn't read as "Showing 0–0 of 0".
 *  - Single-page case keeps the layout stable — dropdown + nav both
 *    render, nav buttons just disable. Predictable for the user.
 *  - Defaults pageSizeOptions to [10, 25, 50] — the project-wide
 *    locked-in set. Callers can override if a surface needs different
 *    options later.
 */

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";

interface PaginationProps {
  /** 1-indexed current page. */
  readonly page: number;
  /** Rows per page. */
  readonly pageSize: number;
  /** Total rows across all pages (server's `total` field). */
  readonly total: number;
  readonly onPageChange: (page: number) => void;
  /** Caller is responsible for resetting `page` to 1 in this handler —
   *  the component intentionally doesn't drive that side-effect so
   *  parents that need other reset behaviour (e.g. preserve first
   *  visible row) can opt in. The convention here is "reset to 1". */
  readonly onPageSizeChange: (size: number) => void;
  /** Page-size choices the dropdown offers. Defaults to [10, 25, 50] —
   *  the locked-in app-wide set. Override only when a surface has
   *  unusual cardinality needs. */
  readonly pageSizeOptions?: readonly number[];
  /** Plural entity name for the counter + empty-state copy
   *  ("reviews", "users", "projects"). Defaults to "rows". */
  readonly entityLabel?: string;
}

// Match the HR Dashboard cycle picker exactly so the filter-area
// dropdown visual language stays consistent. The min-width keeps the
// numeric "10" option from looking too small next to longer "Per page"
// labels.
const SELECT_CLS =
  "rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer min-w-[80px] disabled:opacity-50";

// Nav button styling — pulled from the existing "Load more" button
// across the 5 paginated surfaces so the new control inherits the
// established button shape (border + bg + rounded + disabled state).
const NAV_BUTTON_CLS =
  "inline-flex items-center justify-center rounded-lg border border-border bg-white px-2.5 py-1.5 text-[13px] text-text-main hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors";

const LABEL_CLS =
  "text-[11px] font-bold uppercase tracking-wider text-text-muted";

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 25, 50] as const;

export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
  entityLabel = "rows",
}: PaginationProps) {
  // Total pages — `Math.max(1, …)` so a 0-total or empty-filter result
  // still reports "Page 1 of 1" rather than "Page 1 of 0", which reads
  // wrong even when nav is hidden.
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  // Clamp the rendered page to the legal range. Defensive — the parent
  // SHOULD reset page to 1 when filters narrow the result set, but if
  // a race causes page > totalPages briefly, we render the legal value
  // instead of "Page 7 of 3".
  const safePage = Math.min(Math.max(1, page), totalPages);

  // 1-indexed start/end row numbers for the counter copy.
  const firstRow = total === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const lastRow = Math.min(safePage * pageSize, total);

  const atFirst = safePage <= 1;
  const atLast = safePage >= totalPages;

  // ── Empty state ───────────────────────────────────────────────────
  // Hide dropdown + nav entirely — a "Per page: 25" + "Page 1 of 1"
  // toolbar over an empty table is more noise than information. The
  // counter line alone tells HR what they need to know.
  if (total === 0) {
    return (
      <div className="flex items-center justify-center py-3 text-sm text-text-muted">
        No {entityLabel} match these filters.
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-3 px-1">
      {/* Group 1: per-page selector */}
      <div className="flex items-center gap-2">
        <label htmlFor="pagination-page-size" className={LABEL_CLS}>
          Per page
        </label>
        <select
          id="pagination-page-size"
          value={pageSize}
          onChange={(e) => onPageSizeChange(Number(e.target.value))}
          className={SELECT_CLS}
          aria-label="Rows per page"
        >
          {pageSizeOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>

      {/* Group 2: counter — "Showing 51–75 of 247 reviews" */}
      <div className="text-xs text-text-muted">
        Showing {firstRow.toLocaleString()}–{lastRow.toLocaleString()} of{" "}
        {total.toLocaleString()} {entityLabel}
      </div>

      {/* Group 3: navigation */}
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onPageChange(1)}
          disabled={atFirst}
          className={NAV_BUTTON_CLS}
          aria-label="First page"
        >
          <ChevronsLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(safePage - 1)}
          disabled={atFirst}
          className={NAV_BUTTON_CLS}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="px-2 text-[13px] text-text-main tabular-nums">
          Page <strong className="font-semibold">{safePage}</strong> of{" "}
          {totalPages.toLocaleString()}
        </span>
        <button
          type="button"
          onClick={() => onPageChange(safePage + 1)}
          disabled={atLast}
          className={NAV_BUTTON_CLS}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => onPageChange(totalPages)}
          disabled={atLast}
          className={NAV_BUTTON_CLS}
          aria-label="Last page"
        >
          <ChevronsRight className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
