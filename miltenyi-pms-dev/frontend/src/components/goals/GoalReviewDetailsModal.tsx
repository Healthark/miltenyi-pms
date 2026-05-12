/**
 * GoalReviewDetailsModal — read-only renderer for a single goal's
 * self-reviews and mentor reviews. Used by HR_MyOrg's "All Goals" tab
 * so HR can audit the qualitative content (not just the status badge).
 *
 * Draft rows are filtered out — HR sees the same picture mentors do:
 * only submitted reflections, never the mentee's work-in-progress.
 */

import { createPortal } from "react-dom";
import { ClipboardCheck, MessageSquare, UserCircle, X } from "lucide-react";
import type {
  TeamGoal,
  SelfReviewCycleHalf,
} from "@/services/goal.service";
import { ApprovalStatusBadge } from "@/components/goals/ApprovalStatusBadge";
import { formatFyYearSpan } from "@/utils/fy";
import { halfDisplayLabel } from "@/utils/goalStatus";

interface GoalReviewDetailsModalProps {
  readonly goal: TeamGoal;
  readonly onClose: () => void;
}

/** Canonical order so H1 lands above H2, Q1..Q4 in numeric order — regardless
 *  of the order the API returned the rows in. */
const CYCLE_ORDER: SelfReviewCycleHalf[] = ["H1", "H2", "Q1", "Q2", "Q3", "Q4"];

export function GoalReviewDetailsModal({
  goal,
  onClose,
}: GoalReviewDetailsModalProps) {
  // Halves that have at least one submitted self-review OR mentor review.
  // Drafts are excluded so HR sees only finalised content.
  const halves = CYCLE_ORDER.filter((h) => {
    const sr = goal.self_reviews.find(
      (r) => r.cycle_half === h && !r.is_draft,
    );
    const mr = goal.mentor_reviews.find(
      (r) => r.cycle_half === h && !r.is_draft,
    );
    return !!sr || !!mr;
  });

  const fyLabel = goal.fy_year ? formatFyYearSpan(goal.fy_year) : null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="goal-review-details-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl rounded-xl bg-surface shadow-xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 shrink-0">
                <ClipboardCheck className="h-4 w-4 text-indigo-600" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <h2
                  id="goal-review-details-title"
                  className="font-display text-base font-semibold text-text-main truncate"
                >
                  {goal.title}
                </h2>
                <p className="mt-0.5 text-xs text-text-muted">
                  {goal.owner_name}
                  {fyLabel && <> · {fyLabel}</>}
                  {goal.manager_name && <> · Mentor: {goal.manager_name}</>}
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Status + description */}
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-text-main">Status:</span>
            <ApprovalStatusBadge status={goal.approval_status} />
          </div>

          {goal.description && goal.description.trim().length > 0 && (
            <section className="space-y-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Description
              </h3>
              <div className="rounded-lg border border-border bg-surface px-4 py-3">
                <p className="text-[13px] text-text-main whitespace-pre-wrap leading-relaxed">
                  {goal.description}
                </p>
              </div>
            </section>
          )}

          {/* Per-half reviews */}
          {halves.length === 0 ? (
            <section className="rounded-lg border border-dashed border-border bg-background/50 px-4 py-6 text-center">
              <p className="text-sm italic text-text-muted">
                No self or mentor reviews submitted yet.
              </p>
            </section>
          ) : (
            halves.map((half) => {
              const sr = goal.self_reviews.find(
                (r) => r.cycle_half === half && !r.is_draft,
              );
              const mr = goal.mentor_reviews.find(
                (r) => r.cycle_half === half && !r.is_draft,
              );
              return (
                <section key={half} className="space-y-2">
                  <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                    {halfDisplayLabel(half)} Reviews
                  </h3>

                  {sr ? (
                    <div className="rounded-lg border border-border bg-blue-50/30 px-4 py-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1">
                        <UserCircle className="h-3 w-3" aria-hidden="true" />
                        Self-Review
                      </div>
                      <p className="text-[13px] text-text-main whitespace-pre-wrap leading-relaxed">
                        {sr.self_overall_review}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border bg-background/50 px-4 py-2 text-[12px] italic text-text-muted">
                      No self-review submitted for {halfDisplayLabel(half)}.
                    </div>
                  )}

                  {mr ? (
                    <div className="rounded-lg border border-border bg-emerald-50/30 px-4 py-3">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1">
                        <MessageSquare className="h-3 w-3" aria-hidden="true" />
                        Mentor Review
                      </div>
                      <p className="text-[13px] text-text-main whitespace-pre-wrap leading-relaxed">
                        {mr.mentor_overall_review}
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border bg-background/50 px-4 py-2 text-[12px] italic text-text-muted">
                      No mentor review submitted for {halfDisplayLabel(half)}.
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-border px-6 py-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
