/**
 * MentorDashboard — landing page for Mentors (and anyone with direct
 * mentees). Cards are scoped to the mentor's mentees, not the mentor's own
 * records — mentors do not keep annual goals or an annual review of their
 * own, so the personal cards of the staff dashboard are left out.
 *
 *   Row 1: Cycles (goal year · current quarter · annual half) | Team Project Goals
 *   Row 2: Mentee Goal Approvals | Mentee Annual Reviews
 *   Row 3: My Mentees
 *
 * Fetches: /dashboard/summary (cycle, mentee count), /mentees/summary
 * (annual funnels) and, for Project Goals orgs, /project-goals/period and
 * /project-goals/team for the current quarter — the same rows the Team
 * Goals queue renders.
 */

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useAuth } from "@/hooks/useAuth";
import { useSnackbar } from "@/hooks/useSnackbar";
import { dashboardService } from "@/services/dashboard.service";
import { menteeService } from "@/services/mentee.service";
import { projectGoalsService } from "@/services/project-goals.service";
import { getErrorMessage } from "@/utils/errors";
import {
  ActiveCyclesCard,
  LEGACY_BLOCKS,
  LEGACY_BLOCKS_WITH_PROJECT_REVIEWS,
  PROJECT_GOALS_BLOCKS,
} from "@/components/dashboard/ActiveCyclesCard";
import { MenteesWidget } from "@/components/dashboard/MenteesWidget";
import { MenteeGoalFunnelCard } from "@/components/dashboard/MenteeGoalFunnelCard";
import { MenteeReviewFunnelCard } from "@/components/dashboard/MenteeReviewFunnelCard";
import { TeamProjectGoalsCard } from "@/components/dashboard/TeamProjectGoalsCard";

export function MentorDashboard() {
  const { user, hasFeature } = useAuth();
  const snackbar = useSnackbar();
  const projectGoalsOn = hasFeature("project_goals");
  const projectReviewsOn = hasFeature("project_reviews");

  // ['dashboard', 'summary'] is shared with the staff dashboard on purpose:
  // one cache entry, one invalidation.
  const { data: summary, error: summaryError } = useQuery({
    queryKey: queryKeys.dashboard.summary(),
    queryFn: dashboardService.getSummary,
  });

  const { data: mentees, error: menteesError } = useQuery({
    queryKey: queryKeys.mentees.summaries(),
    queryFn: menteeService.getSummaries,
  });

  const { data: period, error: periodError } = useQuery({
    queryKey: queryKeys.projectGoals.period(),
    queryFn: () => projectGoalsService.getPeriod(),
    enabled: projectGoalsOn,
  });

  const { data: team, error: teamError } = useQuery({
    queryKey: queryKeys.projectGoals.team(),
    queryFn: () => projectGoalsService.getTeam(),
    enabled: projectGoalsOn,
  });

  useEffect(() => {
    if (summaryError) snackbar.error(getErrorMessage(summaryError));
  }, [summaryError, snackbar]);

  useEffect(() => {
    if (menteesError) snackbar.error(getErrorMessage(menteesError));
  }, [menteesError, snackbar]);

  useEffect(() => {
    if (periodError) snackbar.error(getErrorMessage(periodError));
  }, [periodError, snackbar]);

  useEffect(() => {
    if (teamError) snackbar.error(getErrorMessage(teamError));
  }, [teamError, snackbar]);

  const firstName = user?.full_name?.split(" ")[0] ?? "there";
  const blocks = projectGoalsOn ? PROJECT_GOALS_BLOCKS : projectReviewsOn ? LEGACY_BLOCKS_WITH_PROJECT_REVIEWS : LEGACY_BLOCKS;
  // undefined while loading, null when no goal year is active
  const pgPeriod = projectGoalsOn ? period : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">Welcome back, {firstName}</h1>
        <p className="mt-0.5 text-sm text-text-muted">Where your mentees stand on project goals, annual goals and reviews.</p>
      </div>

      {/* Row 1: where are we now | the Project Goals queue at a glance */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {summary ? <ActiveCyclesCard activeCycle={summary.active_cycle} period={pgPeriod} blocks={blocks} /> : <CardSkeleton />}
        {projectGoalsOn ? (
          <TeamProjectGoalsCard rows={team ?? null} period={pgPeriod} viewerIsHr={user?.role === "Admin"} />
        ) : summary ? (
          <MenteesWidget summary={summary} />
        ) : (
          <CardSkeleton />
        )}
      </div>

      {/* Row 2: the annual stream, aggregated across every mentee.
          `?? null` bridges useQuery's undefined to the widgets' null sentinel. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <MenteeGoalFunnelCard mentees={mentees ?? null} />
        <MenteeReviewFunnelCard mentees={mentees ?? null} />
      </div>

      {/* Row 3: My Mentees count (already in row 1 for orgs without Project Goals) */}
      {projectGoalsOn && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {summary ? <MenteesWidget summary={summary} /> : <CardSkeleton />}
        </div>
      )}
    </div>
  );
}

// Generic per-card skeleton matching the loaded widgets' surface + padding.
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
