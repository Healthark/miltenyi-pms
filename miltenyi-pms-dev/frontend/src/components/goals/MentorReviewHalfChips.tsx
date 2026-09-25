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
 *   - Mentee hasn't submitted yet     → outline "Draft H1 review" while the half's
 *                                       window is open (submit waits for the
 *                                       self-review; 25 Sep 2026), else grey
 *                                       "H1 · Not open" (disabled)
 *
 * Clicking any enabled chip fires `onSelect(half)` so the parent can
 * open the GoalMentorReviewModal in the right mode.
 */

import { Check, ArrowRight, Clock, Edit3 } from "lucide-react";
import type { Goal, SelfReviewCycleHalf } from "@/services/goal.service";
import { cycleKeysForType, halfDisplayLabel, isHalfWindowOpen } from "@/utils/goalStatus";
import { useSystemSettings } from "@/hooks/useSystemSettings";

interface MentorReviewHalfChipsProps {
  readonly goal: Goal;
  readonly onSelect: (cycleHalf: SelfReviewCycleHalf) => void;
}

export function MentorReviewHalfChips({
  goal,
  onSelect,
}: MentorReviewHalfChipsProps) {
  const cycles = cycleKeysForType();
  const { settings } = useSystemSettings();
  const fiscalStartMonth = settings?.fiscal_start_month ?? 4;
  const today = settings?.simulated_today ? new Date(settings.simulated_today) : new Date();

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

        // State 2: Mentor has a draft — resume it whether or not the self-review is in.
        if (mentorDraft) {
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

        // State 4: Mentee hasn't submitted yet — the mentor can still draft
        // while the half's window is open; submit unlocks once the
        // self-review arrives.
        if (isHalfWindowOpen(half, goal.fy_year, fiscalStartMonth, today)) {
          return (
            <button
              key={half}
              type="button"
              onClick={() => onSelect(half)}
              title={`${label} self-review not in yet — draft now; submit unlocks once it arrives`}
              className="flex items-center gap-1 rounded-md border border-brand/40 bg-white px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand/10 transition-colors"
            >
              <Edit3 className="h-3 w-3" aria-hidden="true" />
              Draft {label} review
            </button>
          );
        }
        // State 5: the half's window is not open (or the goal has no year).
        return (
          <span
            key={half}
            title={`The ${label} review window is not open yet`}
            className="flex items-center gap-1 rounded-md border border-border bg-slate-50 px-2 py-1 text-[11px] font-medium text-text-muted cursor-not-allowed"
          >
            <Clock className="h-3 w-3" aria-hidden="true" />
            {label} · Not open
          </span>
        );
      })}
    </div>
  );
}
