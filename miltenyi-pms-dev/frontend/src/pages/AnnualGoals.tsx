import { useState, useEffect, useCallback, Fragment } from "react";
import {
  Plus, Target, Lock, Search,
  LayoutGrid, Table2, ChevronDown, BookOpen,
  Pencil, SendHorizonal, Link, MessageSquare,
  UserCircle, Info, Eye,
} from "lucide-react";
import {
  goalService,
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
import { ExportExcelButton } from "@/components/admin/ExportExcelButton";
import { SortableHeader } from "@/components/SortableHeader";
import { compareValues, type SortKind, type SortState, type SortValue } from "@/utils/sort";
import { formatFyYearSpan } from "@/utils/fy";
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
  /** Latest goal's FY (highest fy_year) — drives the Year column. */
  latest_fy_year: number | null;
  /** Mentor on the latest goal — drives the Mentor column. */
  latest_manager_name: string | null;
  goals: TeamGoal[];
}

type AllGoalsSortKey =
  | "owner_name"
  | "function_name"
  | "designation_name"
  | "latest_fy_year"
  | "latest_manager_name";

const ALL_GOALS_SORT_CONFIG: Record<
  AllGoalsSortKey,
  { kind: SortKind; get: (g: AllGoalsEmployeeGroup) => SortValue }
> = {
  owner_name:          { kind: "alpha",   get: (g) => g.owner_name },
  function_name:       { kind: "alpha",   get: (g) => g.function_name },
  designation_name:    { kind: "alpha",   get: (g) => g.designation_name },
  latest_fy_year:      { kind: "numeric", get: (g) => g.latest_fy_year },
  latest_manager_name: { kind: "alpha",   get: (g) => g.latest_manager_name },
};

function buildAllGoalsGroups(goals: readonly TeamGoal[]): AllGoalsEmployeeGroup[] {
  const map = new Map<number, AllGoalsEmployeeGroup>();
  for (const g of goals) {
    const existing = map.get(g.user_id);
    if (existing) {
      existing.goals.push(g);
    } else {
      map.set(g.user_id, {
        user_id: g.user_id,
        owner_name: g.owner_name,
        function_name: g.owner_function_name,
        designation_name: g.owner_designation_name,
        latest_fy_year: null,
        latest_manager_name: null,
        goals: [g],
      });
    }
  }
  // Inner goals: newest FY first so the drop-down reads top-down. After
  // sorting, the latest goal is goals[0] — its fy_year and mentor populate
  // the per-employee Year and Mentor columns.
  for (const group of map.values()) {
    group.goals.sort((a, b) => (b.fy_year ?? 0) - (a.fy_year ?? 0));
    const latest = group.goals[0];
    group.latest_fy_year = latest?.fy_year ?? null;
    group.latest_manager_name = latest?.manager_name ?? null;
  }
  return Array.from(map.values());
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
  // Staff → "My Goals" tab, Mentor → "Team Goals" tab,
  // HR_MyOrg → view-only "All Goals" tab.
  const isStaff = user?.role === "Staff";
  const isMentor = user?.role === "Mentor";
  const isHRMyOrg = user?.role === "HR_MyOrg";
  const annualGoalsEditEnabled = settings?.annual_goals_edit_enabled ?? false;

  // Extract bare FY label ("H1 FY26" → "FY26") for the page header.
  const fyLabel = settings?.active_cycle_name
    ? settings.active_cycle_name.split(" ").find((t) => t.startsWith("FY")) ??
      settings.active_cycle_name
    : null;

  const [activeTab, setActiveTab] = useState<ActiveTab>("my");
  const [approvalFilter, setApprovalFilter] = useState<ApprovalFilter>("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<SortState<MyGoalsSortKey> | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [expandedGoalId, setExpandedGoalId] = useState<number | null>(null);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  // Self-review modal state
  const [selfReviewGoal, setSelfReviewGoal] = useState<Goal | null>(null);
  const [selfReviewCycle, setSelfReviewCycle] =
    useState<SelfReviewCycleHalf | null>(null);
  const [isSelfReviewSaving, setIsSelfReviewSaving] = useState(false);
  const [isSelfReviewDraftSaving, setIsSelfReviewDraftSaving] = useState(false);
  const [selfReviewError, setSelfReviewError] = useState("");

  // Role expectations for the My Goals tab — collapsed by default.
  const [roleExpectation, setRoleExpectation] = useState<UserRoleExpectation | null>(null);
  const [roleExpectationsOpen, setRoleExpectationsOpen] = useState(false);
  useEffect(() => {
    let cancelled = false;
    profileService
      .getMyExpectations()
      .then((exp) => {
        if (!cancelled) setRoleExpectation(exp);
      })
      .catch(() => {
        // Non-fatal — section just won't render.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Auto-switch to the role's primary tab once auth resolves.
  useEffect(() => {
    if (isMentor) setActiveTab("team");
    else if (isHRMyOrg) setActiveTab("all");
    else setActiveTab("my");
  }, [isMentor, isHRMyOrg]);

  const [allGoals, setAllGoals] = useState<TeamGoal[]>([]);

  const loadGoals = useCallback(async () => {
    setIsLoading(true);
    try {
      if (isHRMyOrg) {
        setAllGoals(await goalService.getAllGoals());
      } else if (isStaff) {
        setGoals(await goalService.getMyGoals("annual"));
      } else {
        // Mentor: TeamGoalsTab loads its own data
      }
    } catch {
      /* stays empty */
    } finally {
      setIsLoading(false);
    }
  }, [isHRMyOrg, isStaff]);

  useEffect(() => {
    void loadGoals();
  }, [loadGoals]);

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

  // Create or update
  const handleSave = async (payload: GoalCreatePayload | GoalUpdatePayload) => {
    setIsSaving(true);
    setModalError("");
    try {
      if (editingGoal) {
        const updated = await goalService.updateGoal(
          editingGoal.id,
          payload as GoalUpdatePayload,
        );
        setGoals((prev) =>
          prev.map((g) => (g.id === updated.id ? updated : g)),
        );
        closeModal();
        toast.success("Goal updated.");
      } else {
        const created = await goalService.createGoal({
          ...(payload as GoalCreatePayload),
          goal_type: "annual",
        });
        setGoals((prev) => [created, ...prev]);
        closeModal();
        toast.success("Goal created.");
      }
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  // Submit draft / changes_requested goal for mentor review
  const handleSubmit = async (goal: Goal) => {
    const ok = await confirm({
      title: "Submit goal for approval?",
      message: `Send "${goal.title}" to your mentor for review. Once submitted you can't edit this goal until your mentor approves it or requests changes.`,
      variant: "warning",
      confirmText: "Submit",
    });
    if (!ok) return;
    try {
      const updated = await goalService.submitGoal(goal.id);
      setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
      toast.success("Goal submitted for review.");
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
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
    setIsSelfReviewSaving(true);
    setSelfReviewError("");
    try {
      const updated = await goalService.submitSelfReview(
        selfReviewGoal.id,
        cycleHalf,
        payload,
      );
      setGoals((prev) =>
        prev.map((g) => (g.id === updated.id ? updated : g)),
      );
      closeSelfReview();
      toast.success("Self-review submitted.");
    } catch (err) {
      setSelfReviewError(getErrorMessage(err));
    } finally {
      setIsSelfReviewSaving(false);
    }
  };

  const handleSelfReviewSaveDraft = async (
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalSelfReviewPayload,
  ) => {
    if (!selfReviewGoal) return;
    setIsSelfReviewDraftSaving(true);
    setSelfReviewError("");
    try {
      const updated = await goalService.saveSelfReviewDraft(
        selfReviewGoal.id,
        cycleHalf,
        payload,
      );
      setGoals((prev) =>
        prev.map((g) => (g.id === updated.id ? updated : g)),
      );
      // Keep the modal open so the mentee sees the "(Draft)" title and can
      // continue editing — toast confirms the save.
      toast.success("Draft saved.");
    } catch (err) {
      setSelfReviewError(getErrorMessage(err));
    } finally {
      setIsSelfReviewDraftSaving(false);
    }
  };

  // Criterion toggle — client-side progress recompute for instant feedback
  const handleCriterionUpdate = useCallback(
    (goalId: number, updated: Criterion) => {
      setGoals((prev) =>
        prev.map((g) => {
          if (g.id !== goalId) return g;
          const newCriteria = g.criteria.map((c) =>
            c.id === updated.id ? updated : c,
          );
          return {
            ...g,
            criteria: newCriteria,
            progress_percent: recomputeProgress(newCriteria),
          };
        }),
      );
    },
    [],
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
  // Staff/Mentor keep the existing "Team Goals" label.
  // HR_MyOrg gets "All Goals" — distinct view-only org-wide scope.
  const headerTitle = isHRMyOrg ? "All Goals" : "Team Goals";
  const headerSubtitle = isHRMyOrg
    ? "View-only access to every annual goal across the org."
    : isMentor
      ? "Review and evaluate your team's annual goals."
      : "Define and track your annual objectives for mentor approval.";

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
        {isStaff &&
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
          {isStaff && (
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
          {isStaff && activeTab === "my" && (
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
                  <table className="w-full text-[13px]">
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
            <AllGoalsTab goals={allGoals} isLoading={isLoading} />
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
          isSaving={isSaving}
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
          isSaving={isSelfReviewSaving}
          isDraftSaving={isSelfReviewDraftSaving}
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

function AllGoalsTab({
  goals,
  isLoading,
}: {
  readonly goals: TeamGoal[];
  readonly isLoading: boolean;
}) {
  const [statusFilter, setStatusFilter] = useState<ApprovalFilter>("all");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [functionFilter, setFunctionFilter] = useState<string>("all");
  const [designationFilter, setDesignationFilter] = useState<string>("all");
  // Employee filter — typeable combobox styled like the PM picker.
  // Empty string means "no employee filter applied".
  const [employeeFilter, setEmployeeFilter] = useState<string>("");
  const [sort, setSort] = useState<SortState<AllGoalsSortKey> | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<number | null>(null);
  // The goal whose self/mentor reviews are currently being read in the
  // details modal. null = modal closed.
  const [viewGoal, setViewGoal] = useState<TeamGoal | null>(null);

  const years = Array.from(
    new Set(goals.map((g) => g.fy_year).filter((y): y is number => y !== null)),
  ).sort((a, b) => b - a);

  // Derived from the loaded goals so the suggestions are always real.
  const employees = Array.from(
    new Set(goals.map((g) => g.owner_name).filter((n): n is string => !!n)),
  ).sort();
  const functions = Array.from(
    new Set(
      goals.map((g) => g.owner_function_name).filter((f): f is string => !!f),
    ),
  ).sort();
  const designations = Array.from(
    new Set(
      goals
        .map((g) => g.owner_designation_name)
        .filter((d): d is string => !!d),
    ),
  ).sort();

  const filtered = goals
    .filter((g) => statusFilter === "all" || g.approval_status === statusFilter)
    .filter((g) => yearFilter === "all" || g.fy_year === Number(yearFilter))
    .filter(
      (g) => functionFilter === "all" || g.owner_function_name === functionFilter,
    )
    .filter(
      (g) =>
        designationFilter === "all" ||
        g.owner_designation_name === designationFilter,
    )
    .filter((g) => !employeeFilter || g.owner_name === employeeFilter);

  const groups = buildAllGoalsGroups(filtered);

  const sortedGroups = sort
    ? groups.slice().sort((a, b) => {
        const { kind, get } = ALL_GOALS_SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : groups
        .slice()
        .sort((a, b) =>
          a.owner_name.localeCompare(b.owner_name, undefined, {
            sensitivity: "base",
          }),
        );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-text-muted">
        Loading goals…
      </div>
    );
  }
  if (goals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
        <Target className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
        <p className="font-display text-base font-medium text-text-main">
          No annual goals recorded
        </p>
        <p className="mt-1 text-sm text-text-muted">
          Goals will appear here once Staff submit them and mentors approve.
        </p>
      </div>
    );
  }

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
            value={employeeFilter}
            onChange={setEmployeeFilter}
            placeholder="Type a name…"
          />
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
            value={yearFilter}
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
            htmlFor="all-goals-function"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Function
          </label>
          <select
            id="all-goals-function"
            value={functionFilter}
            onChange={(e) => setFunctionFilter(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer min-w-[140px]"
          >
            <option value="all">All Functions</option>
            {functions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="all-goals-designation"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Designation
          </label>
          <select
            id="all-goals-designation"
            value={designationFilter}
            onChange={(e) => setDesignationFilter(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer min-w-[140px]"
          >
            <option value="all">All Designations</option>
            {designations.map((d) => (
              <option key={d} value={d}>
                {d}
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
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ApprovalFilter)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer min-w-[160px]"
          >
            {buildFilterConfig().map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <span className="text-xs text-text-muted">
          {sortedGroups.length} {sortedGroups.length === 1 ? "employee" : "employees"} ·{" "}
          {filtered.length} of {goals.length} goals
        </span>
       </div>
       <div className="shrink-0">
         <ExportExcelButton kind="goals" />
       </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-slate-50/80 border-b border-border">
              <th className="text-left px-5 py-2.5">
                <SortableHeader
                  label="Employee"
                  columnKey="owner_name"
                  sort={sort}
                  onSort={setSort}
                />
              </th>
              <th className="text-left px-4 py-2.5">
                <SortableHeader
                  label="Function"
                  columnKey="function_name"
                  sort={sort}
                  onSort={setSort}
                />
              </th>
              <th className="text-left px-4 py-2.5">
                <SortableHeader
                  label="Designation"
                  columnKey="designation_name"
                  sort={sort}
                  onSort={setSort}
                />
              </th>
              <th className="text-left px-4 py-2.5">
                <SortableHeader
                  label="Year"
                  columnKey="latest_fy_year"
                  sort={sort}
                  onSort={setSort}
                />
              </th>
              <th className="text-left px-4 py-2.5">
                <SortableHeader
                  label="Mentor"
                  columnKey="latest_manager_name"
                  sort={sort}
                  onSort={setSort}
                />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {sortedGroups.map((group) => {
              const isExpanded = expandedUserId === group.user_id;
              return (
                <Fragment key={group.user_id}>
                  <tr
                    className={`transition-colors cursor-pointer ${
                      isExpanded ? "bg-brand/5" : "hover:bg-slate-50/60"
                    }`}
                    onClick={() =>
                      setExpandedUserId(isExpanded ? null : group.user_id)
                    }
                  >
                    <td className="px-5 py-3 font-medium text-text-main">
                      <div className="flex items-center gap-2 min-w-0">
                        <ChevronDown
                          className={`h-4 w-4 text-text-muted shrink-0 transition-transform duration-200 ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                          aria-hidden="true"
                        />
                        <span className="truncate">{group.owner_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {group.function_name ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {group.designation_name ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      {group.latest_fy_year ? (
                        <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                          {formatFyYearSpan(group.latest_fy_year)}
                        </span>
                      ) : (
                        <span className="text-[12px] text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {group.latest_manager_name ?? "—"}
                    </td>
                  </tr>
                  {isExpanded && (
                    <>
                      {/* Sub-header — reuses the parent table's column
                          widths so Goal / Description / Status / Action
                          line up with Employee / Function+Designation /
                          Year / Mentor visually. Tinted with the brand
                          colour so the expanded block reads as a child
                          of the employee row rather than blending into
                          the table chrome. */}
                      <tr className="bg-brand/10 border-t border-brand/20 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                        <th className="text-left px-5 py-2 pl-10 font-bold border-l-2 border-brand/40">Goal</th>
                        <th colSpan={2} className="text-left px-4 py-2 font-bold">Description</th>
                        <th className="text-left px-4 py-2 font-bold">Status</th>
                        <th className="text-left px-4 py-2 font-bold">Action</th>
                      </tr>
                      {group.goals.map((g, gi) => {
                        const hasReview =
                          g.self_reviews.some((r) => !r.is_draft) ||
                          g.mentor_reviews.some((r) => !r.is_draft);
                        return (
                          <tr key={g.id} className="bg-brand/5 hover:bg-brand/10 transition-colors border-t border-brand/10">
                            <td className="px-5 py-2.5 pl-10 align-top border-l-2 border-brand/40">
                              <span className="font-medium text-text-main">
                                <span className="mr-2 font-mono text-[12px] text-text-muted tabular-nums">
                                  {gi + 1}.
                                </span>
                                {g.title}
                              </span>
                            </td>
                            <td colSpan={2} className="px-4 py-2.5 text-[12.5px] text-text-muted align-top">
                              {g.description ? (
                                <span className="whitespace-normal break-words">
                                  {g.description}
                                </span>
                              ) : (
                                <span>—</span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 align-top">
                              <ApprovalStatusBadge status={g.approval_status} />
                            </td>
                            <td className="px-4 py-2.5 align-top">
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
                            </td>
                          </tr>
                        );
                      })}
                    </>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {viewGoal && (
        <GoalReviewDetailsModal
          goal={viewGoal}
          onClose={() => setViewGoal(null)}
        />
      )}
    </div>
  );
}
