/**
 * EvalForm — pure form body for the mentor's annual evaluation.
 *
 * The original EvalModal mixed shell (centered overlay) and form. We split
 * those: this component owns the inputs, dirty-tracking, and the
 * auto-save-on-unmount behaviour; the centered modal (EvalModal) and the
 * right-anchored drawer (EvalDrawer) each wrap it with their own chrome.
 *
 * Auto-save semantics:
 *   - "Dirty" means the local mentorReview/rating differ from what the
 *     server-side draft currently holds.
 *   - On unmount: if dirty AND the close was implicit (route change, tab
 *     change, parent unmount), fire `onSaveDraft` so the user doesn't lose
 *     their typing. The component is unmounting so we don't await the
 *     promise — the network call goes through, the response is ignored.
 *   - Cancel and the X button set `bypassAutoSaveRef.current = true` before
 *     calling `onClose`, so explicit dismissal does NOT auto-save.
 *   - Submit/Save Draft persist their values via the explicit handlers and
 *     also reset the dirty baseline.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Save, Send, X } from "lucide-react";
import type {
  MenteeAnnualReview,
  MentorEvalPayload,
  MentorEvalDraftPayload,
} from "../../services/annual-review.service";
import { PerformanceRatingSelect } from "./PerformanceRatingSelect";
import { formatFyLabel } from "../../utils/fy";

const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";

export interface EvalFormProps {
  readonly review: MenteeAnnualReview;
  readonly onSubmit: (
    reviewId: number,
    payload: MentorEvalPayload,
  ) => Promise<void>;
  readonly onSaveDraft?: (
    reviewId: number,
    payload: MentorEvalDraftPayload,
  ) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly isDraftSaving?: boolean;
  readonly error: string;
}

export function EvalForm({
  review,
  onSubmit,
  onSaveDraft,
  onClose,
  isSaving,
  isDraftSaving = false,
  error,
}: EvalFormProps) {
  const [mentorReview, setMentorReview] = useState(
    review.mentor_overall_review_draft ?? "",
  );
  const [rating, setRating] = useState<number | "">(
    review.mentor_performance_rating_draft ?? "",
  );

  // Baseline = the current server-side draft. Used to compute "dirty" so
  // we don't auto-save when nothing changed.
  const baselineRef = useRef({
    mentorReview: review.mentor_overall_review_draft ?? "",
    rating: (review.mentor_performance_rating_draft ?? "") as number | "",
  });

  // When Cancel/X fires, set this to skip the auto-save in the cleanup.
  const bypassAutoSaveRef = useRef(false);

  // Latest values exposed to the cleanup effect via a ref so the cleanup
  // sees the values at unmount time, not at mount time.
  const latestRef = useRef({ mentorReview, rating });
  useEffect(() => {
    latestRef.current = { mentorReview, rating };
  }, [mentorReview, rating]);

  // Re-seed when the review prop changes (different mentee).
  useEffect(() => {
    const seededReview = review.mentor_overall_review_draft ?? "";
    const seededRating = (review.mentor_performance_rating_draft ?? "") as
      | number
      | "";
    setMentorReview(seededReview);
    setRating(seededRating);
    baselineRef.current = {
      mentorReview: seededReview,
      rating: seededRating,
    };
    bypassAutoSaveRef.current = false;
  }, [
    review.id,
    review.mentor_overall_review_draft,
    review.mentor_performance_rating_draft,
  ]);

  // Auto-save-on-unmount. Captures `review.id` and `onSaveDraft` so the
  // cleanup can call into the latest references after the parent has
  // already begun unmounting.
  const reviewIdRef = useRef(review.id);
  reviewIdRef.current = review.id;
  const saveDraftRef = useRef(onSaveDraft);
  saveDraftRef.current = onSaveDraft;
  useEffect(() => {
    return () => {
      if (bypassAutoSaveRef.current) return;
      const baseline = baselineRef.current;
      const latest = latestRef.current;
      const isDirty =
        latest.mentorReview !== baseline.mentorReview ||
        latest.rating !== baseline.rating;
      if (!isDirty) return;
      const save = saveDraftRef.current;
      if (!save) return;
      const payload: MentorEvalDraftPayload = {};
      payload.mentor_overall_review = latest.mentorReview;
      if (typeof latest.rating === "number") {
        payload.mentor_performance_rating = latest.rating;
      }
      // Fire-and-forget — component is unmounting; we don't await.
      void save(reviewIdRef.current, payload);
    };
  }, []);

  const allFilled =
    mentorReview.trim().length > 0 && typeof rating === "number";

  const closeWithoutAutoSave = () => {
    bypassAutoSaveRef.current = true;
    onClose();
  };

  const handleSubmit = async () => {
    if (typeof rating !== "number") return;
    bypassAutoSaveRef.current = true; // submit replaces the draft anyway
    await onSubmit(review.id, {
      mentor_overall_review: mentorReview,
      mentor_performance_rating: rating,
    });
  };

  const handleSaveDraft = async () => {
    if (!onSaveDraft) return;
    const payload: MentorEvalDraftPayload = {};
    payload.mentor_overall_review = mentorReview;
    if (typeof rating === "number") {
      payload.mentor_performance_rating = rating;
    }
    await onSaveDraft(review.id, payload);
    // Reset baseline so subsequent auto-save only fires on further edits.
    baselineRef.current = { mentorReview, rating };
  };

  return (
    <>
      {/* ── Header ── */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
        <div>
          <h2 className="font-display text-base font-semibold text-text-main">
            Evaluate · {review.employee_name}
          </h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {formatFyLabel(review.cycle_name)} · Review the self-review and
            record your overall assessment.
          </p>
        </div>
        <button
          type="button"
          onClick={closeWithoutAutoSave}
          className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors"
          aria-label="Close"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden px-6 py-5 space-y-6">
        {error && (
          <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
            {error}
          </p>
        )}

        <PerformanceRatingSelect
          id="mentor-rating"
          label="Overall Rating"
          value={rating}
          onChange={setRating}
        />

        <div className="rounded-lg border border-border overflow-hidden">
          <div className="bg-slate-50 px-4 py-2 border-b border-border">
            <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
              Employee's Self Review
            </p>
          </div>
          <div className="p-4">
            <p className="text-sm text-text-main whitespace-pre-wrap">
              {review.self_overall_review || "—"}
            </p>
          </div>
        </div>

        <div>
          <label
            htmlFor="mentor-overall-review"
            className="block text-xs font-semibold text-text-main mb-1"
          >
            Your Overall Review *
          </label>
          <p className="text-xs text-text-muted mb-2">
            Summarise the year for this mentee — strengths, areas for growth,
            and your overall assessment.
          </p>
          <textarea
            id="mentor-overall-review"
            rows={10}
            className={TEXTAREA_CLS}
            value={mentorReview}
            onChange={(e) => setMentorReview(e.target.value)}
            placeholder={`Your evaluation of ${review.employee_name}'s year…`}
          />
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="flex justify-end gap-3 border-t border-border px-6 py-4 shrink-0">
        <button
          type="button"
          onClick={closeWithoutAutoSave}
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
          {isSaving ? "Submitting…" : "Submit Evaluation"}
        </button>
      </div>
    </>
  );
}
