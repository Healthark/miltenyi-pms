/**
 * EmployeeDashboard — landing page for Employee, PM, and any role without
 * direct mentees. Answers the "how am I doing?" question via:
 *   - S3 My Annual Goals (funnel + completion)
 *   - S4 My Annual Review
 *
 * Two cycle cards anchor the page at the top so the rest of the
 * numbers read against the right time horizon:
 *   - Active Project Cycle (left)  — H1/H2/Q1..Q4, used by project reviews.
 *   - Active Goal Cycle (right)    — FY span, used by annual goals.
 *
 * NOTE: The old "My Action Items" widget was removed product-wide —
 * users now reach pending work through the per-feature pages (My Goals,
 * My Reviews, Project Reviews) and the notifications dropdown. PMs
 * accordingly see only the Active Cycles strip on their landing page;
 * their pending project-review queue lives on /project-reviews.
 *
 * A PM who also mentors gets routed to MentorDashboard instead (see
 * Dashboard.tsx).
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
import { profileService } from "@/services/profile.service";
import { getErrorMessage } from "@/utils/errors";
import { ActiveCyclesCard } from "@/components/dashboard/ActiveCyclesCard";
import { GoalsWidget } from "@/components/dashboard/GoalsWidget";
import { MyAnnualReviewWidget } from "@/components/dashboard/MyAnnualReviewWidget";
import { MyMentorWidget } from "@/components/dashboard/MyMentorWidget";
import { ProjectReviewsStatusCard } from "@/components/dashboard/ProjectReviewsStatusCard";

export function EmployeeDashboard() {
  const { user } = useAuth();
  const snackbar = useSnackbar();
  // PM-specific gating. Drives the Goals/Annual-Review row visibility
  // below — both surface concepts (goals, annual self-review) that
  // the role model explicitly excludes for PMs (see
  // backend/app/models/user_models.py Role enum docstring).
  const isPM = user?.role === "PM";

  // useQuery replaces the useEffect + useState ceremony:
  //   - The cache is keyed by ['dashboard', 'summary'], so MentorDashboard
  //     (which uses the same key) will hit the same cache entry. Navigate
  //     Employee → Mentor → Employee and the second Employee mount reads cache
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

  // Mentor info — fetched for every Employee-style dashboard view so
  // the My Mentor card always renders. Users without a mentor (CEO /
  // founders / unassigned mentees) get the same card with a "No
  // mentor assigned · Contact HR if this looks wrong" empty state
  // inside the widget rather than a missing tile.
  const { data: profile, error: profileError } = useQuery({
    queryKey: queryKeys.profile.me(),
    queryFn: profileService.getProfile,
  });

  // Surface fetch errors through the existing snackbar pattern. Kept as
  // a separate effect rather than inlined into the queryFn so the
  // snackbar stays out of the cache layer's concerns.
  useEffect(() => {
    if (error) snackbar.error(getErrorMessage(error));
  }, [error, snackbar]);

  useEffect(() => {
    if (profileError) snackbar.error(getErrorMessage(profileError));
  }, [profileError, snackbar]);

  const firstName = user?.full_name?.split(" ")[0] ?? "there";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">
          Welcome back, {firstName}
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">
          Your goals, reviews, and what's on your plate this cycle.
        </p>
      </div>

      {isPM ? (
        /* PM layout — two-up row: Active Cycles (left, half width) +
           Project Reviews status donut (right). Goals + Annual Review
           rows aren't rendered for PMs (Role enum: no goals, never
           rated). The Action Items widget used to round this page out
           for PMs but has been removed product-wide; the pending
           project-review queue is now summarised inside the new
           ProjectReviewsStatusCard with a "View pending" CTA into
           /project-reviews. MyMentorWidget isn't rendered either —
           PMs typically don't have a mentor in this product; the
           rare PM-with-mentor can read mentor info on /profile. */
        /* items-start so neither card stretches to match the other's
           content height — Active Cycles is naturally shorter than
           the Project Reviews donut card, and forcing stretch dumps a
           large empty band into ActiveCyclesCard. */
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 items-start">
          {summary ? (
            <ActiveCyclesCard
              activeCycle={summary.active_cycle}
              blocks={["fy", "project"]}
            />
          ) : (
            <CardSkeleton />
          )}
          {summary ? (
            <ProjectReviewsStatusCard summary={summary} />
          ) : (
            <CardSkeleton />
          )}
        </div>
      ) : (
        <>
          {/* Row 1: Active Cycles (left) | My Mentor (right). Cycle
              context anchors the dashboard ("where are we right
              now?"); the personal mentor card follows. My Mentor
              always renders — when the user has no mentor on file
              (CEO / founders / freshly-orphaned mentees) the card
              shows a "No mentor assigned" empty state with a Contact
              HR nudge, rather than collapsing the grid. Keeps the
              layout stable across user types and surfaces the missing
              mentor as something to act on. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {summary ? (
              <ActiveCyclesCard activeCycle={summary.active_cycle} />
            ) : (
              <CardSkeleton />
            )}
            <MyMentorWidget profile={profile ?? null} />
          </div>

          {/* Row 2: My Annual Review (left) | Annual Goals (right).
              Annual Review on the left mirrors row 1's left-side
              anchor (the "where are we" surface — your active-cycle
              review status + CTA). The Annual Review card also
              carries a compact project-reviews strip footer so the
              Employee can glance at both review streams without an
              extra card. The page used to have a bottom-row Action
              Items widget; both were removed together when that
              widget was retired product-wide. */}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {summary ? (
              <MyAnnualReviewWidget summary={summary} />
            ) : (
              <CardSkeleton />
            )}
            {summary ? <GoalsWidget summary={summary} /> : <CardSkeleton />}
          </div>
        </>
      )}
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
