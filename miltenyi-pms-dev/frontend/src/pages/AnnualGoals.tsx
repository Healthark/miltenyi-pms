import { useCallback, useEffect, useRef, useState, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { queryKeys } from "@/lib/queryKeys";
import {
  Plus, Target, Lock, Search,
  LayoutGrid, Table2, ChevronDown, BookOpen,
  Pencil, SendHorizonal, Link, MessageSquare,
  UserCircle, Info, Eye,
} from "lucide-react";
import {
  goalService,
  type AllGoalsFilters,
  type AllGoalsSortBy,
  type Goal,
  type TeamGoal,
  type GoalCreatePayload,
  type GoalUpdatePayload,
  type GoalSelfReviewPayload,
  type SelfReviewCycleHalf,
  type Criterion,
  type ApprovalStatus,
} from "@/services/goal.service";
import { useAuth } from "@/hooks/useAuth";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { useToast } from "@/hooks/useToast";
import { useSnackbar } from "@/hooks/useSnackbar";
import { useConfirm } from "@/hooks/useConfirm";
import { getErrorMessage } from "@/utils/errors";
import { setOrDeleteParam, searchParamsChanged } from "@/utils/searchParams";
import { AnnualGoalCard } from "@/components/goals/AnnualGoalCard";
import { GoalFormModal } from "@/components/goals/GoalFormModal";
import { GoalSelfReviewModal } from "@/components/goals/GoalSelfReviewModal";
import { GoalReviewDetailsModal } from "@/components/goals/GoalReviewDetailsModal";
import { SelfReviewCycleMenu } from "@/components/goals/SelfReviewCycleMenu";
import { TeamGoalsTab } from "@/components/goals/TeamGoalsTab";
import { ApprovalStatusBadge } from "@/components/goals/ApprovalStatusBadge";
import { CriteriaChecklist } from "@/components/goals/CriteriaChecklist";
import { RoleExpectationsModal } from "@/components/goals/RoleExpectationsModal";
import { StringCombobox } from "@/components/common/StringCombobox";
import { ClearFiltersButton } from "@/components/common/ClearFiltersButton";
import { useOrgReferenceData } from "@/hooks/useOrgReferenceData";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { useGoalYears } from "@/hooks/useGoalYears";
import { ExportExcelButton } from "@/components/admin/ExportExcelButton";
import { SortableHeader } from "@/components/SortableHeader";
import { compareValues, type SortKind, type SortState, type SortValue } from "@/utils/sort";
import { formatFyYearSpan, fyTokenToStartYear } from "@/utils/fy";
import {
  profileService,
  type UserRoleExpectation,
} from "@/services/profile.service";
import { isPostApproved } from "@/utils/goalStatus";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type ApprovalFilter = "all" | ApprovalStatus;

/** Build the status filter options. Goal cadence is locked to half-yearly
 *  for every org, so this no longer branches on `cycle_type`. The Q1..Q4
 *  values stay in the ApprovalStatus enum for backward-compat with any
 *  legacy rows but aren't surfaced as filter options. */
function buildFilterConfig(): { value: ApprovalFilter; label: string }[] {
  return [
    { value: "all", label: "All" },
    { value: "draft", label: "Draft" },
    { value: "pending_approval", label: "Pending Approval" },
    { value: "changes_requested", label: "Changes Requested" },
    { value: "approved", label: "Approved" },
    { value: "h1_self_reviewed",   label: "H1 Self-Reviewed" },
    { value: "h1_mentor_reviewed", label: "H1 Mentor-Reviewed" },
    { value: "h2_self_reviewed",   label: "H2 Self-Reviewed" },
    { value: "h2_mentor_reviewed", label: "H2 Mentor-Reviewed" },
  ];
}

type ActiveTab = "my" | "team" | "all";
type ViewMode = "grid" | "table";

// My Goals table sort config — Goal/Mentor/Status are alpha, Year is numeric.
// Actions column is not sortable (has no backing data).
type MyGoalsSortKey = "title" | "manager_name" | "fy_year" | "approval_status";

const MY_GOALS_SORT_CONFIG: Record<
  MyGoalsSortKey,
  { kind: SortKind; get: (g: Goal) => SortValue }
> = {
  title:           { kind: "alpha",   get: (g) => g.title },
  manager_name:    { kind: "alpha",   get: (g) => g.manager_name },
  fy_year:         { kind: "numeric", get: (g) => g.fy_year },
  approval_status: { kind: "alpha",   get: (g) => g.approval_status },
};

// All Goals (HR_MyOrg view-only) — flat sortable table styled like the
// All Reviews tab. The single visible column is "Employee"; clicking the
// name reveals an inline drop-down listing that employee's goals (Goal,
// FY, Status, Mentor) without repeating column headers.
interface AllGoalsEmployeeGroup {
  user_id: number;
  owner_name: string;
  function_name: string | null;
  designation_name: string | null;
  /** The fiscal year this row's goals belong to. One group per
   *  (user_id, fy_year) pair — when an employee has goals across
   *  multiple FYs they show up as multiple adjacent rows, not one
   *  row with mixed-year contents. `null` only for goals that the
   *  backend has yet to stamp with a cycle_name (edge case). */
  fy_year: number | null;
  /** Mentor on this group's goals. Goals inside a single (user, FY)
   *  group share a mentor in practice (mentor_id is per-goal but
   *  the seed associates one mentor per employee per cycle). Read
   *  from the first goal in the sorted list. */
  manager_name: string | null;
  goals: TeamGoal[];
}

// Server-side sort dimensions (PR #48, doc 31). Matches backend's
// `_ALL_GOALS_SORT_COLUMNS` map exactly. Re-exported as the wire-type
// `AllGoalsSortBy` from goal.service.ts. Derived columns
// (`fy_year`, `manager_name`) used to be sortable client-side; on the
// server they'd need correlated MAX subqueries — deferred. Those
// column headers stay rendered as plain text.
type AllGoalsSortKey = AllGoalsSortBy;
// ALL_GOALS_SORT_CONFIG used to live here (per-key {kind, get}
// accessors driving the client-side sort). Server-side sort makes the
// accessors unnecessary — backend SQL ORDER BY owns the semantics.

/**
 * Group goals into one row per (user_id, fy_year). An employee with
 * goals across multiple fiscal years gets multiple rows — adjacent
 * because they share owner_name, newest FY first.
 *
 * Previously this grouped by user_id alone, which meant Bob Builder's
 * FY25-26 goals (3 lifecycle-complete) and FY26-27 goal (1 in-progress)
 * collapsed into one row whose Year column showed only the latest FY.
 * Expanding that row mixed both years' goals together with no per-row
 * year demarcation. Splitting by (user, FY) makes each row's Year
 * column accurate.
 */
function buildAllGoalsGroups(goals: readonly TeamGoal[]): AllGoalsEmployeeGroup[] {
  const map = new Map<string, AllGoalsEmployeeGroup>();
  for (const g of goals) {
    const key = `${g.user_id}_${g.fy_year ?? "null"}`;
    const existing = map.get(key);
    if (existing) {
      existing.goals.push(g);
    } else {
      map.set(key, {
        user_id: g.user_id,
        owner_name: g.owner_name,
        function_name: g.owner_function_name,
        designation_name: g.owner_designation_name,
        fy_year: g.fy_year,
        manager_name: g.manager_name,
        goals: [g],
      });
    }
  }
  // Inner goals: newest first within a group (created_at proxy via
  // fy_year fallback). All goals in a single group share an fy_year,
  // so this is just a stable ordering for the expansion list.
  for (const group of map.values()) {
    group.goals.sort(
      (a, b) =>
        (b.fy_year ?? 0) - (a.fy_year ?? 0) ||
        new Date(b.created_at ?? 0).getTime() -
          new Date(a.created_at ?? 0).getTime(),
    );
  }
  // Final ordering: by owner_name (matches the existing primary sort)
  // and within the same employee, newer FY first so the active-cycle
  // row floats to the top of that employee's pair.
  return Array.from(map.values()).sort((a, b) => {
    const nameCmp = a.owner_name.localeCompare(b.owner_name);
    if (nameCmp !== 0) return nameCmp;
    return (b.fy_year ?? 0) - (a.fy_year ?? 0);
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recomputeProgress(criteria: Criterion[]): number {
  if (criteria.length === 0) return 0;
  const completed = criteria.filter((c) => c.is_completed).length;
  return Math.round((completed / criteria.length) * 100);
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EmptyState({
  editGateOpen,
  hasFilter,
}: {
  editGateOpen: boolean;
  hasFilter: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
      <Target className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
      <p className="font-display text-base font-medium text-text-main">
        {hasFilter ? "No goals match this filter" : "No goals yet"}
      </p>
      <p className="mt-1 text-sm text-text-muted">
        {hasFilter
          ? "Try selecting a different filter above."
          : editGateOpen
          ? "Use Add Goal button to add your first annual goal."
          : "Goal submissions are currently closed. Check back when the next window opens."}
      </p>
    </div>
  );
}

function GoalSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 animate-pulse">
      {[1, 2, 3].map((n) => (
        <div
          key={n}
          className="h-44 rounded-lg border border-border bg-surface p-4"
        >
          <div className="h-3 w-3/4 rounded bg-slate-100 mb-3" />
          <div className="h-2.5 w-full rounded bg-slate-100" />
          <div className="h-2.5 w-2/3 rounded bg-slate-100 mt-1.5" />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function AnnualGoals() {
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();

  // Role-based detection (replaces the old `has_mentees` shortcut).
  // Employee → "My Goals" tab, Mentor → "Team Goals" tab,
  // HR_MyOrg → view-only "All Goals" tab.
  const isEmployee = user?.role === "Employee";
  const isMentor = user?.role === "Mentor";
  const isHRMyOrg = user?.role === "HR_MyOrg";
  const annualGoalsEditEnabled = settings?.annual_goals_edit_enabled ?? false;

  // Extract bare FY label ("H1 FY26" → "FY26") for the page header.
  const fyLabel = settings?.active_cycle_name
    ? settings.active_cycle_name.split(" ").find((t) => t.startsWith("FY")) ??
      settings.active_cycle_name
    : null;

  const queryClient = useQueryClient();

  // Tab selection: role-driven default + explicit user override. Picking
  // a tab locks the choice so a stale render of useAuth() can't yank the
  // user back to the role-default tab mid-session. See AnnualReviews for
  // the same pattern.
  const [userPickedTab, setUserPickedTab] = useState<ActiveTab | null>(null);
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<SortState<MyGoalsSortKey> | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [expandedGoalId, setExpandedGoalId] = useState<number | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [modalError, setModalError] = useState("");

  // Self-review modal state — pure client state. The saving flags are
  // gone (mutations expose isPending instead); the error string + which
  // goal/half is being reviewed stay local.
  const [selfReviewGoal, setSelfReviewGoal] = useState<Goal | null>(null);
  const [selfReviewCycle, setSelfReviewCycle] =
    useState<SelfReviewCycleHalf | null>(null);
  const [selfReviewError, setSelfReviewError] = useState("");

  const [roleExpectationsOpen, setRoleExpectationsOpen] = useState(false);

  // ── Queries ────────────────────────────────────────────────────────
  // Three queries, all role-gated. Both goal queries register
  // unconditionally (Rules of Hooks) and use `enabled` to keep the
  // request parked unless the current user actually needs it. Mentor
  // is conspicuously absent here — TeamGoalsTab owns its own
  // ['goals', 'mentees'] query.
  //
  // Role-expectations is everyone-fetches: every role sees the
  // collapsible "What's expected at my level" panel, so no gate.
  const expectationsQuery = useQuery({
    queryKey: queryKeys.profile.expectations(),
    queryFn: profileService.getMyExpectations,
  });
  const myGoalsQuery = useQuery({
    queryKey: queryKeys.goals.mine("annual"),
    queryFn: () => goalService.getMyGoals("annual"),
    enabled: isEmployee,
  });
  // Paginated as of PR #37 (doc 20). Same useInfiniteQuery shape as the
  // AnnualReviews "All Reviews" tab (doc 19), but the server here
  // paginates by EMPLOYEE not by goal row — see goalService.getAllGoals
  // for the rationale. `flatMap(p => p.items)` still yields a goal array
  // that `buildAllGoalsGroups` consumes unchanged, producing complete
  // per-employee groups (no employee straddles two pages).
  //
  // ── Server-side filters (PR #44, doc 27) ─────────────────────────
  // Filter state lives at the page level so it can be baked into the
  // queryKey (each filter combination is its own paginated cache
  // entry). The cache key still starts with ['goals', 'org', ...] so
  // broadcast invalidations on queryKeys.goals.all keep working for
  // every filter variant when goal mutations fire.
  //
  // - initialPageParam: 0  → first request: GET /goals/all?offset=0&limit=50
  // - getNextPageParam: derives the next offset from the previous page's
  //   has_more flag (server-computed). Return undefined to stop paging.
  const ALL_GOALS_PAGE_SIZE = 50;
  const [allGoalsFilters, setAllGoalsFilters] = useState<AllGoalsFilters>({});
  const [allGoalsSort, setAllGoalsSort] = useState<
    SortState<AllGoalsSortKey> | null
  >(null);

  // First time we know the org's active cycle, pre-fill the Year +
  // Status filters on the All Goals tab. HR almost always lands here
  // to triage the CURRENT year ("show me what's pending approval
  // right now"), so defaulting to "All Years" forces them to narrow
  // every session.
  //
  // URL search params take precedence so dashboard deep-links (e.g.
  // /annual-goals?fy=2026&status=pending_approval from a funnel card's
  // View-all link) land pre-filtered.
  //
  // Ref guard fires once per mount; later user edits to the filters
  // are preserved across re-renders / settings refetches.
  const [searchParams, setSearchParams] = useSearchParams();
  // HR All-Goals tab reader. Gated on `isHRMyOrg` so the Employee
  // landing here (My Goals tab) doesn't accidentally seed
  // allGoalsFilters from URL — there's a separate Employee reader
  // below that targets approvalFilter + yearFilter.
  const allGoalsYearDefaultedRef = useRef(false);
  useEffect(() => {
    if (!isHRMyOrg) return;
    if (allGoalsYearDefaultedRef.current) return;
    if (!settings?.active_cycle_name) return;

    const urlFy = searchParams.get("fy");
    const urlStatus = searchParams.get("status");

    const updates: Partial<AllGoalsFilters> = {};
    if (urlFy) {
      const parsed = Number(urlFy);
      if (!Number.isNaN(parsed)) updates.fy_year = parsed;
    } else {
      const activeFy = fyTokenToStartYear(settings.active_cycle_name);
      if (activeFy !== null) updates.fy_year = activeFy;
    }
    if (urlStatus) updates.approval_status = urlStatus;

    if (Object.keys(updates).length > 0) {
      setAllGoalsFilters((prev) => ({ ...prev, ...updates }));
    }
    allGoalsYearDefaultedRef.current = true;
  }, [isHRMyOrg, settings?.active_cycle_name, searchParams]);

  // HR write-back: mirror the current All-Goals filter state to URL
  // so refresh + share-link preserves the view. Gated on the same
  // ref the reader uses (so the first render's empty state doesn't
  // clobber URL params before the reader has seeded state) + on
  // isHRMyOrg so Employee landing here doesn't clear the URL.
  // `replace` so the browser history doesn't accumulate one entry
  // per keystroke. The string-equality short circuit prevents
  // redundant React Router navigations.
  useEffect(() => {
    if (!isHRMyOrg) return;
    if (!allGoalsYearDefaultedRef.current) return;
    const next = new URLSearchParams(searchParams);
    setOrDeleteParam(next, "fy", allGoalsFilters.fy_year);
    setOrDeleteParam(next, "status", allGoalsFilters.approval_status);
    if (searchParamsChanged(searchParams, next)) {
      setSearchParams(next, { replace: true });
    }
  }, [isHRMyOrg, allGoalsFilters, searchParams, setSearchParams]);

  // Employee My-Goals tab URL reader + writer. Mirrors approvalFilter
  // (-> ?status=) + yearFilter (-> ?fy=) so refresh + share-link
  // preserves filter state, and dashboard deep-links from
  // ActionItemsWidget ("?status=changes_requested" /
  // "?status=draft") seed the right subset on first paint.
  // Search query is intentionally NOT URL-synced — typing-into-URL
  // would be jarring at every keystroke and the search is debounced
  // already on the data side; refresh forfeits the in-progress
  // query, which is acceptable.
  const myGoalsDefaultedRef = useRef(false);
  useEffect(() => {
    if (!isEmployee) return;
    if (myGoalsDefaultedRef.current) return;
    const urlStatus = searchParams.get("status");
    const urlFy = searchParams.get("fy");
    if (urlStatus) setApprovalFilter(urlStatus as ApprovalFilter);
    // yearFilter is a string in this component ("all" / "2026"); the
    // URL value is also a string so no parsing needed.
    if (urlFy) setYearFilter(urlFy);
    myGoalsDefaultedRef.current = true;
  }, [isEmployee, searchParams]);

  useEffect(() => {
    if (!isEmployee) return;
    if (!myGoalsDefaultedRef.current) return;
    const next = new URLSearchParams(searchParams);
    setOrDeleteParam(next, "status", approvalFilter);
    setOrDeleteParam(next, "fy", yearFilter);
    if (searchParamsChanged(searchParams, next)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    isEmployee,
    approvalFilter,
    yearFilter,
    searchParams,
    setSearchParams,
  ]);
  // Strip empty / undefined values so cache keys and request payloads
  // collapse to a clean shape — see doc 26 Part 2's "empty-filters trap".
  const allGoalsFilterParams: Record<string, string | number> =
    Object.fromEntries(
      Object.entries(allGoalsFilters).filter(
        ([, v]) => v !== undefined && v !== "",
      ),
    ) as Record<string, string | number>;
  // Merge sort into the request params (doc 30 Part 1).
  const allGoalsRequestParams: Record<string, string | number> = {
    ...allGoalsFilterParams,
    ...(allGoalsSort
      ? { sort_by: allGoalsSort.key, sort_dir: allGoalsSort.direction }
      : {}),
  };
  const allGoalsQuery = useInfiniteQuery({
    queryKey: queryKeys.goals.org(allGoalsRequestParams),
    queryFn: ({ pageParam }) =>
      goalService.getAllGoals({
        ...(allGoalsRequestParams as Record<string, string | number> & {
          sort_by?: AllGoalsSortBy;
        }),
        limit: ALL_GOALS_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.offset + lastPage.limit : undefined,
    enabled: isHRMyOrg,
  });

  const roleExpectation: UserRoleExpectation | null =
    expectationsQuery.data ?? null;
  const goals: Goal[] = myGoalsQuery.data ?? [];
  // Flatten loaded pages into a single goal array. Every consumer
  // downstream (filters, sort, grouping) sees one combined list as the
  // user loads more pages. Empty array on the first render before any
  // page resolves.
  const allGoals: TeamGoal[] =
    allGoalsQuery.data?.pages.flatMap((p) => p.items) ?? [];
  // Total employee count across ALL pages (the server returns the same
  // value on every paginated response, so we read it off the latest
  // page). 0 before the first page resolves.
  const allGoalsTotalEmployees =
    allGoalsQuery.data?.pages[allGoalsQuery.data.pages.length - 1]?.total ?? 0;
  // For paginated queries `isPending` covers ONLY the first-page fetch
  // (no pages loaded yet); subsequent fetchNextPage() calls flip
  // `isFetchingNextPage` instead, handled at the Load More button below.
  const isLoading = isEmployee
    ? myGoalsQuery.isPending
    : isHRMyOrg
      ? allGoalsQuery.isPending
      : false;

  // Role-driven default tab. `userPickedTab` (above) overrides once set.
  const defaultTab: ActiveTab = isMentor ? "team" : isHRMyOrg ? "all" : "my";
  const activeTab = userPickedTab ?? defaultTab;
  const setActiveTab = setUserPickedTab;

  // Modal helpers
  const openAdd = () => {
    setEditingGoal(null);
    setModalError("");
    setShowModal(true);
  };
  const openEdit = (g: Goal) => {
    setEditingGoal(g);
    setModalError("");
    setShowModal(true);
  };
  const closeModal = () => {
    setShowModal(false);
    setEditingGoal(null);
    setModalError("");
  };

  // ── Mutations ──────────────────────────────────────────────────────
  // All five mutations invalidate the SAME two parent keys:
  //
  //   ['goals']      — catches ['goals','mine','annual'], ['goals','all'],
  //                    ['goals','mentees'] (TeamGoalsTab), and any other
  //                    cache entry under the goals namespace. This is
  //                    the broadcast pattern: one parent-key invalidation
  //                    refreshes every observer of every goal query in
  //                    the app, regardless of who's looking.
  //   ['dashboard']  — the dashboard summary tile counts goals, so any
  //                    goal mutation can change those numbers. The old
  //                    code never refreshed dashboard counts after a
  //                    goal write — a real bug this migration fixes.
  //
  // Broadcast keys vs explicit lists: in PR #21 we listed each affected
  // key by name (['annual-reviews','mine'] + ['annual-reviews','all']).
  // That's clearer when the list is short. When you have 3+ children
  // under a parent (mine, all, mentees, plus future per-user keys), a
  // parent-key invalidation is shorter, future-proof, and matches
  // TanStack Query's prefix-matching semantics perfectly.
  // Uses the factory's `.all` properties to broadcast-invalidate every
  // cache entry under each namespace. ['goals'] catches all 4 goal
  // queries; ['dashboard'] catches the summary + HR summary entries.
  const invalidateGoalsAndDashboard = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  }, [queryClient]);

  const createGoalMutation = useMutation({
    mutationFn: (payload: GoalCreatePayload) =>
      goalService.createGoal({ ...payload, goal_type: "annual" }),
    onSuccess: () => {
      invalidateGoalsAndDashboard();
      closeModal();
      toast.success("Goal created.");
    },
    onError: (err) => setModalError(getErrorMessage(err)),
  });

  const updateGoalMutation = useMutation({
    mutationFn: (vars: { id: number; payload: GoalUpdatePayload }) =>
      goalService.updateGoal(vars.id, vars.payload),
    onSuccess: () => {
      invalidateGoalsAndDashboard();
      closeModal();
      toast.success("Goal updated.");
    },
    onError: (err) => setModalError(getErrorMessage(err)),
  });

  const submitGoalMutation = useMutation({
    mutationFn: (goalId: number) => goalService.submitGoal(goalId),
    onSuccess: () => {
      invalidateGoalsAndDashboard();
      toast.success("Goal submitted for review.");
    },
    onError: (err) => snackbar.error(getErrorMessage(err)),
  });

  const submitSelfReviewMutation = useMutation({
    mutationFn: (vars: {
      goalId: number;
      cycleHalf: SelfReviewCycleHalf;
      payload: GoalSelfReviewPayload;
    }) =>
      goalService.submitSelfReview(vars.goalId, vars.cycleHalf, vars.payload),
    onSuccess: () => {
      invalidateGoalsAndDashboard();
      closeSelfReview();
      toast.success("Self-review submitted.");
    },
    onError: (err) => setSelfReviewError(getErrorMessage(err)),
  });

  const saveSelfReviewDraftMutation = useMutation({
    mutationFn: (vars: {
      goalId: number;
      cycleHalf: SelfReviewCycleHalf;
      payload: GoalSelfReviewPayload;
    }) =>
      goalService.saveSelfReviewDraft(
        vars.goalId,
        vars.cycleHalf,
        vars.payload,
      ),
    onSuccess: () => {
      invalidateGoalsAndDashboard();
      // Keep the modal open so the mentee sees the "(Draft)" title and
      // can continue editing — toast confirms the save.
      toast.success("Draft saved.");
    },
    onError: (err) => setSelfReviewError(getErrorMessage(err)),
  });

  const isSavingGoal =
    createGoalMutation.isPending || updateGoalMutation.isPending;

  // ── Handlers (thin wrappers over mutations) ────────────────────────
  // Create or update. mutateAsync because GoalFormModal awaits onSave
  // to drive its "Saving..." state (same pattern as UserModal in #20).
  const handleSave = async (payload: GoalCreatePayload | GoalUpdatePayload) => {
    setModalError("");
    try {
      if (editingGoal) {
        await updateGoalMutation.mutateAsync({
          id: editingGoal.id,
          payload: payload as GoalUpdatePayload,
        });
      } else {
        await createGoalMutation.mutateAsync(payload as GoalCreatePayload);
      }
    } catch {
      /* handled by onError */
    }
  };

  // Submit draft / changes_requested goal for mentor review.
  // Fire-and-forget — no caller awaits this.
  const handleSubmit = async (goal: Goal) => {
    const ok = await confirm({
      title: "Submit goal for approval?",
      message: `Send "${goal.title}" to your mentor for review. Once submitted you can't edit this goal until your mentor approves it or requests changes.`,
      variant: "warning",
      confirmText: "Submit",
    });
    if (!ok) return;
    submitGoalMutation.mutate(goal.id);
  };

  // Self-review handlers
  const openSelfReview = (goal: Goal, cycleHalf: SelfReviewCycleHalf) => {
    setSelfReviewError("");
    setSelfReviewGoal(goal);
    setSelfReviewCycle(cycleHalf);
  };
  const closeSelfReview = () => {
    setSelfReviewGoal(null);
    setSelfReviewCycle(null);
    setSelfReviewError("");
  };
  const handleSelfReviewSubmit = async (
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalSelfReviewPayload,
  ) => {
    if (!selfReviewGoal) return;
    const ok = await confirm({
      title: `Submit ${cycleHalf} self-review?`,
      message: `Submit your ${cycleHalf} reflection on "${selfReviewGoal.title}". Self-reviews are one-shot — once sent you can't edit this entry, and your mentor will be able to read it.`,
      variant: "warning",
      confirmText: "Submit Self-Review",
    });
    if (!ok) return;
    setSelfReviewError("");
    try {
      await submitSelfReviewMutation.mutateAsync({
        goalId: selfReviewGoal.id,
        cycleHalf,
        payload,
      });
    } catch {
      /* handled by onError */
    }
  };

  const handleSelfReviewSaveDraft = async (
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalSelfReviewPayload,
  ) => {
    if (!selfReviewGoal) return;
    setSelfReviewError("");
    try {
      await saveSelfReviewDraftMutation.mutateAsync({
        goalId: selfReviewGoal.id,
        cycleHalf,
        payload,
      });
    } catch {
      /* handled by onError */
    }
  };

  // Criterion toggle — preserves the original "instant client-side
  // feedback" behaviour, but now writes to the cache directly via
  // setQueryData instead of a local useState. CriteriaChecklist still
  // calls goalService.updateCriterion itself; this handler just splices
  // the response into the My Goals cache entry.
  //
  // Why setQueryData (not invalidateQueries) here: the criterion toggle
  // is a HOT PATH — every checkbox click would otherwise trigger a full
  // /goals refetch. Direct cache mutation keeps the UI responsive and
  // saves bandwidth. The trade is: if the server normalizes the row
  // somehow we can miss the normalization, but criterion writes are
  // simple enough that this is safe.
  //
  // The dashboard summary's completion_percent ALSO depends on
  // criterion state, so we invalidate dashboard alongside. That's a
  // background refetch the user doesn't see (the dashboard isn't
  // mounted while on /annual-goals).
  const handleCriterionUpdate = useCallback(
    (goalId: number, updated: Criterion) => {
      queryClient.setQueryData<Goal[]>(
        queryKeys.goals.mine("annual"),
        (prev) => {
          if (!prev) return prev;
          return prev.map((g) => {
            if (g.id !== goalId) return g;
            const newCriteria = g.criteria.map((c) =>
              c.id === updated.id ? updated : c,
            );
            return {
              ...g,
              criteria: newCriteria,
              progress_percent: recomputeProgress(newCriteria),
            };
          });
        },
      );
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    },
    [queryClient],
  );

  const availableYears = Array.from(
    new Set(goals.map((g) => g.fy_year).filter((y): y is number => y !== null)),
  ).sort((a, b) => b - a);

  const filteredGoals = goals
    .filter((g) => approvalFilter === "all" || g.approval_status === approvalFilter)
    .filter((g) => yearFilter === "all" || g.fy_year === Number(yearFilter))
    .filter((g) =>
      searchQuery.trim() === "" ||
      g.title.toLowerCase().includes(searchQuery.toLowerCase()),
    );

  // Sorting layered on top of filtering. Slice first to keep React state immutable.
  const sortedGoals = sort
    ? filteredGoals.slice().sort((a, b) => {
        const { kind, get } = MY_GOALS_SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : filteredGoals;

  const tabCls = (tab: ActiveTab) =>
    `px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
      activeTab === tab
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  const viewBtnCls = (mode: ViewMode) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
      viewMode === mode
        ? "bg-brand/10 text-brand"
        : "text-text-muted hover:bg-slate-100"
    }`;

  // Header text per role.
  // Employee/Mentor keep the existing "Team Goals" label.
  // HR_MyOrg gets "All Goals" — distinct view-only org-wide scope.
  const headerTitle = isHRMyOrg ? "All Goals" : "Team Goals";
  const headerSubtitle = isHRMyOrg
    ? "View-only access to every annual goal across the org."
    : isMentor
      ? "Review and evaluate your team's annual goals."
      : "Define your annual objectives for this year.";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
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

        {/* Add Goal button is Staff-only (Mentor has no own goals;
            HR_MyOrg view-only). Honors the no-mentor + edit-gate rules. */}
        {isEmployee &&
          (user?.has_mentor === false ? (
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-700">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              No mentor assigned — goal creation is disabled.
            </div>
          ) : annualGoalsEditEnabled ? (
            <button
              type="button"
              onClick={openAdd}
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Add Goal
            </button>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Goal submissions are currently closed.
            </div>
          ))}
      </div>

      {/* Tab container */}
      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-border px-2">
          {isEmployee && (
            <button
              type="button"
              className={tabCls("my")}
              onClick={() => setActiveTab("my")}
            >
              My Goals
            </button>
          )}
          {isMentor && (
            <button
              type="button"
              className={tabCls("team")}
              onClick={() => setActiveTab("team")}
            >
              Team Goals
            </button>
          )}
          {isHRMyOrg && (
            <button
              type="button"
              className={tabCls("all")}
              onClick={() => setActiveTab("all")}
            >
              All Goals
            </button>
          )}
        </div>

        <div className="p-5">
          {/* ── My Goals tab ── */}
          {isEmployee && activeTab === "my" && (
            <div className="space-y-4">
              {/* Role expectations — button-triggered modal so the reader
                  sees all eight competencies at full width, not just a
                  hard-coded subset inside an inline accordion. */}
              {roleExpectation && (
                <div className="flex items-center justify-between rounded-lg border border-blue-100 bg-blue-50/40 px-4 py-2.5">
                  <span className="flex items-center gap-2 text-[13px] text-text-main">
                    <BookOpen
                      className="h-3.5 w-3.5 text-blue-600 shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      Reference your role expectations while writing or
                      reviewing your goals.
                    </span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setRoleExpectationsOpen(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-[12px] font-medium text-blue-700 hover:bg-blue-50 transition-colors shrink-0"
                  >
                    <Info className="h-3.5 w-3.5" aria-hidden="true" />
                    View Role Expectations
                  </button>
                </div>
              )}

              {/* Toolbar */}
              {!isLoading && goals.length > 0 && (
                <div className="flex flex-col gap-3">
                  {/* Row 1: Search + View Toggle */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="relative flex-1 max-w-xs">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
                      <input
                        type="text"
                        placeholder="Search goals..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-1.5 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand"
                      />
                    </div>
                    <div className="flex items-center gap-1 rounded-lg border border-border bg-white p-0.5">
                      <button type="button" className={viewBtnCls("grid")} onClick={() => setViewMode("grid")}>
                        <LayoutGrid className="h-3.5 w-3.5" /> Cards
                      </button>
                      <button type="button" className={viewBtnCls("table")} onClick={() => setViewMode("table")}>
                        <Table2 className="h-3.5 w-3.5" /> Table
                      </button>
                    </div>
                  </div>

                  {/* Row 2: Filters */}
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <label htmlFor="goal-year-filter" className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Year</label>
                      <select
                        id="goal-year-filter"
                        value={yearFilter}
                        onChange={(e) => setYearFilter(e.target.value)}
                        className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[120px] cursor-pointer"
                      >
                        <option value="all">All Years</option>
                        {availableYears.map((y) => (
                          <option key={y} value={y}>{formatFyYearSpan(y)}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <label htmlFor="goal-status-filter" className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Status</label>
                      <select
                        id="goal-status-filter"
                        value={approvalFilter}
                        onChange={(e) => setApprovalFilter(e.target.value as ApprovalFilter)}
                        className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[160px] cursor-pointer"
                      >
                        {buildFilterConfig().map((f) => (
                          <option key={f.value} value={f.value}>{f.label}</option>
                        ))}
                      </select>
                    </div>

                    <ClearFiltersButton
                      active={
                        approvalFilter !== "all" ||
                        yearFilter !== "all" ||
                        searchQuery.trim().length > 0
                      }
                      onClear={() => {
                        setApprovalFilter("all");
                        setYearFilter("all");
                        setSearchQuery("");
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Content */}
              {isLoading ? (
                <GoalSkeleton />
              ) : goals.length === 0 ? (
                <EmptyState
                  editGateOpen={annualGoalsEditEnabled}
                  hasFilter={false}
                />
              ) : filteredGoals.length === 0 ? (
                <EmptyState
                  editGateOpen={annualGoalsEditEnabled}
                  hasFilter={true}
                />
              ) : viewMode === "grid" ? (
                /* ── Card / Grid View ── */
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {sortedGoals.map((goal) => (
                    <AnnualGoalCard
                      key={goal.id}
                      goal={goal}
                      onEdit={openEdit}
                      onSubmit={handleSubmit}
                      onSelfReview={(g, half) => openSelfReview(g, half)}
                      onCriterionUpdate={handleCriterionUpdate}
                      editGateOpen={annualGoalsEditEnabled}
                    />
                  ))}
                </div>
              ) : (
                /* ── Table View ── */
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full min-w-max text-[13px]">
                    <thead>
                      <tr className="bg-slate-50/80 border-b border-border">
                        <th className="text-left px-5 py-2.5">
                          <SortableHeader label="Goal" columnKey="title" sort={sort} onSort={setSort} />
                        </th>
                        <th className="text-left px-4 py-2.5">
                          <SortableHeader label="Mentor" columnKey="manager_name" sort={sort} onSort={setSort} />
                        </th>
                        <th className="text-left px-4 py-2.5">
                          <SortableHeader label="Year" columnKey="fy_year" sort={sort} onSort={setSort} />
                        </th>
                        <th className="text-left px-4 py-2.5">
                          <SortableHeader label="Status" columnKey="approval_status" sort={sort} onSort={setSort} />
                        </th>
                        <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/50">
                      {sortedGoals.map((goal) => {
                        const isExpanded = expandedGoalId === goal.id;
                        const isDraft = goal.approval_status === "draft";
                        const isChangesRequired = goal.approval_status === "changes_requested";
                        const canEdit = (isDraft || isChangesRequired) && annualGoalsEditEnabled;
                        const canSubmit = isDraft || isChangesRequired;

                        return (
                          <Fragment key={goal.id}>
                            <tr
                              className={`transition-colors cursor-pointer ${isExpanded ? "bg-brand/5" : "hover:bg-slate-50/60"}`}
                              onClick={() => setExpandedGoalId(isExpanded ? null : goal.id)}
                            >
                              <td className="px-5 py-3 font-medium text-text-main max-w-xs">
                                <div className="flex items-center gap-2">
                                  <ChevronDown className={`h-4 w-4 text-text-muted shrink-0 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                                  <span className="line-clamp-1">{goal.title}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3">
                                {goal.manager_name ? (
                                  <div className="flex items-center gap-1.5 text-[12.5px] text-text-main">
                                    <UserCircle className="h-3.5 w-3.5 text-text-muted shrink-0" />
                                    <span className="truncate">{goal.manager_name}</span>
                                  </div>
                                ) : (
                                  <span className="text-[12px] italic text-text-muted">
                                    No Mentor Assigned
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {goal.fy_year ? (
                                  <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                                    {formatFyYearSpan(goal.fy_year)}
                                  </span>
                                ) : (
                                  <span className="text-[12px] text-text-muted">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                <ApprovalStatusBadge status={goal.approval_status} />
                              </td>
                              <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                                <div className="flex items-center gap-2 flex-wrap">
                                  {canEdit && (
                                    <button
                                      type="button"
                                      onClick={() => openEdit(goal)}
                                      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-text-muted hover:bg-brand/10 hover:text-brand transition-colors"
                                    >
                                      <Pencil className="h-3 w-3" /> Edit
                                    </button>
                                  )}
                                  {canSubmit && (
                                    <button
                                      type="button"
                                      onClick={() => handleSubmit(goal)}
                                      className="flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand hover:text-white transition-colors"
                                    >
                                      <SendHorizonal className="h-3 w-3" /> Request Approval
                                    </button>
                                  )}
                                  {goal.approval_status === "pending_approval" && (
                                    <span className="text-[11px] text-text-muted italic">Awaiting review…</span>
                                  )}
                                  {isPostApproved(goal.approval_status) && (
                                    <SelfReviewCycleMenu
                                      goal={goal}
                                      mode="mentee"
                                      onSelect={(half) =>
                                        openSelfReview(goal, half)
                                      }
                                    />
                                  )}
                                </div>
                              </td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-brand/5">
                                <td colSpan={5} className="px-10 py-4">
                                  <div className="space-y-3 max-w-2xl">
                                    {goal.description && (
                                      <p className="text-sm text-text-muted">{goal.description}</p>
                                    )}
                                    {goal.attachment_url && (
                                      <a
                                        href={goal.attachment_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-1.5 text-xs text-brand hover:underline w-fit"
                                      >
                                        <Link className="h-3 w-3 shrink-0" /> Attachment
                                      </a>
                                    )}
                                    {isChangesRequired && goal.manager_feedback && (
                                      <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                                        <MessageSquare className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                                        <div>
                                          <p className="text-xs font-semibold text-amber-700 mb-0.5">Mentor Feedback</p>
                                          <p className="text-xs text-amber-800">{goal.manager_feedback}</p>
                                        </div>
                                      </div>
                                    )}
                                    {goal.criteria.length > 0 && (
                                      <CriteriaChecklist
                                        criteria={goal.criteria}
                                        approvalStatus={goal.approval_status}
                                        progressPercent={goal.progress_percent}
                                        onCriterionUpdate={(updated: Criterion) =>
                                          handleCriterionUpdate(goal.id, updated)
                                        }
                                      />
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Team Goals tab ── */}
          {isMentor && activeTab === "team" && <TeamGoalsTab />}

          {/* ── HR_MyOrg view-only "All Goals" tab ── */}
          {isHRMyOrg && activeTab === "all" && (
            <AllGoalsTab
              goals={allGoals}
              isLoading={isLoading}
              totalEmployees={allGoalsTotalEmployees}
              hasNextPage={Boolean(allGoalsQuery.hasNextPage)}
              isFetchingNextPage={allGoalsQuery.isFetchingNextPage}
              onLoadMore={() => {
                void allGoalsQuery.fetchNextPage();
              }}
              filters={allGoalsFilters}
              onFiltersChange={setAllGoalsFilters}
              sort={allGoalsSort}
              onSortChange={setAllGoalsSort}
            />
          )}
        </div>
      </div>

      {/* Create / Edit modal — conditionally mounted so the form's
          local state initialises fresh on every open. */}
      {showModal && (
        <GoalFormModal
          onClose={closeModal}
          onSave={handleSave}
          editingGoal={editingGoal}
          isSaving={isSavingGoal}
          error={modalError}
        />
      )}

      {selfReviewGoal !== null && selfReviewCycle !== null && (
        <GoalSelfReviewModal
          goal={selfReviewGoal}
          cycleHalf={selfReviewCycle}
          onClose={closeSelfReview}
          onSubmit={handleSelfReviewSubmit}
          onSaveDraft={handleSelfReviewSaveDraft}
          isSaving={submitSelfReviewMutation.isPending}
          isDraftSaving={saveSelfReviewDraftMutation.isPending}
          error={selfReviewError}
        />
      )}

      {/* Role expectations modal — opened by the "View Role Expectations"
          button on the My Goals tab. Guarded on both open-state and
          loaded data so it never renders with a missing expectation. */}
      {roleExpectationsOpen && roleExpectation && (
        <RoleExpectationsModal
          expectation={roleExpectation}
          onClose={() => setRoleExpectationsOpen(false)}
        />
      )}
    </div>
  );
}

// ── HR_MyOrg "All Goals" view-only table ──────────────────────────

// Shared CSS Grid layout for the 5-column virtualized "All Goals" view.
// The same template covers BOTH the user-level row (Employee | Function
// | Designation | Year | Mentor) AND the per-goal sub-rows inside the
// expansion (Goal | Description-span-2 | Status | Action). For sub-rows
// the Description cell uses `gridColumn: span 2` to occupy what Function
// + Designation would have held — the CSS Grid equivalent of the
// legacy <td colSpan={2}>.
const ALL_GOALS_GRID_TEMPLATE_COLUMNS =
  "minmax(180px, 1.6fr) minmax(140px, 1.4fr) minmax(140px, 1.4fr) " +
  "minmax(100px, 1fr) minmax(140px, 1.3fr)";

// Sum of the GRID_TEMPLATE_COLUMNS minimums plus a little breathing
// room. Drives the table's min-width so the outer horizontal-scroll
// wrapper engages BEFORE the body's implicit overflow-x (legacy CSS
// pairing for overflow-y: auto) does — otherwise the body scrolls
// horizontally on its own and the header stays put. Mirrors the same
// fix in ManagementReview.tsx.
const ALL_GOALS_TABLE_MIN_WIDTH_PX = 760;

// Collapsed user row (~48px) — text-[13px] + py-3 padding. measureElement
// records the real size after render; this estimate seeds the initial
// total-size calculation before any row has rendered.
const ALL_GOALS_ESTIMATE_ROW_PX = 48;

const ALL_GOALS_SCROLL_HEIGHT_PX = 600;

// Lower overscan than PR #15/#17 because expanded groups can be VERY
// tall (a user with 10 goals = ~500px expansion). Over-rendering tall
// rows costs more measurement work; tune up only if scroll on slow
// devices flashes empty rows.
const ALL_GOALS_OVERSCAN = 4;

function AllGoalsTab({
  goals,
  isLoading,
  totalEmployees,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
  filters,
  onFiltersChange,
  sort,
  onSortChange,
}: {
  readonly goals: TeamGoal[];
  readonly isLoading: boolean;
  readonly totalEmployees: number;
  readonly hasNextPage: boolean;
  readonly isFetchingNextPage: boolean;
  readonly onLoadMore: () => void;
  readonly filters: AllGoalsFilters;
  readonly onFiltersChange: (next: AllGoalsFilters) => void;
  /** Current sort. Controlled by the page (doc 30 / 31). */
  readonly sort: SortState<AllGoalsSortKey> | null;
  readonly onSortChange: (next: SortState<AllGoalsSortKey> | null) => void;
}) {
  // Only the modal target + row expansion are local now — filters AND
  // sort moved to the page. Expansion is keyed by the group's composite
  // (user_id, fy_year) identity because employees can now appear as
  // multiple adjacent rows (one per FY) — a plain `user_id` would
  // expand all of an employee's rows together.
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);
  // The goal whose self/mentor reviews are currently being read in the
  // details modal. null = modal closed.
  const [viewGoal, setViewGoal] = useState<TeamGoal | null>(null);

  // All filter dropdown options come from canonical org-wide sources,
  // NOT from the LOADED (= server-filtered) `goals`. Without that,
  // picking any filter narrows the server response and the dropdown
  // re-derives to only the selected value — locking the user out of
  // changing their selection until they clear the filter.
  //
  //   functions / designations  -> useOrgReferenceData() (admin refs)
  //   employees / mentors       -> useOrgUsers() (admin /users)
  //   years                     -> useGoalYears() (DB DISTINCT + active FY)
  const { functionNames: functions, designationNames: designations } =
    useOrgReferenceData();
  const { employeeNames: employees, mentorNames: mentors } = useOrgUsers();
  const { years } = useGoalYears();

  // `goals` is the server-filtered AND server-sorted universe. The
  // grouping function preserves ordering: it iterates `goals` in the
  // received order, so the resulting groups follow the server-ORDER-BY
  // (by parent's owner_name / function_name / designation_name when
  // sort_by is set, alphabetical default otherwise). No client-side
  // sort here.
  const sortedGroups = buildAllGoalsGroups(goals);

  // Helpers that adapt the dropdown/combobox UI sentinels ("all" / "")
  // to the AllGoalsFilters shape (undefined = no narrowing on this dim).
  // `fy_year` is special because the dropdown stores values as numeric
  // strings; we coerce to number for the wire param.
  const setFilter = <K extends keyof AllGoalsFilters>(
    key: K,
    value: AllGoalsFilters[K] | "" | "all",
  ) => {
    onFiltersChange({
      ...filters,
      [key]: value === "" || value === "all" ? undefined : value,
    });
  };
  const setYearFilter = (value: string) => {
    onFiltersChange({
      ...filters,
      fy_year: value === "" || value === "all" ? undefined : Number(value),
    });
  };

  // Variable-height virtualizer for the per-user groups. Each "row" in
  // the virtualizer is a user GROUP; when expanded, the group's outer
  // div contains the user-level row plus the sub-header + per-goal rows
  // inline. measureElement records the total height — collapsed groups
  // are ~48px, expanded groups can be 200-700px depending on goal
  // count. Same pattern as PR #16/#17, applied to the most variable
  // expansion shape so far.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual's useVirtualizer returns non-memoisable functions; React Compiler logs a benign skip here.
  const rowVirtualizer = useVirtualizer({
    count: sortedGroups.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => ALL_GOALS_ESTIMATE_ROW_PX,
    overscan: ALL_GOALS_OVERSCAN,
    // Key the measurement cache by stable group identity (same key we
    // use for the row's React `key`). Without this, the cache uses the
    // array index — so when the user changes a filter or sort, the
    // index → group mapping shifts but a previously-expanded group's
    // cached "tall" height ends up applied to a different group at the
    // same index, producing a visible gap or overlap. With getItemKey
    // the cached height follows the group across reorderings.
    getItemKey: (index) => {
      const g = sortedGroups[index];
      return `${g.user_id}_${g.fy_year ?? "null"}`;
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-text-muted">
        Loading goals…
      </div>
    );
  }
  // Empty-state branching (post-PR-#44): empty `goals` can now mean
  // either "org has no goals" or "filter set returned nothing". Distinct
  // remediation copy for each case.
  //
  // IMPORTANT: the empty state is rendered INSIDE the main layout (as a
  // sibling of the filter toolbar below), NOT as an early-return — so
  // when a filter returns zero rows the user can still see the filter
  // toolbar and clear / change their selection. Returning here would
  // erase the toolbar and trap the user in the empty state.
  const hasActiveFilters = Object.values(filters).some(
    (v) => v !== undefined && v !== "",
  );
  const isEmpty = goals.length === 0;
  const emptyStateNode = (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
      <Target className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
      <p className="font-display text-base font-medium text-text-main">
        {hasActiveFilters
          ? "No goals match these filters"
          : "No annual goals recorded"}
      </p>
      <p className="mt-1 text-sm text-text-muted">
        {hasActiveFilters
          ? "Try clearing one or more filters above to broaden the result."
          : "Goals will appear here once employees submit them and mentors approve."}
      </p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
       <div className="flex items-center gap-4 flex-wrap flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <label
            htmlFor="all-goals-employee"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Employee
          </label>
          <StringCombobox
            id="all-goals-employee"
            options={employees}
            value={filters.employee ?? ""}
            onChange={(v) => setFilter("employee", v)}
            placeholder="Type a name…"
          />
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="all-goals-function"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Function
          </label>
          <StringCombobox
            id="all-goals-function"
            options={functions}
            value={filters.function ?? ""}
            onChange={(v) => setFilter("function", v)}
            placeholder="All Functions"
          />
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="all-goals-designation"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Designation
          </label>
          <StringCombobox
            id="all-goals-designation"
            options={designations}
            value={filters.designation ?? ""}
            onChange={(v) => setFilter("designation", v)}
            placeholder="All Designations"
          />
        </div>
        {/* Toolbar follows the project-wide
            Identity → Category → Relation → Time → State order so
            the filter widgets sit in the same logical slots across
            all admin-accessible pages. Mentor (Relation) precedes
            Year (Time) and Status (State). */}
        <div className="flex items-center gap-2">
          <label
            htmlFor="all-goals-mentor"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Mentor
          </label>
          <select
            id="all-goals-mentor"
            value={filters.mentor ?? "all"}
            onChange={(e) => setFilter("mentor", e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer min-w-[140px]"
          >
            <option value="all">All Mentors</option>
            {mentors.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="all-goals-year"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Year
          </label>
          <select
            id="all-goals-year"
            value={filters.fy_year === undefined ? "all" : String(filters.fy_year)}
            onChange={(e) => setYearFilter(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer min-w-[120px]"
          >
            <option value="all">All Years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {formatFyYearSpan(y)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="all-goals-status"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Status
          </label>
          <select
            id="all-goals-status"
            value={filters.approval_status ?? "all"}
            onChange={(e) => setFilter("approval_status", e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer min-w-[200px]"
          >
            {/* Draft is intentionally omitted — the All Goals view hides
                draft mentee work. "Approved" is the broad bucket that
                expands server-side to APPROVED + every h1/h2 reviewed
                state (see backend POST_APPROVAL_STATES). The four H1/H2
                options below let HR drill into a specific review stage;
                they overlap with "Approved" by design — "Approved" is
                the umbrella, the H1/H2 entries are the slices. Q1..Q4
                states exist in the enum for legacy back-compat (goal
                reviews are half-yearly only now) and are not exposed
                here. */}
            <option value="all">All Statuses</option>
            <option value="pending_approval">Pending Approval</option>
            <option value="changes_requested">Changes Requested</option>
            <option value="approved">Approved (any stage)</option>
            <option value="h1_self_reviewed">H1 Self Reviewed</option>
            <option value="h1_mentor_reviewed">H1 Mentor Reviewed</option>
            <option value="h2_self_reviewed">H2 Self Reviewed</option>
            <option value="h2_mentor_reviewed">H2 Mentor Reviewed</option>
          </select>
        </div>
        <span className="text-xs text-text-muted">
          {/* Both halves now reflect the SERVER-FILTERED universe.
              `totalEmployees` is the server's count of qualifying
              parents (the pagination unit); `goals.length` is the
              flattened goal-row count of what's been loaded so far.
              The "Loaded N of T employees" detail beside Load More
              below tracks paging progress. */}
          {totalEmployees}{" "}
          {totalEmployees === 1 ? "employee" : "employees"} · {goals.length}{" "}
          {goals.length === 1 ? "goal" : "goals"}
        </span>
        <ClearFiltersButton
          active={hasActiveFilters}
          onClear={() => onFiltersChange({})}
        />
       </div>
       <div className="shrink-0">
         <ExportExcelButton kind="goals" />
       </div>
      </div>

      {/* Virtualized "All Goals" view (variable-height; see doc #18).
          Outer div handles x-scroll on narrow viewports. Inner scroll
          container handles y-virtualization. The expansion shape here
          is denser than PR #16/#17 — sub-header + N per-goal rows
          inside one outer measured div. measureElement records the
          total height including the variable expansion.

          When the loaded goals list is empty (either the org has none
          yet or the current filters produced zero matches), the empty
          state replaces the table body but the toolbar above stays
          visible so the user can change / clear their filters. */}
      {isEmpty ? emptyStateNode : (
      <div className="overflow-x-auto rounded-lg border border-border">
        <div
          role="table"
          aria-label="All annual goals (HR view)"
          aria-rowcount={sortedGroups.length}
          className="text-[13px]"
          style={{ minWidth: ALL_GOALS_TABLE_MIN_WIDTH_PX }}
        >
          {/* Header — non-virtualized */}
          <div role="rowgroup" className="bg-slate-50/80 border-b border-border">
            <div
              role="row"
              className="grid items-center"
              style={{ gridTemplateColumns: ALL_GOALS_GRID_TEMPLATE_COLUMNS }}
            >
              <div role="columnheader" className="text-left px-5 py-2.5">
                <SortableHeader label="Employee" columnKey="owner_name" sort={sort} onSort={onSortChange} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Function" columnKey="function_name" sort={sort} onSort={onSortChange} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Designation" columnKey="designation_name" sort={sort} onSort={onSortChange} />
              </div>
              {/* Year + Mentor headers — not sortable in this PR. Doc 31
                  Part 2 explains the deferral (they're derived from the
                  group's latest goal, which needs a correlated MAX
                  subquery to sort server-side). Rendered as plain
                  text to match the visual style of the sortable
                  headers above but without the chevron affordance. */}
              <div role="columnheader" className="text-left px-4 py-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  Year
                </span>
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  Mentor
                </span>
              </div>
            </div>
          </div>

          {/* Body — virtualized per-user groups */}
          <div
            ref={scrollContainerRef}
            role="rowgroup"
            style={{ height: ALL_GOALS_SCROLL_HEIGHT_PX }}
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
                const group = sortedGroups[virtualRow.index];
                const groupKey = `${group.user_id}_${group.fy_year ?? "null"}`;
                const isExpanded = expandedGroupKey === groupKey;
                return (
                  <div
                    role="row"
                    aria-rowindex={virtualRow.index + 1}
                    aria-expanded={isExpanded}
                    key={groupKey}
                    // data-index REQUIRED so the ResizeObserver maps
                    // each measurement back to the right group index.
                    // See doc #16 for the full mechanics.
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className={`transition-colors border-b border-border/50 ${
                      isExpanded ? "bg-brand/5" : "hover:bg-slate-50/60"
                    }`}
                  >
                    {/* User-level row (always visible). Click anywhere
                        on this strip toggles expansion. */}
                    <div
                      className="grid items-center cursor-pointer"
                      style={{ gridTemplateColumns: ALL_GOALS_GRID_TEMPLATE_COLUMNS }}
                      onClick={() =>
                        setExpandedGroupKey(isExpanded ? null : groupKey)
                      }
                    >
                      <div role="cell" className="px-5 py-3 font-medium text-text-main">
                        <div className="flex items-center gap-2 min-w-0">
                          <ChevronDown
                            className={`h-4 w-4 text-text-muted shrink-0 transition-transform duration-200 ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                            aria-hidden="true"
                          />
                          <span className="truncate">{group.owner_name}</span>
                        </div>
                      </div>
                      <div role="cell" className="px-4 py-3 text-text-muted truncate">
                        {group.function_name ?? "—"}
                      </div>
                      <div role="cell" className="px-4 py-3 text-text-muted truncate">
                        {group.designation_name ?? "—"}
                      </div>
                      <div role="cell" className="px-4 py-3">
                        {group.fy_year ? (
                          <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                            {formatFyYearSpan(group.fy_year)}
                          </span>
                        ) : (
                          <span className="text-[12px] text-text-muted">—</span>
                        )}
                      </div>
                      <div role="cell" className="px-4 py-3 text-text-muted truncate">
                        {group.manager_name ?? "—"}
                      </div>
                    </div>

                    {/* Expansion: sub-header + per-goal rows. Same
                        5-column grid; the Description cell uses
                        `gridColumn: span 2` to occupy the visual width
                        of Function+Designation columns — CSS Grid
                        equivalent of the legacy <td colSpan={2}>. */}
                    {isExpanded && (
                      <>
                        {/* Sub-header */}
                        <div
                          className="bg-brand/10 border-t border-brand/20 text-[11px] font-bold uppercase tracking-wider text-text-muted grid items-center"
                          style={{
                            gridTemplateColumns: ALL_GOALS_GRID_TEMPLATE_COLUMNS,
                          }}
                        >
                          <div className="text-left px-5 py-2 pl-10 font-bold border-l-2 border-brand/40">
                            Goal
                          </div>
                          <div
                            className="text-left px-4 py-2 font-bold"
                            style={{ gridColumn: "span 2" }}
                          >
                            Description
                          </div>
                          <div className="text-left px-4 py-2 font-bold">Status</div>
                          <div className="text-left px-4 py-2 font-bold">Action</div>
                        </div>

                        {/* Per-goal sub-rows */}
                        {group.goals.map((g, gi) => {
                          const hasReview =
                            g.self_reviews.some((r) => !r.is_draft) ||
                            g.mentor_reviews.some((r) => !r.is_draft);
                          return (
                            <div
                              key={g.id}
                              className="bg-brand/5 hover:bg-brand/10 transition-colors border-t border-brand/10 grid"
                              style={{
                                gridTemplateColumns: ALL_GOALS_GRID_TEMPLATE_COLUMNS,
                              }}
                            >
                              <div className="px-5 py-2.5 pl-10 border-l-2 border-brand/40 self-start">
                                <span className="font-medium text-text-main">
                                  <span className="mr-2 font-mono text-[12px] text-text-muted tabular-nums">
                                    {gi + 1}.
                                  </span>
                                  {g.title}
                                </span>
                              </div>
                              <div
                                className="px-4 py-2.5 text-[12.5px] text-text-muted self-start"
                                style={{ gridColumn: "span 2" }}
                              >
                                {g.description ? (
                                  <span className="whitespace-normal break-words">
                                    {g.description}
                                  </span>
                                ) : (
                                  <span>—</span>
                                )}
                              </div>
                              <div className="px-4 py-2.5 self-start">
                                <ApprovalStatusBadge status={g.approval_status} />
                              </div>
                              <div className="px-4 py-2.5 self-start">
                                {hasReview ? (
                                  <button
                                    type="button"
                                    onClick={() => setViewGoal(g)}
                                    className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-2.5 py-1 text-[12px] font-medium text-text-muted hover:bg-slate-50 hover:text-text-main transition-colors"
                                  >
                                    <Eye className="h-3 w-3" /> View
                                  </button>
                                ) : (
                                  <span className="text-[11px] italic text-text-muted">
                                    —
                                  </span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
      )}

      {/* Load More — sits BELOW the virtualized scroll card so HR can
          see the "more available" affordance without scrolling to the
          bottom of the 600px window. Hidden when the server reports
          no more pages (hasNextPage === false). The counter alongside
          names the pagination unit (employees) — not the filtered
          group count above. Distinct-user_ids over the unfiltered
          `goals` array is the right "how many parents has the server
          shipped so far" number; filters don't change it. */}
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
            Loaded {new Set(goals.map((g) => g.user_id)).size} of {totalEmployees} employees
          </span>
        </div>
      )}

      {viewGoal && (
        <GoalReviewDetailsModal
          goal={viewGoal}
          onClose={() => setViewGoal(null)}
        />
      )}
    </div>
  );
}
