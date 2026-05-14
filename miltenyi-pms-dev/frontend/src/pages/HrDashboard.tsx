/**
 * HrDashboard — org-wide rollups for HR_MyOrg and HR_Miltenyi.
 *
 * Owns the page shell: greeting, FY picker, widget grid, and the
 * single batched fetch to /dashboard/hr-summary. Widgets are passed
 * either the typed data or `null` for their own skeleton — there is
 * no global page spinner; each card renders its own loading state in
 * place so the layout is stable from first paint.
 *
 * The Dashboard.tsx router-level component delegates to this page
 * when the caller's role is HR_MyOrg or HR_Miltenyi; other roles
 * still see the placeholder.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { dashboardService } from "@/services/dashboard.service";
import { useAuth } from "@/hooks/useAuth";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { useSnackbar } from "@/hooks/useSnackbar";
import { fyTokenToStartYear, formatFyYearSpan } from "@/utils/fy";
import { getErrorMessage } from "@/utils/errors";
import { HeadcountCard } from "@/components/dashboard/HeadcountCard";
import { AnnualReviewFunnelCard } from "@/components/dashboard/AnnualReviewFunnelCard";
import { DashboardAlerts } from "@/components/dashboard/DashboardAlerts";
import { GoalApprovalFunnelCard } from "@/components/dashboard/GoalApprovalFunnelCard";
import { ProjectReviewCompletionCard } from "@/components/dashboard/ProjectReviewCompletionCard";
import { PendingActionsCard } from "@/components/dashboard/PendingActionsCard";
import { ActiveCycleWidget } from "@/components/dashboard/ActiveCycleWidget";

export function HrDashboard() {
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const snackbar = useSnackbar();

  // HR_Miltenyi's scope excludes annual reviews and annual goals
  // (see annual_review_routes.py: "Miltenyi HR has no business in
  // annual reviews"), so the four cards that summarise those flows
  // are hidden for them.
  const isMiltenyiHR = user?.role === "HR_Miltenyi";

  // Active FY drives the picker's default selection. Read straight from
  // settings since it's needed during render. Settings load is async, so
  // this is null on the first paint and the picker stays disabled until
  // settings + the first /hr-summary fetch both land.
  const activeCycleName = settings?.active_cycle_name;
  const activeFyStart = activeCycleName
    ? fyTokenToStartYear(activeCycleName)
    : null;

  const [selectedFy, setSelectedFy] = useState<number | null>(null);

  // Settle the picker to the active FY once we know it. Use during-render
  // compare instead of useEffect to avoid a post-commit re-render.
  if (selectedFy === null && activeFyStart !== null) {
    setSelectedFy(activeFyStart);
  }

  // The FY is part of the queryKey, so switching the picker from
  // FY26-27 to FY25-26 transparently swaps cache entries:
  //   - First switch to FY25-26: data is undefined (skeleton), fetch fires
  //   - Switch back to FY26-27: cache hit, data renders instantly, silent
  //     background refetch confirms freshness
  //   - Each FY's data is independently cached and gc'd (5min default)
  //
  // We no longer need the `trackedFy` state machine that wiped `summary`
  // to null on FY change — useQuery returns `undefined` for `data` while
  // the new key's request is in flight, which the JSX below already
  // treats as "show skeleton". One state, one source of truth.
  //
  // `enabled` gates the fetch on the picker actually having a value.
  // Before settings load, selectedFy is null and we don't want to fire
  // a request with `fy=undefined` (which would return the default FY
  // and then immediately be discarded when settings arrive).
  const { data: summary, error } = useQuery({
    queryKey: queryKeys.dashboard.hrSummary(selectedFy),
    queryFn: () => dashboardService.getHrSummary(selectedFy ?? undefined),
    enabled: selectedFy !== null,
  });

  // Picker options come from the backend — they reflect the FYs that
  // actually have annual-review or annual-goal rows in this org, plus
  // the active FY. Falls back to just [active] until the first fetch
  // resolves so the picker still has *something* to show.
  const availableYears: number[] = summary?.available_fys
    ?? (activeFyStart !== null ? [activeFyStart] : []);

  // Surface fetch errors through the existing snackbar pattern.
  useEffect(() => {
    if (error) snackbar.error(getErrorMessage(error));
  }, [error, snackbar]);

  const firstName = user?.full_name?.split(" ")[0] ?? "there";

  return (
    <div className="space-y-6">
      {/* State-derived alert banners (paused submissions, hidden
          ratings, cycle rollover dismiss). Always rendered first so
          they read as page-level context. */}
      <DashboardAlerts />

      {/* Header: greeting + FY picker */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-main">
            Welcome back, {firstName}
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">
            Org-wide rollups across staffing, reviews, and cycle progress.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label
            htmlFor="hr-dashboard-fy"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            FY
          </label>
          <select
            id="hr-dashboard-fy"
            value={selectedFy ?? ""}
            disabled={availableYears.length === 0}
            onChange={(e) => setSelectedFy(Number(e.target.value))}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer min-w-[140px] disabled:opacity-50"
          >
            {availableYears.length === 0 && (
              <option value="">Loading…</option>
            )}
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {formatFyYearSpan(y)}
                {y === activeFyStart ? " (current)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Row 1: Active Project Cycle | Active Goal Cycle — cycle
          anchors at the top, matching the Staff/Mentor dashboards. The
          goal cycle is hidden for Miltenyi HR since their scope
          excludes annual goals (see header comment), so they get a
          single full-width project cycle card instead. */}
      <div
        className={
          isMiltenyiHR
            ? "grid grid-cols-1 gap-4"
            : "grid grid-cols-1 gap-4 md:grid-cols-2"
        }
      >
        <ActiveCycleWidget
          activeCycle={activeCycleName ?? null}
          variant="project"
        />
        {!isMiltenyiHR && (
          <ActiveCycleWidget
            activeCycle={activeCycleName ?? null}
            variant="goal"
          />
        )}
      </div>

      {/* Summary grid — four progress cards in a 2×2 on the left, and
          the combined "Needs Attention" follow-up card spanning both
          rows on the right. Miltenyi HR doesn't see annual reviews or
          annual goals, so for them we collapse to a single-row layout
          with just the cards they're scoped to. */}
      {isMiltenyiHR ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <ProjectReviewCompletionCard
            data={summary?.project_review_completion ?? null}
          />
          <HeadcountCard data={summary?.headcount ?? null} />
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <AnnualReviewFunnelCard
            data={summary?.annual_review_funnel ?? null}
          />
          <ProjectReviewCompletionCard
            data={summary?.project_review_completion ?? null}
          />
          {/* Merged follow-up card sits in column 3 and spans both
              rows, matching the 2×2 grid height beside it. */}
          <div className="xl:col-start-3 xl:row-start-1 xl:row-span-2">
            <PendingActionsCard
              missingReviews={summary?.missing_annual_reviews ?? null}
              stalledGoals={summary?.stalled_goals ?? null}
            />
          </div>
          <GoalApprovalFunnelCard
            data={summary?.goal_approval_funnel ?? null}
          />
          <HeadcountCard data={summary?.headcount ?? null} />
        </div>
      )}

      {/* Mentor pairing health snapshot — full-width row of its own
          since it isn't FY-scoped and doesn't pair narratively with
          the summary grid above. */}
    </div>
  );
}
