/**
 * GoalSelfReviewModal.tsx — Owner's (or mentor-view) reflection form for
 * a single half (H1 / H2) of an approved annual goal.
 *
 * Form shape mirrors the Annual Review self-appraisal: one freeform
 * paragraph capturing the reflection. Above the textarea, two collapsible
 * panels surface the role expectations for **Firm Growth** and **Competency
 * & Skills** as a reference rubric — scoped to whichever role the *goal
 * owner* holds:
 *   - readOnly=false (mentee filling their own self-review):
 *       fetch via /users/me/expectations.
 *   - readOnly=true  (mentor viewing the mentee's submission):
 *       fetch all org role expectations and filter by the goal owner's
 *       department + designation injected on the goal payload.
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { ClipboardCheck, Send, Loader2, Save, X } from "lucide-react";
import type {
  Goal,
  GoalSelfReviewPayload,
  SelfReviewCycleHalf,
} from "../../services/goal.service";
import {
  profileService,
  type UserRoleExpectation,
} from "../../services/profile.service";
import {
  projectReviewService,
  type RoleExpectation,
} from "../../services/project-review.service";
import { ExpectationPanel } from "../project-reviews/ExpectationPanel";
import { formatFyYearSpan } from "../../utils/fy";
import { getOwnerRole, getOwnerName } from "../../utils/goalOwner";
import { halfDisplayLabel } from "../../utils/goalStatus";
import { useSystemSettings } from "../../hooks/useSystemSettings";

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";

function cycleLabel(
  goal: Goal,
  cycleHalf: SelfReviewCycleHalf,
  cycleType: string | null,
): string {
  // "H1/Q1 FY 2026-27" — display token varies with org cycle_type.
  const display = halfDisplayLabel(cycleHalf, cycleType);
  return goal.fy_year
    ? `${display} ${formatFyYearSpan(goal.fy_year)}`
    : display;
}

/** Adapt the /users/me/expectations payload into the shape ExpectationPanel
 *  expects (it shares its interface with the Project Review forms). */
function asRoleExpectation(u: UserRoleExpectation | null): RoleExpectation | null {
  if (!u) return null;
  return {
    id: 0,
    department_name: u.department_name ?? "",
    designation_name: u.designation_name ?? "",
    exp_task_execution: u.exp_task_execution,
    exp_ownership: u.exp_ownership,
    exp_project_management: u.exp_project_management,
    exp_client_deliverables: u.exp_client_deliverables,
    exp_communication: u.exp_communication,
    exp_mentoring: u.exp_mentoring,
    exp_firm_growth: u.exp_firm_growth,
    exp_competency_skills: u.exp_competency_skills,
  };
}

// ── Props ───────────────────────────────────────────────────────────

interface GoalSelfReviewModalProps {
  readonly isOpen: boolean;
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

export function GoalSelfReviewModal({
  isOpen,
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
  const { settings } = useSystemSettings();
  const cycleType = settings?.cycle_type ?? null;

  const existing =
    goal && cycleHalf
      ? goal.self_reviews.find((sr) => sr.cycle_half === cycleHalf) ?? null
      : null;

  // A draft row is editable; only a fully-submitted row locks the modal.
  const isLocked = readOnly || (existing !== null && !existing.is_draft);
  const isDraft = existing !== null && existing.is_draft;

  const [overall, setOverall] = useState("");
  // Fetched only when readOnly=false (mentee writing their own review).
  const [myExpectation, setMyExpectation] = useState<UserRoleExpectation | null>(null);
  // Fetched only when readOnly=true (mentor viewing): all org expectations,
  // then filtered client-side by the goal owner's dept + desig.
  const [orgExpectations, setOrgExpectations] = useState<RoleExpectation[]>([]);

  // Re-seed the textarea whenever the modal opens on a different (goal, half).
  useEffect(() => {
    if (!isOpen) return;
    setOverall(existing ? existing.self_overall_review : "");
  }, [isOpen, goal?.id, cycleHalf, existing]);

  // Mentee path: fetch the *current user's* expectations.
  useEffect(() => {
    if (!isOpen || readOnly || myExpectation) return;
    let cancelled = false;
    profileService
      .getMyExpectations()
      .then((exp) => {
        if (!cancelled) setMyExpectation(exp);
      })
      .catch(() => {
        // Non-fatal: panels just won't render. The modal still works.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, readOnly, myExpectation]);

  // Mentor-view path: fetch all org expectations once; filter by goal owner.
  useEffect(() => {
    if (!isOpen || !readOnly || orgExpectations.length > 0) return;
    let cancelled = false;
    projectReviewService
      .getRoleExpectations()
      .then((rows) => {
        if (!cancelled) setOrgExpectations(rows);
      })
      .catch(() => {
        // Non-fatal — panels just won't render.
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, readOnly, orgExpectations.length]);

  if (!isOpen || !goal || !cycleHalf) return null;

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
  const title = `Self Review · ${cycleLabel(goal, cycleHalf, cycleType)}${titleSuffix}`;

  // Pick the right expectation source for the rubric panels.
  let expectationForPanel: RoleExpectation | null;
  if (readOnly) {
    const { dept, desig } = getOwnerRole(goal);
    expectationForPanel =
      dept && desig
        ? orgExpectations.find(
            (e) => e.department_name === dept && e.designation_name === desig,
          ) ?? null
        : null;
  } else {
    expectationForPanel = asRoleExpectation(myExpectation);
  }

  const expectationsHeading = readOnly
    ? `Refer to ${getOwnerName(goal)}'s role expectations`
    : "Refer to your role expectations";

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="self-review-modal-title"
    >
      <div className="w-full max-w-2xl rounded-xl bg-surface shadow-xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
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
        <div className="overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </p>
          )}

          {/* Role-expectation reference panels */}
          {expectationForPanel && (
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                {expectationsHeading}
              </p>
              <div>
                <p className="text-[11px] font-semibold text-text-main mb-0.5">
                  Firm Growth
                </p>
                <ExpectationPanel
                  expectation={expectationForPanel}
                  expKey="exp_firm_growth"
                />
              </div>
              <div>
                <p className="text-[11px] font-semibold text-text-main mb-0.5">
                  Competency &amp; Skills
                </p>
                <ExpectationPanel
                  expectation={expectationForPanel}
                  expKey="exp_competency_skills"
                />
              </div>
            </div>
          )}

          {!isLocked && (
            <p className="text-xs text-text-muted">
              Reflect on your delivery against this goal for{" "}
              <strong>{cycleLabel(goal, cycleHalf, cycleType)}</strong> in a single
              paragraph. Use the role expectations above as a guide. Once
              submitted, your mentor will review this entry.
            </p>
          )}

          {readOnly && !existing && (
            <p className="rounded-lg bg-slate-50 border border-border px-4 py-3 text-sm text-text-muted">
              The mentee has not yet submitted their self-review for this half.
            </p>
          )}

          {/* Single freeform paragraph */}
          {(isLocked ? existing !== null : true) && (
            <div>
              <label
                htmlFor="goal-self-overall"
                className="block text-xs font-semibold text-text-main mb-1"
              >
                Self Review
                {!isLocked && " *"}
              </label>
              {isLocked ? (
                <div className="rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm text-text-main whitespace-pre-wrap leading-relaxed">
                  {overall || "—"}
                </div>
              ) : (
                <textarea
                  id="goal-self-overall"
                  rows={10}
                  className={INPUT_CLS}
                  value={overall}
                  onChange={(e) => setOverall(e.target.value)}
                  placeholder="Reflect on your delivery this half — what you accomplished, the impact, where you grew, and where you'd like further input."
                />
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
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
