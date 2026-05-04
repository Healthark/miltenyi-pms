import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Save, Send, X } from "lucide-react";
import type {
  AnnualReview,
  SelfReviewPayload,
  SelfReviewDraftPayload,
} from "../../services/annual-review.service";
import { PerformanceRatingSelect } from "./PerformanceRatingSelect";
import { formatFyLabel } from "../../utils/fy";

const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";

interface SelfReviewFormModalProps {
  readonly cycleName: string;
  /** Existing draft row (when one was previously saved). Used to pre-fill
   *  the form on open and to drive the (Draft) title suffix. */
  readonly draft?: AnnualReview | null;
  readonly onSubmit: (payload: SelfReviewPayload) => Promise<void>;
  readonly onSaveDraft?: (payload: SelfReviewDraftPayload) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly isDraftSaving?: boolean;
  readonly error: string;
}

export function SelfReviewFormModal({
  cycleName,
  draft,
  onSubmit,
  onSaveDraft,
  onClose,
  isSaving,
  isDraftSaving = false,
  error,
}: SelfReviewFormModalProps) {
  const [overallReview, setOverallReview] = useState(
    draft?.self_overall_review ?? "",
  );
  const [rating, setRating] = useState<number | "">(
    draft?.self_performance_rating ?? "",
  );

  // If the draft prop arrives async, re-seed the form once.
  useEffect(() => {
    if (draft) {
      setOverallReview(draft.self_overall_review ?? "");
      setRating(draft.self_performance_rating ?? "");
    }
  }, [draft?.id, draft?.self_overall_review, draft?.self_performance_rating]);

  const allFilled =
    overallReview.trim().length > 0 && typeof rating === "number";

  const handleSubmit = async () => {
    if (!allFilled || typeof rating !== "number") return;
    await onSubmit({
      self_overall_review: overallReview,
      self_performance_rating: rating,
    });
  };

  const handleSaveDraft = async () => {
    if (!onSaveDraft) return;
    const payload: SelfReviewDraftPayload = {
      self_overall_review: overallReview,
    };
    if (typeof rating === "number") {
      payload.self_performance_rating = rating;
    }
    await onSaveDraft(payload);
  };

  const titleSuffix = draft ? " (Draft)" : "";

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
              Self Annual Review{titleSuffix}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Year: {formatFyLabel(cycleName)} · Rate your overall performance
              and summarise the year in your own words. Save as a draft and
              come back, or submit when you're ready (drafts can be edited;
              submissions are final).
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

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </p>
          )}

          <PerformanceRatingSelect value={rating} onChange={setRating} />

          <div>
            <label
              htmlFor="self-overall-review"
              className="block text-xs font-semibold text-text-main mb-1"
            >
              Overall Self Review *
            </label>
            <p className="text-xs text-text-muted mb-2">
              Summarise your year — ownership, deliverables, communication,
              mentoring, skill growth, and any firm-level contributions.
            </p>
            <textarea
              id="self-overall-review"
              rows={10}
              className={TEXTAREA_CLS}
              value={overallReview}
              onChange={(e) => setOverallReview(e.target.value)}
              placeholder="Reflect on your performance this year…"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          {onSaveDraft && (
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={isSaving || isDraftSaving}
              className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-main hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              {isDraftSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              {isDraftSaving ? "Saving…" : "Save Draft"}
            </button>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || isDraftSaving || !allFilled}
            className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSaving ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            {isSaving ? "Submitting…" : "Submit Self-Review"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
