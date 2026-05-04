import {
  Link,
  MessageSquare,
  Pencil,
  SendHorizonal,
  UserCircle,
} from "lucide-react";
import type {
  Goal,
  Criterion,
  SelfReviewCycleHalf,
} from "../../services/goal.service";
import { ApprovalStatusBadge } from "./ApprovalStatusBadge";
import { CriteriaChecklist } from "./CriteriaChecklist";
import { SelfReviewCycleMenu } from "./SelfReviewCycleMenu";
import { formatFyYearSpan } from "../../utils/fy";
import { isPostApproved } from "../../utils/goalStatus";

interface AnnualGoalCardProps {
  readonly goal: Goal;
  readonly onEdit: (goal: Goal) => void;
  readonly onSubmit: (goal: Goal) => void;
  readonly onSelfReview: (goal: Goal, cycleHalf: SelfReviewCycleHalf) => void;
  readonly onCriterionUpdate: (goalId: number, updated: Criterion) => void;
  /** When false, edit is blocked — admin has closed the annual-goal window. */
  readonly editGateOpen: boolean;
}

export function AnnualGoalCard({
  goal,
  onEdit,
  onSubmit,
  onSelfReview,
  onCriterionUpdate,
  editGateOpen,
}: AnnualGoalCardProps) {
  const isDraft = goal.approval_status === "draft";
  const isSubmitted = goal.approval_status === "pending_approval";
  const isChangesRequired = goal.approval_status === "changes_requested";
  const isApproved = isPostApproved(goal.approval_status);

  const canEdit = (isDraft || isChangesRequired) && editGateOpen;
  const canSubmit = isDraft || isChangesRequired;

  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3">
      {/* Mentor name + FY year + edit icon */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
          <UserCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {goal.manager_name ?? (
            <span className="italic">No Mentor Assigned</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {goal.fy_year && (
            <span className="text-[11px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
              {formatFyYearSpan(goal.fy_year)}
            </span>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={() => onEdit(goal)}
              title="Edit goal"
              className="rounded-md p-1.5 text-text-muted hover:bg-brand-light hover:text-brand transition-colors"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>

      {/* Title */}
      <p className="font-medium text-text-main leading-snug">{goal.title}</p>

      {/* Description */}
      {goal.description && (
        <p className="text-sm text-text-muted line-clamp-2">
          {goal.description}
        </p>
      )}

      {/* Attachment */}
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

      {/* Mentor feedback — only visible when changes have been requested */}
      {isChangesRequired && goal.manager_feedback && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2">
          <MessageSquare
            className="h-4 w-4 text-amber-600 mt-0.5 shrink-0"
            aria-hidden="true"
          />
          <div>
            <p className="text-xs font-semibold text-amber-700 mb-0.5">
              Mentor Feedback
            </p>
            <p className="text-xs text-amber-800">{goal.manager_feedback}</p>
          </div>
        </div>
      )}

      {/* Criteria checklist */}
      {goal.criteria.length > 0 && (
        <CriteriaChecklist
          criteria={goal.criteria}
          approvalStatus={goal.approval_status}
          progressPercent={goal.progress_percent}
          onCriterionUpdate={(updated: Criterion) =>
            onCriterionUpdate(goal.id, updated)
          }
        />
      )}

      {/* Approval status badge */}
      <div>
        <ApprovalStatusBadge status={goal.approval_status} />
      </div>

      {/* Footer — workflow actions */}
      <div className="flex items-center justify-end gap-2 mt-auto pt-1 border-t border-border">
        {canSubmit && (
          <button
            type="button"
            onClick={() => onSubmit(goal)}
            className="flex items-center gap-1.5 rounded-md bg-brand-light px-2.5 py-1.5 text-xs font-medium text-brand hover:bg-brand hover:text-white transition-colors"
          >
            <SendHorizonal className="h-3.5 w-3.5" aria-hidden="true" />
            Request Approval
          </button>
        )}

        {isSubmitted && (
          <span className="text-xs text-text-muted italic">
            Awaiting mentor review…
          </span>
        )}

        {isApproved && (
          <SelfReviewCycleMenu
            goal={goal}
            mode="mentee"
            onSelect={(half) => onSelfReview(goal, half)}
          />
        )}
      </div>
    </div>
  );
}
