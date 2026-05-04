import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type {
  AnnualReview,
  MenteeAnnualReview,
} from "../../services/annual-review.service";
import { ReviewStatusBadge } from "./ReviewStatusBadge";
import { PerformanceRatingBadge } from "./PerformanceRatingBadge";
import { formatFyLabel } from "../../utils/fy";

/**
 * Read-only detail for an AnnualReview. Renders the ratings summary, the
 * employee's overall self-review, and (when present) the mentor's overall
 * review and management comments. Visibility is enforced server-side — this
 * component only renders what the backend included.
 */

interface AnnualReviewDetailModalProps {
  readonly review: AnnualReview | MenteeAnnualReview;
  readonly title: string;
  readonly subtitle?: string;
  readonly onClose: () => void;
}

export function AnnualReviewDetailModal({
  review,
  title,
  subtitle,
  onClose,
}: AnnualReviewDetailModalProps) {
  const showMentor = review.mentor_performance_rating != null;
  const showFinal = review.final_performance_rating != null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl rounded-xl bg-surface shadow-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div>
            <h2 className="font-display text-base font-semibold text-text-main">
              {title}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              {subtitle ?? `Year: ${formatFyLabel(review.cycle_name)}`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Status + year */}
          <div className="flex items-center gap-3 flex-wrap">
            <ReviewStatusBadge status={review.status} />
            <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
              {formatFyLabel(review.cycle_name)}
            </span>
          </div>

          {/* Ratings summary */}
          <div className="flex items-center gap-6 flex-wrap rounded-lg border border-border bg-slate-50/50 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-text-muted">
                Self Rating
              </span>
              <PerformanceRatingBadge
                value={review.self_performance_rating}
                size="md"
              />
            </div>
            {showMentor && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-muted">
                  Mentor Rating
                </span>
                <PerformanceRatingBadge
                  value={review.mentor_performance_rating}
                  size="md"
                />
              </div>
            )}
            {showFinal && (
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-muted">
                  Final Rating
                </span>
                <PerformanceRatingBadge
                  value={review.final_performance_rating}
                  size="md"
                />
              </div>
            )}
          </div>

          {/* Overall Self Review */}
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="bg-slate-50 px-4 py-2 border-b border-border">
              <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
                Overall Self Review
              </p>
            </div>
            <div className="p-4">
              <p className="text-sm text-text-main whitespace-pre-wrap">
                {review.self_overall_review || "—"}
              </p>
            </div>
          </div>

          {/* Mentor Overall Review */}
          {showMentor && review.mentor_overall_review && (
            <div className="rounded-lg border border-border overflow-hidden">
              <div className="bg-blue-50 px-4 py-2 border-b border-blue-100">
                <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                  Mentor Review
                </p>
              </div>
              <div className="p-4">
                <p className="text-sm text-blue-900 whitespace-pre-wrap">
                  {review.mentor_overall_review}
                </p>
              </div>
            </div>
          )}

        </div>

        <div className="flex justify-end border-t border-border px-6 py-4 shrink-0">
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
