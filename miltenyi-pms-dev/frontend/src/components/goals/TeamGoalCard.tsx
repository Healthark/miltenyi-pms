import { UserCircle, Check, RotateCcw, Link } from "lucide-react";
import type { TeamGoal, SelfReviewCycleHalf } from "../../services/goal.service";
import { ApprovalStatusBadge } from "./ApprovalStatusBadge";
import { SelfReviewCycleMenu } from "./SelfReviewCycleMenu";
import { formatFyYearSpan } from "../../utils/fy";
import { isPostApproved } from "../../utils/goalStatus";

interface TeamGoalCardProps {
  readonly goal: TeamGoal;
  readonly onApprove: (goal: TeamGoal) => void;
  readonly onRequestChanges: (goal: TeamGoal) => void;
  /** Fired when the mentor picks H1 or H2 from the cycle menu. The parent
   *  decides which modal to open (mentor review modal in the unified Team
   *  Goals tab; read-only self-review viewer in MenteeGoalsTab). */
  readonly onSelectHalf: (
    goal: TeamGoal,
    cycleHalf: SelfReviewCycleHalf,
  ) => void;
  readonly isActing: boolean;
}

export function TeamGoalCard({
  goal,
  onApprove,
  onRequestChanges,
  onSelectHalf,
  isActing,
}: TeamGoalCardProps) {
  const isSubmitted = goal.approval_status === "pending_approval";
  const isApproved = isPostApproved(goal.approval_status);
  const isChangesRequested = goal.approval_status === "changes_requested";

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm flex flex-col gap-3">
      {/* Employee name + FY year */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
          <UserCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {goal.owner_name}
        </div>
        {goal.fy_year && (
          <span className="text-[11px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
            {formatFyYearSpan(goal.fy_year)}
          </span>
        )}
      </div>

      {/* Title */}
      <p className="font-medium text-text-main leading-snug">{goal.title}</p>

      {/* Description */}
      {goal.description && (
        <p className="text-sm text-text-muted line-clamp-2">
          {goal.description}
        </p>
      )}

      {/* Attachment link */}
      {goal.attachment_url && (
        <a
          href={goal.attachment_url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-brand hover:underline truncate w-fit"
        >
          <Link className="h-3 w-3 shrink-0" aria-hidden="true" />
          Attachment
        </a>
      )}

      {/* Status badge */}
      <div className="flex flex-wrap items-center gap-2">
        <ApprovalStatusBadge status={goal.approval_status} />
      </div>

      {/* Footer: workflow actions */}
      <div className="flex items-center justify-end gap-2 pt-1 border-t border-border">
        {isSubmitted && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onRequestChanges(goal)}
              disabled={isActing}
              className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors"
            >
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Request Changes
            </button>
            <button
              type="button"
              onClick={() => onApprove(goal)}
              disabled={isActing}
              className="flex items-center gap-1 rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              Approve
            </button>
          </div>
        )}

        {isApproved && (
          <SelfReviewCycleMenu
            goal={goal}
            mode="mentor"
            onSelect={(half) => onSelectHalf(goal, half)}
          />
        )}

        {isChangesRequested && (
          <span className="text-xs text-text-muted italic">
            Awaiting revision
          </span>
        )}
      </div>
    </div>
  );
}
