import { useEffect, useRef, useState } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { queryKeys } from "@/lib/queryKeys";
import { ChevronDown } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/hooks/useConfirm";
import { SelfReviewTab } from "@/components/reviews/SelfReviewTab";
import { TeamReviewTab } from "@/components/reviews/TeamReviewTab";
import { SelfReviewFormModal } from "@/components/reviews/SelfReviewFormModal";
import { PerformanceRatingBadge } from "@/components/reviews/PerformanceRatingBadge";
import { StringCombobox } from "@/components/common/StringCombobox";
import { ExportExcelButton } from "@/components/admin/ExportExcelButton";
import { SortableHeader } from "@/components/SortableHeader";
import { compareValues, type SortKind, type SortState, type SortValue } from "@/utils/sort";
import {
  annualReviewService,
  type AllReviewsFilters,
  type AnnualReview,
  type SelfReviewPayload,
  type SelfReviewDraftPayload,
} from "@/services/annual-review.service";
import { getErrorMessage } from "@/utils/errors";
import { extractFyToken, formatFyLabel } from "@/utils/fy";

type AllReviewsSortKey =
  | "employee_name"
  | "function"
  | "designation"
  | "cycle_name"
  | "status"
  | "self_performance_rating"
  | "mentor_performance_rating"
  | "final_performance_rating";

const ALL_REVIEWS_SORT_CONFIG: Record<
  AllReviewsSortKey,
  { kind: SortKind; get: (r: AnnualReview) => SortValue }
> = {
  employee_name:             { kind: "alpha",   get: (r) => r.employee_name ?? `User #${r.user_id}` },
  function:                  { kind: "alpha",   get: (r) => r.function },
  designation:               { kind: "alpha",   get: (r) => r.designation },
  cycle_name:                { kind: "cycle",   get: (r) => r.cycle_name },
  status:                    { kind: "alpha",   get: (r) => r.status },
  self_performance_rating:   { kind: "numeric", get: (r) => r.self_performance_rating },
  mentor_performance_rating: { kind: "numeric", get: (r) => r.mentor_performance_rating },
  final_performance_rating:  { kind: "numeric", get: (r) => r.final_performance_rating },
};

// Static lifecycle list keeps the Status dropdown stable even when only
// some statuses are present in the loaded rows.
const ALL_REVIEWS_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "draft",              label: "Draft" },
  { value: "pending_mentor",     label: "Pending Mentor" },
  { value: "pending_management", label: "Pending Management" },
  { value: "completed",          label: "Completed" },
];

type ActiveTab = "my" | "team" | "all";

export function AnnualReviews() {
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const toast = useToast();
  const confirm = useConfirm();

  // Role-based detection. Replaces the previous `has_mentees` shortcut so
  // HR_MyOrg gets their view-only "All Reviews" tab instead of falling
  // through to the Staff layout.
  const isStaff = user?.role === "Staff";
  const isMentor = user?.role === "Mentor";
  const isHRMyOrg = user?.role === "HR_MyOrg";

  const activeCycle = settings?.active_cycle_name ?? "";
  const submissionsOpen = settings?.reviews_submission_open ?? false;

  const fyLabel = settings?.active_cycle_name
    ? formatFyLabel(settings.active_cycle_name)
    : null;

  const [activeTab, setActiveTab] = useState<ActiveTab>("my");

  // Switch to the role's primary tab once auth resolves.
  useEffect(() => {
    if (isMentor) setActiveTab("team");
    else if (isHRMyOrg) setActiveTab("all");
    else setActiveTab("my");
  }, [isMentor, isHRMyOrg]);

  const queryClient = useQueryClient();

  // Role-gated queries. Two endpoints back this page — Staff get their
  // own history, HR_MyOrg gets the org-wide list. We register BOTH
  // queries unconditionally so the hooks-order rule is happy, but use
  // `enabled` to keep each one parked unless the current user's role
  // actually needs it.
  //
  // The Mentor branch is missing from this page on purpose: TeamReviewTab
  // (a child) owns its own ['reviews', 'mentees'] query. Keeping that
  // local to the tab means the data only fetches when the tab is
  // mounted, which matters because TeamReviewTab is HEAVY (~500 LOC).
  const myReviewsQuery = useQuery({
    queryKey: queryKeys.annualReviews.mine(),
    queryFn: annualReviewService.getMyReviewHistory,
    enabled: isStaff,
  });

  // Paginated as of PR #19 (foundation for the pagination theme).
  // useInfiniteQuery stores pages as { pages: PaginatedAnnualReviews[], pageParams: number[] }.
  // We flatten data.pages.flatMap(p => p.items) for the rest of the
  // component, which keeps every consumer that does .sort() working
  // unchanged.
  //
  // ── Server-side filters (PR #43, doc 26) ─────────────────────────
  // Filter state lives at this page-level so it can be baked into the
  // queryKey. Each distinct filter set is its own cache entry; changing
  // a filter triggers a fresh paginated fetch from offset=0 (TanStack
  // Query handles the reset automatically — different key, different
  // pages array). AllReviewsTab consumes filters + setter as props.
  //
  // - initialPageParam: 0  → first request: GET /all?offset=0&limit=50
  // - getNextPageParam: derives the next offset from the previous page's
  //   has_more flag (server-computed). Return undefined to stop paging.
  // - queryKey: queryKeys.annualReviews.org(filterParams) bakes the
  //   non-empty filter values into the cache key. Existing broadcast
  //   invalidations on `queryKeys.annualReviews.all` still catch every
  //   filter-variant entry under it.
  const PAGE_SIZE = 50;
  const [allReviewsFilters, setAllReviewsFilters] = useState<AllReviewsFilters>(
    {},
  );
  // Drop undefined/empty values so cache keys for "no filter X" and
  // "filter X = '' " collapse to the same entry. Without this the
  // queryKey would carry noise and never match a previously-cached
  // entry on the same filter set.
  const filterParams: Record<string, string> = Object.fromEntries(
    Object.entries(allReviewsFilters).filter(
      ([, v]) => v !== undefined && v !== "",
    ),
  ) as Record<string, string>;
  const allReviewsQuery = useInfiniteQuery({
    queryKey: queryKeys.annualReviews.org(filterParams),
    queryFn: ({ pageParam }) =>
      annualReviewService.getAllReviews({
        ...filterParams,
        limit: PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.offset + lastPage.limit : undefined,
    enabled: isHRMyOrg,
  });

  // `data = []` keeps downstream `.find()`/`.filter()` working with arrays
  // even before the first fetch resolves. The cache stays the source of
  // truth — these are just renaming-for-readability locals.
  const reviews = myReviewsQuery.data ?? [];
  // Flatten loaded pages into a single array. As the user clicks "Load
  // more" this array grows; everything downstream (filter / sort /
  // virtualizer) sees one combined list.
  const allReviews =
    allReviewsQuery.data?.pages.flatMap((p) => p.items) ?? [];
  // Total count across ALL pages (taken from the most recent page's
  // `total` field — the server returns the SAME total on every page).
  // Used by the UI to render "Showing N of T" alongside Load more.
  const allReviewsTotal =
    allReviewsQuery.data?.pages[allReviewsQuery.data.pages.length - 1]
      ?.total ?? 0;
  // Show the table skeleton while the role-relevant query is loading.
  // For paginated queries, `isPending` is true only on the FIRST fetch
  // (no pages loaded yet). Subsequent `fetchNextPage` calls flip
  // `isFetchingNextPage` instead — handled separately near the Load
  // More button below.
  const isLoading = isStaff
    ? myReviewsQuery.isPending
    : isHRMyOrg
      ? allReviewsQuery.isPending
      : false;

  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState("");

  // Lookup the active-cycle row (if any). May be a draft (still editable),
  // or one of the post-draft statuses (locked). The form modal below
  // pre-fills from this when `isCurrentDraft` is true; the My Reviews
  // tab decides which per-row action to surface based on submissionsOpen
  // and the row's own status.
  //
  // Match on the FY token, not the full active-cycle string: annual-review
  // rows are stamped with the bare FY label (e.g. "FY26-27"), while
  // `active_cycle_name` can carry a half/quarter prefix (e.g. "Q1 FY26-27").
  // Without `extractFyToken` here the lookup would miss every draft on
  // half/quarterly orgs — the Save Draft handler would then take the
  // "create new" branch and 400 with "review already exists."
  const activeFyToken = activeCycle ? extractFyToken(activeCycle) : "";
  const currentReview = activeFyToken
    ? reviews.find((r) => r.cycle_name === activeFyToken) ?? null
    : null;
  const isCurrentDraft = currentReview?.status === "draft";

  // ── Mutations ──────────────────────────────────────────────────────
  // All three writes invalidate ['annual-reviews', 'mine'] so the
  // history table re-fetches with the new row. The previous code did a
  // findIndex+splice upsert against local state; with invalidate the
  // server's response is the source of truth and we don't have to keep
  // an upsert helper in sync with backend behaviour (e.g. server may
  // recompute `cycle_name` from the canonical FY label).
  //
  // We also invalidate ['annual-reviews', 'all'] so HR's view (if any
  // HR user has it mounted in another tab) refreshes too. Cross-key
  // invalidation: each write declares EVERY key it could affect, not
  // just the one the current user is looking at. That's the real
  // unlock of theme 2's cache architecture.

  const submitMutation = useMutation({
    mutationFn: annualReviewService.submitSelfReview,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.annualReviews.mine() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.annualReviews.org() });
      setShowForm(false);
      toast.success("Self-review submitted.");
    },
    onError: (err) => setFormError(getErrorMessage(err)),
  });

  // createSelfDraft and saveDraft hit different endpoints (POST vs
  // PATCH) but both share the same key invalidation + toast + UI
  // contract, so we wire them under ONE mutation whose mutationFn
  // routes based on whether a row already exists. Cleaner than two
  // useMutations the caller has to choose between.
  const draftMutation = useMutation({
    mutationFn: (payload: SelfReviewDraftPayload) =>
      currentReview
        ? annualReviewService.saveDraft(currentReview.id, payload)
        : annualReviewService.createSelfDraft(payload),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.annualReviews.mine() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.annualReviews.org() });
      toast.success("Draft saved.");
    },
    onError: (err) => setFormError(getErrorMessage(err)),
  });

  const handleSubmit = async (payload: SelfReviewPayload) => {
    const ok = await confirm({
      title: "Submit annual self-review?",
      message: `Submit your self-review for ${
        fyLabel ?? "this cycle"
      }. Once submitted you can't edit your responses, and your mentor will receive it for evaluation.`,
      variant: "warning",
      confirmText: "Submit",
    });
    if (!ok) return;
    setFormError("");
    // mutateAsync because SelfReviewFormModal awaits onSubmit to drive
    // its internal "Submitting..." state. Catch + swallow so the
    // legacy contract (onSubmit never throws to the modal) is
    // preserved — onError already set formError for the UI.
    try {
      await submitMutation.mutateAsync(payload);
    } catch {
      /* handled by onError */
    }
  };

  const handleSaveDraft = async (payload: SelfReviewDraftPayload) => {
    setFormError("");
    try {
      await draftMutation.mutateAsync(payload);
    } catch {
      /* handled by onError */
    }
  };

  const tabCls = (tab: ActiveTab) =>
    `px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
      activeTab === tab
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  // Header text per role. HR_MyOrg → "All Reviews" (org-wide view-only).
  // Mentor → "Team Reviews" (they're evaluating their mentees). Staff and
  // any other role → "Annual Reviews" (generic — Staff only have their
  // own self-review here and shouldn't see a "Team" label since they
  // don't have a team).
  const headerTitle = isHRMyOrg
    ? "All Reviews"
    : isMentor
      ? "Team Reviews"
      : "Annual Reviews";
  const headerSubtitle = isHRMyOrg
    ? "View-only access to every annual review across the org."
    : isMentor
      ? "Complete your team review and provide feedback for your team members."
      : "Write your annual self-review and track its progress through the cycle.";

  // When HR pauses the module, the page stays open so people can read
  // historical reviews — only mutating endpoints 403. Surface the pause
  // as a banner so the absence of action buttons isn't mysterious.
  // Suppressed for HR_MyOrg: they're the one who flipped the toggle, so
  // the announcement adds no information for them and just clutters
  // their view. Staff and Mentors still see it.
  const submissionsPaused =
    settings?.annual_reviews_enabled === false && !isHRMyOrg;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-main">
            {headerTitle}
            {fyLabel && (
              <span className="ml-2 text-sm font-normal text-text-muted">
                · {fyLabel}
              </span>
            )}
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">{headerSubtitle}</p>
        </div>
        {/* The Self-Review start / Continue Draft action used to live
            here. It now lives inside the My Reviews table as a per-row
            action (synthetic current-FY row → Start; draft row → Continue),
            so the header has no action buttons. */}
      </div>

      {submissionsPaused && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm text-amber-800"
        >
          <span className="font-semibold">Submissions paused.</span>
          <span>
            New annual review submissions are temporarily disabled by your
            administrator. Historical reviews remain readable.
          </span>
        </div>
      )}

      {/* Tab container */}
      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        <div className="flex border-b border-border px-2">
          {isStaff && (
            <button
              type="button"
              className={tabCls("my")}
              onClick={() => setActiveTab("my")}
            >
              My Reviews
            </button>
          )}
          {isMentor && (
            <button
              type="button"
              className={tabCls("team")}
              onClick={() => setActiveTab("team")}
            >
              Team Review
            </button>
          )}
          {isHRMyOrg && (
            <button
              type="button"
              className={tabCls("all")}
              onClick={() => setActiveTab("all")}
            >
              All Reviews
            </button>
          )}
        </div>

        <div className="p-5">
          {isStaff && activeTab === "my" && (
            <SelfReviewTab
              reviews={reviews}
              isLoading={isLoading}
              activeCycle={activeCycle}
              submissionsOpen={submissionsOpen}
              onStartReview={() => {
                setFormError("");
                setShowForm(true);
              }}
              onContinueDraft={() => {
                // The form modal pulls draft content from `currentReview`
                // via `draft={isCurrentDraft ? currentReview : null}`
                // below, so opening it for the active-FY draft is the
                // same path as Start.
                setFormError("");
                setShowForm(true);
              }}
            />
          )}
          {isMentor && activeTab === "team" && <TeamReviewTab />}
          {isHRMyOrg && activeTab === "all" && (
            <AllReviewsTab
              reviews={allReviews}
              isLoading={isLoading}
              total={allReviewsTotal}
              hasNextPage={Boolean(allReviewsQuery.hasNextPage)}
              isFetchingNextPage={allReviewsQuery.isFetchingNextPage}
              onLoadMore={() => {
                void allReviewsQuery.fetchNextPage();
              }}
              filters={allReviewsFilters}
              onFiltersChange={setAllReviewsFilters}
            />
          )}
        </div>
      </div>

      {/* Form modal lives at page scope so the header button can open it */}
      {showForm && activeCycle && (
        <SelfReviewFormModal
          cycleName={activeCycle}
          draft={isCurrentDraft ? currentReview : null}
          onSubmit={handleSubmit}
          onSaveDraft={handleSaveDraft}
          onClose={() => {
            setShowForm(false);
            setFormError("");
          }}
          isSaving={submitMutation.isPending}
          isDraftSaving={draftMutation.isPending}
          error={formError}
        />
      )}
    </div>
  );
}

// ── HR_MyOrg "All Reviews" view-only table ──────────────────────────

// Shared CSS Grid layout for the 8-column virtualized table (header
// + body rows). `minmax(<floor>, <weight>fr)` keeps narrow columns
// readable while letting wide ones expand. See PR #15 for the
// rationale on table → div + CSS Grid.
const ALL_REVIEWS_GRID_TEMPLATE_COLUMNS =
  "minmax(180px, 1.8fr) minmax(120px, 1.2fr) minmax(140px, 1.4fr) " +
  "minmax(100px, 1fr) minmax(120px, 1.1fr) minmax(80px, 0.8fr) " +
  "minmax(80px, 0.8fr) minmax(80px, 0.8fr)";

// Starting guess for a collapsed row's height (py-3 + text-[13px] line
// height ≈ 46px; round up). Unlike PR #15's ManagementReview, this
// table has VARIABLE-height rows (inline expansion). The virtualizer
// uses `estimateSize` only for unmeasured rows; once a row has
// rendered, `measureElement` records its real size and the
// virtualizer uses that. Subsequent expansions trigger re-measurement
// via the underlying ResizeObserver.
const ALL_REVIEWS_ESTIMATE_ROW_PX = 48;

const ALL_REVIEWS_SCROLL_HEIGHT_PX = 600;
const ALL_REVIEWS_OVERSCAN = 5;

function AllReviewsTab({
  reviews,
  isLoading,
  total,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  filters,
  onFiltersChange,
}: {
  readonly reviews: AnnualReview[];
  readonly isLoading: boolean;
  /** Total rows matching the SERVER FILTER across all pages. Equal to
   *  the org-wide review count when no filters are active; smaller as
   *  filters narrow. The server returns this on every paginated
   *  response (same value across pages of the same filter set). */
  readonly total: number;
  /** True while at least one more page exists on the server FOR THE
   *  CURRENT FILTER SET (server-derived from has_more). When filters
   *  change, the cache entry resets and `hasNextPage` recomputes
   *  against the new universe. */
  readonly hasNextPage: boolean;
  /** True while a fetchNextPage() call is in flight — drives the Load
   *  More button's spinner state without flashing the initial-load
   *  skeleton. */
  readonly isFetchingNextPage: boolean;
  /** Trigger for fetchNextPage. Wired by the parent page. */
  readonly onLoadMore: () => void;
  /** Current filter set. Controlled by the page so the values flow
   *  into the useInfiniteQuery's queryKey (PR #43, doc 26). */
  readonly filters: AllReviewsFilters;
  /** Setter for the filter set. Each call replaces the entire object;
   *  helpers below produce new objects via `{ ...filters, X: value }`. */
  readonly onFiltersChange: (next: AllReviewsFilters) => void;
}) {
  // Local-only state remains local: sort + expansion. Filters were
  // moved up to the page so they can flow into the queryKey.
  const [sort, setSort] = useState<SortState<AllReviewsSortKey> | null>(null);
  // Inline expansion: clicking a row reveals the self + mentor narrative
  // side-by-side. Only one row at a time; clicking the same row again
  // collapses it.
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // Faceted-style dropdown options — derived from the LOADED reviews,
  // which is the filtered universe (since the server already filtered).
  // Trade-off: when a filter narrows the universe, OTHER dropdowns
  // only show values present in that narrow set. Workaround: clear a
  // dropdown to see its full option list refresh on the next fetch.
  // A future "facets endpoint" could return all distinct values
  // regardless of filters — out of scope for this PR (doc 26 Part 4).
  const cycles = Array.from(
    new Set(reviews.map((r) => r.cycle_name).filter(Boolean)),
  ).sort((a, b) => b.localeCompare(a));
  const employees = Array.from(
    new Set(
      reviews.map((r) => r.employee_name).filter((n): n is string => !!n),
    ),
  ).sort();
  const functions = Array.from(
    new Set(reviews.map((r) => r.function).filter((n): n is string => !!n)),
  ).sort();
  const designations = Array.from(
    new Set(reviews.map((r) => r.designation).filter((n): n is string => !!n)),
  ).sort();

  // No client-side filter loop anymore — `reviews` IS the filtered
  // universe (the server applied the filters and returned matching
  // rows). Sort stays client-side because it operates on the loaded
  // pages; server-side sort is a future PR (would need ?sort_by= +
  // ?sort_dir= params and a stable secondary tiebreaker).
  const sorted = sort
    ? reviews.slice().sort((a, b) => {
        const { kind, get } = ALL_REVIEWS_SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : reviews;

  // Helpers that adapt the "all"/"" sentinel values used by the
  // dropdown/combobox UI to the AllReviewsFilters shape (undefined =
  // no narrowing on this dim). Pure functions, no React state.
  const setFilter = <K extends keyof AllReviewsFilters>(
    key: K,
    value: AllReviewsFilters[K] | "" | "all",
  ) => {
    onFiltersChange({
      ...filters,
      [key]: value === "" || value === "all" ? undefined : value,
    });
  };

  // ── Virtualization (variable-height) ──────────────────────────────
  // measureElement turns this into a variable-height virtualizer:
  // estimateSize is used only for rows that haven't rendered yet;
  // measured heights override the estimate via a ResizeObserver under
  // the hood. When the user toggles expandedId, the affected row's
  // outer div re-renders with the expansion panel inside, the
  // ResizeObserver fires, the virtualizer updates its size cache and
  // the total list height, and the scroll position stays sensible.
  //
  // overscan is intentionally smaller than PR #15 (5 vs 8) because
  // measurement work is more expensive than fixed-size lookup —
  // rendering extra rows that the user can't see costs a bit more
  // here. Tune up if scrolling on slow devices flashes empty rows.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ALL_REVIEWS_ESTIMATE_ROW_PX,
    overscan: ALL_REVIEWS_OVERSCAN,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-text-muted">
        Loading reviews…
      </div>
    );
  }
  // Empty-state messaging splits between "org has no reviews" and
  // "your filter set returned nothing" because the two demand
  // different remediation. Pre-PR-#43 the loaded array could only be
  // empty for the first reason; now the server can return zero rows
  // for any filter the user picks, so we name what happened.
  const hasActiveFilters = Object.values(filters).some(
    (v) => v !== undefined && v !== "",
  );
  if (reviews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
        <p className="font-display text-base font-medium text-text-main">
          {hasActiveFilters
            ? "No reviews match these filters"
            : "No annual reviews recorded"}
        </p>
        <p className="mt-1 text-sm text-text-muted">
          {hasActiveFilters
            ? "Try clearing one or more filters above to broaden the result."
            : "Reviews will appear here once Staff submit self-reviews and mentors start evaluating."}
        </p>
      </div>
    );
  }

  const labelCls =
    "text-[11px] font-bold uppercase tracking-wider text-text-muted";
  const selectCls =
    "rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
       <div className="flex items-center gap-4 flex-wrap flex-1 min-w-0">
        {/* Employee filter — typeable combobox styled like the PM picker
            in ProjectModal. Typing narrows the suggestion list; clicking
            an option commits the filter. Click the X to clear. */}
        <div className="flex items-center gap-2">
          <label htmlFor="all-rev-employee" className={labelCls}>
            Employee
          </label>
          <StringCombobox
            id="all-rev-employee"
            options={employees}
            value={filters.employee ?? ""}
            onChange={(v) => setFilter("employee", v)}
            placeholder="Type a name…"
          />
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="all-rev-cycle" className={labelCls}>
            Cycle
          </label>
          <select
            id="all-rev-cycle"
            value={filters.cycle ?? "all"}
            onChange={(e) => setFilter("cycle", e.target.value)}
            className={`${selectCls} min-w-[120px]`}
          >
            <option value="all">All</option>
            {cycles.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="all-rev-status" className={labelCls}>
            Status
          </label>
          <select
            id="all-rev-status"
            value={filters.status ?? "all"}
            onChange={(e) =>
              setFilter("status", e.target.value as AllReviewsFilters["status"] | "all")
            }
            className={`${selectCls} min-w-[150px]`}
          >
            <option value="all">All</option>
            {ALL_REVIEWS_STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {functions.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="all-rev-function" className={labelCls}>
              Function
            </label>
            <select
              id="all-rev-function"
              value={filters.function ?? "all"}
              onChange={(e) => setFilter("function", e.target.value)}
              className={`${selectCls} min-w-[130px]`}
            >
              <option value="all">All</option>
              {functions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        )}

        {designations.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="all-rev-designation" className={labelCls}>
              Designation
            </label>
            <select
              id="all-rev-designation"
              value={filters.designation ?? "all"}
              onChange={(e) => setFilter("designation", e.target.value)}
              className={`${selectCls} min-w-[150px]`}
            >
              <option value="all">All</option>
              {designations.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        )}

        <span className="text-xs text-text-muted">
          {/* `total` is the server's count of rows matching the active
              filter set (PR #43, doc 26). Equal to the org-wide
              review count when no filters are active; smaller as
              filters narrow. The "loaded of total" counter beside the
              Load More button below tracks paging progress through
              the filtered universe. */}
          {total} {total === 1 ? "match" : "matches"}
        </span>
       </div>
       <div className="shrink-0">
         <ExportExcelButton kind="annual-reviews" />
       </div>
      </div>

      {/* Virtualized variable-height table.
          - Outer div = x-scroll container (handles narrow viewports;
            header + body scroll horizontally together via this).
          - Header row lives outside the y-scroll container so it stays
            pinned vertically while data scrolls below.
          - Each data row is a single div with optional expanded panel
            inside. measureElement records its real rendered height so
            collapse/expand toggling correctly resizes the virtualizer's
            total content. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <div
          role="table"
          aria-label="All annual reviews"
          aria-rowcount={sorted.length}
          className="text-[13px]"
        >
          {/* Header — non-virtualized, sticky at top of x-scroll viewport */}
          <div role="rowgroup" className="bg-slate-50/80 border-b border-border">
            <div
              role="row"
              className="grid items-center"
              style={{ gridTemplateColumns: ALL_REVIEWS_GRID_TEMPLATE_COLUMNS }}
            >
              <div role="columnheader" className="text-left px-5 py-2.5">
                <SortableHeader label="Employee" columnKey="employee_name" sort={sort} onSort={setSort} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Function" columnKey="function" sort={sort} onSort={setSort} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Designation" columnKey="designation" sort={sort} onSort={setSort} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Cycle" columnKey="cycle_name" sort={sort} onSort={setSort} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Status" columnKey="status" sort={sort} onSort={setSort} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Self" columnKey="self_performance_rating" sort={sort} onSort={setSort} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Mentor" columnKey="mentor_performance_rating" sort={sort} onSort={setSort} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Final" columnKey="final_performance_rating" sort={sort} onSort={setSort} />
              </div>
            </div>
          </div>

          {/* Body — either the no-matches message or the virtualized
              scroll container. */}
          {sorted.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <p className="text-[13px] text-text-main font-medium">
                No matching reviews
              </p>
              <p className="text-[11px] text-text-muted mt-0.5">
                Try adjusting your filters or clearing the search.
              </p>
            </div>
          ) : (
            <div
              ref={scrollContainerRef}
              role="rowgroup"
              style={{ height: ALL_REVIEWS_SCROLL_HEIGHT_PX }}
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
                  const r = sorted[virtualRow.index];
                  const isExpanded = expandedId === r.id;
                  return (
                    <div
                      role="row"
                      aria-rowindex={virtualRow.index + 1}
                      aria-expanded={isExpanded}
                      key={r.id}
                      // data-index is REQUIRED by measureElement — it's
                      // how the virtualizer maps a ResizeObserver entry
                      // back to a row index.
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      onClick={() => setExpandedId(isExpanded ? null : r.id)}
                      style={{
                        // No explicit height — measureElement reads the
                        // natural offsetHeight after render and tells
                        // the virtualizer the actual size.
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start}px)`,
                      }}
                      className={`cursor-pointer transition-colors border-b border-border/50 ${
                        isExpanded ? "bg-brand/5" : "hover:bg-slate-50/60"
                      }`}
                    >
                      {/* Base row (always rendered) */}
                      <div
                        className="grid items-center"
                        style={{
                          gridTemplateColumns:
                            ALL_REVIEWS_GRID_TEMPLATE_COLUMNS,
                        }}
                      >
                        <div role="cell" className="px-5 py-3 font-medium text-text-main">
                          <div className="flex items-center gap-2">
                            <ChevronDown
                              className={`h-4 w-4 text-text-muted shrink-0 transition-transform duration-200 ${
                                isExpanded ? "rotate-180" : ""
                              }`}
                              aria-hidden="true"
                            />
                            {r.employee_name ?? `User #${r.user_id}`}
                          </div>
                        </div>
                        <div role="cell" className="px-4 py-3 text-text-muted">
                          {r.function ?? "—"}
                        </div>
                        <div role="cell" className="px-4 py-3 text-text-muted">
                          {r.designation ?? "—"}
                        </div>
                        <div role="cell" className="px-4 py-3">
                          <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                            {r.cycle_name}
                          </span>
                        </div>
                        <div role="cell" className="px-4 py-3 text-text-muted capitalize">
                          {r.status.replace("_", " ")}
                        </div>
                        <div role="cell" className="px-4 py-3">
                          <PerformanceRatingBadge value={r.self_performance_rating} />
                        </div>
                        <div role="cell" className="px-4 py-3">
                          <PerformanceRatingBadge value={r.mentor_performance_rating} />
                        </div>
                        <div role="cell" className="px-4 py-3">
                          <PerformanceRatingBadge value={r.final_performance_rating} />
                        </div>
                      </div>

                      {/* Expanded narrative panel (conditional). This is
                          INSIDE the row's outer div, so measureElement
                          sees the row's total height grow when the
                          panel appears and shrink when it disappears.
                          ResizeObserver fires → virtualizer updates
                          total size → scrollbar adjusts → other rows'
                          translateY offsets recompute. */}
                      {isExpanded && (
                        <div className="bg-slate-50/40 border-t border-brand/10 px-5 py-5">
                          <ReviewNarrativePanel review={r} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Load More — sits BELOW the virtualized scroll card so HR can
          see the "more available" affordance without scrolling to the
          bottom of the 600px window. The button is hidden when no
          more pages exist on the server (hasNextPage === false). The
          live counter alongside it explains exactly what was loaded
          vs what's available. */}
      {hasNextPage && (
        <div className="flex items-center gap-3 justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-[13px] font-medium text-text-main hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </button>
          <span className="text-xs text-text-muted">
            Loaded {reviews.length} of {total}
          </span>
        </div>
      )}
    </div>
  );
}

// ── Inline narrative panel (Self + Mentor side-by-side) ─────────────

function ReviewNarrativePanel({ review }: { readonly review: AnnualReview }) {
  const empty = (
    <span className="text-text-muted italic">Not provided yet.</span>
  );
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="rounded-lg border border-border bg-white overflow-hidden">
        <div className="bg-slate-100 px-4 py-2 border-b border-border">
          <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
            Self Review
          </p>
        </div>
        <div className="p-4">
          <p className="text-sm text-text-main whitespace-pre-wrap">
            {review.self_overall_review || empty}
          </p>
        </div>
      </div>
      <div className="rounded-lg border border-blue-100 bg-white overflow-hidden">
        <div className="bg-blue-50 px-4 py-2 border-b border-blue-100">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
            Mentor Review
          </p>
        </div>
        <div className="p-4">
          <p className="text-sm text-blue-900 whitespace-pre-wrap">
            {review.mentor_overall_review || empty}
          </p>
        </div>
      </div>
    </div>
  );
}
