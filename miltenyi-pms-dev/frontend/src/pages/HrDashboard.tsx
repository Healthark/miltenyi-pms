/**
 * HrDashboard — org-wide rollups for HR_MyOrg and HR_Miltenyi.
 *
 * Owns the page shell: greeting, Cycle picker, widget grid, and the
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
import { GoalApprovalFunnelCard } from "@/components/dashboard/GoalApprovalFunnelCard";
import { ProjectReviewCompletionCard } from "@/components/dashboard/ProjectReviewCompletionCard";
import { PendingActionsCard } from "@/components/dashboard/PendingActionsCard";
import { ActiveCycleWidget } from "@/components/dashboard/ActiveCycleWidget";
import { ActiveCyclesCard } from "@/components/dashboard/ActiveCyclesCard";
import { MentorCoverageCard } from "@/components/dashboard/MentorCoverageCard";

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
      {/* Header: greeting + cycle picker (selects which FY's data
          the dashboard cards render). The label says "Cycle" — HR's
          everyday language for the selectable unit — even though the
          underlying value is a fiscal start year. The internal id
          (`hr-dashboard-fy`) stays for back-compat with anything
          referencing the element via querySelector. */}
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
            Cycle
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

      {/* HR_Miltenyi: simpler layout — single project-cycle anchor +
          their two-card summary grid. They don't see annual reviews,
          annual goals, or PendingActions, so no merge needed. */}
      {isMiltenyiHR ? (
        <>
          <div className="grid grid-cols-1 gap-4">
            <ActiveCycleWidget
              activeCycle={activeCycleName ?? null}
              variant="project"
            />
          </div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <ProjectReviewCompletionCard
              data={summary?.project_review_completion ?? null}
              cycleHint={activeCycleName ?? null}
            />
            <HeadcountCard data={summary?.headcount ?? null} />
          </div>
        </>
      ) : (
        /* HR_MyOrg: single grid pairing the merged Cycles card with
           Pending Actions in the top row, then a 2×2 of funnel /
           data cards beneath. Pending Actions stays tall on the right
           (it has 3 subsections); the merged Cycles card sits to its
           left at half-width-ish, replacing the previous two-card
           cycles row above. This frees the funnel cards from having
           to stretch tall to match Pending Actions' height.
           xl layout:
             Row 1: [ActiveCyclesCard cols 1-2] [PendingActions col 3, row-span 3]
             Row 2: [AnnualRev col 1] [ProjectRev col 2] [PA cont]
             Row 3: [GoalApprov col 1] [Headcount col 2] [PA cont]
           md (2-col) layout:
             Row 1: ActiveCyclesCard (full row, col-span-2)
             Row 2: PendingActions (full row, col-span-2)
             Row 3: AnnualRev | ProjectRev
             Row 4: GoalApprov | Headcount
        */
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="md:col-span-2 xl:col-span-2">
            <ActiveCyclesCard activeCycle={activeCycleName ?? null} />
          </div>
          <div className="md:col-span-2 xl:col-span-1 xl:col-start-3 xl:row-start-1 xl:row-span-3">
            <PendingActionsCard
              missingReviews={summary?.missing_annual_reviews ?? null}
            />
          </div>
          <AnnualReviewFunnelCard
            data={summary?.annual_review_funnel ?? null}
          />
          <ProjectReviewCompletionCard
            data={summary?.project_review_completion ?? null}
          />
          <GoalApprovalFunnelCard
            data={summary?.goal_approval_funnel ?? null}
          />
          <HeadcountCard data={summary?.headcount ?? null} />
        </div>
      )}

      {/* Mentor pairing health snapshot — full-width row of its own
          since it isn't FY-scoped and doesn't pair narratively with
          the summary grid above. HR_MyOrg only — Miltenyi HR doesn't
          own mentor assignments (no Mentor/Employee relationship on
          their side of the org). */}
      {!isMiltenyiHR && (
        <MentorCoverageCard data={summary?.mentor_coverage ?? null} />
      )}
    </div>
  );
}
