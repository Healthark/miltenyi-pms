/**
 * HrDashboard — org-wide rollups for the Admin.
 *
 * Owns the page shell: greeting, the year picker, the widget grid and the
 * batched fetch to /dashboard/hr-summary. For Project Goals orgs it also
 * loads the picked year's goal period and its preflight (the same counts
 * the System Settings Save confirmation shows). Widgets receive either
 * their typed data or `null` for their own skeleton — no global spinner.
 *
 * Years are picked by start year and shown as calendar-year spans
 * ("CY 26-27"); the same span is the "FY26-27" token stored on annual
 * goals and reviews and used in the deep links.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { dashboardService } from "@/services/dashboard.service";
import { goalFrameworkService } from "@/services/goal-framework.service";
import { projectGoalsService } from "@/services/project-goals.service";
import { useAuth } from "@/hooks/useAuth";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { useSnackbar } from "@/hooks/useSnackbar";
import { cyLabel, fyTokenToStartYear, startYearOf } from "@/utils/fy";
import { getErrorMessage } from "@/utils/errors";
import { HeadcountCard } from "@/components/dashboard/HeadcountCard";
import { AnnualReviewFunnelCard } from "@/components/dashboard/AnnualReviewFunnelCard";
import { GoalApprovalFunnelCard } from "@/components/dashboard/GoalApprovalFunnelCard";
import { ProjectReviewCompletionCard } from "@/components/dashboard/ProjectReviewCompletionCard";
import { ProjectGoalsFunnelCard } from "@/components/dashboard/ProjectGoalsFunnelCard";
import { PendingActionsCard } from "@/components/dashboard/PendingActionsCard";
import {
  ActiveCyclesCard,
  LEGACY_BLOCKS,
  LEGACY_BLOCKS_WITH_PROJECT_REVIEWS,
  PROJECT_GOALS_BLOCKS,
} from "@/components/dashboard/ActiveCyclesCard";
import { MentorCoverageCard } from "@/components/dashboard/MentorCoverageCard";

export function HrDashboard() {
  const { user, hasFeature } = useAuth();
  const { settings } = useSystemSettings();
  const snackbar = useSnackbar();
  const projectGoalsOn = hasFeature("project_goals");
  // Retired for orgs that run Project Goals (Miltenyi, Sep 2026).
  const projectReviewsOn = hasFeature("project_reviews");

  // The active year drives the picker's default. Settings load
  // asynchronously, so this is null on first paint.
  const activeCycleName = settings?.active_cycle_name;
  const activeFyStart = activeCycleName ? fyTokenToStartYear(activeCycleName) : null;

  const [selectedFy, setSelectedFy] = useState<number | null>(null);
  if (selectedFy === null && activeFyStart !== null) {
    setSelectedFy(activeFyStart);
  }
  const yearLabel = selectedFy !== null ? cyLabel(selectedFy) : null;

  // The year is part of the query key, so switching the picker swaps
  // cache entries; `enabled` waits for the picker to settle.
  const { data: summary, error } = useQuery({
    queryKey: queryKeys.dashboard.hrSummary(selectedFy),
    queryFn: () => dashboardService.getHrSummary(selectedFy ?? undefined),
    enabled: selectedFy !== null,
  });

  // Project Goals: which goal years exist, then the picked year's period
  // and preflight (only when that year has a goal year — the endpoints
  // 404 otherwise).
  const { data: periods, error: periodsError } = useQuery({
    queryKey: queryKeys.projectGoals.periods(),
    queryFn: projectGoalsService.getPeriods,
    enabled: projectGoalsOn,
  });
  const periodExists = !!yearLabel && !!periods?.some((p) => p.period_label === yearLabel);
  const { data: pgPeriodData, error: pgPeriodError } = useQuery({
    queryKey: queryKeys.projectGoals.period(yearLabel ?? undefined),
    queryFn: () => projectGoalsService.getPeriod(yearLabel),
    enabled: projectGoalsOn && periodExists,
  });
  const { data: preflightData, error: preflightError } = useQuery({
    queryKey: queryKeys.admin.goalPreflight(yearLabel ?? undefined),
    queryFn: () => goalFrameworkService.getPreflight(yearLabel),
    enabled: projectGoalsOn && periodExists,
  });

  // undefined while loading, null when the picked year has no goal year
  const pgPeriod = !projectGoalsOn ? null : periods === undefined || yearLabel === null ? undefined : !periodExists ? null : pgPeriodData;
  const pgPreflight = !projectGoalsOn ? null : periods === undefined || yearLabel === null ? undefined : !periodExists ? null : preflightData;
  const activePeriod = !projectGoalsOn ? null : periods === undefined ? undefined : (periods.find((p) => p.is_active) ?? null);

  // Picker options: years with annual data, the active year, and every
  // goal year — newest first.
  const years = new Set<number>(summary?.available_fys ?? (activeFyStart !== null ? [activeFyStart] : []));
  for (const p of periods ?? []) {
    const y = startYearOf(p.period_label);
    if (y !== null) years.add(y);
  }
  const availableYears = Array.from(years).sort((a, b) => b - a);

  useEffect(() => {
    if (error) snackbar.error(getErrorMessage(error));
  }, [error, snackbar]);

  useEffect(() => {
    const e = periodsError ?? pgPeriodError ?? preflightError;
    if (e) snackbar.error(getErrorMessage(e));
  }, [periodsError, pgPeriodError, preflightError, snackbar]);

  const firstName = user?.full_name?.split(" ")[0] ?? "there";
  const blocks = projectGoalsOn ? PROJECT_GOALS_BLOCKS : projectReviewsOn ? LEGACY_BLOCKS_WITH_PROJECT_REVIEWS : LEGACY_BLOCKS;

  return (
    <div className="space-y-6">
      {/* Header: greeting + year picker (which year the cards describe) */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-main">Welcome back, {firstName}</h1>
          <p className="mt-0.5 text-sm text-text-muted">Org-wide rollups across staffing, goals and reviews.</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="hr-dashboard-fy" className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            Year
          </label>
          <select
            id="hr-dashboard-fy"
            value={selectedFy ?? ""}
            disabled={availableYears.length === 0}
            onChange={(e) => setSelectedFy(Number(e.target.value))}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer min-w-[140px] disabled:opacity-50"
          >
            {availableYears.length === 0 && <option value="">Loading…</option>}
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {cyLabel(y)}
                {y === activeFyStart ? " (current)" : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* xl: [Cycles cols 1-2] [Pending Actions col 3, spanning three rows]
               [Project Goals] [Annual Review Progress]
               [Goal Approval Progress] [Active Personnel]
          md: each pair stacks into a 2-column grid. */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="md:col-span-2 xl:col-span-2">
          <ActiveCyclesCard activeCycle={activeCycleName ?? null} period={activePeriod} blocks={blocks} />
        </div>
        <div className="md:col-span-2 xl:col-span-1 xl:col-start-3 xl:row-start-1 xl:row-span-3">
          <PendingActionsCard missingReviews={summary?.missing_annual_reviews ?? null} period={pgPeriod} preflight={pgPreflight} />
        </div>
        {projectGoalsOn && <ProjectGoalsFunnelCard preflight={pgPreflight} period={pgPeriod} yearLabel={yearLabel ?? "—"} />}
        <AnnualReviewFunnelCard data={summary?.annual_review_funnel ?? null} />
        <GoalApprovalFunnelCard data={summary?.goal_approval_funnel ?? null} />
        <HeadcountCard data={summary?.headcount ?? null} />
        {projectReviewsOn && <ProjectReviewCompletionCard data={summary?.project_review_completion ?? null} />}
      </div>

      {/* Mentor pairing health — not year-scoped, so it gets its own row */}
      <MentorCoverageCard data={summary?.mentor_coverage ?? null} />
    </div>
  );
}
