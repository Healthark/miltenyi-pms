import { MessageSquare, User, UserCircle } from "lucide-react";
import type { ProjectReviewResponse } from "../../services/project-review.service";

/**
 * Renders the PM's overall impact statement plus any submitted
 * secondary-evaluator impact statements for a reviewed project.
 * Used by both the My Reviews grid detail panel and the table
 * expanded row.
 */
export function ImpactBlock({
  review,
  compact,
}: {
  readonly review: ProjectReviewResponse;
  readonly compact?: boolean;
}) {
  return (
    <>
      {review.impact_statement && (
        <div
          className={`${
            compact ? "rounded-lg p-3" : "rounded-xl p-5"
          } border border-blue-200 bg-blue-50/50`}
        >
          <h3 className="text-[12px] font-bold uppercase tracking-widest text-blue-700 mb-2 flex items-center gap-2">
            <MessageSquare className="h-3.5 w-3.5" /> Overall Impact Statement
          </h3>
          <p
            className={`leading-relaxed text-blue-900 whitespace-pre-wrap ${
              compact ? "text-[13px]" : "text-[13.5px]"
            }`}
          >
            {review.impact_statement}
          </p>
        </div>
      )}

      {review.secondary_evaluations &&
        review.secondary_evaluations.length > 0 && (
          <div
            className={`${
              compact ? "rounded-lg p-3" : "rounded-xl p-5"
            } border border-dashed border-border bg-background/50`}
          >
            <h3 className="text-[12px] font-bold uppercase tracking-widest text-text-muted mb-3 flex items-center gap-2">
              <User className="h-3.5 w-3.5" /> Secondary Feedback
            </h3>
            <div className="flex flex-col gap-3">
              {review.secondary_evaluations.map((ev) => (
                <div
                  key={ev.id}
                  className="flex flex-col gap-1.5 pb-3 border-b border-border/50 last:border-0 last:pb-0"
                >
                  <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-main">
                    <UserCircle className="h-4 w-4 text-text-muted" />
                    {ev.evaluator_name}
                    <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-bold tracking-wider text-slate-600 uppercase">
                      Secondary
                    </span>
                  </div>
                  <p className="text-[13px] leading-relaxed text-text-muted pl-5 whitespace-pre-wrap">
                    {ev.impact_statement ?? "—"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
    </>
  );
}
