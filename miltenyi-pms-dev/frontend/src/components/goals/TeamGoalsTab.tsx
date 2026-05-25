import { useState, useCallback, Fragment } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { patchRowsAcross } from "@/lib/optimistic";
import { createPortal } from "react-dom";
import {
  Users,
  ChevronDown,
  Check,
  CheckCheck,
  RotateCcw,
  Link as LinkIcon,
} from "lucide-react";
import {
  goalService,
  type TeamGoal,
  type ApprovalStatus,
  type SelfReviewCycleHalf,
  type GoalMentorReviewPayload,
} from "@/services/goal.service";
import { getErrorMessage } from "@/utils/errors";
import { useToast } from "@/hooks/useToast";
import { useSnackbar } from "@/hooks/useSnackbar";
import { useConfirm } from "@/hooks/useConfirm";
import { ApprovalStatusBadge } from "@/components/goals/ApprovalStatusBadge";
import { GoalMentorReviewModal } from "@/components/goals/GoalMentorReviewModal";
import { MentorReviewHalfChips } from "@/components/goals/MentorReviewHalfChips";
import { BulkApproveModal } from "@/components/goals/BulkApproveModal";
import { SortableHeader } from "@/components/SortableHeader";
import { StringCombobox } from "@/components/common/StringCombobox";
import { ClearFiltersButton } from "@/components/common/ClearFiltersButton";
import { compareValues, type SortKind, type SortState, type SortValue } from "@/utils/sort";
import { formatFyYearSpan } from "@/utils/fy";
import { halfDisplayLabel, isPostApproved } from "@/utils/goalStatus";
import { useSystemSettings } from "@/hooks/useSystemSettings";

// ---------------------------------------------------------------------------
// FeedbackModal — "Request Changes" portal (unchanged)
// ---------------------------------------------------------------------------

interface FeedbackModalProps {
  readonly goal: TeamGoal;
  readonly onSend: (feedback: string) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly error: string;
}

function FeedbackModal({
  goal,
  onSend,
  onClose,
  isSaving,
  error,
}: FeedbackModalProps) {
  const [feedback, setFeedback] = useState("");

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="feedback-modal-title"
    >
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="border-b border-border px-6 py-4">
          <h2
            id="feedback-modal-title"
            className="font-display text-base font-semibold text-text-main"
          >
            Request Changes
          </h2>
          <p className="mt-0.5 text-sm text-text-muted">
            Explain what needs to be revised for{" "}
            <strong>{goal.owner_name}</strong>.
          </p>
        </div>

        <div className="px-6 py-5 space-y-3">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </p>
          )}
          <label
            htmlFor="feedback-text"
            className="block text-xs font-medium text-text-muted mb-1"
          >
            Feedback *
          </label>
          <textarea
            id="feedback-text"
            rows={4}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="e.g. Please make the target more specific and measurable."
            className="w-full resize-none rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSend(feedback)}
            disabled={isSaving || !feedback.trim()}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50 transition-colors"
          >
            {isSaving ? "Sending…" : "Send Feedback"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------------------------------------------------------------------------
// Filter config
// ---------------------------------------------------------------------------

type StatusFilter = "all" | ApprovalStatus;

function buildStatusFilters(
  cycleType: string | null,
): { value: StatusFilter; label: string }[] {
  const base: { value: StatusFilter; label: string }[] = [
    { value: "all", label: "All" },
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

// ---------------------------------------------------------------------------
// Mentee-grouped row model (mirrors All Goals tab)
// ---------------------------------------------------------------------------

interface TeamGoalsEmployeeGroup {
  user_id: number;
  owner_name: string;
  function_name: string | null;
  designation_name: string | null;
  /** The fiscal year this row's goals belong to. One group per
   *  (user_id, fy_year) pair so a mentee with goals across multiple
   *  FYs gets multiple adjacent rows instead of one row with
   *  mixed-year contents. `null` is reserved for the edge case where
   *  a goal predates cycle-name stamping. */
  fy_year: number | null;
  goals: TeamGoal[];
}

type TeamGoalsSortKey =
  | "owner_name"
  | "function_name"
  | "designation_name"
  | "fy_year"
  | "goal_count";

const TEAM_GOALS_SORT_CONFIG: Record<
  TeamGoalsSortKey,
  { kind: SortKind; get: (g: TeamGoalsEmployeeGroup) => SortValue }
> = {
  owner_name:       { kind: "alpha",   get: (g) => g.owner_name },
  function_name:    { kind: "alpha",   get: (g) => g.function_name },
  designation_name: { kind: "alpha",   get: (g) => g.designation_name },
  fy_year:          { kind: "numeric", get: (g) => g.fy_year },
  goal_count:       { kind: "numeric", get: (g) => g.goals.length },
};

/**
 * Group goals into one row per (user_id, fy_year). A mentee with
 * goals across multiple fiscal years appears as multiple rows in the
 * mentor's queue — adjacent because they share owner_name, newest FY
 * on top. Previously this keyed by user_id alone, which collapsed
 * Bob's FY25-26 and FY26-27 goals into a single expansion under a
 * misleadingly singular Year column.
 */
function buildTeamGoalsGroups(
  goals: readonly TeamGoal[],
): TeamGoalsEmployeeGroup[] {
  const map = new Map<string, TeamGoalsEmployeeGroup>();
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
        goals: [g],
      });
    }
  }
  // Inside a single (user, FY) bucket all goals share the FY, so
  // ordering is just for the expansion list's reading flow. Newest
  // created_at first.
  for (const group of map.values()) {
    group.goals.sort(
      (a, b) =>
        new Date(b.created_at ?? 0).getTime() -
        new Date(a.created_at ?? 0).getTime(),
    );
  }
  // Final ordering: by owner_name (matches the existing primary sort
  // — actual user-driven sort runs on the array later via
  // `TEAM_GOALS_SORT_CONFIG`); within the same employee, newer FY on
  // top so the active-cycle row floats above older history.
  return Array.from(map.values()).sort((a, b) => {
    const nameCmp = a.owner_name.localeCompare(b.owner_name);
    if (nameCmp !== 0) return nameCmp;
    return (b.fy_year ?? 0) - (a.fy_year ?? 0);
  });
}

// ---------------------------------------------------------------------------
// Tab component
// ---------------------------------------------------------------------------

export function TeamGoalsTab() {
  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();
  const { settings } = useSystemSettings();
  const cycleType = settings?.cycle_type ?? null;

  const queryClient = useQueryClient();

  // The mentor's goal-approval queue. Cached under
  // queryKeys.goals.mentees() so any goal-mutation broadcast catches
  // it. Cross-page cache sharing kept it consistent with the (now-
  // retired) dashboard pending-mentor-work card; same broadcast still
  // refreshes the goal_approval_funnel on the HR dashboard.
  const teamGoalsQuery = useQuery({
    queryKey: queryKeys.goals.mentees(),
    queryFn: () => goalService.getTeamGoals("annual"),
  });
  const goals: TeamGoal[] = teamGoalsQuery.data ?? [];
  const isLoading = teamGoalsQuery.isPending;

  // Filters
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [functionFilter, setFunctionFilter] = useState("all");
  const [designationFilter, setDesignationFilter] = useState("all");
  // Empty string means "no mentee filter" (StringCombobox convention).
  const [menteeFilter, setMenteeFilter] = useState("");

  const hasActiveFilters =
    statusFilter !== "all" ||
    yearFilter !== "all" ||
    functionFilter !== "all" ||
    designationFilter !== "all" ||
    menteeFilter !== "";

  const clearFilters = () => {
    setStatusFilter("all");
    setYearFilter("all");
    setFunctionFilter("all");
    setDesignationFilter("all");
    setMenteeFilter("");
  };
  const [sort, setSort] = useState<SortState<TeamGoalsSortKey> | null>(null);
  // Expansion is keyed by the composite group identity (user_id,
  // fy_year) because a mentee with goals across multiple FYs now
  // shows up as multiple adjacent rows — keying by user_id alone
  // would expand all of that mentee's rows together.
  const [expandedGroupKey, setExpandedGroupKey] = useState<string | null>(null);

  // "Request Changes" modal state
  const [feedbackTarget, setFeedbackTarget] = useState<TeamGoal | null>(null);
  const [modalError, setModalError] = useState("");

  // Bulk approve modal state
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkError, setBulkError] = useState("");

  // Mentor review modal state
  const [reviewGoal, setReviewGoal] = useState<TeamGoal | null>(null);
  const [reviewCycle, setReviewCycle] = useState<SelfReviewCycleHalf | null>(null);
  const [reviewError, setReviewError] = useState("");

  // ── Mutations ──────────────────────────────────────────────────────
  // All five goal-side mutations broadcast-invalidate the same two
  // namespaces: ['goals'] (catches mentor's queue + Employee's mine + HR's
  // org) and ['dashboard'] (catches goal_approval_funnel + the various
  // completion counts).
  //
  // Single helper because all five mutations share this scope —
  // following the same DRY pattern from PR #22 (AnnualGoals).
  const invalidateGoalsScope = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  }, [queryClient]);

  // Approve a single goal. The owner name is passed alongside the id
  // so the success toast can be personalized without us having to
  // look it up after the mutation resolves (the goals list might
  // already have been refetched).
  // Optimistic update (PR #50, doc 32). Mentor clicks Approve → the
  // goal's approval_status flips to "approved" instantly in the
  // pending list; the toast confirms after the server response.
  // Same broadcast scope as the invalidation (covers ['goals'] +
  // ['dashboard']) but applied as an optimistic patch first.
  const approveGoalMutation = useMutation({
    mutationFn: (vars: { goalId: number; ownerName: string }) =>
      goalService.updateApproval(vars.goalId, {
        approval_status: "approved",
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.goals.all });
      const snapshot = patchRowsAcross<{
        id: number;
        approval_status: string;
      }>(
        queryClient,
        queryKeys.goals.all,
        (g) => g.id === vars.goalId,
        { approval_status: "approved" },
      );
      return { snapshot };
    },
    onSuccess: (_data, vars) => {
      toast.success(`${vars.ownerName}'s goal approved.`);
    },
    onError: (err, _vars, context) => {
      context?.snapshot.restore();
      snackbar.error(getErrorMessage(err));
    },
    onSettled: () => {
      invalidateGoalsScope();
    },
  });

  // Request-changes flow — same endpoint as approve, different status
  // + a feedback message. Errors go to `modalError` (the feedback
  // modal stays open on failure); approve errors go to snackbar
  // (no modal context). Optimistic patch also writes back the
  // feedback string so the goal card shows the mentor's note
  // immediately.
  const requestChangesMutation = useMutation({
    mutationFn: (vars: { goalId: number; feedback: string }) =>
      goalService.updateApproval(vars.goalId, {
        approval_status: "changes_requested",
        feedback: vars.feedback,
      }),
    onMutate: async (vars) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.goals.all });
      const snapshot = patchRowsAcross<{
        id: number;
        approval_status: string;
        manager_feedback: string | null;
      }>(
        queryClient,
        queryKeys.goals.all,
        (g) => g.id === vars.goalId,
        { approval_status: "changes_requested", manager_feedback: vars.feedback },
      );
      return { snapshot };
    },
    onSuccess: () => {
      setFeedbackTarget(null);
      toast.success("Feedback sent.");
    },
    onError: (err, _vars, context) => {
      context?.snapshot.restore();
      setModalError(getErrorMessage(err));
    },
    onSettled: () => {
      invalidateGoalsScope();
    },
  });

  // Bulk approve — partial-success-aware. The response carries
  // approved_ids + failures; we toast a summary either way and surface
  // the first failure reason if any.
  const bulkApproveMutation = useMutation({
    mutationFn: (goalIds: number[]) => goalService.bulkApprove(goalIds),
    onSuccess: (result, goalIds) => {
      invalidateGoalsScope();
      if (result.failures.length === 0) {
        toast.success(
          `Approved ${result.approved_ids.length} goal${
            result.approved_ids.length === 1 ? "" : "s"
          }.`,
        );
        setBulkOpen(false);
      } else {
        toast.success(
          `Approved ${result.approved_ids.length} of ${goalIds.length} goal${
            goalIds.length === 1 ? "" : "s"
          }.`,
        );
        const firstReason =
          result.failures[0]?.reason ?? "Some goals could not be approved.";
        const extra =
          result.failures.length > 1
            ? ` (+${result.failures.length - 1} more)`
            : "";
        setBulkError(`${firstReason}${extra}`);
      }
    },
    onError: (err) => setBulkError(getErrorMessage(err)),
  });

  // Mentor review save-draft and submit are 3-arg service calls;
  // standard pack-into-object pattern (doc #20 part 2).
  const saveMentorReviewDraftMutation = useMutation({
    mutationFn: (vars: {
      goalId: number;
      cycleHalf: SelfReviewCycleHalf;
      payload: GoalMentorReviewPayload;
    }) =>
      goalService.saveMentorReviewDraft(
        vars.goalId,
        vars.cycleHalf,
        vars.payload,
      ),
    onSuccess: () => {
      invalidateGoalsScope();
      toast.success("Draft saved.");
    },
    onError: (err) => setReviewError(getErrorMessage(err)),
  });

  const submitMentorReviewMutation = useMutation({
    mutationFn: (vars: {
      goalId: number;
      cycleHalf: SelfReviewCycleHalf;
      payload: GoalMentorReviewPayload;
    }) =>
      goalService.submitMentorReview(
        vars.goalId,
        vars.cycleHalf,
        vars.payload,
      ),
    onSuccess: () => {
      invalidateGoalsScope();
      closeReview();
    },
    onError: (err) => setReviewError(getErrorMessage(err)),
  });

  // Combined acting flag for the approve / feedback row-level UI
  // (some row-level UI disables itself while a mutation is in flight).
  const isActing =
    approveGoalMutation.isPending || requestChangesMutation.isPending;

  const openReview = (goal: TeamGoal, half: SelfReviewCycleHalf) => {
    setReviewError("");
    setReviewGoal(goal);
    setReviewCycle(half);
  };
  const closeReview = () => {
    setReviewGoal(null);
    setReviewCycle(null);
    setReviewError("");
  };

  // ── Handlers (thin wrappers over mutations) ────────────────────────
  // Review modal handlers use mutateAsync because the review form
  // modal awaits onSubmit / onSaveDraft to drive its "Saving..." spinner.
  // The other mutations don't have callers that need to await — plain
  // mutate() is the right choice. See doc #03 for the pattern.
  const handleSaveReviewDraft = async (
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalMentorReviewPayload,
  ) => {
    if (!reviewGoal) return;
    setReviewError("");
    try {
      await saveMentorReviewDraftMutation.mutateAsync({
        goalId: reviewGoal.id,
        cycleHalf,
        payload,
      });
    } catch {
      /* handled by onError */
    }
  };

  const handleSubmitReview = async (
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalMentorReviewPayload,
  ) => {
    if (!reviewGoal) return;
    const halfLabel = halfDisplayLabel(cycleHalf);
    const ok = await confirm({
      title: `Submit ${halfLabel} mentor review?`,
      message: `Submit your ${halfLabel} review on "${reviewGoal.title}" for ${reviewGoal.owner_name}. Mentor reviews are one-shot — once submitted you can't edit this entry, and ${reviewGoal.owner_name} will see your assessment for this half.`,
      variant: "warning",
      confirmText: "Submit Mentor Review",
    });
    if (!ok) return;
    setReviewError("");
    try {
      await submitMentorReviewMutation.mutateAsync({
        goalId: reviewGoal.id,
        cycleHalf,
        payload,
      });
    } catch {
      /* handled by onError */
    }
  };

  const handleApprove = async (goal: TeamGoal) => {
    const ok = await confirm({
      title: `Approve ${goal.owner_name}'s goal?`,
      message: `Approve "${goal.title}". This locks the goal for editing and opens the H1/H2 self-review window for ${goal.owner_name}. You won't be able to undo this from here.`,
      variant: "default",
      confirmText: "Approve",
    });
    if (!ok) return;
    approveGoalMutation.mutate({
      goalId: goal.id,
      ownerName: goal.owner_name,
    });
  };

  // Bulk-approve and feedback modals both await their submit
  // callback to drive their internal "Saving..." spinner, so
  // mutateAsync + try/catch is required (same pattern as the other
  // modal flows in this file).
  const handleBulkApprove = async (goalIds: number[]) => {
    setBulkError("");
    try {
      await bulkApproveMutation.mutateAsync(goalIds);
    } catch {
      /* handled by onError */
    }
  };

  const handleSendFeedback = async (feedback: string) => {
    if (!feedbackTarget) return;
    setModalError("");
    try {
      await requestChangesMutation.mutateAsync({
        goalId: feedbackTarget.id,
        feedback,
      });
    } catch {
      /* handled by onError */
    }
  };

  // ── Derived filter options ────────────────────────────────────────
  const availableYears = Array.from(
    new Set(goals.map((g) => g.fy_year).filter((y): y is number => y !== null)),
  ).sort((a, b) => b - a);

  const availableMentees = Array.from(
    new Set(goals.map((g) => g.owner_name).filter((n): n is string => !!n)),
  ).sort();

  const availableFunctions = Array.from(
    new Set(
      goals.map((g) => g.owner_function_name).filter((f): f is string => !!f),
    ),
  ).sort();

  const availableDesignations = Array.from(
    new Set(
      goals
        .map((g) => g.owner_designation_name)
        .filter((d): d is string => !!d),
    ),
  ).sort();

  // Bulk-approve badge counts pending across ALL loaded goals, not the
  // filtered subset — the modal's selection list shows the full pool.
  const pendingApprovalCount = goals.filter(
    (g) => g.approval_status === "pending_approval",
  ).length;

  const filtered = goals
    .filter((g) => statusFilter === "all" || g.approval_status === statusFilter)
    .filter((g) => yearFilter === "all" || g.fy_year === Number(yearFilter))
    .filter(
      (g) =>
        functionFilter === "all" || g.owner_function_name === functionFilter,
    )
    .filter(
      (g) =>
        designationFilter === "all" ||
        g.owner_designation_name === designationFilter,
    )
    .filter((g) => !menteeFilter || g.owner_name === menteeFilter);

  const groups = buildTeamGoalsGroups(filtered);

  const sortedGroups = sort
    ? groups.slice().sort((a, b) => {
        const { kind, get } = TEAM_GOALS_SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : groups
        .slice()
        .sort((a, b) =>
          a.owner_name.localeCompare(b.owner_name, undefined, {
            sensitivity: "base",
          }),
        );

  // Derive the visible expanded row instead of resetting it via effect
  // when filters change. If the user filtered the expanded row out of
  // view, treat it as collapsed without mutating state — the stored
  // key is restored automatically when the filter is cleared.
  const visibleExpandedGroupKey =
    expandedGroupKey !== null &&
    sortedGroups.some(
      (g) => `${g.user_id}_${g.fy_year ?? "null"}` === expandedGroupKey,
    )
      ? expandedGroupKey
      : null;

  // ── Render ────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-text-muted">
        Loading goals…
      </div>
    );
  }

  if (goals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
        <Users className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
        <p className="font-display text-base font-medium text-text-main">
          No annual goals to review
        </p>
        <p className="mt-1 text-sm text-text-muted">
          Your mentees haven't requested approval on any annual goals yet.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar — filters + bulk approve all on one wrap row */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label
            htmlFor="team-mentee-filter"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Mentee
          </label>
          <StringCombobox
            id="team-mentee-filter"
            options={availableMentees}
            value={menteeFilter}
            onChange={setMenteeFilter}
            placeholder="Type a name…"
          />
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="team-year-filter"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Year
          </label>
          <select
            id="team-year-filter"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer min-w-[120px]"
          >
            <option value="all">All Years</option>
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {formatFyYearSpan(y)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="team-function-filter"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Function
          </label>
          <StringCombobox
            id="team-function-filter"
            options={availableFunctions}
            // State uses "all" as the no-filter sentinel; the combobox
            // uses "" — translate on both edges.
            value={functionFilter === "all" ? "" : functionFilter}
            onChange={(v) => setFunctionFilter(v === "" ? "all" : v)}
            placeholder="All Functions"
          />
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="team-designation-filter"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Designation
          </label>
          <StringCombobox
            id="team-designation-filter"
            options={availableDesignations}
            value={designationFilter === "all" ? "" : designationFilter}
            onChange={(v) => setDesignationFilter(v === "" ? "all" : v)}
            placeholder="All Designations"
          />
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="team-status-filter"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Status
          </label>
          <select
            id="team-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer min-w-[160px]"
          >
            {buildStatusFilters(cycleType).map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <span className="text-xs text-text-muted">
          {sortedGroups.length}{" "}
          {sortedGroups.length === 1 ? "mentee" : "mentees"} ·{" "}
          {filtered.length} of {goals.length} goals
        </span>
        <div className="ml-auto flex items-center gap-2">
        <ClearFiltersButton active={hasActiveFilters} onClear={clearFilters} />
        <button
          type="button"
          onClick={() => {
            setBulkError("");
            setBulkOpen(true);
          }}
          disabled={pendingApprovalCount === 0}
          className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          title={
            pendingApprovalCount === 0
              ? "No goals are currently awaiting approval"
              : `Bulk approve ${pendingApprovalCount} pending goal${
                  pendingApprovalCount === 1 ? "" : "s"
                }`
          }
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Bulk Approve
          {pendingApprovalCount > 0 && (
            <span className="rounded-full bg-white/20 px-1.5 text-[10px] font-semibold">
              {pendingApprovalCount}
            </span>
          )}
        </button>
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center bg-background/50">
          <Users className="h-8 w-8 text-text-muted mb-2" aria-hidden="true" />
          <p className="font-display text-sm font-medium text-text-main">
            No goals match this filter
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Try adjusting your filter options.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-max text-[13px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-border">
                <th className="text-left px-5 py-2.5">
                  <SortableHeader
                    label="Mentee"
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
                    columnKey="fy_year"
                    sort={sort}
                    onSort={setSort}
                  />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader
                    label="Goals"
                    columnKey="goal_count"
                    sort={sort}
                    onSort={setSort}
                  />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {sortedGroups.map((group) => {
                const groupKey = `${group.user_id}_${group.fy_year ?? "null"}`;
                const isExpanded = visibleExpandedGroupKey === groupKey;
                const goalCount = group.goals.length;
                return (
                  <Fragment key={groupKey}>
                    <tr
                      className={`transition-colors cursor-pointer ${
                        isExpanded ? "bg-brand/5" : "hover:bg-slate-50/60"
                      }`}
                      onClick={() =>
                        setExpandedGroupKey(isExpanded ? null : groupKey)
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
                        {group.fy_year ? (
                          <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                            {formatFyYearSpan(group.fy_year)}
                          </span>
                        ) : (
                          <span className="text-[12px] text-text-muted">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-muted">
                        {goalCount} {goalCount === 1 ? "goal" : "goals"}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50/80">
                        <td colSpan={5} className="p-0">
                          <table className="w-full min-w-max text-[13px]">
                            <thead>
                              <tr className="text-left text-[11px] font-bold uppercase tracking-wider text-text-muted border-b border-border/40">
                                <th className="px-10 py-2 font-bold">Goal</th>
                                <th className="px-4 py-2 font-bold">
                                  Description
                                </th>
                                <th className="px-4 py-2 font-bold">Status</th>
                                <th className="px-4 py-2 font-bold">Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {group.goals.map((g) => {
                                const isPending =
                                  g.approval_status === "pending_approval";
                                const isApproved = isPostApproved(
                                  g.approval_status,
                                );
                                const isChangesRequested =
                                  g.approval_status === "changes_requested";
                                return (
                                  <tr
                                    key={g.id}
                                    className="border-t border-border/40"
                                  >
                                    <td className="px-10 py-2.5">
                                      <div className="flex items-center gap-2">
                                        <span className="font-medium text-text-main">
                                          {g.title}
                                        </span>
                                        {g.attachment_url && (
                                          <a
                                            href={g.attachment_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-brand hover:text-brand/80 transition-colors shrink-0"
                                            title="Open attachment"
                                          >
                                            <LinkIcon
                                              className="h-3.5 w-3.5"
                                              aria-hidden="true"
                                            />
                                          </a>
                                        )}
                                      </div>
                                    </td>
                                    <td className="px-4 py-2.5 text-[12.5px] text-text-muted max-w-md">
                                      {g.description ? (
                                        <span className="line-clamp-2">
                                          {g.description}
                                        </span>
                                      ) : (
                                        <span>—</span>
                                      )}
                                    </td>
                                    <td className="px-4 py-2.5">
                                      <ApprovalStatusBadge
                                        status={g.approval_status}
                                      />
                                    </td>
                                    <td className="px-4 py-2.5">
                                      <div className="flex items-center gap-2 flex-wrap">
                                        {isPending && (
                                          <>
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setModalError("");
                                                setFeedbackTarget(g);
                                              }}
                                              disabled={isActing}
                                              className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                                            >
                                              <RotateCcw className="h-3 w-3" />
                                              Request Changes
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() => handleApprove(g)}
                                              disabled={isActing}
                                              className="flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                                            >
                                              <Check className="h-3 w-3" />
                                              Approve
                                            </button>
                                          </>
                                        )}
                                        {isApproved && (
                                          <MentorReviewHalfChips
                                            goal={g}
                                            onSelect={(half) =>
                                              openReview(g, half)
                                            }
                                          />
                                        )}
                                        {isChangesRequested && (
                                          <span className="text-[11px] text-amber-700 italic">
                                            Awaiting revision
                                          </span>
                                        )}
                                      </div>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
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

      {/* "Request Changes" modal */}
      {feedbackTarget && (
        <FeedbackModal
          goal={feedbackTarget}
          onSend={handleSendFeedback}
          onClose={() => setFeedbackTarget(null)}
          isSaving={isActing}
          error={modalError}
        />
      )}

      {/* Bulk approve modal — conditionally mounted so each open is a
          fresh React tree and the modal's local state (selection,
          collapsed groups) is reset by mount, not by an effect. */}
      {bulkOpen && (
        <BulkApproveModal
          goals={goals}
          onClose={() => {
            setBulkOpen(false);
            setBulkError("");
          }}
          onSubmit={handleBulkApprove}
          isSaving={bulkApproveMutation.isPending}
          error={bulkError}
        />
      )}

      {/* Mentor review modal — editable when no review yet for this half,
          read-only once the mentor's review has been submitted. */}
      {reviewGoal !== null && reviewCycle !== null && (
        <GoalMentorReviewModal
          goal={reviewGoal}
          cycleHalf={reviewCycle}
          onClose={closeReview}
          onSubmit={handleSubmitReview}
          onSaveDraft={handleSaveReviewDraft}
          isSaving={submitMentorReviewMutation.isPending}
          isDraftSaving={saveMentorReviewDraftMutation.isPending}
          error={reviewError}
        />
      )}

    </div>
  );
}
