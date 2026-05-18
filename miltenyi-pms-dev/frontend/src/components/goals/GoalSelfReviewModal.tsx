/**
 * GoalSelfReviewModal.tsx — Owner's (or mentor-view) reflection form for
 * a single half (H1 / H2) of an approved annual goal.
 *
 * Form shape mirrors the Annual Review self-appraisal: one freeform
 * paragraph capturing the reflection.
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import { ClipboardCheck, Send, Loader2, Save, X } from "lucide-react";
import type {
  Goal,
  GoalSelfReviewPayload,
  SelfReviewCycleHalf,
} from "@/services/goal.service";
import { formatFyYearSpan } from "@/utils/fy";
import { halfDisplayLabel } from "@/utils/goalStatus";

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";

const SELF_REVIEW_MAX = 5000;

function cycleLabel(
  goal: Goal,
  cycleHalf: SelfReviewCycleHalf,
): string {
  // "H1 FY 2026-27" — goal cadence is uniformly half-yearly.
  const display = halfDisplayLabel(cycleHalf);
  return goal.fy_year
    ? `${display} ${formatFyYearSpan(goal.fy_year)}`
    : display;
}

// ── Props ───────────────────────────────────────────────────────────

interface GoalSelfReviewModalProps {
  readonly goal: Goal | null;
  readonly cycleHalf: SelfReviewCycleHalf | null;
  readonly onClose: () => void;
  readonly onSubmit: (
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalSelfReviewPayload,
  ) => Promise<void>;
  /** Save-as-draft handler. Optional — when omitted (e.g. read-only mentor
   *  view), the Save Draft button is hidden. */
  readonly onSaveDraft?: (
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalSelfReviewPayload,
  ) => Promise<void>;
  readonly isSaving: boolean;
  readonly isDraftSaving?: boolean;
  readonly error: string;
  /** Force the modal into view-only mode (mentor viewing mentee's entry). */
  readonly readOnly?: boolean;
}

// ── Component ───────────────────────────────────────────────────────

/**
 * The parent conditionally mounts this modal when (goal, cycleHalf) are
 * both non-null, so each open is a fresh React mount — useState
 * initializers run with the right `existing` review and we don't need
 * an effect to re-seed the textarea.
 */
export function GoalSelfReviewModal({
  goal,
  cycleHalf,
  onClose,
  onSubmit,
  onSaveDraft,
  isSaving,
  isDraftSaving = false,
  error,
  readOnly = false,
}: GoalSelfReviewModalProps) {
  const existing =
    goal && cycleHalf
      ? goal.self_reviews.find((sr) => sr.cycle_half === cycleHalf) ?? null
      : null;

  // A draft row is editable; only a fully-submitted row locks the modal.
  const isLocked = readOnly || (existing !== null && !existing.is_draft);
  const isDraft = existing !== null && existing.is_draft;

  const [overall, setOverall] = useState(() =>
    existing ? existing.self_overall_review : "",
  );

  if (!goal || !cycleHalf) return null;

  const allFilled = overall.trim().length > 0;

  const handleSubmit = async () => {
    await onSubmit(cycleHalf, { self_overall_review: overall.trim() });
  };

  const handleSaveDraft = async () => {
    if (!onSaveDraft) return;
    await onSaveDraft(cycleHalf, { self_overall_review: overall });
  };

  const titleSuffix = readOnly
    ? " (View)"
    : isLocked
      ? " (Submitted)"
      : isDraft
        ? " (Draft)"
        : "";
  const title = `Self Review · ${cycleLabel(goal, cycleHalf)}${titleSuffix}`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="self-review-modal-title"
    >
      <div className="w-full max-w-2xl rounded-xl bg-surface shadow-xl flex flex-col h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light">
              <ClipboardCheck
                className="h-5 w-5 text-brand"
                aria-hidden="true"
              />
            </div>
            <div>
              <h2
                id="self-review-modal-title"
                className="font-display text-base font-semibold text-text-main"
              >
                {title}
              </h2>
              <p className="mt-0.5 text-xs text-text-muted">{goal.title}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-slate-100 transition-colors"
            aria-label="Close self-review"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 flex-col gap-4 overflow-hidden px-6 py-5 min-h-0">
          {error && (
            <p className="shrink-0 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </p>
          )}

          {!isLocked && (
            <p className="shrink-0 text-xs text-text-muted">
              Reflect on your delivery against this goal for{" "}
              <strong>{cycleLabel(goal, cycleHalf)}</strong> in a single
              paragraph. Once submitted, your mentor will review this entry.
            </p>
          )}

          {readOnly && !existing && (
            <p className="shrink-0 rounded-lg bg-slate-50 border border-border px-4 py-3 text-sm text-text-muted">
              The mentee has not yet submitted their self-review for this half.
            </p>
          )}

          {/* Single freeform paragraph */}
          {(isLocked ? existing !== null : true) && (
            <div className="flex flex-1 flex-col min-h-0">
              <label
                htmlFor="goal-self-overall"
                className="block text-xs font-semibold text-text-main mb-1 shrink-0"
              >
                Self Review
                {!isLocked && " *"}
              </label>
              {isLocked ? (
                <div className="flex-1 overflow-y-auto rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm text-text-main whitespace-pre-wrap leading-relaxed">
                  {overall || "—"}
                </div>
              ) : (
                <>
                  <textarea
                    id="goal-self-overall"
                    maxLength={SELF_REVIEW_MAX}
                    className={`${INPUT_CLS} flex-1 min-h-0`}
                    value={overall}
                    onChange={(e) => setOverall(e.target.value)}
                    placeholder="Reflect on your delivery this half — what you accomplished, the impact, where you grew, and where you'd like further input."
                  />
                  <div
                    className={`mt-1 shrink-0 text-right text-xs ${
                      overall.length >= SELF_REVIEW_MAX
                        ? "text-red-600"
                        : "text-text-muted"
                    }`}
                  >
                    {overall.length.toLocaleString()} /{" "}
                    {SELF_REVIEW_MAX.toLocaleString()}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4 shrink-0">
          <p className="text-xs text-text-muted">
            {isLocked
              ? "Self-review is locked once submitted."
              : isDraft
                ? "Draft saved — keep editing or submit when ready."
                : "Drafts can be saved and edited; submit when ready."}
          </p>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
            >
              {isLocked ? "Close" : "Cancel"}
            </button>
            {!isLocked && onSaveDraft && (
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
            {!isLocked && (
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
                {isSaving ? "Submitting…" : "Submit Self Review"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
