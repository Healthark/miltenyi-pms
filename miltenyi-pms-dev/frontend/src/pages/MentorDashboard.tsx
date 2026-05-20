/**
 * MentorDashboard — landing page for users with one or more direct
 * mentees. Cards on this page are scoped to the mentor's relationship
 * with their mentees, not the mentor's own employee data — mentors in
 * this org structure do not maintain their own goals or annual review,
 * so the personal "My Goals" / "My Review" / "My Action Items" widgets
 * that the Employee dashboard renders are deliberately omitted.
 *
 * Layout:
 *   Row 1: Active Project Cycle | Active Goal Cycle    — cycle anchors,
 *          identical to the Mentee/Employee dashboard's top row.
 *   Row 2: Mentee Goal Funnel | Mentee Annual Review   — HR-style donut
 *          cards aggregated across every mentee. Surface where work
 *          sits in the approval / evaluation pipeline.
 *   Row 3: My Mentees                                  — mentee count tile.
 *
 * Owns two fetches at the page level:
 *   /dashboard/summary  → DashboardSummary  (drives the cycle cards and
 *                          the mentee count tile)
 *   /mentees/summary    → MenteeSummary[]   (drives both funnel cards)
 *
 * Each card receives either its loaded slice or null and renders its
 * own skeleton in place — the grid is stable from first paint.
 */

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useAuth } from "@/hooks/useAuth";
import { useSnackbar } from "@/hooks/useSnackbar";
import { dashboardService } from "@/services/dashboard.service";
import { menteeService } from "@/services/mentee.service";
import { getErrorMessage } from "@/utils/errors";
import { ActiveCycleWidget } from "@/components/dashboard/ActiveCycleWidget";
import { MenteesWidget } from "@/components/dashboard/MenteesWidget";
import { MenteeGoalFunnelCard } from "@/components/dashboard/MenteeGoalFunnelCard";
import { MenteeReviewFunnelCard } from "@/components/dashboard/MenteeReviewFunnelCard";
import { DashboardAlerts } from "@/components/dashboard/DashboardAlerts";

export function MentorDashboard() {
  const { user } = useAuth();
  const snackbar = useSnackbar();

  // Two independent queries — they run in parallel (TanStack Query does
  // not serialise them). Both share global defaults from queryClient
  // (30s staleTime, 5min gcTime, refetch-on-focus).
  //
  // Note ['dashboard', 'summary'] matches EmployeeDashboard's key on purpose:
  // a Mentor who also lands on /dashboard sees the same cached entry,
  // and any future mutation that invalidates ['dashboard'] refreshes
  // BOTH variants at once.
  const { data: summary, error: summaryError } = useQuery({
    queryKey: queryKeys.dashboard.summary(),
    queryFn: dashboardService.getSummary,
  });

  const { data: mentees, error: menteesError } = useQuery({
    queryKey: queryKeys.mentees.summaries(),
    queryFn: menteeService.getSummaries,
  });

  // One snackbar effect per query: keeps each query's error surfacing
  // independent. If both queries fail in the same render, both toasts
  // fire — which is what the user wants (they need to know both
  // resources are broken, not just whichever errored first).
  useEffect(() => {
    if (summaryError) snackbar.error(getErrorMessage(summaryError));
  }, [summaryError, snackbar]);

  useEffect(() => {
    if (menteesError) snackbar.error(getErrorMessage(menteesError));
  }, [menteesError, snackbar]);

  const firstName = user?.full_name?.split(" ")[0] ?? "there";

  return (
    <div className="space-y-6">
      {/* State-derived alert banners (paused submissions, hidden
          ratings, cycle rollover dismiss). */}
      <DashboardAlerts />

      {/* Header */}
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">
          Welcome back, {firstName}
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">
          Where your mentees stand on goals and reviews.
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
      {/* useQuery returns `undefined` for not-yet-loaded data; the
          widgets predate the migration and were typed for `null` as
          their loading sentinel. The `?? null` here is the smallest
          possible bridge — fixing it "properly" means changing every
          dashboard widget's prop type, which is a follow-up cleanup. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <MenteeGoalFunnelCard mentees={mentees ?? null} />
        <MenteeReviewFunnelCard mentees={mentees ?? null} />
      </div>

      {/* Row 3: My Mentees count */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
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
