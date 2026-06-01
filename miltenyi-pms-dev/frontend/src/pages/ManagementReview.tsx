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

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
import { useOrgReferenceData } from "@/hooks/useOrgReferenceData";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { useAnnualReviewCycles } from "@/hooks/useAnnualReviewCycles";
import { StringCombobox } from "@/components/common/StringCombobox";
import { ClearFiltersButton } from "@/components/common/ClearFiltersButton";
import { Pagination } from "@/components/common/Pagination";
import { patchRowsAcross } from "@/lib/optimistic";
import { PerformanceRatingBadge } from "@/components/reviews/PerformanceRatingBadge";
import { PerformanceRatingSelect } from "@/components/reviews/PerformanceRatingSelect";
import { ReviewStatusBadge } from "@/components/reviews/ReviewStatusBadge";
import { getErrorMessage } from "@/utils/errors";
import { useConfirm } from "@/hooks/useConfirm";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { extractFyToken } from "@/utils/fy";
import { setOrDeleteParam, searchParamsChanged } from "@/utils/searchParams";

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
  // Cycle is non-sortable client-side. In multi-cycle mode the backend
  // already orders by (employee_name asc, cycle_name desc) as the
  // default + tiebreaker, so multi-FY rows for the same employee group
  // together newest-first regardless of which other column the user
  // sorts on. In single-cycle mode every row shares the same cycle, so
  // a sort would be a no-op.
  { label: "Cycle",              key: null },
  { label: "Status",             key: "status" },
  // Column shows just the rating badge (per-row narrative lives
  // inside the Rate / View modal under the section labelled "Self
  // Review" / "Mentor Review"). The column header reads "Rating" to
  // describe what's actually rendered in the cell — keeps the three
  // rating columns consistent (Self Rating / Mentor Rating /
  // Management Rating).
  { label: "Self Rating",        key: "self_performance_rating" },
  { label: "Mentor Rating",      key: "mentor_performance_rating" },
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
// Columns (order matches the header + body):
//   User · Email · Mentor · Function · Designation · Cycle · Status ·
//   Self · Mentor · Management · Actions
//
// Function + Designation minimums were widened from 90/110 to 180/220
// after the GCC framework rollout — names like "Clinical Trial
// Management" (24 chars) and "Senior Regulatory Affairs Associate"
// (35 chars) need real estate. Email got slimmed in the same pass
// because the Miltenyi address pattern (bob@miltenyi.com) is short
// and the column was over-allocated relative to its content. Cells
// still use `truncate` + `title={...}` so the rare long edge cases
// degrade to ellipsis with a hover tooltip rather than overflowing
// the fixed-height row.
//
// Cycle (90px min) was added when multi-cycle mode landed. Bare FY
// tokens like "FY26-27" / "FY25-26" fit comfortably in that width;
// the rare longer legacy token degrades to truncate+title like the
// other text columns.
//
// Actions (180px min) was bumped from the original 135px because the
// View + Rate button pair (each ~66px) + 6px gap + 32px cell padding
// needs ~170px to render without clipping. The body's 15px right-edge
// clip (from overflow-x:hidden on the scroll container) eats into the
// cell's right padding rather than the buttons themselves.
// First column is the running row number ("#") — narrow fixed-ish
// width sized for 4-digit page numbers (e.g. "1,234").
const GRID_TEMPLATE_COLUMNS =
  "minmax(48px, 0.4fr) minmax(140px, 1.4fr) minmax(150px, 1.3fr) minmax(110px, 1fr) minmax(180px, 1.4fr) minmax(220px, 1.7fr) minmax(90px, 0.9fr) minmax(140px, 1.2fr) minmax(70px, 0.7fr) minmax(70px, 0.7fr) minmax(90px, 1fr) minmax(180px, 1.2fr)";

// Sum of the GRID_TEMPLATE_COLUMNS minimums. Drives the table's
// min-width so the outer horizontal-scroll wrapper keeps the header
// and body grids aligned on narrow viewports — without it, the body's
// implicit overflow-x (per the y-auto spec interaction) would scroll
// independently of the header.
// 48 + 140 + 150 + 110 + 180 + 220 + 90 + 140 + 70 + 70 + 90 + 180 = 1488
const TABLE_MIN_WIDTH_PX = 1488;

// Fixed row height (in px) — applied as inline style on every row to
// preserve the spreadsheet-style uniform appearance now that the
// virtualizer (PR #74) no longer enforces it implicitly. py-3.5
// (28px total) + content (~22px line-height) ≈ 50px; 52 leaves
// breathing room for badge spacing.
const ROW_HEIGHT_PX = 52;

// Virtualizer scroll-container + overscan constants removed (PR #74).
// At max 50 rows per page the previous virtualization wasn't paying
// for itself.

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all",                label: "All" },
  { value: "not_started",        label: "Not Started" },
  { value: "draft",              label: "Draft" },
  { value: "pending_mentor",     label: "Pending Mentor" },
  { value: "pending_management", label: "Pending Management" },
  { value: "completed",          label: "Completed" },
];

// STATUS_SORT_WEIGHT used to drive lifecycle-progression ordering on
// the client-side sort. Server-side sort (PR #48, doc 31) now applies
// the same lifecycle weighting via a CASE WHEN expression in
// `_STATUS_LIFECYCLE_ORDER` — Not Started → Draft → Pending Mentor →
// Pending Management → Completed. No further client-side reordering
// is needed; the rows arrive in lifecycle order.

export function ManagementReview() {
  const { settings } = useSystemSettings();
  // Extract bare FY token ("H1 FY26-27" -> "FY26-27") — used both as
  // the default for the Cycle filter dropdown AND as the header label
  // when single-cycle mode is active.
  const activeFyToken = settings?.active_cycle_name
    ? extractFyToken(settings.active_cycle_name)
    : "";
  // Distinct cycle options for the Cycle dropdown. The hook merges the
  // active FY token in even when no review row exists for it yet, so
  // HR can always filter to "this year" while pre-population is in
  // progress.
  const { cycles: availableCycles } = useAnnualReviewCycles();

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

  // Read dashboard / cross-page deep-link params on first mount and
  // seed the filters so HR lands where the source page said they
  // would. Today's known deep-links:
  //   • PendingActionsCard Not-Started rows →
  //       /management-review?cycle=FY26-27&status=not_started
  //       (+ optional &employee=Name for per-row jump)
  //   • Future dashboard cards may write ?cycle=…&status=…
  // URL params take precedence over the active-cycle default that
  // already lives below (cycleFilter ?? activeFyToken). Ref guard
  // fires once per mount; user edits afterwards are preserved.
  const [searchParams, setSearchParams] = useSearchParams();
  const managementDefaultedRef = useRef(false);
  useEffect(() => {
    if (managementDefaultedRef.current) return;
    const urlCycle = searchParams.get("cycle");
    const urlStatus = searchParams.get("status");
    const urlEmployee = searchParams.get("employee");
    const urlFunction = searchParams.get("function");
    const urlDesignation = searchParams.get("designation");
    const urlMentor = searchParams.get("mentor");
    if (
      !urlCycle &&
      !urlStatus &&
      !urlEmployee &&
      !urlFunction &&
      !urlDesignation &&
      !urlMentor
    ) {
      // No deep-link params; let the existing active-cycle default
      // handle it. Flip the ref so we don't keep re-checking.
      managementDefaultedRef.current = true;
      return;
    }
    setFilters((prev) => ({
      ...prev,
      ...(urlCycle ? { cycle: urlCycle } : {}),
      ...(urlStatus
        ? { status: urlStatus as CalibrationFilters["status"] }
        : {}),
      ...(urlFunction ? { function: urlFunction } : {}),
      ...(urlDesignation ? { designation: urlDesignation } : {}),
      ...(urlMentor ? { mentor: urlMentor } : {}),
    }));
    if (urlEmployee) {
      setSearchInput(urlEmployee);
    }
    managementDefaultedRef.current = true;
  }, [searchParams]);

  // Write-back: mirror Management Review filter state to URL so
  // refresh + share-link preserves the view. Uses `searchInput`
  // (not the debounced version) for the employee param so the URL
  // stays in sync with what HR actually typed — share-links carry
  // the user's intent, not the debounced cache key. Gated on the
  // reader ref so first render's empty state can't clobber URL.
  useEffect(() => {
    if (!managementDefaultedRef.current) return;
    const next = new URLSearchParams(searchParams);
    setOrDeleteParam(next, "cycle", filters.cycle);
    setOrDeleteParam(next, "status", filters.status);
    setOrDeleteParam(next, "function", filters.function);
    setOrDeleteParam(next, "designation", filters.designation);
    setOrDeleteParam(next, "mentor", filters.mentor);
    setOrDeleteParam(next, "employee", searchInput);
    if (searchParamsChanged(searchParams, next)) {
      setSearchParams(next, { replace: true });
    }
  }, [filters, searchInput, searchParams, setSearchParams]);


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

  // Cycle resolution. The user picks via the Cycle dropdown:
  //   • Specific FY token (e.g. "FY26-27") → single-cycle mode
  //   • "all" → multi-cycle mode (one row per (employee, cycle))
  //   • Unset → default to the active cycle so first-load behaviour
  //     matches the legacy page (HR lands on this year's calibration).
  // The header label, the request param, and the "Not Started" status
  // option's visibility all derive from this single value.
  const cycleFilter = filters.cycle ?? activeFyToken;
  const isMultiCycle = cycleFilter.toLowerCase() === "all";
  const headerCycleLabel = isMultiCycle
    ? "All Cycles"
    : cycleFilter || null;
  // Inject the resolved cycle into the request params. When activeFyToken
  // is empty (settings still loading) we omit the param and let the
  // backend default kick in — avoids sending `cycle=` (empty), which the
  // backend would treat as "default" anyway but is uglier on the wire.
  if (cycleFilter) {
    filterParams.cycle = cycleFilter;
  }

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
  // Classic-pagination rewrite (PR #74): useInfiniteQuery → useQuery
  // + <Pagination>. page is 1-indexed; pageSize default 25.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Sort state — declared earlier (employee_name asc default). Wire
  // it into the request params alongside filters. `requestParams` is
  // a superset of `filterParams` that includes the active sort.
  const requestParams: Record<string, string> = {
    ...filterParams,
    sort_by: sortKey,
    sort_dir: sortDir,
  };

  // Reset to page 1 whenever filters or sort change — otherwise a user
  // narrowing the result set from page 5 lands on an empty table.
  const requestParamsKey = JSON.stringify(requestParams);
  useEffect(() => {
    setPage(1);
  }, [requestParamsKey]);

  const gridQueryKeyParams: Record<string, string | number> = {
    ...requestParams,
    _page: page,
    _pageSize: pageSize,
  };
  const gridQuery = useQuery({
    queryKey: queryKeys.annualReviews.calibration(
      gridQueryKeyParams as Record<string, string | undefined>,
    ),
    queryFn: () =>
      annualReviewService.getCalibrationGrid({
        ...(requestParams as Record<string, string> & {
          sort_by?: CalibrationSortBy;
        }),
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
  });
  // Single page slice — useQuery returns one Paginated payload. Memoised
  // so the `?? []` fallback doesn't manufacture a fresh array each
  // render and break downstream useMemo dependency stability.
  const rows: CalibrationRow[] = useMemo(
    () => gridQuery.data?.items ?? [],
    [gridQuery.data],
  );
  // Total Employee count returned by the server for this filter set.
  const totalUsers = gridQuery.data?.total ?? 0;
  // `isPending` is true on the very first load only.
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

  // All filter dropdown options come from canonical org-wide sources,
  // NOT the currently-loaded (server-filtered) rows. Otherwise picking
  // any filter narrows the server response and the dropdown re-derives
  // to only the selected value — locking the user out of changing it.
  //
  //   functions / designations  -> useOrgReferenceData() (admin refs)
  //   mentors                   -> useOrgUsers() (admin /users, role=Mentor)
  const { functionNames: availableFuncs, designationNames: availableDesignations } =
    useOrgReferenceData();
  const { mentorNames: availableMentors } = useOrgUsers();

  // `rows` is the server-filtered universe (the queryKey reflects every
  // active filter dim). No client-side narrowing needed; sort stays
  // client-side, applied directly to `rows`. See doc 29 for why we
  // skip the local filter loop and what it means for the sort.
  // `rows` is already server-sorted per the active `sortKey` + `sortDir`
  // (PR #48, doc 31). Status sort uses the same lifecycle weighting
  // the old client-side sort applied — Not Started → Draft → Pending
  // Mentor → Pending Management → Completed — implemented as a CASE
  // WHEN expression in the backend's `_STATUS_LIFECYCLE_ORDER`.
  const visibleRows = rows;

  // Empty-state branching: empty `rows` can now mean either "org has
  // no Employees" or "filter set returned nothing". Computed
  // alongside the filters so the toolbar + empty UI agree.
  const hasActiveFilters =
    searchInput !== "" ||
    Object.values(filters).some((v) => v !== undefined && v !== "");

  // Virtualizer dropped (PR #74). At max 50 rows per page the
  // virtualization overhead doesn't pay off — straight render is
  // simpler and removes the scroll-container measurement bug surface.

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
    // Stamp the FY in the confirmation copy — important in multi-cycle
    // mode where HR may be calibrating a prior FY and an unlabelled
    // dialog reads as if it applies to the current cycle.
    const cycleLabel = editTarget.row.cycle_name ?? "this cycle";
    const ok = await confirm({
      title: isOverwrite
        ? `Overwrite management rating for ${editTarget.row.employee_name} (${cycleLabel})?`
        : `Publish management rating for ${editTarget.row.employee_name} (${cycleLabel})?`,
      message: isOverwrite
        ? `Replace ${editTarget.row.employee_name}'s ${cycleLabel} management rating with ${editTarget.draft}/5. They will see the updated rating immediately.`
        : `Publish a ${cycleLabel} management rating of ${editTarget.draft}/5 for ${editTarget.row.employee_name}. Once saved, they will be able to see this rating in their own annual review.`,
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
          {headerCycleLabel && (
            <span className="ml-2 text-sm font-normal text-text-muted">
              · {headerCycleLabel}
            </span>
          )}
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">
          {isMultiCycle
            ? "Calibrate management ratings across the org's annual reviews — every cycle, newest first."
            : "Calibrate management ratings across the org's annual reviews for the selected cycle."}
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
                  <StringCombobox
                    id="mgmt-review-func-filter"
                    options={availableFuncs}
                    value={filters.function ?? ""}
                    onChange={(v) => setFilter("function", v)}
                    placeholder="All Functions"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="mgmt-review-desig-filter"
                    className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
                  >
                    Designation
                  </label>
                  <StringCombobox
                    id="mgmt-review-desig-filter"
                    options={availableDesignations}
                    value={filters.designation ?? ""}
                    onChange={(v) => setFilter("designation", v)}
                    placeholder="All Designations"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="mgmt-review-mentor-filter"
                    className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
                  >
                    Mentor
                  </label>
                  <StringCombobox
                    id="mgmt-review-mentor-filter"
                    // Sentinel "(No mentor)" prepended to the option
                    // list. Backend recognises the literal and
                    // translates it to User.mentor_id IS NULL
                    // (bypassing the INNER mentor join that would
                    // otherwise drop these rows). Display label ==
                    // wire value, so it slots into the combobox's
                    // flat string list without a value/label split.
                    options={["(No mentor)", ...availableMentors]}
                    value={filters.mentor ?? ""}
                    onChange={(v) => setFilter("mentor", v)}
                    placeholder="All Mentors"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="mgmt-review-cycle-filter"
                    className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
                  >
                    Cycle
                  </label>
                  <select
                    id="mgmt-review-cycle-filter"
                    value={cycleFilter || "all"}
                    // Direct setFilters here (not the shared setFilter
                    // helper) because the helper inverts "all" → undefined,
                    // and for the cycle dim "all" is a real value (the
                    // multi-cycle mode), not "no filter applied." We do
                    // still want undefined when the user clicks Clear
                    // Filters — that path uses setFilters({}) below.
                    onChange={(e) =>
                      setFilters({ ...filters, cycle: e.target.value })
                    }
                    className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[140px] cursor-pointer"
                  >
                    <option value="all">All Cycles</option>
                    {availableCycles.map((c) => (
                      <option key={c} value={c}>{c}</option>
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
                    {STATUS_FILTER_OPTIONS.filter(
                      // "Not Started" is meaningless in multi-cycle mode
                      // because every row in that mode is an actual review
                      // — the option is gone for a cleaner UX rather than
                      // sending a filter the backend silently drops.
                      (o) => !(isMultiCycle && o.value === "not_started"),
                    ).map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                <ClearFiltersButton
                  active={hasActiveFilters}
                  onClear={() => {
                    setSearchInput("");
                    setFilters({});
                  }}
                />
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
                    : isMultiCycle
                      ? "No reviews exist in any cycle yet."
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
                    {/* Running row-number column ("#") — cumulative
                        across pages, matches the "Showing N–M of T"
                        counter at the bottom. */}
                    <div
                      role="columnheader"
                      className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-text-muted"
                    >
                      #
                    </div>
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

                {/* Body — plain map() over the page slice (virtualizer
                    dropped in PR #74; max 50 rows per page makes it
                    unnecessary). */}
                <div role="rowgroup">
                  {visibleRows.map((r, idx) => {
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
                          aria-rowindex={idx + 1}
                          // Composite key — `user_id` alone collides in
                          // multi-cycle mode where the same employee
                          // appears once per cycle. `review_id` is
                          // null for synthetic not-started rows so we
                          // fall back to (user_id, cycle_name).
                          key={
                            r.review_id != null
                              ? `r-${r.review_id}`
                              : `ns-${r.user_id}-${r.cycle_name ?? "none"}`
                          }
                          className="grid items-center border-b border-border transition-colors hover:bg-slate-50"
                          style={{
                            height: ROW_HEIGHT_PX,
                            gridTemplateColumns: GRID_TEMPLATE_COLUMNS,
                          }}
                        >
                          {/* # — cumulative across pages */}
                          <div
                            role="cell"
                            className="px-4 text-text-muted tabular-nums text-xs"
                          >
                            {((page - 1) * pageSize + idx + 1).toLocaleString()}
                          </div>
                          <div
                            role="cell"
                            className="px-5 font-medium text-text-main truncate"
                            title={r.employee_name}
                          >
                            {r.employee_name}
                          </div>
                          <div
                            role="cell"
                            className="px-4 text-text-muted truncate"
                            title={r.employee_email ?? undefined}
                          >
                            {r.employee_email ?? "—"}
                          </div>
                          <div
                            role="cell"
                            className="px-4 text-text-muted truncate"
                            title={r.mentor_name ?? undefined}
                          >
                            {r.mentor_name ?? "—"}
                          </div>
                          <div
                            role="cell"
                            className="px-4 text-text-muted truncate"
                            title={r.function ?? undefined}
                          >
                            {r.function ?? "—"}
                          </div>
                          <div
                            role="cell"
                            className="px-4 text-text-muted truncate"
                            title={r.designation ?? undefined}
                          >
                            {r.designation ?? "—"}
                          </div>
                          <div
                            role="cell"
                            className="px-4 text-text-muted truncate"
                            title={r.cycle_name ?? undefined}
                          >
                            {r.cycle_name ?? "—"}
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
            )}
          </div>
        )}
        </div>
      </div>

      {/* Pagination toolbar — per-page selector + prev/next + page
          indicator. Replaces the previous Load-more + counter combo.
          The Pagination component handles its own zero-total state. */}
      {!isLoading && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={totalUsers}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
          entityLabel="employees"
        />
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
                  {editTarget.row.cycle_name ?? "—"} ·{" "}
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

