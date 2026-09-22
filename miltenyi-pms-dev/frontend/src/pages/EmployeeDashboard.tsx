/**
 * EmployeeDashboard — landing page for Staff (and any user who is neither
 * an Admin nor a mentor). Answers "how am I doing?":
 *
 *   Row 1: Cycles (goal year · current quarter · annual half) | My Mentor
 *   Row 2: Project Goals — the yearly goal set and this quarter's review
 *   Row 3: My Reviews (annual) | Annual Goals
 *
 * Fetches: /dashboard/summary (annual counts, active cycle), /users/me
 * (mentor name) and, for Project Goals orgs, /project-goals/me — the same
 * cache entry the Project Goals page uses, so the card and the page never
 * disagree. Each card renders its own skeleton so the grid is stable from
 * first paint.
 */

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useAuth } from "@/hooks/useAuth";
import { useSnackbar } from "@/hooks/useSnackbar";
import { dashboardService } from "@/services/dashboard.service";
import { profileService } from "@/services/profile.service";
import { projectGoalsService } from "@/services/project-goals.service";
import { getErrorMessage } from "@/utils/errors";
import {
  ActiveCyclesCard,
  LEGACY_BLOCKS,
  LEGACY_BLOCKS_WITH_PROJECT_REVIEWS,
  PROJECT_GOALS_BLOCKS,
} from "@/components/dashboard/ActiveCyclesCard";
import { GoalsWidget } from "@/components/dashboard/GoalsWidget";
import { MyAnnualReviewWidget } from "@/components/dashboard/MyAnnualReviewWidget";
import { MyMentorWidget } from "@/components/dashboard/MyMentorWidget";
import { ProjectGoalsWidget } from "@/components/dashboard/ProjectGoalsWidget";

export function EmployeeDashboard() {
  const { user, hasFeature } = useAuth();
  const snackbar = useSnackbar();
  const projectGoalsOn = hasFeature("project_goals");
  // Project Reviews is retired for orgs that run Project Goals instead
  // (Miltenyi, Sep 2026); its cycle block only appears when the feature is on.
  const projectReviewsOn = hasFeature("project_reviews");

  const { data: summary, error } = useQuery({
    queryKey: queryKeys.dashboard.summary(),
    queryFn: dashboardService.getSummary,
  });

  // Mentor name for the My Mentor card. Users without a mentor get the
  // card's "No mentor assigned" empty state rather than a missing tile.
  const { data: profile, error: profileError } = useQuery({
    queryKey: queryKeys.profile.me(),
    queryFn: profileService.getProfile,
  });

  const { data: mine, error: mineError } = useQuery({
    queryKey: queryKeys.projectGoals.mine(),
    queryFn: () => projectGoalsService.getMine(),
    enabled: projectGoalsOn,
  });

  useEffect(() => {
    if (error) snackbar.error(getErrorMessage(error));
  }, [error, snackbar]);

  useEffect(() => {
    if (profileError) snackbar.error(getErrorMessage(profileError));
  }, [profileError, snackbar]);

  useEffect(() => {
    if (mineError) snackbar.error(getErrorMessage(mineError));
  }, [mineError, snackbar]);

  const firstName = user?.full_name?.split(" ")[0] ?? "there";
  const blocks = projectGoalsOn ? PROJECT_GOALS_BLOCKS : projectReviewsOn ? LEGACY_BLOCKS_WITH_PROJECT_REVIEWS : LEGACY_BLOCKS;
  // undefined while /project-goals/me loads, null when no goal year is active
  const period = projectGoalsOn ? (mine === undefined ? undefined : mine.period) : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">Welcome back, {firstName}</h1>
        <p className="mt-0.5 text-sm text-text-muted">Your project goals, annual goals and reviews at a glance.</p>
      </div>

      {/* Row 1: where are we now | who you report to */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {summary ? <ActiveCyclesCard activeCycle={summary.active_cycle} period={period} blocks={blocks} /> : <CardSkeleton />}
        <MyMentorWidget profile={profile ?? null} />
      </div>

      {/* Row 2: Project Goals — the year's goal set and this quarter's review */}
      {projectGoalsOn && <ProjectGoalsWidget data={mine ?? null} />}

      {/* Row 3: the annual stream */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {summary ? <MyAnnualReviewWidget summary={summary} /> : <CardSkeleton />}
        {summary ? <GoalsWidget summary={summary} /> : <CardSkeleton />}
      </div>
    </div>
  );
}

// Same skeleton shape as the other dashboards — keeps first paint consistent.
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
