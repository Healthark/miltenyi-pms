/**
 * ManagementReview.tsx — Standalone Management Review page.
 *
 * Only routable for HR_MyOrg (the platform owner's HR). The backend
 * enforces the same gate via `_require_management` on every endpoint
 * this page touches — this is purely a UI affordance.
 *
 * Lists every active Employee in the org for the active cycle,
 * LEFT-joined against their AnnualReview row, and lets HR_MyOrg
 * set/override the management rating inline once the mentor has
 * submitted. View and Edit affordances are gated per stage.
 */

import { useMemo, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Eye,
  Loader2,
  Pencil,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  annualReviewService,
  type CalibrationFilters,
  type CalibrationRow,
  type CalibrationSortBy,
  type ReviewStatus,
} from "@/services/annual-review.service";
import { queryKeys } from "@/lib/queryKeys";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { patchRowsAcross } from "@/lib/optimistic";
import { PerformanceRatingBadge } from "@/components/reviews/PerformanceRatingBadge";
import { PerformanceRatingSelect } from "@/components/reviews/PerformanceRatingSelect";
import { ReviewStatusBadge } from "@/components/reviews/ReviewStatusBadge";
import { getErrorMessage } from "@/utils/errors";
import { useConfirm } from "@/hooks/useConfirm";
import { useSystemSettings } from "@/hooks/useSystemSettings";

type RatingValue = number | "";
type StatusFilter = "all" | ReviewStatus;
type SortKey =
  | "employee_name"
  | "employee_email"
  | "mentor_name"
  | "function"
  | "designation"
  | "status"
  | "self_performance_rating"
  | "mentor_performance_rating"
  | "management_performance_rating";
type SortDir = "asc" | "desc";

type ModalMode = "view" | "rate";

interface EditTarget {
  readonly row: CalibrationRow;
  readonly mode: ModalMode;
  readonly draft: RatingValue;
}

const COLUMN_DEFS: Array<{ label: string; key: SortKey | null }> = [
  { label: "User",               key: "employee_name" },
  { label: "Email",              key: "employee_email" },
  { label: "Mentor",             key: "mentor_name" },
  { label: "Function",           key: "function" },
  { label: "Designation",        key: "designation" },
  { label: "Status",             key: "status" },
  { label: "Self Review",        key: "self_performance_rating" },
  { label: "Mentor Review",      key: "mentor_performance_rating" },
  { label: "Management Rating",  key: "management_performance_rating" },
  { label: "Actions",            key: null },
];

// Shared 10-column CSS Grid layout used by BOTH the (non-virtualized)
// header row and the (virtualized) data rows. The values mirror the
// pre-virtualization column widths derived from the table-layout
// algorithm's natural sizing on representative data — User/Email/Mentor
// get more room, badges and actions get just enough.
//
// Why CSS Grid instead of the old <table>'s automatic layout: virtualized
// rows are absolutely positioned (transform: translateY(...)), which
// breaks table-row cell alignment. CSS Grid gives us per-row alignment
// that doesn't depend on a shared <table> context, and lets the header
// stay perfectly aligned without us having to thread column widths
// through a Context.
const GRID_TEMPLATE_COLUMNS =
  "minmax(140px, 1.5fr) minmax(170px, 1.8fr) minmax(110px, 1.2fr) minmax(90px, 1fr) minmax(110px, 1.1fr) minmax(140px, 1.3fr) minmax(70px, 0.7fr) minmax(70px, 0.7fr) minmax(90px, 1fr) minmax(135px, 1.2fr)";

// Sum of the GRID_TEMPLATE_COLUMNS minimums. Drives the table's
// min-width so the outer horizontal-scroll wrapper keeps the header
// and body grids aligned on narrow viewports — without it, the body's
// implicit overflow-x (per the y-auto spec interaction) would scroll
// independently of the header.
const TABLE_MIN_WIDTH_PX = 1125;

// Fixed row height (in px) the virtualizer uses to size the scrollbar
// thumb and decide which rows are in-window. py-3.5 (28px total) +
// content (~22px line-height) ≈ 50px; rounded to 52 to leave breathing
// room for badge spacing without forcing measureElement.
const ROW_HEIGHT_PX = 52;

// Scroll container height. Fixed for now; viewport-relative sizing
// (`calc(100vh - 320px)`) is a follow-up if the page header height
// ever drifts. 600px keeps roughly 11 rows visible at once.
const SCROLL_CONTAINER_HEIGHT_PX = 600;

// How many rows beyond the viewport edges to render. Higher = smoother
// scroll on slow devices, more DOM. 8 is the default sweet spot for
// fixed-height rows.
const VIRTUALIZER_OVERSCAN = 8;

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all",                label: "All" },
  { value: "not_started",        label: "Not Started" },
  { value: "draft",              label: "Draft" },
  { value: "pending_mentor",     label: "Pending Mentor" },
  { value: "pending_management", label: "Pending Management" },
  { value: "completed",          label: "Completed" },
];

// STATUS_SORT_WEIGHT used to drive lifecycle-progression ordering on
// the client-side sort. Server-side sort (PR #48, doc 31) orders
// AnnualReview.status lexically. Documented in doc 31 Part 3.

export function ManagementReview() {
  const { settings } = useSystemSettings();
  // Extract bare FY label ("H1 FY26" -> "FY26") for the page header.
  const fyLabel = settings?.active_cycle_name
    ? settings.active_cycle_name.split(" ").find((t) => t.startsWith("FY")) ??
      settings.active_cycle_name
    : null;

  const queryClient = useQueryClient();
  const confirm = useConfirm();

  // ── Filter state (PR #46, doc 29) + sort state (PR #48, doc 31) ────
  // Single consolidated filter object so each value can flow into the
  // queryKey atomically. `search` is debounced before reaching the
  // queryKey so typing a query doesn't fire a request per keystroke.
  // Sort state stays as the existing `sortKey` + `sortDir` two-piece
  // (it's a stable local convention in this file). Both feed into the
  // queryKey via `requestParams` below.
  const [filters, setFilters] = useState<CalibrationFilters>({});
  const [searchInput, setSearchInput] = useState("");
  // 300ms is the standard "just enough to feel reactive without
  // request spam" window. See useDebouncedValue + doc 29 Part 4.
  const debouncedSearch = useDebouncedValue(searchInput, 300);
  // Merge debounced search back into the filter object before piping
  // to the queryKey. Source of truth: the input element binds to
  // `searchInput` (always current); the query reads `effectiveFilters`
  // (search lags by `delayMs`).
  const effectiveFilters: CalibrationFilters = {
    ...filters,
    search: debouncedSearch || undefined,
  };
  const filterParams: Record<string, string> = Object.fromEntries(
    Object.entries(effectiveFilters).filter(
      ([, v]) => v !== undefined && v !== "",
    ),
  ) as Record<string, string>;

  // Sort state — moved up so the queryKey + queryFn (below) can read
  // it. Default to alphabetical ascending; client-side sort used to
  // own this state, server-side sort owns it now (PR #48, doc 31).
  const [sortKey, setSortKey] = useState<SortKey>("employee_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // ── Queries ────────────────────────────────────────────────────────
  // 1. The calibration grid (page-level table).
  //    Paginated as of PR #38 (doc 21). The shape is the simplest case
  //    of the pagination template: each row = one Employee, so
  //    `total` and `items.length` are the same unit (vs the parent/
  //    child split in doc 20). We still use `useInfiniteQuery` here for
  //    consistency with the other paginated endpoints — `flatMap` over
  //    pages produces a row array that the rest of the component
  //    consumes unchanged.
  //
  //    Server-side filters added in PR #46 (doc 29). Each distinct
  //    `filterParams` produces its own cache entry; broadcast
  //    invalidation on `annualReviews.all` still catches every variant
  //    when setManagementRating's onSuccess fires.
  //
  //    - initialPageParam: 0  → first request: ?offset=0&limit=50
  //    - getNextPageParam: derives from has_more on the latest page.
  const CALIBRATION_PAGE_SIZE = 50;
  // Sort state — declared earlier (employee_name asc default). Wire
  // it into the request params alongside filters. `requestParams` is
  // a superset of `filterParams` that includes the active sort.
  const requestParams: Record<string, string> = {
    ...filterParams,
    sort_by: sortKey,
    sort_dir: sortDir,
  };
  const gridQuery = useInfiniteQuery({
    queryKey: queryKeys.annualReviews.calibration(requestParams),
    queryFn: ({ pageParam }) =>
      annualReviewService.getCalibrationGrid({
        ...(requestParams as Record<string, string> & {
          sort_by?: CalibrationSortBy;
        }),
        limit: CALIBRATION_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.offset + lastPage.limit : undefined,
  });
  // Flatten loaded pages → row array. As HR clicks "Load more" this
  // grows; every downstream consumer (filters, sort, virtualizer) sees
  // one combined list. Memoised so the `?? []` fallback doesn't
  // manufacture a fresh array each render and break downstream useMemo
  // dependency stability.
  const rows: CalibrationRow[] = useMemo(
    () => gridQuery.data?.pages.flatMap((p) => p.items) ?? [],
    [gridQuery.data],
  );
  // Total Employee count returned by the server (same on every page,
  // we read it off the latest one). Drives the "Loaded N of T" counter.
  const totalUsers =
    gridQuery.data?.pages[gridQuery.data.pages.length - 1]?.total ?? 0;
  // For paginated queries, `isPending` is true only on the FIRST fetch.
  // Subsequent fetchNextPage() calls flip `isFetchingNextPage` instead —
  // handled separately near the Load More button below.
  const isLoading = gridQuery.isPending;
  const loadError = gridQuery.isError ? getErrorMessage(gridQuery.error) : "";

  // Filter state lives ABOVE the queries (see `filters`, `searchInput`,
  // `debouncedSearch` near the top of the component). Local-only UI
  // helper to translate sentinel values for the dropdown UI:
  const setFilter = <K extends keyof CalibrationFilters>(
    key: K,
    value: CalibrationFilters[K] | "" | "all",
  ) => {
    setFilters({
      ...filters,
      [key]: value === "" || value === "all" ? undefined : value,
    });
  };

  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [saveError, setSaveError] = useState("");

  // 2. The per-review detail — on-demand. `enabled` gates on the Rate
  //    modal actually being open AND having a valid review_id. The
  //    queryKey embeds the id, so opening successive Rate modals
  //    populates separate cache entries (visit two HR sessions, close
  //    the first, and the second is still cached for next-open).
  //
  //    Tradeoff vs the old useEffect: same network round-trip on first
  //    open, but a second open of the SAME review is instant (cache
  //    hit). The legacy code refetched every time the modal opened.
  const editReviewId = editTarget?.row.review_id ?? null;
  const editReviewQuery = useQuery({
    queryKey: queryKeys.annualReviews.detail(editReviewId ?? -1),
    queryFn: () =>
      annualReviewService.getReview(editReviewId as number),
    enabled: editReviewId !== null,
  });
  const editReview = editReviewQuery.data ?? null;
  const isEditReviewLoading = editReviewId !== null && editReviewQuery.isPending;
  const editReviewError = editReviewQuery.isError
    ? getErrorMessage(editReviewQuery.error)
    : "";

  const closeEdit = () => {
    setEditTarget(null);
    setSaveError("");
  };

  // ── Mutation ───────────────────────────────────────────────────────
  // Publishes the management rating for a single review. Broadcast-
  // invalidates everything under `annual-reviews` (catches calibration
  // grid + this review's detail + mentee history + HR's all-reviews)
  // and `dashboard` (the AnnualReviewFunnelCard's completed-count
  // moves when management ratings publish).
  //
  // We could narrow the invalidation to just calibration + detail(id)
  // + dashboard, but the broadcast pattern (established in PR #22) is
  // cleaner — three keys catch every consumer of the affected data,
  // and the wasted-refetch cost on dormant entries is essentially
  // zero (no observer = no refetch).
  // Optimistic update (PR #50, doc 32). The user-visible payoff:
  // clicking "Publish Rating" flips the row's status to "completed"
  // and populates the management-rating column INSTANTLY in the
  // calibration grid, before the network round-trip completes.
  // The modal stays open until the server confirms — keeping it open
  // means errors land in the existing in-modal `saveError` slot
  // (recoverable: user can retry without losing context). The
  // "instant feel" win comes from the row update, not the modal close.
  //
  // Patches across the entire `annual-reviews` namespace because the
  // same review can appear in multiple cache entries (calibration
  // grid + HR's `/annual-reviews/all` if HR has that tab loaded too).
  const setRatingMutation = useMutation({
    mutationFn: (vars: { reviewId: number; rating: number }) =>
      annualReviewService.setManagementRating(vars.reviewId, {
        management_performance_rating: vars.rating,
      }),
    onMutate: async (vars) => {
      // Cancel any in-flight refetches under `annual-reviews` so a
      // stale response can't land AFTER the optimistic patch and
      // overwrite it.
      await queryClient.cancelQueries({
        queryKey: queryKeys.annualReviews.all,
      });
      // Apply the patch across every cache entry containing this
      // review row. `final_performance_rating` mirrors the backend's
      // synthesized fallback (management ?? mentor) so the published
      // value appears immediately.
      const snapshot = patchRowsAcross<CalibrationRow>(
        queryClient,
        queryKeys.annualReviews.all,
        (r) => r.review_id === vars.reviewId,
        {
          management_performance_rating: vars.rating,
          final_performance_rating: vars.rating,
          final_rating_enabled: true,
          status: "completed",
        },
      );
      return { snapshot };
    },
    onSuccess: () => {
      closeEdit();
    },
    onError: (err, _vars, context) => {
      // Rollback — restore every cache entry the patch touched.
      context?.snapshot.restore();
      setSaveError(getErrorMessage(err));
    },
    onSettled: () => {
      // Revalidate against server truth (success OR failure path).
      // Catches anything the optimistic patch missed — e.g. dashboard
      // counter rollups under `queryKeys.dashboard.all`.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.annualReviews.all,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard.all,
      });
    },
  });
  const isSaving = setRatingMutation.isPending;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const getSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />;
    if (sortDir === "asc") return <ChevronUp className="h-3 w-3" aria-hidden="true" />;
    return <ChevronDown className="h-3 w-3" aria-hidden="true" />;
  };

  const availableFuncs = useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.function).filter((d): d is string => !!d)),
      ).sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const availableDesignations = useMemo(
    () =>
      Array.from(
        new Set(
          rows.map((r) => r.designation).filter((d): d is string => !!d),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const availableMentors = useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.mentor_name).filter((m): m is string => !!m)),
      ).sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  // `rows` is the server-filtered universe (the queryKey reflects every
  // active filter dim). No client-side narrowing needed; sort stays
  // client-side, applied directly to `rows`. See doc 29 for why we
  // skip the local filter loop and what it means for the sort.
  // `rows` is already server-sorted per the active `sortKey` + `sortDir`
  // (PR #48, doc 31). The previous lifecycle-weighted Status sort
  // (Not Started → Completed) is now lexical on the server — see doc
  // 31 Part 3 for the deliberate behaviour shift.
  const visibleRows = rows;

  // Empty-state branching: empty `rows` can now mean either "org has
  // no Employees" or "filter set returned nothing". Computed
  // alongside the filters so the toolbar + empty UI agree.
  const hasActiveFilters =
    searchInput !== "" ||
    Object.values(filters).some((v) => v !== undefined && v !== "");

  // ── Virtualization ───────────────────────────────────────────────────
  // useVirtualizer needs a scroll-container ref and an item count. It
  // returns `getVirtualItems()` — the subset of rows whose index falls
  // within the current scroll window (± overscan). Each item carries
  // its precomputed `start` offset which we apply via translateY.
  //
  // Re-creating the virtualizer when `visibleRows.length` changes
  // (filter / sort) is correct: the scroll position resets to top,
  // which is the right UX for "I just narrowed the filter — show me
  // the first match." If we ever want scroll-preservation across
  // filter changes, we'd need to lift this state and snapshot/restore
  // it explicitly.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual's useVirtualizer returns non-memoisable functions; React Compiler logs a benign skip here.
  const rowVirtualizer = useVirtualizer({
    count: visibleRows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ROW_HEIGHT_PX,
    overscan: VIRTUALIZER_OVERSCAN,
  });

  const handleSave = async () => {
    if (!editTarget) return;
    if (editTarget.row.review_id == null) {
      // Edit is UI-gated on canEdit, which requires review_id to exist —
      // this branch should be unreachable in practice but narrows the
      // type for setManagementRating().
      setSaveError("This review row has no underlying record yet.");
      return;
    }
    if (editTarget.draft === "") {
      setSaveError("Please select a rating.");
      return;
    }
    const isOverwrite =
      editTarget.row.management_performance_rating != null;
    const ok = await confirm({
      title: isOverwrite
        ? `Overwrite management rating for ${editTarget.row.employee_name}?`
        : `Publish management rating for ${editTarget.row.employee_name}?`,
      message: isOverwrite
        ? `Replace the existing management rating with ${editTarget.draft}/5. ${editTarget.row.employee_name} will see the updated rating immediately.`
        : `Publish a management rating of ${editTarget.draft}/5 for ${editTarget.row.employee_name}. Once saved, ${editTarget.row.employee_name} will be able to see this rating in their own annual review.`,
      variant: isOverwrite ? "warning" : "default",
      confirmText: isOverwrite ? "Overwrite Rating" : "Publish Rating",
    });
    if (!ok) return;
    setSaveError("");
    // Fire-and-forget — onSuccess closes the modal, onError surfaces
    // saveError inline. No caller awaits the result, so plain
    // mutate() is correct (mutateAsync would force an unused await).
    setRatingMutation.mutate({
      reviewId: editTarget.row.review_id,
      rating: editTarget.draft,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">
          Management Review
          {fyLabel && (
            <span className="ml-2 text-sm font-normal text-text-muted">
              · {fyLabel}
            </span>
          )}
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">
          Calibrate management ratings across the org's annual reviews for the active cycle.
        </p>
      </div>

      {/* Card */}
      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        <div className="p-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 text-sm text-text-muted animate-pulse gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading reviews…
          </div>
        ) : loadError ? (
          <p className="text-sm text-rose-600">{loadError}</p>
        ) : (
          <div className="flex flex-col gap-4">
            {/* Toolbar */}
            <div className="flex flex-col gap-3">
              <div className="relative max-w-sm">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  placeholder="Search name or email…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-4 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
                  aria-label="Search management reviews"
                />
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="mgmt-review-func-filter"
                    className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
                  >
                    Function
                  </label>
                  <select
                    id="mgmt-review-func-filter"
                    value={filters.function ?? "all"}
                    onChange={(e) => setFilter("function", e.target.value)}
                    className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[140px] cursor-pointer"
                  >
                    <option value="all">All Functions</option>
                    {availableFuncs.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="mgmt-review-desig-filter"
                    className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
                  >
                    Designation
                  </label>
                  <select
                    id="mgmt-review-desig-filter"
                    value={filters.designation ?? "all"}
                    onChange={(e) => setFilter("designation", e.target.value)}
                    className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[150px] cursor-pointer"
                  >
                    <option value="all">All Designations</option>
                    {availableDesignations.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="mgmt-review-mentor-filter"
                    className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
                  >
                    Mentor
                  </label>
                  <select
                    id="mgmt-review-mentor-filter"
                    value={filters.mentor ?? "all"}
                    onChange={(e) => setFilter("mentor", e.target.value)}
                    className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[160px] cursor-pointer"
                  >
                    <option value="all">All Mentors</option>
                    {availableMentors.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="mgmt-review-status-filter"
                    className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
                  >
                    Status
                  </label>
                  <select
                    id="mgmt-review-status-filter"
                    value={filters.status ?? "all"}
                    onChange={(e) =>
                      setFilter(
                        "status",
                        e.target.value as CalibrationFilters["status"] | "all",
                      )
                    }
                    className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[170px] cursor-pointer"
                  >
                    {STATUS_FILTER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Virtualized table / empty state.
                The empty-state branch is unchanged from the legacy
                `<table>` implementation. The data branch swapped from a
                `<table><thead/><tbody/></table>` to a CSS-Grid layout of
                `role="row"` divs inside a fixed-height scroll container
                so `useVirtualizer` can window the data rows. ARIA roles
                preserve screen-reader semantics. */}
            {visibleRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
                <ShieldCheck
                  className="h-10 w-10 text-text-muted mb-3"
                  aria-hidden="true"
                />
                <p className="font-display text-base font-medium text-text-main">
                  {hasActiveFilters
                    ? "No reviews match your filters"
                    : "No reviews yet"}
                </p>
                <p className="mt-1 text-sm text-text-muted">
                  {hasActiveFilters
                    ? "Try a different search term or adjust your filters."
                    : "No active Employees in this cycle yet."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <div
                  role="table"
                  aria-label="Management calibration grid"
                  aria-rowcount={visibleRows.length}
                  className="text-sm"
                  style={{ minWidth: TABLE_MIN_WIDTH_PX }}
                >
                {/* Header row — NOT virtualized. Lives outside the
                    scroll container so it stays visible while the body
                    scrolls. Same grid template as data rows so the
                    columns line up. */}
                <div
                  role="rowgroup"
                  className="border-b border-border bg-slate-50"
                >
                  <div
                    role="row"
                    className="grid items-center"
                    style={{ gridTemplateColumns: GRID_TEMPLATE_COLUMNS }}
                  >
                    {COLUMN_DEFS.map((col, idx) => {
                      // Capture key once so TS narrows it inside the
                      // closure — `col.key` widens back to
                      // `SortKey | null` in the arrow body.
                      const columnSortKey = col.key;
                      // `aria-sort` is "none" for unsorted columns,
                      // "ascending" or "descending" for the active one.
                      // Compare the page-level `sortKey` state with
                      // this column's key (`columnSortKey`).
                      const isActiveSort =
                        columnSortKey !== null && sortKey === columnSortKey;
                      const padX = idx === 0 ? "px-5" : "px-4";
                      return columnSortKey ? (
                        <div
                          role="columnheader"
                          aria-sort={
                            isActiveSort
                              ? sortDir === "asc"
                                ? "ascending"
                                : "descending"
                              : "none"
                          }
                          key={col.label}
                          onClick={() => handleSort(columnSortKey)}
                          className={`${padX} py-2.5 text-xs font-semibold uppercase tracking-wide text-text-muted cursor-pointer select-none hover:text-text-main`}
                        >
                          <span className="inline-flex items-center gap-1">
                            {col.label}
                            {getSortIcon(columnSortKey)}
                          </span>
                        </div>
                      ) : (
                        <div
                          role="columnheader"
                          key={col.label}
                          className={`${padX} py-2.5 text-xs font-semibold uppercase tracking-wide text-text-muted`}
                        >
                          {col.label}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Scrollable + virtualized body. The OUTER div is the
                    scroll viewport (overflow-y: auto, fixed height). The
                    INNER div is sized to the TOTAL list height so the
                    browser draws a correct-length scrollbar. Each
                    virtualized row is absolute-positioned inside it.

                    Why fixed height instead of `flex-1` / viewport-
                    relative: the virtualizer needs a definite container
                    size to compute which rows are in-window. Once we
                    have telemetry on real-world usage we can tune this
                    to `calc(100vh - <page header>)` for adaptive sizing. */}
                <div
                  ref={scrollContainerRef}
                  role="rowgroup"
                  style={{ height: SCROLL_CONTAINER_HEIGHT_PX }}
                  className="overflow-y-auto"
                >
                  <div
                    style={{
                      height: rowVirtualizer.getTotalSize(),
                      position: "relative",
                      width: "100%",
                    }}
                  >
                    {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                      const r = visibleRows[virtualRow.index];
                      // Action gating per stage:
                      //   not_started / draft   -> no actions (mentee
                      //     work is either nonexistent or private)
                      //   pending_mentor        -> View only (self-review)
                      //   pending_management /
                      //   completed             -> View + Edit
                      const canView =
                        r.review_id != null &&
                        (r.status === "pending_mentor" ||
                          r.status === "pending_management" ||
                          r.status === "completed");
                      const canEdit =
                        r.review_id != null &&
                        (r.status === "pending_management" ||
                          r.status === "completed");
                      return (
                        <div
                          role="row"
                          aria-rowindex={virtualRow.index + 1}
                          key={r.user_id}
                          className="grid items-center border-b border-border transition-colors hover:bg-slate-50"
                          style={{
                            // Absolute positioning is how every virtual
                            // list library works — the container reserves
                            // the full scroll height, rows are stacked at
                            // explicit offsets, and only the in-window
                            // ones exist in the DOM.
                            position: "absolute",
                            top: 0,
                            left: 0,
                            width: "100%",
                            height: virtualRow.size,
                            transform: `translateY(${virtualRow.start}px)`,
                            gridTemplateColumns: GRID_TEMPLATE_COLUMNS,
                          }}
                        >
                          <div role="cell" className="px-5 font-medium text-text-main truncate">
                            {r.employee_name}
                          </div>
                          <div role="cell" className="px-4 text-text-muted truncate">
                            {r.employee_email ?? "—"}
                          </div>
                          <div role="cell" className="px-4 text-text-muted truncate">
                            {r.mentor_name ?? "—"}
                          </div>
                          <div role="cell" className="px-4 text-text-muted truncate">
                            {r.function ?? "—"}
                          </div>
                          <div role="cell" className="px-4 text-text-muted truncate">
                            {r.designation ?? "—"}
                          </div>
                          <div role="cell" className="px-4">
                            <ReviewStatusBadge status={r.status} />
                          </div>
                          <div role="cell" className="px-4">
                            <PerformanceRatingBadge value={r.self_performance_rating} />
                          </div>
                          <div role="cell" className="px-4">
                            <PerformanceRatingBadge value={r.mentor_performance_rating} />
                          </div>
                          <div role="cell" className="px-4">
                            <PerformanceRatingBadge value={r.management_performance_rating} />
                          </div>
                          <div role="cell" className="px-4">
                            {/* flex-nowrap (no `flex-wrap`) here so a
                                row's height stays a constant 52px —
                                variable heights would require
                                measureElement() and slower scroll. */}
                            <div className="flex items-center gap-1.5 flex-nowrap">
                              {canView && r.review_id != null && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSaveError("");
                                    setEditTarget({
                                      row: r,
                                      mode: "view",
                                      draft: r.management_performance_rating ?? "",
                                    });
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md border border-border bg-white dark:bg-slate-700/40 px-2 py-1 text-[12px] font-medium text-text-muted hover:bg-brand-light hover:text-brand-accent hover:border-brand-light transition-colors"
                                  aria-label={`View review for ${r.employee_name}`}
                                >
                                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                                  View
                                </button>
                              )}
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSaveError("");
                                    setEditTarget({
                                      row: r,
                                      mode: "rate",
                                      draft: r.management_performance_rating ?? "",
                                    });
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1 text-[12px] font-medium text-white hover:opacity-90 transition-opacity"
                                  aria-label={`Rate review for ${r.employee_name}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                  Rate
                                </button>
                              )}
                              {!canView && !canEdit && (
                                <span className="text-xs italic text-text-muted">—</span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                </div>
              </div>
            )}
          </div>
        )}
        </div>
      </div>

      {/* Load More — sits BELOW the calibration card so HR can see the
          "more available" affordance without scrolling to the bottom of
          the 600px virtualized window. Hidden when the server reports
          no more pages (hasNextPage === false). The counter reads
          "Loaded N of T" — same unit on both sides because each row
          corresponds to one Staff user (vs doc 20 where total was the
          parent count and items.length was the child count). */}
      {gridQuery.hasNextPage && (
        <div className="flex items-center gap-3 justify-center">
          <button
            type="button"
            onClick={() => {
              void gridQuery.fetchNextPage();
            }}
            disabled={gridQuery.isFetchingNextPage}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-[13px] font-medium text-text-main hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {gridQuery.isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
          <span className="text-xs text-text-muted">
            Loaded {rows.length} of {totalUsers}
          </span>
        </div>
      )}

      {editTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mgmt-rating-modal-title"
        >
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between border-b border-border px-5 py-3 shrink-0">
              <div>
                <h3
                  id="mgmt-rating-modal-title"
                  className="font-display text-sm font-semibold text-text-main"
                >
                  {editTarget.mode === "rate"
                    ? "Management Rating"
                    : "Annual Review"}
                </h3>
                <p className="mt-0.5 text-xs text-text-muted">
                  {editTarget.row.employee_name} ·{" "}
                  {editTarget.row.function ?? "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-md p-1 text-text-muted hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {isEditReviewLoading ? (
                <div className="flex items-center justify-center py-8 text-sm text-text-muted gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading review…
                </div>
              ) : editReviewError ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  Could not load full review: {editReviewError}.
                </p>
              ) : null}

              {/* Self Review */}
              <section className="rounded-lg border border-border overflow-hidden">
                <div className="flex items-center justify-between bg-slate-50 px-4 py-2 border-b border-border">
                  <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
                    Self Review
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-text-muted">Rating</span>
                    <PerformanceRatingBadge
                      value={editTarget.row.self_performance_rating}
                    />
                  </div>
                </div>
                <div className="p-3">
                  <p className="text-sm text-text-main whitespace-pre-wrap">
                    {editReview?.self_overall_review || (
                      <span className="italic text-text-muted">
                        {isEditReviewLoading ? "…" : "Not submitted."}
                      </span>
                    )}
                  </p>
                </div>
              </section>

              {/* Mentor Review */}
              <section className="rounded-lg border border-blue-100 overflow-hidden">
                <div className="flex items-center justify-between bg-blue-50 px-4 py-2 border-b border-blue-100">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                    Mentor Review
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-blue-700/70">Rating</span>
                    <PerformanceRatingBadge
                      value={editTarget.row.mentor_performance_rating}
                    />
                  </div>
                </div>
                <div className="p-3">
                  <p className="text-sm text-blue-900 whitespace-pre-wrap">
                    {editReview?.mentor_overall_review || (
                      <span className="italic text-blue-900/60">
                        {isEditReviewLoading ? "…" : "Not submitted."}
                      </span>
                    )}
                  </p>
                </div>
              </section>

              {/* Management Rating — input in rate mode, read-only badge in view mode */}
              <section className="rounded-lg border border-border bg-slate-50/40 px-4 py-3">
                {editTarget.mode === "rate" ? (
                  <>
                    <PerformanceRatingSelect
                      id="management-rating-input"
                      label="Management Rating"
                      value={editTarget.draft}
                      onChange={(next) =>
                        setEditTarget({ ...editTarget, draft: next })
                      }
                      disabled={isSaving}
                    />
                    {saveError && (
                      <p className="mt-2 text-xs text-rose-600">{saveError}</p>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-text-muted">
                      Management Rating
                    </span>
                    {editTarget.row.management_performance_rating != null ? (
                      <PerformanceRatingBadge
                        value={editTarget.row.management_performance_rating}
                      />
                    ) : (
                      <span className="text-xs italic text-text-muted">
                        Not rated yet
                      </span>
                    )}
                  </div>
                )}
              </section>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3 shrink-0">
              {editTarget.mode === "rate" ? (
                <>
                  <button
                    type="button"
                    onClick={closeEdit}
                    disabled={isSaving}
                    className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-text-main hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="rounded-lg bg-brand px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {isSaving ? "Saving…" : "Save"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={closeEdit}
                  className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-text-main hover:bg-slate-50"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

