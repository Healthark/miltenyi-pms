/**
 * StaffDashboard — landing page for Staff, PM, and any role without
 * direct mentees. Answers the two recurring employee questions:
 *
 *   "What do I owe?"   → S1 My Action Items, S2 Active Cycle.
 *   "How am I doing?"  → S3 My Annual Goals, S4 My Annual Review.
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

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSnackbar } from "@/hooks/useSnackbar";
import {
  dashboardService,
  type DashboardSummary,
} from "@/services/dashboard.service";
import { getErrorMessage } from "@/utils/errors";
import { ActionItemsWidget } from "@/components/dashboard/ActionItemsWidget";
import { ActiveCycleWidget } from "@/components/dashboard/ActiveCycleWidget";
import { GoalsWidget } from "@/components/dashboard/GoalsWidget";
import { MyAnnualReviewWidget } from "@/components/dashboard/MyAnnualReviewWidget";

export function StaffDashboard() {
  const { user } = useAuth();
  const snackbar = useSnackbar();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);

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

      {/* Row 1: Action Items (span 2) | Active Cycle */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="xl:col-span-2">
          {summary ? <ActionItemsWidget summary={summary} /> : <CardSkeleton />}
        </div>
        {summary ? <ActiveCycleWidget summary={summary} /> : <CardSkeleton />}
      </div>

      {/* Row 2: Annual Goals | Annual Review */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {summary ? <GoalsWidget summary={summary} /> : <CardSkeleton />}
        {summary ? (
          <MyAnnualReviewWidget summary={summary} />
        ) : (
          <CardSkeleton />
        )}
      </div>
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
