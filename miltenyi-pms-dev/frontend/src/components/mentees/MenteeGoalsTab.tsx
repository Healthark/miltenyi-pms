import { useEffect, useState, Fragment } from "react";
import { createPortal } from "react-dom";
import {
  Search,
  LayoutGrid,
  Table2,
  ChevronDown,
  Check,
  RotateCcw,
  Link as LinkIcon,
  MessageSquare,
  Target,
} from "lucide-react";
import {
  goalService,
  type TeamGoal,
  type ApprovalStatus,
  type SelfReviewCycleHalf,
} from "../../services/goal.service";
import { getErrorMessage } from "../../utils/errors";
import { formatFyYearSpan } from "../../utils/fy";
import { isPostApproved } from "../../utils/goalStatus";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { useConfirm } from "../../hooks/useConfirm";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { TeamGoalCard } from "../goals/TeamGoalCard";
import { ApprovalStatusBadge } from "../goals/ApprovalStatusBadge";
import { CriteriaChecklist } from "../goals/CriteriaChecklist";
import { GoalSelfReviewModal } from "../goals/GoalSelfReviewModal";
import { SelfReviewCycleMenu } from "../goals/SelfReviewCycleMenu";
import { SortableHeader } from "../SortableHeader";
import { compareValues, type SortKind, type SortState } from "../../utils/sort";

// ---------------------------------------------------------------------------
// Feedback modal (Portal) — duplicated from TeamGoalsTab so the two views can
// evolve independently. Same behavior: mentor writes feedback and sends.
// ---------------------------------------------------------------------------

interface FeedbackModalProps {
  readonly goal: TeamGoal;
  readonly onSend: (feedback: string) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly error: string;
}

function FeedbackModal({ goal, onSend, onClose, isSaving, error }: FeedbackModalProps) {
  const [feedback, setFeedback] = useState("");

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mentee-feedback-modal-title"
    >
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="border-b border-border px-6 py-4">
          <h2
            id="mentee-feedback-modal-title"
            className="font-display text-base font-semibold text-text-main"
          >
            Request Changes
          </h2>
          <p className="mt-0.5 text-sm text-text-muted">
            Explain what needs to be revised for <strong>{goal.owner_name}</strong>.
          </p>
        </div>

        <div className="px-6 py-5 space-y-3">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </p>
          )}
          <label
            htmlFor="mentee-feedback-text"
            className="block text-xs font-medium text-text-muted mb-1"
          >
            Feedback *
          </label>
          <textarea
            id="mentee-feedback-text"
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
// Filter + sort config
// ---------------------------------------------------------------------------

type StatusFilter = "all" | ApprovalStatus;
type ViewMode = "grid" | "table";

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

type MenteeGoalsSortKey = "title" | "fy_year" | "approval_status";

const SORT_CONFIG: Record<
  MenteeGoalsSortKey,
  { kind: SortKind; get: (g: TeamGoal) => unknown }
> = {
  title:           { kind: "alpha",   get: (g) => g.title },
  fy_year:         { kind: "numeric", get: (g) => g.fy_year },
  approval_status: { kind: "alpha",   get: (g) => g.approval_status },
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface MenteeGoalsTabProps {
  readonly goals: TeamGoal[];
  readonly menteeName: string;
  /** Called after an action (approve / request-changes) so the parent can re-fetch. */
  readonly onReload: () => void;
}

export function MenteeGoalsTab({ goals, menteeName, onReload }: MenteeGoalsTabProps) {
  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();
  const { settings } = useSystemSettings();
  const cycleType = settings?.cycle_type ?? null;

  const [isActing, setIsActing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<SortState<MenteeGoalsSortKey> | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [yearFilter, setYearFilter] = useState("all");
  const [expandedGoalId, setExpandedGoalId] = useState<number | null>(null);

  // Request-Changes modal
  const [feedbackTarget, setFeedbackTarget] = useState<TeamGoal | null>(null);
  const [modalError, setModalError] = useState("");

  // View-only self-review modal
  const [viewSelfReviewGoal, setViewSelfReviewGoal] = useState<TeamGoal | null>(null);
  const [viewSelfReviewCycle, setViewSelfReviewCycle] = useState<SelfReviewCycleHalf | null>(null);

  const openMenteeSelfReview = (goal: TeamGoal, half: SelfReviewCycleHalf) => {
    setViewSelfReviewGoal(goal);
    setViewSelfReviewCycle(half);
  };
  const closeMenteeSelfReview = () => {
    setViewSelfReviewGoal(null);
    setViewSelfReviewCycle(null);
  };

  const handleApprove = async (goal: TeamGoal) => {
    const ok = await confirm({
      title: `Approve ${menteeName}'s goal?`,
      message: `Approve "${goal.title}". This locks the goal for editing and opens the H1/H2 self-review window for ${menteeName}. You won't be able to undo this from here.`,
      variant: "default",
      confirmText: "Approve",
    });
    if (!ok) return;
    setIsActing(true);
    try {
      await goalService.updateApproval(goal.id, { approval_status: "approved" });
      onReload();
      toast.success(`${goal.owner_name}'s goal approved.`);
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    } finally {
      setIsActing(false);
    }
  };

  const handleSendFeedback = async (feedback: string) => {
    if (!feedbackTarget) return;
    setIsActing(true);
    setModalError("");
    try {
      await goalService.updateApproval(feedbackTarget.id, {
        approval_status: "changes_requested",
        feedback,
      });
      setFeedbackTarget(null);
      onReload();
      toast.success("Feedback sent.");
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsActing(false);
    }
  };

  // Reset expanded row when filters change so the UI stays coherent
  useEffect(() => {
    setExpandedGoalId(null);
  }, [statusFilter, yearFilter, searchQuery, viewMode]);

  const availableYears = Array.from(
    new Set(goals.map((g) => g.fy_year).filter((y): y is number => y !== null)),
  ).sort((a, b) => b - a);

  const filtered = goals
    .filter((g) => statusFilter === "all" || g.approval_status === statusFilter)
    .filter((g) => yearFilter === "all" || g.fy_year === Number(yearFilter))
    .filter((g) => {
      const q = searchQuery.trim().toLowerCase();
      return q === "" || g.title.toLowerCase().includes(q);
    });

  const sortedGoals = sort
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

  // Empty: no goals at all for this mentee
  if (goals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center">
        <Target className="h-8 w-8 text-text-muted mb-2" aria-hidden="true" />
        <p className="font-display text-sm font-medium text-text-main">
          No annual goals to review
        </p>
        <p className="mt-1 text-xs text-text-muted">
          {menteeName} hasn't requested approval on any annual goals yet.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        {/* Row 1: search + view toggle */}
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

        {/* Row 2: filters */}
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label
              htmlFor="mentee-goal-year-filter"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Year
            </label>
            <select
              id="mentee-goal-year-filter"
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[120px] cursor-pointer"
            >
              <option value="all">All Years</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="mentee-goal-status-filter"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Status
            </label>
            <select
              id="mentee-goal-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[160px] cursor-pointer"
            >
              {buildStatusFilters(cycleType).map((f) => (
                <option key={f.value} value={f.value}>
                  {f.label}
                  {f.value !== "all" &&
                    ` (${goals.filter((g) => g.approval_status === f.value).length})`}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Content */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center bg-background/50">
          <Search className="h-8 w-8 text-text-muted mb-2" aria-hidden="true" />
          <p className="font-display text-sm font-medium text-text-main">
            No goals match this filter
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Try adjusting your search or filter options.
          </p>
        </div>
      ) : viewMode === "grid" ? (
        /* ── Cards view ── */
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sortedGoals.map((goal) => (
            <TeamGoalCard
              key={goal.id}
              goal={goal}
              onApprove={handleApprove}
              onRequestChanges={(g) => {
                setModalError("");
                setFeedbackTarget(g);
              }}
              onSelectHalf={openMenteeSelfReview}
              isActing={isActing}
            />
          ))}
        </div>
      ) : (
        /* ── Table view ── */
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-border">
                <th className="text-left px-5 py-2.5">
                  <SortableHeader
                    label="Goal"
                    columnKey="title"
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
                    label="Status"
                    columnKey="approval_status"
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
              {sortedGoals.map((goal) => {
                const isExpanded = expandedGoalId === goal.id;
                const isSubmitted = goal.approval_status === "pending_approval";
                const isApproved = isPostApproved(goal.approval_status);
                const isChangesRequested =
                  goal.approval_status === "changes_requested";

                return (
                  <Fragment key={goal.id}>
                    <tr
                      className={`transition-colors cursor-pointer ${
                        isExpanded ? "bg-brand/5" : "hover:bg-slate-50/60"
                      }`}
                      onClick={() =>
                        setExpandedGoalId(isExpanded ? null : goal.id)
                      }
                    >
                      <td className="px-5 py-3 font-medium text-text-main max-w-xs">
                        <div className="flex items-center gap-2">
                          <ChevronDown
                            className={`h-4 w-4 text-text-muted shrink-0 transition-transform duration-200 ${
                              isExpanded ? "rotate-180" : ""
                            }`}
                          />
                          <span className="line-clamp-1">{goal.title}</span>
                        </div>
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
                      <td
                        className="px-4 py-3"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          {isSubmitted && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setModalError("");
                                  setFeedbackTarget(goal);
                                }}
                                disabled={isActing}
                                className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                              >
                                <RotateCcw className="h-3 w-3" /> Request Changes
                              </button>
                              <button
                                type="button"
                                onClick={() => handleApprove(goal)}
                                disabled={isActing}
                                className="flex items-center gap-1 rounded-md bg-green-600 px-2 py-1 text-[11px] font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
                              >
                                <Check className="h-3 w-3" /> Approve
                              </button>
                            </>
                          )}
                          {isApproved && (
                            <SelfReviewCycleMenu
                              goal={goal}
                              mode="mentor"
                              onSelect={(half) => openMenteeSelfReview(goal, half)}
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
                    {isExpanded && (
                      <tr className="bg-brand/5">
                        <td colSpan={4} className="px-10 py-4">
                          <div className="space-y-3 max-w-2xl">
                            {goal.description && (
                              <p className="text-sm text-text-muted">
                                {goal.description}
                              </p>
                            )}
                            {goal.attachment_url && (
                              <a
                                href={goal.attachment_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-xs text-brand hover:underline w-fit"
                              >
                                <LinkIcon className="h-3 w-3 shrink-0" />
                                Attachment
                              </a>
                            )}
                            {isChangesRequested && goal.manager_feedback && (
                              <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
                                <MessageSquare className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                                <div>
                                  <p className="text-xs font-semibold text-amber-700 mb-0.5">
                                    Mentor Feedback
                                  </p>
                                  <p className="text-xs text-amber-800">
                                    {goal.manager_feedback}
                                  </p>
                                </div>
                              </div>
                            )}
                            {goal.criteria.length > 0 && (
                              <CriteriaChecklist
                                criteria={goal.criteria}
                                approvalStatus={goal.approval_status}
                                progressPercent={goal.progress_percent}
                                readOnly
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

      {/* Request-Changes modal */}
      {feedbackTarget && (
        <FeedbackModal
          goal={feedbackTarget}
          onSend={handleSendFeedback}
          onClose={() => setFeedbackTarget(null)}
          isSaving={isActing}
          error={modalError}
        />
      )}

      {/* Read-only view of the mentee's self-review */}
      <GoalSelfReviewModal
        isOpen={viewSelfReviewGoal !== null && viewSelfReviewCycle !== null}
        goal={viewSelfReviewGoal}
        cycleHalf={viewSelfReviewCycle}
        onClose={closeMenteeSelfReview}
        onSubmit={async () => {}}
        isSaving={false}
        error=""
        readOnly
      />
    </div>
  );
}
