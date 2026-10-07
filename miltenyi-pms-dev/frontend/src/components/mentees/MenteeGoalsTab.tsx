/**
 * MenteeGoalsTab — the mentee page's Annual Goals tab (7 Oct 2026).
 *
 * Shows the same one-row table the mentor works on under Annual Goals: one
 * goal per year, approve or request changes, and the half's mentor review.
 * The page's year picker decides which years are shown; with "All years"
 * each year's goal is listed, newest first.
 */
import { Target } from "lucide-react";
import type { TeamGoal } from "@/services/goal.service";
import { AnnualGoalSheet } from "@/components/annual-goals/AnnualGoalSheet";
import { goalOfYear } from "@/components/annual-goals/helpers";

interface MenteeGoalsTabProps {
  /** The mentee's annual goals, already narrowed by the page's year picker. */
  readonly goals: TeamGoal[];
  readonly menteeName: string;
  /** Kept for the page's call site; the sheet loads and refreshes its own data. */
  readonly menteeId: number;
}

export function MenteeGoalsTab({ goals, menteeName }: MenteeGoalsTabProps) {
  const years = Array.from(new Set(goals.map((g) => g.fy_year))).sort((a, b) => (b ?? 0) - (a ?? 0));
  const shown = years
    .map((y) => goalOfYear(goals, y).goal)
    .filter((g): g is TeamGoal => g !== null);

  if (shown.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-14 text-center">
        <Target className="mb-3 h-10 w-10 text-text-muted" aria-hidden="true" />
        <p className="font-display text-base font-medium text-text-main">No annual goal for this year yet</p>
        <p className="mt-1 text-sm text-text-muted">{menteeName} writes it on the Annual Goals page.</p>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      {shown.map((g) => (
        <AnnualGoalSheet key={g.id} goalId={g.id} />
      ))}
    </div>
  );
}
