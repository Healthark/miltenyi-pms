/**
 * GoalMentorReviewModal.tsx — Split-panel modal for mentor review of a mentee's
 * self-review, simplified to a single paragraph each side.
 *
 * Layout:
 *   Top (full-width)  — collapsible role-expectation panels for Firm Growth
 *                       and Competency & Skills, scoped to the mentee's
 *                       (goal owner's) department × designation.
 *   Left panel        — read-only display of the mentee's self-review paragraph.
 *   Right panel       — mentor fills a single paragraph (or views read-only
 *                       when a mentor review already exists for this half).
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import {
  ClipboardCheck,
  Send,
  Loader2,
  Save,
  X,
  User,
  MessageSquarePlus,
} from "lucide-react";
import type {
  Goal,
  GoalMentorReviewPayload,
  SelfReviewCycleHalf,
} from "../../services/goal.service";
import {
  projectReviewService,
  type RoleExpectation,
} from "../../services/project-review.service";
import { ExpectationPanel } from "../project-reviews/ExpectationPanel";
import { formatFyYearSpan } from "../../utils/fy";
import { halfDisplayLabel } from "../../utils/goalStatus";
import { getOwnerRole } from "../../utils/goalOwner";
import { useSystemSettings } from "../../hooks/useSystemSettings";

const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";

function cycleLabel(
  goal: Goal,
  cycleHalf: SelfReviewCycleHalf,
  cycleType: string | null,
): string {
  const display = halfDisplayLabel(cycleHalf, cycleType);
  return goal.fy_year ? `${display} ${formatFyYearSpan(goal.fy_year)}` : display;
}

// ── Props ────────────────────────────────────────────────────────────

interface GoalMentorReviewModalProps {
  readonly isOpen: boolean;
  readonly goal: Goal | null;
  readonly cycleHalf: SelfReviewCycleHalf | null;
  readonly onClose: () => void;
  readonly onSubmit: (
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalMentorReviewPayload,
  ) => Promise<void>;
  readonly onSaveDraft?: (
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalMentorReviewPayload,
  ) => Promise<void>;
  readonly isSaving: boolean;
  readonly isDraftSaving?: boolean;
  readonly error: string;
}

// ── Component ────────────────────────────────────────────────────────

export function GoalMentorReviewModal({
  isOpen,
  goal,
  cycleHalf,
  onClose,
  onSubmit,
  onSaveDraft,
  isSaving,
  isDraftSaving = false,
  error,
}: GoalMentorReviewModalProps) {
  const { settings } = useSystemSettings();
  const cycleType = settings?.cycle_type ?? null;

  // Use the mentee's submitted self-review (drafts are owner-only).
  const selfReview =
    goal && cycleHalf
      ? goal.self_reviews.find(
          (sr) => sr.cycle_half === cycleHalf && !sr.is_draft,
        ) ?? null
      : null;

  const existingMentorReview =
    goal && cycleHalf
      ? goal.mentor_reviews.find((mr) => mr.cycle_half === cycleHalf) ?? null
      : null;

  // Mentor drafts stay editable; only a final non-draft row locks the modal.
  const isReadOnly =
    existingMentorReview !== null && !existingMentorReview.is_draft;
  const isDraft =
    existingMentorReview !== null && existingMentorReview.is_draft;

  const [overall, setOverall] = useState("");
  const [expectations, setExpectations] = useState<RoleExpectation[]>([]);

  // Re-seed the textarea whenever the modal opens on a different (goal, half).
  useEffect(() => {
    if (!isOpen) return;
    setOverall(
      existingMentorReview ? existingMentorReview.mentor_overall_review : "",
    );
  }, [isOpen, goal?.id, cycleHalf, existingMentorReview]);

  // Fetch role-expectation rows once when the modal first opens. The org
  // typically only has 9 of these; cache once and filter client-side by
  // the owner's department + designation.
  useEffect(() => {
    if (!isOpen || expectations.length > 0) return;
    let cancelled = false;
    projectReviewService
      .getRoleExpectations()
      .then((rows) => {
        if (!cancelled) setExpectations(rows);
      })
      .catch(() => {
        // Non-fatal — panels just won't render.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, expectations.length]);

  if (!isOpen || !goal || !cycleHalf) return null;

  const { dept, desig } = getOwnerRole(goal);
  const ownerExpectation: RoleExpectation | null =
    dept && desig
      ? expectations.find(
          (e) => e.department_name === dept && e.designation_name === desig,
        ) ?? null
      : null;

  const allFilled = overall.trim().length > 0;

  const handleSubmit = async () => {
    await onSubmit(cycleHalf, { mentor_overall_review: overall.trim() });
  };

  const handleSaveDraft = async () => {
    if (!onSaveDraft) return;
    await onSaveDraft(cycleHalf, { mentor_overall_review: overall });
  };

  const label = cycleLabel(goal, cycleHalf, cycleType);
  const titleSuffix = isReadOnly
    ? " (Submitted)"
    : isDraft
      ? " (Draft)"
      : "";
  const title = `Mentor Review · ${label}${titleSuffix}`;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="mentor-review-modal-title"
    >
      <div className="w-full max-w-5xl rounded-xl bg-surface shadow-xl flex flex-col max-h-[90vh]">
        {/* ── Header ── */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4 shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light shrink-0">
              <MessageSquarePlus className="h-5 w-5 text-brand" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="mentor-review-modal-title"
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
            aria-label="Close mentor review"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* ── Role-expectation reference panels (above the split) ── */}
        {ownerExpectation && (
          <div className="border-b border-border bg-blue-50/30 px-6 py-3 space-y-2 shrink-0">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Mentee role expectations
            </p>
            <div>
              <p className="text-[11px] font-semibold text-text-main mb-0.5">
                Firm Growth
              </p>
              <ExpectationPanel
                expectation={ownerExpectation}
                expKey="exp_firm_growth"
              />
            </div>
            <div>
              <p className="text-[11px] font-semibold text-text-main mb-0.5">
                Competency &amp; Skills
              </p>
              <ExpectationPanel
                expectation={ownerExpectation}
                expKey="exp_competency_skills"
              />
            </div>
          </div>
        )}

        {/* ── Body — two-panel layout ── */}
        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Left: Mentee self-review (read-only paragraph) */}
          <div className="w-1/2 border-r border-border flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-slate-50/80 shrink-0">
              <User className="h-4 w-4 text-text-muted" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                Mentee Self Review
              </span>
            </div>
            <div className="overflow-y-auto px-5 py-4">
              {selfReview === null ? (
                <div className="rounded-lg border border-border bg-slate-50 px-4 py-6 text-center text-sm text-text-muted">
                  The mentee has not submitted their self-review for this half yet.
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main whitespace-pre-wrap leading-relaxed">
                  {selfReview.self_overall_review || "—"}
                </div>
              )}
            </div>
          </div>

          {/* Right: Mentor review (editable or read-only) */}
          <div className="w-1/2 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-5 py-3 border-b border-border bg-brand/5 shrink-0">
              <ClipboardCheck className="h-4 w-4 text-brand" aria-hidden="true" />
              <span className="text-xs font-semibold uppercase tracking-wider text-brand">
                Your Review
              </span>
              {isReadOnly && (
                <span className="ml-auto text-[10px] font-medium text-green-600 bg-green-50 border border-green-200 rounded px-1.5 py-0.5">
                  Submitted
                </span>
              )}
            </div>
            <div className="overflow-y-auto px-5 py-4 space-y-3">
              {error && (
                <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
                  {error}
                </p>
              )}

              {selfReview === null && !isReadOnly && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                  You can only submit a mentor review once the mentee has
                  submitted their self-review.
                </div>
              )}

              {(selfReview !== null || isReadOnly) && (
                <div>
                  <label
                    htmlFor="mentor-overall"
                    className="block text-xs font-semibold text-text-main mb-1"
                  >
                    Your Review
                    {!isReadOnly && " *"}
                  </label>
                  {isReadOnly ? (
                    <div className="rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm text-text-main whitespace-pre-wrap leading-relaxed">
                      {overall || "—"}
                    </div>
                  ) : (
                    <textarea
                      id="mentor-overall"
                      rows={12}
                      className={TEXTAREA_CLS}
                      value={overall}
                      onChange={(e) => setOverall(e.target.value)}
                      placeholder="Your assessment of the mentee's delivery this half — what was strong, where to grow, and how it ties into Firm Growth and Competency & Skills (see expectations above)."
                    />
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Footer ── */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4 shrink-0">
          <p className="text-xs text-text-muted">
            {isReadOnly
              ? "Mentor review is locked once submitted."
              : selfReview === null
                ? "Waiting for mentee self-review."
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
              {isReadOnly ? "Close" : "Cancel"}
            </button>
            {!isReadOnly && selfReview !== null && onSaveDraft && (
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
            {!isReadOnly && selfReview !== null && (
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
                {isSaving ? "Submitting…" : "Submit Review"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
