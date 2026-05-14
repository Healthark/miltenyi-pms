/**
 * MentorDashboard — landing page for users with one or more direct
 * mentees. Cards on this page are scoped to the mentor's relationship
 * with their mentees, not the mentor's own employee data — mentors in
 * this org structure do not maintain their own goals or annual review,
 * so the personal "My Goals" / "My Review" / "My Action Items" widgets
 * that the Staff dashboard renders are deliberately omitted.
 *
 * Layout:
 *   Row 1: Active Project Cycle | Active Goal Cycle    — cycle anchors,
 *          identical to the Mentee/Staff dashboard's top row.
 *   Row 2: Mentee Goal Funnel | Mentee Annual Review   — HR-style donut
 *          cards aggregated across every mentee. Surface where work
 *          sits in the approval / evaluation pipeline.
 *   Row 3: Pending Mentor Work (col-span-2) | My Mentees  — focused
 *          action list + the mentee count tile.
 *
 * Owns two fetches at the page level:
 *   /dashboard/summary  → DashboardSummary  (drives the cycle cards and
 *                          the mentor-only fields on PendingMentorWork)
 *   /mentees/summary    → MenteeSummary[]   (drives both funnel cards)
 *
 * Each card receives either its loaded slice or null and renders its
 * own skeleton in place — the grid is stable from first paint.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSnackbar } from "@/hooks/useSnackbar";
import {
  dashboardService,
  type DashboardSummary,
} from "@/services/dashboard.service";
import {
  menteeService,
  type MenteeSummary,
} from "@/services/mentee.service";
import { getErrorMessage } from "@/utils/errors";
import { ActiveCycleWidget } from "@/components/dashboard/ActiveCycleWidget";
import { PendingMentorWorkWidget } from "@/components/dashboard/PendingMentorWorkWidget";
import { MenteesWidget } from "@/components/dashboard/MenteesWidget";
import { MenteeGoalFunnelCard } from "@/components/dashboard/MenteeGoalFunnelCard";
import { MenteeReviewFunnelCard } from "@/components/dashboard/MenteeReviewFunnelCard";

export function MentorDashboard() {
  const { user } = useAuth();
  const snackbar = useSnackbar();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [mentees, setMentees] = useState<MenteeSummary[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    dashboardService
      .getSummary()
      .then((res) => {
        if (!cancelled) setSummary(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) snackbar.error(getErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [snackbar]);

  useEffect(() => {
    let cancelled = false;
    menteeService
      .getSummaries()
      .then((res) => {
        if (!cancelled) setMentees(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) snackbar.error(getErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [snackbar]);

  const firstName = user?.full_name?.split(" ")[0] ?? "there";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">
          Welcome back, {firstName}
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">
          Where your mentees stand on goals, reviews, and what's owed to you.
        </p>
      </div>

      {/* Row 1: Active Project Cycle | Active Goal Cycle */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {summary ? (
          <ActiveCycleWidget
            activeCycle={summary.active_cycle}
            variant="project"
          />
        ) : (
          <CardSkeleton />
        )}
        {summary ? (
          <ActiveCycleWidget
            activeCycle={summary.active_cycle}
            variant="goal"
          />
        ) : (
          <CardSkeleton />
        )}
      </div>

      {/* Row 2: Mentee Goal Funnel | Mentee Annual Review Funnel */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <MenteeGoalFunnelCard mentees={mentees} />
        <MenteeReviewFunnelCard mentees={mentees} />
      </div>

      {/* Row 3: Pending Mentor Work (col-span-2) | My Mentees count */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="xl:col-span-2">
          {summary ? (
            <PendingMentorWorkWidget summary={summary} />
          ) : (
            <CardSkeleton />
          )}
        </div>
        {summary ? <MenteesWidget summary={summary} /> : <CardSkeleton />}
      </div>
    </div>
  );
}

// Generic per-card skeleton matching the surface + padding of the
// loaded widgets, so the grid doesn't reflow when data lands.
function CardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4 animate-pulse h-44">
      <div className="flex items-center gap-2">
        <div className="h-9 w-9 rounded-lg bg-slate-100" />
        <div className="space-y-1.5">
          <div className="h-2.5 w-24 rounded bg-slate-100" />
          <div className="h-4 w-12 rounded bg-slate-100" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-3 w-3/4 rounded bg-slate-100" />
        <div className="h-3 w-2/3 rounded bg-slate-100" />
        <div className="h-3 w-1/2 rounded bg-slate-100" />
      </div>
    </div>
  );
}
