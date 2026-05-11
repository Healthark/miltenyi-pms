/**
 * MentorReviewHalfChips.tsx — Per-half action chips for the mentor's
 * row in the Team Goals tab.
 *
 * Replaces the older "Self Reviews (1/2)" dropdown, which buried the
 * action behind an ambiguous label. Each half (H1, H2) renders as its
 * own chip whose colour, icon, and verb reflect the exact state the
 * mentor is in:
 *
 *   - Mentor already reviewed         → green "✓ H1 Reviewed" (click to view)
 *   - Mentor has a draft saved        → amber "Resume H1 · Draft"
 *   - Mentee submitted, mentor hasn't → brand "Review H1 →"
 *   - Mentee hasn't submitted yet     → grey  "H1 · Awaiting self-review" (disabled)
 *
 * Clicking any enabled chip fires `onSelect(half)` so the parent can
 * open the GoalMentorReviewModal in the right mode.
 */

import { Check, ArrowRight, Clock, Edit3 } from "lucide-react";
import type { Goal, SelfReviewCycleHalf } from "@/services/goal.service";
import { cycleKeysForType, halfDisplayLabel } from "@/utils/goalStatus";

interface MentorReviewHalfChipsProps {
  readonly goal: Goal;
  readonly onSelect: (cycleHalf: SelfReviewCycleHalf) => void;
}

export function MentorReviewHalfChips({
  goal,
  onSelect,
}: MentorReviewHalfChipsProps) {
  const cycles = cycleKeysForType();

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {cycles.map((half) => {
        const label = halfDisplayLabel(half);
        const selfRow = goal.self_reviews.find((sr) => sr.cycle_half === half);
        const selfSubmitted = selfRow !== undefined && !selfRow.is_draft;
        const mentorRow = goal.mentor_reviews.find(
          (mr) => mr.cycle_half === half,
        );
        const mentorReviewed = mentorRow !== undefined && !mentorRow.is_draft;
        const mentorDraft = mentorRow !== undefined && mentorRow.is_draft;

        // State 1: Mentor review already submitted — click to view.
        if (mentorReviewed) {
          return (
            <button
              key={half}
              type="button"
              onClick={() => onSelect(half)}
              title="Mentor review submitted — click to view"
              className="flex items-center gap-1 rounded-md border border-green-200 bg-green-50 px-2 py-1 text-[11px] font-medium text-green-700 hover:bg-green-100 transition-colors"
            >
              <Check className="h-3 w-3" aria-hidden="true" />
              {label} Reviewed
            </button>
          );
        }

        // State 2: Mentor has a draft (mentee already submitted self-review).
        if (mentorDraft && selfSubmitted) {
          return (
            <button
              key={half}
              type="button"
              onClick={() => onSelect(half)}
              title="Mentor review draft — click to resume"
              className="flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100 transition-colors"
            >
              <Edit3 className="h-3 w-3" aria-hidden="true" />
              Resume {label} · Draft
            </button>
          );
        }

        // State 3: Mentee submitted self-review, mentor hasn't reviewed yet.
        if (selfSubmitted) {
          return (
            <button
              key={half}
              type="button"
              onClick={() => onSelect(half)}
              className="flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand hover:text-white transition-colors"
            >
              Review {label}
              <ArrowRight className="h-3 w-3" aria-hidden="true" />
            </button>
          );
        }

        // State 4: Mentee hasn't submitted yet — disabled chip with tooltip.
        return (
          <span
            key={half}
            title="Mentee hasn't submitted their self-review for this half yet"
            className="flex items-center gap-1 rounded-md border border-border bg-slate-50 px-2 py-1 text-[11px] font-medium text-text-muted cursor-not-allowed"
          >
            <Clock className="h-3 w-3" aria-hidden="true" />
            {label} · Awaiting self-review
          </span>
        );
      })}
    </div>
  );
}
