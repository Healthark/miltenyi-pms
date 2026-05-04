import { useState, useEffect, useCallback, Fragment } from "react";
import {
  Plus, Target, Lock, Search,
  LayoutGrid, Table2, ChevronDown, ChevronUp, BookOpen,
  Pencil, SendHorizonal, Link, MessageSquare,
  UserCircle,
} from "lucide-react";
import {
  goalService,
  type Goal,
  type GoalCreatePayload,
  type GoalUpdatePayload,
  type GoalSelfReviewPayload,
  type SelfReviewCycleHalf,
  type Criterion,
  type ApprovalStatus,
} from "../services/goal.service";
import { useAuth } from "../hooks/useAuth";
import { useSystemSettings } from "../hooks/useSystemSettings";
import { useToast } from "../hooks/useToast";
import { useSnackbar } from "../hooks/useSnackbar";
import { useConfirm } from "../hooks/useConfirm";
import { getErrorMessage } from "../utils/errors";
import { AnnualGoalCard } from "../components/goals/AnnualGoalCard";
import { GoalFormModal } from "../components/goals/GoalFormModal";
import { GoalSelfReviewModal } from "../components/goals/GoalSelfReviewModal";
import { SelfReviewCycleMenu } from "../components/goals/SelfReviewCycleMenu";
import { TeamGoalsTab } from "../components/goals/TeamGoalsTab";
import { ApprovalStatusBadge } from "../components/goals/ApprovalStatusBadge";
import { CriteriaChecklist } from "../components/goals/CriteriaChecklist";
import { SortableHeader } from "../components/SortableHeader";
import { compareValues, type SortKind, type SortState } from "../utils/sort";
import { formatFyYearSpan } from "../utils/fy";
import {
  profileService,
  type UserRoleExpectation,
} from "../services/profile.service";
import { isPostApproved } from "../utils/goalStatus";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

type ApprovalFilter = "all" | ApprovalStatus;

/** Build the status filter options. Half-yearly orgs see H1/H2 self/mentor
 *  options; quarterly orgs see Q1..Q4 self/mentor options instead. */
function buildFilterConfig(
  cycleType: string | null,
): { value: ApprovalFilter; label: string }[] {
  const base: { value: ApprovalFilter; label: string }[] = [
    { value: "all", label: "All" },
    { value: "draft", label: "Draft" },
    { value: "pending_approval", label: "Pending Approval" },
    { value: "changes_requested", label: "Changes Requested" },
    { value: "approved", label: "Approved" },
  ];
  if (cycleType === "quarterly") {
    return [
      ...base,
      { value: "q1_self_reviewed",   label: "Q1 Self-Reviewed" },
      { value: "q1_mentor_reviewed", label: "Q1 Mentor-Reviewed" },
      { value: "q2_self_reviewed",   label: "Q2 Self-Reviewed" },
      { value: "q2_mentor_reviewed", label: "Q2 Mentor-Reviewed" },
      { value: "q3_self_reviewed",   label: "Q3 Self-Reviewed" },
      { value: "q3_mentor_reviewed", label: "Q3 Mentor-Reviewed" },
      { value: "q4_self_reviewed",   label: "Q4 Self-Reviewed" },
      { value: "q4_mentor_reviewed", label: "Q4 Mentor-Reviewed" },
    ];
  }
  return [
    ...base,
    { value: "h1_self_reviewed",   label: "H1 Self-Reviewed" },
    { value: "h1_mentor_reviewed", label: "H1 Mentor-Reviewed" },
    { value: "h2_self_reviewed",   label: "H2 Self-Reviewed" },
    { value: "h2_mentor_reviewed", label: "H2 Mentor-Reviewed" },
  ];
}

type ActiveTab = "my" | "team";
type ViewMode = "grid" | "table";

// My Goals table sort config — Goal/Mentor/Status are alpha, Year is numeric.
// Actions column is not sortable (has no backing data).
type MyGoalsSortKey = "title" | "manager_name" | "fy_year" | "approval_status";

const MY_GOALS_SORT_CONFIG: Record<
  MyGoalsSortKey,
  { kind: SortKind; get: (g: Goal) => unknown }
> = {
  title:           { kind: "alpha",   get: (g) => g.title },
  manager_name:    { kind: "alpha",   get: (g) => g.manager_name },
  fy_year:         { kind: "numeric", get: (g) => g.fy_year },
  approval_status: { kind: "alpha",   get: (g) => g.approval_status },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function recomputeProgress(criteria: Criterion[]): number {
  if (criteria.length === 0) return 0;
  const completed = criteria.filter((c) => c.is_completed).length;
  return Math.round((completed / criteria.length) * 100);
}

const ROLE_EXP_FIELDS: { expKey: keyof UserRoleExpectation; label: string }[] = [
  { expKey: "exp_firm_growth",       label: "Firm Growth" },
  { expKey: "exp_competency_skills", label: "Competency & Skills" },
];

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

  // A user is treated as a "mentor" purely based on whether other users
  // report to them via mentor_id — role is not the authority here.
  // The backend populates has_mentees on the login response.
  const isMentor = user?.has_mentees ?? false;
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

  const loadGoals = useCallback(async () => {
    setIsLoading(true);
    try {
      setGoals(await goalService.getMyGoals("annual"));
    } catch {
      /* stays empty */
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-main">
            Annual Goals
            {fyLabel && (
              <span className="ml-2 text-sm font-normal text-text-muted">
                · {fyLabel}
              </span>
            )}
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">
            Define and track your annual objectives for mentor approval.
          </p>
        </div>

        {activeTab === "my" &&
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
          <button
            type="button"
            className={tabCls("my")}
            onClick={() => setActiveTab("my")}
          >
            My Goals
          </button>
          {isMentor && (
            <button
              type="button"
              className={tabCls("team")}
              onClick={() => setActiveTab("team")}
            >
              Team Goals
            </button>
          )}
        </div>

        <div className="p-5">
          {/* ── My Goals tab ── */}
          {activeTab === "my" && (
            <div className="space-y-4">
              {/* Role expectations — single collapsible container, all competencies */}
              {roleExpectation && (
                <div className="rounded-lg border border-border overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setRoleExpectationsOpen((v) => !v)}
                    className="flex w-full items-center justify-between px-4 py-2.5 bg-blue-50/50 hover:bg-blue-50/80 transition-colors"
                  >
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-text-main">
                      <BookOpen className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                      Your Role Expectations
                    </span>
                    {roleExpectationsOpen
                      ? <ChevronUp className="h-3.5 w-3.5 text-text-muted shrink-0" />
                      : <ChevronDown className="h-3.5 w-3.5 text-text-muted shrink-0" />}
                  </button>
                  {roleExpectationsOpen && (
                    <div className="px-4 py-3 space-y-3 bg-blue-50/20 border-t border-border">
                      {ROLE_EXP_FIELDS.map(({ expKey, label }) => {
                        const text = roleExpectation[expKey] as string | null | undefined;
                        if (!text) return null;
                        return (
                          <div key={expKey}>
                            <p className="text-[11px] font-semibold text-text-main mb-0.5">{label}</p>
                            <p className="text-xs text-text-muted whitespace-pre-wrap leading-relaxed">
                              {text.replace(/ \| /g, "\n• ")}
                            </p>
                          </div>
                        );
                      })}
                      <p className="text-[10px] text-text-muted pt-1 border-t border-border">
                        {roleExpectation.department_name} · {roleExpectation.designation_name}
                      </p>
                    </div>
                  )}
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
                        {buildFilterConfig(settings?.cycle_type ?? null).map((f) => (
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
          {activeTab === "team" && isMentor && <TeamGoalsTab />}
        </div>
      </div>

      {/* Create / Edit modal */}
      <GoalFormModal
        isOpen={showModal}
        onClose={closeModal}
        onSave={handleSave}
        editingGoal={editingGoal}
        isSaving={isSaving}
        error={modalError}
      />

      <GoalSelfReviewModal
        isOpen={selfReviewGoal !== null && selfReviewCycle !== null}
        goal={selfReviewGoal}
        cycleHalf={selfReviewCycle}
        onClose={closeSelfReview}
        onSubmit={handleSelfReviewSubmit}
        onSaveDraft={handleSelfReviewSaveDraft}
        isSaving={isSelfReviewSaving}
        isDraftSaving={isSelfReviewDraftSaving}
        error={selfReviewError}
      />
    </div>
  );
}
