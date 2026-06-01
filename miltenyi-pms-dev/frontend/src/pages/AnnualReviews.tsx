import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
import { ReviewStatusBadge } from "@/components/reviews/ReviewStatusBadge";
import { StringCombobox } from "@/components/common/StringCombobox";
import { ClearFiltersButton } from "@/components/common/ClearFiltersButton";
import { Pagination } from "@/components/common/Pagination";
import { useOrgReferenceData } from "@/hooks/useOrgReferenceData";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { useAnnualReviewCycles } from "@/hooks/useAnnualReviewCycles";
import { setOrDeleteParam, searchParamsChanged } from "@/utils/searchParams";
import { ExportExcelButton } from "@/components/admin/ExportExcelButton";
import { SortableHeader } from "@/components/SortableHeader";
import { type SortState } from "@/utils/sort";
import {
  annualReviewService,
  type AllReviewsFilters,
  type AllReviewsSortBy,
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

// ALL_REVIEWS_SORT_CONFIG used to live here as a Record<sortKey,
// {kind, get}> mapping driving the client-side sort. Server-side sort
// (PR #47, doc 30) made the per-column accessors + compareValues
// unnecessary — backend SQL ORDER BY handles every column's semantics.
// The `AllReviewsSortKey` union above is still the authoritative list
// of sortable columns (mirrors backend `_ALL_REVIEWS_SORT_COLUMNS`).

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
  // through to the Employee layout.
  const isEmployee = user?.role === "Employee";
  const isMentor = user?.role === "Mentor";
  const isHRMyOrg = user?.role === "HR_MyOrg";

  const activeCycle = settings?.active_cycle_name ?? "";
  const submissionsOpen = settings?.reviews_submission_open ?? false;

  const fyLabel = settings?.active_cycle_name
    ? formatFyLabel(settings.active_cycle_name)
    : null;

  // The role-driven default. Recomputed every render — cheap. When auth
  // hasn't resolved yet, isMentor / isHRMyOrg are both false so this
  // falls through to "my"; once auth flips, the new value flows through
  // without a setState-in-effect.
  const defaultTab: ActiveTab = isMentor ? "team" : isHRMyOrg ? "all" : "my";
  // `null` ⇒ "no explicit click yet, honour the role default". On click
  // we lock to the explicit choice so a stale render of useAuth() can't
  // yank the user back to the role-default tab mid-session.
  const [userPickedTab, setUserPickedTab] = useState<ActiveTab | null>(null);
  const activeTab = userPickedTab ?? defaultTab;
  const setActiveTab = setUserPickedTab;

  const queryClient = useQueryClient();

  // Role-gated queries. Two endpoints back this page — Employees get their
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
    enabled: isEmployee,
  });

  // Paginated as of PR #19 (foundation for the pagination theme).
  // useInfiniteQuery stores pages as { pages: PaginatedAnnualReviews[], pageParams: number[] }.
  // We flatten data.pages.flatMap(p => p.items) for the rest of the
  // component.
  //
  // ── Server-side filters (PR #43, doc 26) + sort (PR #47, doc 30) ───
  // Filter AND sort state live at this page-level so both flow into
  // the queryKey. Each distinct (filter, sort) tuple is its own cache
  // entry. AllReviewsTab consumes filters + sort + their setters as
  // props (controlled component).
  //
  // Classic-pagination rewrite (PR #74): swapped useInfiniteQuery +
  // virtualizer + Load-more for useQuery + <Pagination>. page is
  // 1-indexed; pageSize is 10/25/50 (default 25). Both are baked into
  // the queryKey so each (filter, page, pageSize) is its own cache
  // entry; broadcast invalidations on `queryKeys.annualReviews.all`
  // still catch every variant.
  const [allReviewsPage, setAllReviewsPage] = useState(1);
  const [allReviewsPageSize, setAllReviewsPageSize] = useState(25);
  const [allReviewsFilters, setAllReviewsFilters] = useState<AllReviewsFilters>(
    {},
  );

  // First time we know the active cycle, pre-fill the Cycle filter on
  // the All Reviews tab. HR almost always lands here to triage the
  // CURRENT FY (e.g. via the dashboard's "View all" link on the annual
  // review funnel), so defaulting to "All" forces them to narrow every
  // session.
  //
  // URL search params take precedence so dashboard deep-links (e.g.
  // /annual-reviews?cycle=FY26-27&status=pending_mentor from a funnel
  // card) land pre-filtered. Ref guard fires once per mount; later
  // user edits to the filters are preserved.
  const [searchParams, setSearchParams] = useSearchParams();
  const allReviewsDefaultedRef = useRef(false);
  useEffect(() => {
    if (allReviewsDefaultedRef.current) return;
    if (!settings?.active_cycle_name) return;

    const urlCycle = searchParams.get("cycle");
    const urlStatus = searchParams.get("status");
    const urlFunction = searchParams.get("function");
    const urlDesignation = searchParams.get("designation");
    const urlEmployee = searchParams.get("employee");

    const updates: Partial<AllReviewsFilters> = {};
    if (urlCycle) {
      updates.cycle = urlCycle;
    } else {
      // Annual reviews are tagged with the bare FY token ("FY26-27");
      // active_cycle_name can carry a half/quarter prefix. extractFyToken
      // strips that so the filter matches actual stored cycle_names.
      const fyToken = extractFyToken(settings.active_cycle_name);
      if (fyToken) updates.cycle = fyToken;
    }
    if (urlStatus) updates.status = urlStatus as AllReviewsFilters["status"];
    if (urlFunction) updates.function = urlFunction;
    if (urlDesignation) updates.designation = urlDesignation;
    if (urlEmployee) updates.employee = urlEmployee;

    if (Object.keys(updates).length > 0) {
      setAllReviewsFilters((prev) => ({ ...prev, ...updates }));
    }
    allReviewsDefaultedRef.current = true;
  }, [settings?.active_cycle_name, searchParams]);

  // Write-back: mirror All-Reviews filter state to URL so refresh /
  // share-link preserves the view. Gated on the same ref the reader
  // uses (first render's empty state never overwrites URL params
  // before the reader has seeded state from them). `replace: true`
  // keeps the browser history a single entry per page visit.
  useEffect(() => {
    if (!allReviewsDefaultedRef.current) return;
    const next = new URLSearchParams(searchParams);
    setOrDeleteParam(next, "cycle", allReviewsFilters.cycle);
    setOrDeleteParam(next, "status", allReviewsFilters.status);
    setOrDeleteParam(next, "function", allReviewsFilters.function);
    setOrDeleteParam(next, "designation", allReviewsFilters.designation);
    setOrDeleteParam(next, "employee", allReviewsFilters.employee);
    if (searchParamsChanged(searchParams, next)) {
      setSearchParams(next, { replace: true });
    }
  }, [allReviewsFilters, searchParams, setSearchParams]);

  // Sort state. `null` means "default ordering" (cycle_name DESC,
  // created_at DESC) — the backend takes over when sort is unset.
  // Translated to `sort_by` + `sort_dir` strings for the wire format.
  const [allReviewsSort, setAllReviewsSort] = useState<
    SortState<AllReviewsSortKey> | null
  >(null);
  // Drop undefined/empty values so cache keys for "no filter X" and
  // "filter X = '' " collapse to the same entry. Without this the
  // queryKey would carry noise and never match a previously-cached
  // entry on the same filter set.
  const filterParams: Record<string, string> = Object.fromEntries(
    Object.entries(allReviewsFilters).filter(
      ([, v]) => v !== undefined && v !== "",
    ),
  ) as Record<string, string>;
  // Merge sort into the requestParams that flow into both queryKey
  // and queryFn. Sort enters the same `params` object as filters so
  // the cache key naturally distinguishes filter-X-sort-A from
  // filter-X-sort-B.
  const requestParams: Record<string, string> = {
    ...filterParams,
    ...(allReviewsSort
      ? { sort_by: allReviewsSort.key, sort_dir: allReviewsSort.direction }
      : {}),
  };
  // Reset to page 1 when filters or sort change — otherwise a user
  // narrowing a 247-row list to 8 rows from page 5 sees the empty
  // page-5 state. Watching the serialised request params is safer
  // than enumerating each filter individually.
  const requestParamsKey = JSON.stringify(requestParams);
  useEffect(() => {
    setAllReviewsPage(1);
  }, [requestParamsKey]);

  const allReviewsQueryKeyParams: Record<string, string | number> = {
    ...requestParams,
    _page: allReviewsPage,
    _pageSize: allReviewsPageSize,
  };
  const allReviewsQuery = useQuery({
    queryKey: queryKeys.annualReviews.org(
      allReviewsQueryKeyParams as Record<string, string | undefined>,
    ),
    queryFn: () =>
      annualReviewService.getAllReviews({
        ...(requestParams as Record<string, string> & {
          sort_by?: AllReviewsSortBy;
        }),
        limit: allReviewsPageSize,
        offset: (allReviewsPage - 1) * allReviewsPageSize,
      }),
    enabled: isHRMyOrg,
  });

  // `data = []` keeps downstream `.find()`/`.filter()` working with arrays
  // even before the first fetch resolves. The cache stays the source of
  // truth — these are just renaming-for-readability locals.
  const reviews = myReviewsQuery.data ?? [];
  // Single page slice — `useQuery` returns one Paginated payload (rows
  // replace per page change; no cross-page accumulation).
  const allReviews = allReviewsQuery.data?.items ?? [];
  // Server's count of qualifying rows for the current filter set.
  const allReviewsTotal = allReviewsQuery.data?.total ?? 0;
  // `isPending` is true on the very first load only. Page changes flip
  // `isFetching` while keeping previous rows visible.
  const isLoading = isEmployee
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
  // Mentor → "Team Reviews" (they're evaluating their mentees). Employees and
  // any other role → "Annual Reviews" (generic — Employees only have their
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
  // their view. Employees and Mentors still see it.
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
          {isEmployee && (
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
          {isEmployee && activeTab === "my" && (
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
              page={allReviewsPage}
              pageSize={allReviewsPageSize}
              onPageChange={setAllReviewsPage}
              onPageSizeChange={(n) => {
                setAllReviewsPageSize(n);
                setAllReviewsPage(1);
              }}
              filters={allReviewsFilters}
              onFiltersChange={setAllReviewsFilters}
              sort={allReviewsSort}
              onSortChange={setAllReviewsSort}
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
// First column is the running row number ("#") — narrow fixed-ish
// width sized for 4-digit page numbers (e.g. "1,234").
const ALL_REVIEWS_GRID_TEMPLATE_COLUMNS =
  "minmax(48px, 0.4fr) minmax(180px, 1.8fr) minmax(120px, 1.2fr) minmax(140px, 1.4fr) " +
  "minmax(100px, 1fr) minmax(120px, 1.1fr) minmax(80px, 0.8fr) " +
  "minmax(80px, 0.8fr) minmax(80px, 0.8fr)";

// Sum of the GRID_TEMPLATE_COLUMNS minimums plus a little breathing
// room. Drives the table's min-width so the outer horizontal-scroll
// wrapper engages BEFORE the body's implicit overflow-x (legacy CSS
// pairing for overflow-y: auto) does — otherwise the body scrolls
// horizontally on its own and the header stays put. Mirrors the same
// fix in ManagementReview.tsx.
const ALL_REVIEWS_TABLE_MIN_WIDTH_PX = 1008;

// Virtualizer constants removed (PR #74). With max 50 rows per page
// the previous measure-driven variable-height logic isn't needed —
// the table renders straight.

function AllReviewsTab({
  reviews,
  isLoading,
  total,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
}: {
  readonly reviews: AnnualReview[];
  readonly isLoading: boolean;
  /** Total rows matching the SERVER FILTER. Equal to the org-wide
   *  review count when no filters are active; smaller as filters
   *  narrow. */
  readonly total: number;
  /** 1-indexed current page. */
  readonly page: number;
  /** Rows per page (10 / 25 / 50). */
  readonly pageSize: number;
  readonly onPageChange: (page: number) => void;
  /** Caller resets page to 1 inside this handler. */
  readonly onPageSizeChange: (size: number) => void;
  /** Current filter set. Controlled by the page so the values flow
   *  into the queryKey (PR #43, doc 26). */
  readonly filters: AllReviewsFilters;
  /** Setter for the filter set. Each call replaces the entire object;
   *  helpers below produce new objects via `{ ...filters, X: value }`. */
  readonly onFiltersChange: (next: AllReviewsFilters) => void;
  /** Current sort state. Controlled by the page so it can flow into
   *  the queryKey (PR #47, doc 30). `null` means default ordering. */
  readonly sort: SortState<AllReviewsSortKey> | null;
  /** Setter consumed by `<SortableHeader>` — toggling a column header
   *  produces the next sort state. */
  readonly onSortChange: (
    next: SortState<AllReviewsSortKey> | null,
  ) => void;
}) {
  // Only inline expansion remains local — filters AND sort moved up.
  const [expandedId, setExpandedId] = useState<number | null>(null);

  // All filter dropdown options come from canonical org-wide sources,
  // NOT from the LOADED (= server-filtered) `reviews`. Without that,
  // picking any filter narrows the server response and the dropdown
  // re-derives to only the selected value — trapping the user.
  //
  //   cycles                    -> useAnnualReviewCycles() (DB DISTINCT + active FY)
  //   employees                 -> useOrgUsers() (admin /users, role=Employee)
  //   functions / designations  -> useOrgReferenceData() (admin refs)
  const { functionNames: functions, designationNames: designations } =
    useOrgReferenceData();
  // Annual reviews exist only for role="Employee" — Mentors aren't
  // reviewed, PMs are never rated (Role enum docstring). Sourcing the
  // Employee combobox from `employeeNames` keeps the dropdown's
  // universe aligned with the reviews universe so selecting a name
  // always has a chance of returning rows. Earlier this used
  // `allUserNames`, which included Mentor/PM/HR names that could
  // never yield results when picked.
  //
  // Trade-off: a user promoted Employee → Mentor since their review
  // was written disappears from the dropdown but their historical
  // reviews still appear in the unfiltered list (reviews are keyed
  // by user_id, not by current role).
  const { employeeNames: employees } = useOrgUsers();
  const { cycles } = useAnnualReviewCycles();

  // `reviews` is the server-filtered + server-sorted universe (PR #43
  // for filters, PR #47 for sort). No client-side narrowing OR
  // re-sorting — both happen in SQL. `sorted` is now an alias to
  // `reviews` retained only so the variable name reads naturally at
  // the call sites below.
  const sorted = reviews;

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

  // Virtualizer dropped (PR #74). At max 50 rows per page the
  // measurement/ResizeObserver overhead wasn't paying for itself and
  // complicated the variable-height expansion. The table renders
  // straight; outer page wrapper still owns the scroll.

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
  //
  // IMPORTANT: the empty state is rendered INSIDE the main layout (as
  // a sibling of the filter toolbar), NOT as an early-return — so when
  // a filter returns zero rows the user can still see the toolbar and
  // clear / change their selection. Returning here would erase the
  // toolbar and trap the user in the empty state.
  const hasActiveFilters = Object.values(filters).some(
    (v) => v !== undefined && v !== "",
  );
  const isEmpty = reviews.length === 0;
  const emptyStateNode = (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
      <p className="font-display text-base font-medium text-text-main">
        {hasActiveFilters
          ? "No reviews match these filters"
          : "No annual reviews recorded"}
      </p>
      <p className="mt-1 text-sm text-text-muted">
        {hasActiveFilters
          ? "Try clearing one or more filters above to broaden the result."
          : "Reviews will appear here once employees submit self-reviews and mentors start evaluating."}
      </p>
    </div>
  );

  const labelCls =
    "text-[11px] font-bold uppercase tracking-wider text-text-muted";
  const selectCls =
    "rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
       <div className="flex items-center gap-4 flex-wrap flex-1 min-w-0">
        {/* Toolbar follows the project-wide
            Identity → Category → Relation → Time → State order so
            the filter widgets sit in the same logical slots across
            all admin-accessible pages. Function + Designation
            (Category) precede Cycle (Time) and Status (State). */}

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

        {functions.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="all-rev-function" className={labelCls}>
              Function
            </label>
            <StringCombobox
              id="all-rev-function"
              options={functions}
              value={filters.function ?? ""}
              onChange={(v) => setFilter("function", v)}
              placeholder="All Functions"
            />
          </div>
        )}

        {designations.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="all-rev-designation" className={labelCls}>
              Designation
            </label>
            <StringCombobox
              id="all-rev-designation"
              options={designations}
              value={filters.designation ?? ""}
              onChange={(v) => setFilter("designation", v)}
              placeholder="All Designations"
            />
          </div>
        )}

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

        <span className="text-xs text-text-muted">
          {/* `total` is the server's count of rows matching the active
              filter set (PR #43, doc 26). Equal to the org-wide
              review count when no filters are active; smaller as
              filters narrow. The "loaded of total" counter beside the
              Load More button below tracks paging progress through
              the filtered universe. */}
          {total} {total === 1 ? "match" : "matches"}
        </span>
        <ClearFiltersButton
          active={hasActiveFilters}
          onClear={() => onFiltersChange({})}
        />
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
          style={{ minWidth: ALL_REVIEWS_TABLE_MIN_WIDTH_PX }}
        >
          {/* Header — non-virtualized, sticky at top of x-scroll viewport */}
          <div role="rowgroup" className="bg-slate-50/80 border-b border-border">
            <div
              role="row"
              className="grid items-center"
              style={{ gridTemplateColumns: ALL_REVIEWS_GRID_TEMPLATE_COLUMNS }}
            >
              {/* Running row number ("#") — cumulative across pages,
                  matches the "Showing N–M of T" counter below. */}
              <div
                role="columnheader"
                className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted"
              >
                #
              </div>
              <div role="columnheader" className="text-left px-5 py-2.5">
                <SortableHeader label="Employee" columnKey="employee_name" sort={sort} onSort={onSortChange} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Function" columnKey="function" sort={sort} onSort={onSortChange} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Designation" columnKey="designation" sort={sort} onSort={onSortChange} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Cycle" columnKey="cycle_name" sort={sort} onSort={onSortChange} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Status" columnKey="status" sort={sort} onSort={onSortChange} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Self" columnKey="self_performance_rating" sort={sort} onSort={onSortChange} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Mentor" columnKey="mentor_performance_rating" sort={sort} onSort={onSortChange} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Final" columnKey="final_performance_rating" sort={sort} onSort={onSortChange} />
              </div>
            </div>
          </div>

          {/* Body — either the no-matches message or the virtualized
              scroll container. Empty state uses the same context-aware
              copy as the org-empty case ("no reviews recorded" vs "no
              reviews match these filters") because both render here
              now — keeps the toolbar above visible so the user can
              clear filters that produced zero rows. */}
          {isEmpty ? (
            <div className="px-5 py-10">{emptyStateNode}</div>
          ) : (
            <div role="rowgroup">
              {sorted.map((r, idx) => {
                const isExpanded = expandedId === r.id;
                return (
                  <div
                    role="row"
                    aria-rowindex={idx + 1}
                    aria-expanded={isExpanded}
                    key={r.id}
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}
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
                      {/* # — cumulative across pages */}
                      <div
                        role="cell"
                        className="px-4 py-3 text-text-muted tabular-nums text-xs"
                      >
                        {((page - 1) * pageSize + idx + 1).toLocaleString()}
                      </div>
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
                      <div role="cell" className="px-4 py-3">
                        <ReviewStatusBadge status={r.status} />
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

                    {/* Expanded narrative panel (conditional). */}
                    {isExpanded && (
                      <div className="bg-slate-50/40 border-t border-brand/10 px-5 py-5">
                        <ReviewNarrativePanel review={r} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Pagination toolbar — per-page selector + prev/next + page
          indicator. Replaces the previous Load-more button + counter
          combo. The Pagination component handles its own zero-total
          empty state internally, but our `isEmpty` branch above also
          renders the contextual empty-state copy so the toolbar reads
          clean. */}
      {!isEmpty && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={onPageChange}
          onPageSizeChange={onPageSizeChange}
          entityLabel="reviews"
        />
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
