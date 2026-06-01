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

import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { Pagination } from "@/components/common/Pagination";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  ClipboardCheck, Eye, LayoutGrid, Search,
  Table2, UserCircle, Users,
} from "lucide-react";
import {
  annualReviewService,
  type MenteeAnnualReview,
  type MenteeReviewsFilters,
  type MenteeReviewsSortBy,
} from "@/services/annual-review.service";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { ReviewStatusBadge } from "@/components/reviews/ReviewStatusBadge";
import { PerformanceRatingBadge } from "@/components/reviews/PerformanceRatingBadge";
import { AnnualReviewDetailModal } from "@/components/reviews/AnnualReviewDetailModal";
import { ClearFiltersButton } from "@/components/common/ClearFiltersButton";
import { SortableHeader } from "@/components/SortableHeader";
import { type SortState } from "@/utils/sort";
import { extractFyToken, formatFyLabel, fyTokenToStartYear } from "@/utils/fy";

type ViewMode = "grid" | "table";
type SortKey =
  | "employee_name"
  | "cycle_name"
  | "status"
  | "self_performance_rating"
  | "mentor_performance_rating"
  | "management_performance_rating";

// SORT_CONFIG used to drive client-side sort. Server-side sort
// (PR #48, doc 31) makes the accessor map unnecessary; the SortKey
// literal-union above is still the authoritative column list
// (mirrors backend _MENTEE_REVIEWS_SORT_COLUMNS).

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
  const [viewMode, setViewMode] = useState<ViewMode>("table");

  // ── Filter state (PR #46, doc 29) ───────────────────────────────
  // Consolidated filter object that flows into the queryKey. `search`
  // is debounced before reaching the queryKey to avoid a request per
  // keystroke (see useDebouncedValue + doc 29 Part 4). The input
  // element keeps binding to `searchInput` for instant echo; the
  // query reads `effectiveFilters` which lags by `delayMs`.
  //
  // Status default `pending_mentor` — Mentor's primary job here is
  // evaluating mentee submissions. Defaulting to "all" forced the
  // Mentor to narrow every session before they could act.
  const [filters, setFilters] = useState<MenteeReviewsFilters>({
    status: "pending_mentor",
  });
  const [searchInput, setSearchInput] = useState("");

  // Read deep-link `?status=` on first mount and seed the filter so
  // dashboard CTAs (MenteeReviewFunnelCard "View all") land Mentor on
  // the matching status bucket. Pure read-on-mount — no URL write-back
  // yet (deferred). Ref guard fires once per mount; user dropdown
  // edits after that are preserved.
  const [searchParams] = useSearchParams();
  const teamReviewDefaultedRef = useRef(false);
  useEffect(() => {
    if (teamReviewDefaultedRef.current) return;
    const urlStatus = searchParams.get("status");
    if (urlStatus) {
      setFilters((prev) => ({
        ...prev,
        status: urlStatus as MenteeReviewsFilters["status"],
      }));
    }
    teamReviewDefaultedRef.current = true;
  }, [searchParams]);
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  const effectiveFilters: MenteeReviewsFilters = {
    ...filters,
    search: debouncedSearch || undefined,
  };
  const filterParams: Record<string, string | number> = Object.fromEntries(
    Object.entries(effectiveFilters).filter(
      ([, v]) => v !== undefined && v !== "",
    ),
  ) as Record<string, string | number>;

  const setFilter = <K extends keyof MenteeReviewsFilters>(
    key: K,
    value: MenteeReviewsFilters[K] | "" | "all",
  ) => {
    setFilters({
      ...filters,
      [key]: value === "" || value === "all" ? undefined : value,
    });
  };
  // The dropdown stores FY tokens like "FY26-27" / "FY26"; the backend
  // expects an integer fy_year (2026). fyTokenToStartYear converts;
  // null falls through to "no filter" (defensive — shouldn't fire for
  // valid dropdown options). The reverse-mapping for the dropdown's
  // `value` prop is computed inline near the <select> below since
  // `reviews` (the option source) isn't in scope here.
  const setYearFilter = (value: string) => {
    if (value === "" || value === "all") {
      setFilters({ ...filters, fy_year: undefined });
      return;
    }
    const year = fyTokenToStartYear(value);
    setFilters({ ...filters, fy_year: year ?? undefined });
  };

  const [sort, setSort] = useState<SortState<SortKey> | null>(null);
  const [viewTarget, setViewTarget] = useState<MenteeAnnualReview | null>(null);

  // Merge filter + sort into the request params (PR #48, doc 31).
  const requestParams: Record<string, string | number> = {
    ...filterParams,
    ...(sort
      ? { sort_by: sort.key, sort_dir: sort.direction }
      : {}),
  };

  // Classic-pagination rewrite (PR #74): useInfiniteQuery → useQuery
  // + <Pagination>. page is 1-indexed; pageSize default 25.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const requestParamsKey = JSON.stringify(requestParams);
  useEffect(() => {
    setPage(1);
  }, [requestParamsKey]);

  // The mentor's view of every mentee's annual review. Cache-keyed
  // under ['annual-reviews', 'mentees']. EvalDrawer / useReviewDetails
  // mutations invalidate this key so the table refreshes after a
  // submit. refetchOnWindowFocus (default true) also handles the
  // "I just reviewed a mentee in another tab" case.
  //
  // Server-side filters + sort: each (filter, sort, page, pageSize)
  // tuple lives in its own cache entry. Broadcast invalidation on
  // `annualReviews.all` (fired by EvalDrawer's mutations) catches
  // every variant.
  const reviewsQueryKeyParams: Record<string, string | number> = {
    ...requestParams,
    _page: page,
    _pageSize: pageSize,
  };
  const reviewsQuery = useQuery({
    queryKey: queryKeys.annualReviews.mentees(reviewsQueryKeyParams),
    queryFn: () =>
      annualReviewService.getMenteeReviews({
        ...(requestParams as Record<string, string | number> & {
          sort_by?: MenteeReviewsSortBy;
        }),
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
  });
  // Single page slice — no flatten.
  const reviews: MenteeAnnualReview[] = reviewsQuery.data?.items ?? [];
  // Total review count returned by the server (same across pages).
  const totalReviews = reviewsQuery.data?.total ?? 0;
  const isLoading = reviewsQuery.isPending;

  const availableYears = Array.from(
    new Set(reviews.map((r) => extractFyToken(r.cycle_name))),
  ).sort((a, b) => b.localeCompare(a));

  // Mentee dropdown options derive from the loaded rows so we never show
  // a name that has no row to match against.
  const availableMentees = Array.from(
    new Set(reviews.map((r) => r.employee_name).filter(Boolean)),
  ).sort();

  // Status options are the four AnnualReview lifecycle states. We render
  // them via a static list rather than deriving from rows so the dropdown
  // is stable even when only some statuses are present in the data.
  const STATUS_OPTIONS: { value: string; label: string }[] = [
    { value: "draft",              label: "Draft" },
    { value: "pending_mentor",     label: "Pending Mentor" },
    { value: "pending_management", label: "Pending Management" },
    { value: "completed",          label: "Completed" },
  ];

  // `reviews` is the server-filtered AND server-sorted universe
  // (PR #46 for filter, PR #48 for sort). No client-side narrowing
  // or re-sorting needed.
  const sorted = reviews;

  // Boolean used by counter + empty-state branching. `pending_mentor`
  // is the page default (Mentor's first task), so it doesn't count as
  // a "filter applied" state — Clear Filters only activates when the
  // Mentor has narrowed beyond / off the default. Same default-aware
  // shape used by PrimaryEvaluationTab + UsersTab.
  const hasActiveFilters =
    searchInput !== "" ||
    Object.entries(filters).some(([key, value]) => {
      if (value === undefined || value === "") return false;
      if (key === "status" && value === "pending_mentor") return false;
      return true;
    });

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
      {/* Toolbar. Stays visible when active filters return zero results
          (so user can clear them); only hides when truly empty (no
          mentees, no active filters). */}
      {(reviews.length > 0 || hasActiveFilters) && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="relative flex-1 max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
              <input
                type="text"
                placeholder="Search mentees…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
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
                // The dropdown stores FY tokens; round-trip the backend
                // integer to the matching token, falling back to "all"
                // when the integer doesn't correspond to any loaded
                // cycle (unlikely except after URL-state hacking).
                value={
                  filters.fy_year === undefined
                    ? "all"
                    : (availableYears.find(
                        (tok) => fyTokenToStartYear(tok) === filters.fy_year,
                      ) ?? "all")
                }
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
            <div className="flex items-center gap-2">
              <label
                htmlFor="team-review-status-filter"
                className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
              >
                Status
              </label>
              <select
                id="team-review-status-filter"
                value={filters.status ?? "all"}
                onChange={(e) =>
                  setFilter(
                    "status",
                    e.target.value as MenteeReviewsFilters["status"] | "all",
                  )
                }
                className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[150px] cursor-pointer"
              >
                <option value="all">All</option>
                {STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            {availableMentees.length > 0 && (
              <div className="flex items-center gap-2">
                <label
                  htmlFor="team-review-mentee-filter"
                  className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
                >
                  Mentee
                </label>
                <select
                  id="team-review-mentee-filter"
                  value={filters.mentee ?? "all"}
                  onChange={(e) => setFilter("mentee", e.target.value)}
                  className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[140px] cursor-pointer"
                >
                  <option value="all">All</option>
                  {availableMentees.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <span className="text-xs text-text-muted">
              {/* Both halves now reflect the server-filtered universe;
                  "Loaded X of Y" by the Load More button covers the
                  paging-progress angle. */}
              {totalReviews}{" "}
              {totalReviews === 1 ? "match" : "matches"}
            </span>
            <ClearFiltersButton
              active={hasActiveFilters}
              onClear={() => {
                setSearchInput("");
                // Reset to the page default (status=pending_mentor),
                // not an empty filter object. "Clear" means "go back
                // to the entry state", which for this tab is the
                // actionable subset, not the universe.
                setFilters({ status: "pending_mentor" });
              }}
            />
          </div>
        </div>
      )}

      {/* Content. Empty `reviews` could mean "mentor has no mentee
          reviews" or "filter set returned nothing"; the EmptyState
          branches accordingly. The `filtered.length === 0` legacy
          path is gone (we don't client-filter anymore). */}
      {reviews.length === 0 ? (
        <EmptyState hasFilter={hasActiveFilters} />
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
          <table className="w-full min-w-max text-[13px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-border">
                {/* Running row number ("#") — cumulative across pages,
                    table view only (Cards view doesn't surface a row
                    number concept). Matches the "Showing N–M of T"
                    counter at the bottom. */}
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted w-12">
                  #
                </th>
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
                <th className="text-left px-4 py-2.5">
                  <SortableHeader
                    label="Self Rating"
                    columnKey="self_performance_rating"
                    sort={sort}
                    onSort={setSort}
                  />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader
                    label="Your Rating"
                    columnKey="mentor_performance_rating"
                    sort={sort}
                    onSort={setSort}
                  />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader
                    label="Management Rating"
                    columnKey="management_performance_rating"
                    sort={sort}
                    onSort={setSort}
                  />
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {sorted.map((r, idx) => {
                const canEvaluate = r.status === "pending_mentor";
                const canView =
                  r.status === "pending_management" ||
                  r.status === "completed";

                return (
                  <tr
                    key={r.id}
                    className="hover:bg-slate-50/60 transition-colors"
                  >
                    <td className="px-4 py-3 text-text-muted tabular-nums text-xs">
                      {((page - 1) * pageSize + idx + 1).toLocaleString()}
                    </td>
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

      {/* Pagination toolbar — appears below either view mode (grid or
          table). The Pagination component handles its own "no rows"
          state internally so we don't need a hasNextPage gate here. */}
      {reviews.length > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={totalReviews}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
          entityLabel="reviews"
        />
      )}

      {viewTarget && (
        <AnnualReviewDetailModal
          review={viewTarget}
          title={`${viewTarget.employee_name} · Annual Review`}
          subtitle={`Year: ${formatFyLabel(viewTarget.cycle_name)}${
            viewTarget.function ? ` · ${viewTarget.function}` : ""
          }`}
          onClose={() => setViewTarget(null)}
        />
      )}
    </div>
  );
}
