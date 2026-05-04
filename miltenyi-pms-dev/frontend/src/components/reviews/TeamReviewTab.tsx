/**
 * TeamReviewTab.tsx — Mentor's unified workspace for team annual reviews.
 *
 * Replaces the separate "Mentee Review" and "Team Review" tabs with one
 * surface: the mentor sees every mentee's review across cycles, evaluates
 * the ones in pending_mentor, and views the rest read-only via the same
 * detail modal the mentee's own "My Review" uses.
 *
 * Action column by status:
 *   pending_mentor     → Evaluate  (opens EvalModal with side-by-side form)
 *   pending_management → View      (read-only detail modal)
 *   completed          → View      (read-only detail modal)
 *   draft              → "Awaiting self-review" (mentee hasn't submitted)
 */

import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  ClipboardCheck, Eye, LayoutGrid, Search,
  Table2, UserCircle, Users,
} from "lucide-react";
import {
  annualReviewService,
  type MenteeAnnualReview,
} from "../../services/annual-review.service";
import { ReviewStatusBadge } from "./ReviewStatusBadge";
import { PerformanceRatingBadge } from "./PerformanceRatingBadge";
import { AnnualReviewDetailModal } from "./AnnualReviewDetailModal";
import { SortableHeader } from "../SortableHeader";
import { compareValues, type SortKind, type SortState } from "../../utils/sort";
import { extractFyToken, formatFyLabel } from "../../utils/fy";

type ViewMode = "grid" | "table";
type SortKey = "employee_name" | "cycle_name" | "status";

const SORT_CONFIG: Record<
  SortKey,
  { kind: SortKind; get: (r: MenteeAnnualReview) => unknown }
> = {
  employee_name: { kind: "alpha", get: (r) => r.employee_name },
  cycle_name:    { kind: "alpha", get: (r) => r.cycle_name },
  status:        { kind: "alpha", get: (r) => r.status },
};

// ── Card ────────────────────────────────────────────────────────────

function TeamReviewCard({
  review,
  onEvaluate,
  onView,
}: {
  readonly review: MenteeAnnualReview;
  readonly onEvaluate: (r: MenteeAnnualReview) => void;
  readonly onView: (r: MenteeAnnualReview) => void;
}) {
  const canEvaluate = review.status === "pending_mentor";
  const canView =
    review.status === "pending_management" || review.status === "completed";

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <UserCircle
            className="h-5 w-5 text-text-muted shrink-0"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="font-medium text-text-main truncate">
              {review.employee_name}
            </p>
            {review.designation && (
              <p className="text-[11px] text-text-muted truncate">
                {review.designation}
              </p>
            )}
          </div>
        </div>
        <span className="text-[11px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded shrink-0">
          {formatFyLabel(review.cycle_name)}
        </span>
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
          <span className="text-text-muted">Yours</span>
          <PerformanceRatingBadge value={review.mentor_performance_rating} />
        </div>
      </div>

      {canEvaluate ? (
        <button
          type="button"
          onClick={() => onEvaluate(review)}
          className="mt-auto flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          <ClipboardCheck className="h-4 w-4" aria-hidden="true" />
          Evaluate
        </button>
      ) : canView ? (
        <button
          type="button"
          onClick={() => onView(review)}
          className="mt-auto flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-main hover:bg-slate-50 transition-colors"
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
          View Review
        </button>
      ) : (
        <div className="mt-auto flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm italic text-text-muted">
          Awaiting self-review
        </div>
      )}
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────

function EmptyState({ hasFilter }: { readonly hasFilter: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
      <Users className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
      <p className="font-display text-base font-medium text-text-main">
        {hasFilter ? "No reviews match this filter" : "No mentee reviews yet"}
      </p>
      <p className="mt-1 text-sm text-text-muted">
        {hasFilter
          ? "Try selecting a different filter above."
          : "Your mentees haven't submitted their self-reviews yet."}
      </p>
    </div>
  );
}

// ── Main ────────────────────────────────────────────────────────────

export function TeamReviewTab() {
  const navigate = useNavigate();
  const [reviews, setReviews] = useState<MenteeAnnualReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [yearFilter, setYearFilter] = useState("all");
  const [sort, setSort] = useState<SortState<SortKey> | null>(null);
  const [viewTarget, setViewTarget] = useState<MenteeAnnualReview | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setReviews(await annualReviewService.getMenteeReviews());
    } catch {
      /* stays empty */
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
        r.employee_name.toLowerCase().includes(searchQuery.toLowerCase()),
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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse">
        Loading team reviews…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      {reviews.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
              <input
                type="text"
                placeholder="Search mentees…"
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
                htmlFor="team-review-year-filter"
                className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
              >
                Year
              </label>
              <select
                id="team-review-year-filter"
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
      )}

      {/* Content */}
      {reviews.length === 0 ? (
        <EmptyState hasFilter={false} />
      ) : filtered.length === 0 ? (
        <EmptyState hasFilter={true} />
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((r) => (
            <TeamReviewCard
              key={r.id}
              review={r}
              onEvaluate={(rev) => navigate(`/my-mentees/${rev.user_id}?tab=summary`)}
              onView={setViewTarget}
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
                    label="Mentee"
                    columnKey="employee_name"
                    sort={sort}
                    onSort={setSort}
                  />
                </th>
                <th className="text-left px-4 py-2.5">
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
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Self Rating
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Your Rating
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Management Rating
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {sorted.map((r) => {
                const canEvaluate = r.status === "pending_mentor";
                const canView =
                  r.status === "pending_management" ||
                  r.status === "completed";

                return (
                  <tr
                    key={r.id}
                    className="hover:bg-slate-50/60 transition-colors"
                  >
                    <td className="px-5 py-3 font-medium text-text-main">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <UserCircle className="h-3.5 w-3.5 text-text-muted shrink-0" />
                        <span className="truncate">{r.employee_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                        {formatFyLabel(r.cycle_name)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <ReviewStatusBadge status={r.status} />
                    </td>
                    <td className="px-4 py-3">
                      {r.self_performance_rating != null ? (
                        <PerformanceRatingBadge value={r.self_performance_rating} />
                      ) : (
                        <span className="text-[11px] italic text-text-muted">Not rated yet</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.mentor_performance_rating != null ? (
                        <PerformanceRatingBadge value={r.mentor_performance_rating} />
                      ) : (
                        <span className="text-[11px] italic text-text-muted">Not rated yet</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {r.management_performance_rating != null ? (
                        <PerformanceRatingBadge value={r.management_performance_rating} />
                      ) : (
                        <span className="text-[11px] italic text-text-muted">Not rated yet</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {canEvaluate ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/my-mentees/${r.user_id}?tab=summary`)}
                          className="flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand hover:text-white transition-colors"
                        >
                          <ClipboardCheck className="h-3 w-3" /> Evaluate
                        </button>
                      ) : canView ? (
                        <button
                          type="button"
                          onClick={() => setViewTarget(r)}
                          className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-text-muted hover:bg-brand/10 hover:text-brand transition-colors"
                        >
                          <Eye className="h-3 w-3" /> View
                        </button>
                      ) : (
                        <span className="text-[11px] italic text-text-muted">
                          Awaiting self-review
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {viewTarget && (
        <AnnualReviewDetailModal
          review={viewTarget}
          title={`${viewTarget.employee_name} · Annual Review`}
          subtitle={`Year: ${formatFyLabel(viewTarget.cycle_name)}${
            viewTarget.department ? ` · ${viewTarget.department}` : ""
          }`}
          onClose={() => setViewTarget(null)}
        />
      )}
    </div>
  );
}
