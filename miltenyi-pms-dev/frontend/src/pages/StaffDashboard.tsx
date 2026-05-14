/**
 * StaffDashboard — landing page for Staff, PM, and any role without
 * direct mentees. Answers the two recurring employee questions:
 *
 *   "What do I owe?"   → S1 My Action Items.
 *   "How am I doing?"  → S3 My Annual Goals (funnel + completion),
 *                        S4 My Annual Review.
 *
 * Two cycle cards anchor the page at the top so the rest of the
 * numbers read against the right time horizon:
 *   - Active Project Cycle (left)  — H1/H2/Q1..Q4, used by project reviews.
 *   - Active Goal Cycle (right)    — FY span, used by annual goals.
 *
 * PMs land here too: their pending project-review queue surfaces inside
 * ActionItemsWidget via DashboardSummary.project_reviews_pending_primary
 * — no PM-specific card is needed. A PM who also mentors gets routed to
 * MentorDashboard instead (see Dashboard.tsx).
 *
 * Owns one fetch (/dashboard/summary) and passes the result to each
 * widget. Skeletons render in place per card so the grid is stable
 * from first paint.
 */

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { useAuth } from "@/hooks/useAuth";
import { useSnackbar } from "@/hooks/useSnackbar";
import { dashboardService } from "@/services/dashboard.service";
import { getErrorMessage } from "@/utils/errors";
import { ActionItemsWidget } from "@/components/dashboard/ActionItemsWidget";
import { ActiveCycleWidget } from "@/components/dashboard/ActiveCycleWidget";
import { DashboardAlerts } from "@/components/dashboard/DashboardAlerts";
import { GoalsWidget } from "@/components/dashboard/GoalsWidget";
import { MyAnnualReviewWidget } from "@/components/dashboard/MyAnnualReviewWidget";

export function StaffDashboard() {
  const { user } = useAuth();
  const snackbar = useSnackbar();

  // useQuery replaces the useEffect + useState ceremony:
  //   - The cache is keyed by ['dashboard', 'summary'], so MentorDashboard
  //     (which uses the same key) will hit the same cache entry. Navigate
  //     Staff → Mentor → Staff and the second Staff mount reads cache
  //     instantly while a silent background refetch validates freshness.
  //   - data is undefined until the first fetch resolves; the existing
  //     `summary ? <Widget /> : <Skeleton />` ternaries below already
  //     handle that, so the JSX is unchanged.
  //   - The race-condition `cancelled` flag is gone — TanStack Query
  //     handles unmount-mid-fetch internally via AbortController.
  const { data: summary, error } = useQuery({
    queryKey: queryKeys.dashboard.summary(),
    queryFn: dashboardService.getSummary,
  });

  // Surface fetch errors through the existing snackbar pattern. Kept as
  // a separate effect rather than inlined into the queryFn so the
  // snackbar stays out of the cache layer's concerns.
  useEffect(() => {
    if (error) snackbar.error(getErrorMessage(error));
  }, [error, snackbar]);

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
          Your goals, reviews, and what's on your plate this cycle.
        </p>
      </div>

      {/* Row 1: Active Project Cycle | Active Goal Cycle — anchors at top */}
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

      {/* Row 2: Annual Goals (funnel + completion) | Annual Review */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {summary ? <GoalsWidget summary={summary} /> : <CardSkeleton />}
        {summary ? (
          <MyAnnualReviewWidget summary={summary} />
        ) : (
          <CardSkeleton />
        )}
      </div>

      {/* Row 3: full-width Action Items — the personal queue */}
      {summary ? <ActionItemsWidget summary={summary} /> : <CardSkeleton />}
    </div>
  );
}

// Same skeleton shape as MentorDashboard — keeps both pages visually
// consistent during their first paint.
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
