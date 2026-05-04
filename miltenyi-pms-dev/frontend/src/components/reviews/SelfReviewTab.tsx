/**
 * SelfReviewTab.tsx — "My Review" list for the logged-in user.
 *
 * Presentational: receives the review history from the parent page and renders
 * a toolbar (search + year filter + card/table toggle) over the list. The
 * "Start Self-Review" action lives in the AnnualReviews page header so it
 * stays reachable regardless of list state; this tab only shows the
 * read-only empty state when the user has no reviews at all.
 */

import { useState } from "react";
import {
  Eye, LayoutGrid, Loader2, Lock, Search, Table2, UserCircle,
  ClipboardCheck,
} from "lucide-react";
import type { AnnualReview } from "../../services/annual-review.service";
import { ReviewStatusBadge } from "./ReviewStatusBadge";
import { PerformanceRatingBadge } from "./PerformanceRatingBadge";
import { AnnualReviewDetailModal } from "./AnnualReviewDetailModal";
import { SortableHeader } from "../SortableHeader";
import { compareValues, type SortKind, type SortState } from "../../utils/sort";
import { extractFyToken, formatFyLabel } from "../../utils/fy";
import { useSystemSettings } from "../../hooks/useSystemSettings";

function FinalRatingHiddenBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-text-muted/60">
      <Lock className="h-3 w-3" aria-hidden="true" /> Hidden
    </span>
  );
}

type ViewMode = "grid" | "table";
type SortKey = "cycle_name" | "status" | "self_performance_rating";

const SORT_CONFIG: Record<
  SortKey,
  { kind: SortKind; get: (r: AnnualReview) => unknown }
> = {
  cycle_name:              { kind: "alpha",   get: (r) => r.cycle_name },
  status:                  { kind: "alpha",   get: (r) => r.status },
  self_performance_rating: { kind: "numeric", get: (r) => r.self_performance_rating },
};

// ── Card ────────────────────────────────────────────────────────────

function SelfReviewCard({
  review,
  onView,
  finalRatingVisible,
}: {
  readonly review: AnnualReview;
  readonly onView: (r: AnnualReview) => void;
  readonly finalRatingVisible: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardCheck
            className="h-5 w-5 text-text-muted shrink-0"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="font-medium text-text-main truncate">
              {formatFyLabel(review.cycle_name)}
            </p>
            <p className="text-[11px] text-text-muted">Self-Review</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <ReviewStatusBadge status={review.status} />
      </div>

      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Self</span>
          <PerformanceRatingBadge value={review.self_performance_rating} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Final</span>
          {finalRatingVisible ? (
            <PerformanceRatingBadge value={review.final_performance_rating} />
          ) : (
            <FinalRatingHiddenBadge />
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onView(review)}
        className="mt-auto flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-main hover:bg-slate-50 transition-colors"
      >
        <Eye className="h-4 w-4" aria-hidden="true" />
        View
      </button>
    </div>
  );
}

// ── Empty state (only when the user has zero reviews in DB) ─────────

function NoReviewsEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center">
      <ClipboardCheck
        className="h-10 w-10 text-text-muted mb-3"
        aria-hidden="true"
      />
      <p className="font-display text-base font-medium text-text-main">
        No self-reviews yet
      </p>
      <p className="mt-1 text-sm text-text-muted max-w-sm">
        Reflect on your performance and submit when ready.
      </p>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse gap-2">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      Loading your reviews…
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────

interface SelfReviewTabProps {
  readonly reviews: readonly AnnualReview[];
  readonly isLoading: boolean;
}

export function SelfReviewTab({ reviews, isLoading }: SelfReviewTabProps) {
  const { settings } = useSystemSettings();
  const finalRatingVisible =
    settings?.annual_review_final_rating_visible ?? false;

  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortState<SortKey> | null>(null);

  const [viewTarget, setViewTarget] = useState<AnnualReview | null>(null);

  const availableYears = Array.from(
    new Set(reviews.map((r) => extractFyToken(r.cycle_name))),
  ).sort((a, b) => b.localeCompare(a));

  const filtered = reviews
    .filter(
      (r) => yearFilter === "all" || extractFyToken(r.cycle_name) === yearFilter,
    )
    .filter(
      (r) =>
        searchQuery.trim() === "" ||
        r.cycle_name.toLowerCase().includes(searchQuery.toLowerCase()),
    );

  const sorted = sort
    ? filtered.slice().sort((a, b) => {
        const { kind, get } = SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : filtered;

  const viewBtnCls = (mode: ViewMode) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
      viewMode === mode
        ? "bg-brand/10 text-brand"
        : "text-text-muted hover:bg-slate-100"
    }`;

  if (isLoading) return <LoadingState />;

  if (reviews.length === 0) return <NoReviewsEmptyState />;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Search by cycle…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-1.5 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-white p-0.5">
            <button
              type="button"
              className={viewBtnCls("grid")}
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Cards
            </button>
            <button
              type="button"
              className={viewBtnCls("table")}
              onClick={() => setViewMode("table")}
            >
              <Table2 className="h-3.5 w-3.5" /> Table
            </button>
          </div>
        </div>

        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label
              htmlFor="self-review-year-filter"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Year
            </label>
            <select
              id="self-review-year-filter"
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[120px] cursor-pointer"
            >
              <option value="all">All Years</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {formatFyLabel(y)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
          <UserCircle
            className="h-10 w-10 text-text-muted mb-3"
            aria-hidden="true"
          />
          <p className="font-display text-base font-medium text-text-main">
            No reviews match this filter
          </p>
          <p className="mt-1 text-sm text-text-muted">
            Try selecting a different year.
          </p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((r) => (
            <SelfReviewCard
              key={r.id}
              review={r}
              onView={setViewTarget}
              finalRatingVisible={finalRatingVisible}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-border">
                <th className="text-left px-5 py-2.5">
                  <SortableHeader
                    label="Year"
                    columnKey="cycle_name"
                    sort={sort}
                    onSort={setSort}
                  />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader
                    label="Status"
                    columnKey="status"
                    sort={sort}
                    onSort={setSort}
                  />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader
                    label="Self Rating"
                    columnKey="self_performance_rating"
                    sort={sort}
                    onSort={setSort}
                  />
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Final Rating
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {sorted.map((r) => (
                <tr
                  key={r.id}
                  className="hover:bg-slate-50/60 transition-colors"
                >
                  <td className="px-5 py-3 font-medium text-text-main">
                    <span className="text-[12.5px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                      {formatFyLabel(r.cycle_name)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <ReviewStatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3">
                    <PerformanceRatingBadge
                      value={r.self_performance_rating}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {finalRatingVisible ? (
                      <PerformanceRatingBadge
                        value={r.final_performance_rating}
                      />
                    ) : (
                      <FinalRatingHiddenBadge />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      type="button"
                      onClick={() => setViewTarget(r)}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-text-muted hover:bg-brand/10 hover:text-brand transition-colors"
                    >
                      <Eye className="h-3 w-3" /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Read-only detail modal */}
      {viewTarget && (
        <AnnualReviewDetailModal
          review={viewTarget}
          title="Self Annual Review"
          subtitle={`Year: ${formatFyLabel(viewTarget.cycle_name)}`}
          onClose={() => setViewTarget(null)}
        />
      )}
    </div>
  );
}
