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
import {
  dashboardService,
  type HrDashboardSummary,
} from "@/services/dashboard.service";
import { useAuth } from "@/hooks/useAuth";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { useSnackbar } from "@/hooks/useSnackbar";
import { fyTokenToStartYear, formatFyYearSpan } from "@/utils/fy";
import { getErrorMessage } from "@/utils/errors";
import { HeadcountCard } from "@/components/dashboard/HeadcountCard";
import { AnnualReviewFunnelCard } from "@/components/dashboard/AnnualReviewFunnelCard";
import { GoalApprovalFunnelCard } from "@/components/dashboard/GoalApprovalFunnelCard";
import { ProjectReviewCompletionCard } from "@/components/dashboard/ProjectReviewCompletionCard";
import { MissingAnnualReviewsCard } from "@/components/dashboard/MissingAnnualReviewsCard";
import { StalledGoalsCard } from "@/components/dashboard/StalledGoalsCard";
import { MentorCoverageCard } from "@/components/dashboard/MentorCoverageCard";

export function HrDashboard() {
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const snackbar = useSnackbar();

  const [summary, setSummary] = useState<HrDashboardSummary | null>(null);

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

  // Reset the summary to its skeleton state the moment the FY changes,
  // *before* the next effect tick fires. Doing this with a during-render
  // compare keeps the loading transition synchronous (no flash of stale
  // data) without triggering the cascading-renders ESLint warning that
  // setState-inside-useEffect would.
  const [trackedFy, setTrackedFy] = useState<number | null>(null);
  if (trackedFy !== selectedFy) {
    setTrackedFy(selectedFy);
    setSummary(null);
  }

  // Picker options come from the backend — they reflect the FYs that
  // actually have annual-review or annual-goal rows in this org, plus
  // the active FY. Falls back to just [active] until the first fetch
  // resolves so the picker still has *something* to show.
  const availableYears: number[] = summary?.available_fys
    ?? (activeFyStart !== null ? [activeFyStart] : []);

  // Fetch the summary every time the FY changes. Widgets that ignore
  // the FY (like headcount) get the same numbers regardless, but the
  // batched-endpoint contract lets cycle-bound widgets reuse the same
  // request when they land.
  useEffect(() => {
    let cancelled = false;
    dashboardService
      .getHrSummary(selectedFy ?? undefined)
      .then((res) => {
        if (!cancelled) setSummary(res);
      })
      .catch((err: unknown) => {
        if (!cancelled) snackbar.error(getErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFy, snackbar]);

  const firstName = user?.full_name?.split(" ")[0] ?? "there";

  return (
    <div className="space-y-6">
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

      {/* Widget grid */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <HeadcountCard data={summary?.headcount ?? null} />
        <AnnualReviewFunnelCard
          data={summary?.annual_review_funnel ?? null}
        />
        <GoalApprovalFunnelCard
          data={summary?.goal_approval_funnel ?? null}
        />
        <ProjectReviewCompletionCard
          data={summary?.project_review_completion ?? null}
        />
        <MissingAnnualReviewsCard
          data={summary?.missing_annual_reviews ?? null}
        />
        <StalledGoalsCard data={summary?.stalled_goals ?? null} />
        <MentorCoverageCard data={summary?.mentor_coverage ?? null} />
        {/* Subsequent widgets slot in here as we add them. */}
      </div>
    </div>
  );
}
