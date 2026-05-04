/**
 * MenteeReviewTab — Read-only history of every annual review filed for
 * this mentee, presented as a table that mirrors the /annual-reviews
 * Team Review tab style.
 *
 * Filling/editing always happens on the Annual Summary tab via
 * `EvalModal`. This tab is purely the historical record:
 *   - One row per AnnualReview (newest-first, by extracted FY token).
 *   - Shows status, four ratings (self / mentor / mgmt / final), and a
 *     "View full review" action that opens the same `AnnualReviewDetailModal`
 *     used by /annual-reviews → Team Review.
 *   - Drafts (mentee still self-reviewing) are filtered out — nothing
 *     useful for the mentor to see yet.
 *   - When the active-FY review is in pending_mentor (mentee submitted,
 *     mentor hasn't filed), the row appears with a hint linking the
 *     mentor over to the Summary tab to actually fill it.
 */

import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Eye, FileText } from "lucide-react";
import type { AnnualReview } from "../../services/annual-review.service";
import { ReviewStatusBadge } from "../reviews/ReviewStatusBadge";
import { PerformanceRatingBadge } from "../reviews/PerformanceRatingBadge";
import { AnnualReviewDetailModal } from "../reviews/AnnualReviewDetailModal";
import { extractFyToken, formatFyLabel } from "../../utils/fy";

interface MenteeReviewTabProps {
  readonly reviews: AnnualReview[];
  readonly menteeName: string;
}

export function MenteeReviewTab({ reviews, menteeName }: MenteeReviewTabProps) {
  const [, setSearchParams] = useSearchParams();
  const [viewing, setViewing] = useState<AnnualReview | null>(null);

  // Filter out drafts (mentee still working) — nothing for the mentor to
  // see. Sort newest-first by FY token (alpha-sort works because the bare
  // FY token format "FY26-27" is monotonic on the year prefix).
  const visible = useMemo(() => {
    return reviews
      .filter((r) => r.status !== "draft")
      .slice()
      .sort((a, b) =>
        extractFyToken(b.cycle_name).localeCompare(extractFyToken(a.cycle_name)),
      );
  }, [reviews]);

  const goToSummary = () => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", "summary");
        return next;
      },
      { replace: true },
    );
  };

  if (visible.length === 0) {
    const hasDraft = reviews.some((r) => r.status === "draft");
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border bg-surface px-6 py-10 text-center">
        <FileText className="h-6 w-6 text-text-muted" aria-hidden="true" />
        <p className="mt-2 text-sm font-medium text-text-main">
          {hasDraft
            ? `${menteeName} is drafting their self-review`
            : "No annual reviews yet"}
        </p>
        <p className="text-xs text-text-muted">
          {hasDraft
            ? "It will appear here once submitted."
            : `Reviews appear here once ${menteeName} submits a self-review for the active FY.`}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-slate-50/80 border-b border-border">
              <th className="text-left px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Year
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Status
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Self Review
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Mentor Review
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Management Review
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Final Review
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {visible.map((r) => {
              const awaitingMentor = r.status === "pending_mentor";
              return (
                <tr
                  key={r.id}
                  className="hover:bg-slate-50/60 cursor-pointer transition-colors"
                  onClick={() => setViewing(r)}
                >
                  <td className="px-5 py-3">
                    <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                      {formatFyLabel(r.cycle_name)}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <ReviewStatusBadge status={r.status} />
                  </td>
                  <td className="px-4 py-3">
                    <PerformanceRatingBadge value={r.self_performance_rating} />
                  </td>
                  <td className="px-4 py-3">
                    <PerformanceRatingBadge
                      value={r.mentor_performance_rating}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <PerformanceRatingBadge
                      value={r.management_performance_rating}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <PerformanceRatingBadge
                      value={r.final_performance_rating}
                    />
                  </td>
                  <td
                    className="px-4 py-3"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => setViewing(r)}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-brand hover:underline"
                      >
                        <Eye className="h-3 w-3" aria-hidden="true" />
                        View
                      </button>
                      {awaitingMentor && (
                        <button
                          type="button"
                          onClick={goToSummary}
                          className="text-[11px] italic text-amber-700 hover:underline"
                          title="Open the Annual Summary tab to fill this review"
                        >
                          Fill from Summary →
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {viewing && (
        <AnnualReviewDetailModal
          review={viewing}
          title={`${menteeName} · Annual Review`}
          subtitle={`Year: ${formatFyLabel(viewing.cycle_name)}`}
          onClose={() => setViewing(null)}
        />
      )}
    </div>
  );
}
