/**
 * MentorDashboard — landing page for users with one or more direct mentees.
 *
 * Composes seven widgets answering two recurring mentor questions:
 *   "What do I owe my mentees?" → M1 Pending Mentor Work, M5 Mentee Health,
 *                                  M6 My Action Items (own employee queue).
 *   "Where do I stand myself?"   → M3 My Annual Review, M4 My Annual Goals,
 *                                  M2 My Mentees count, M7 Active Cycle.
 *
 * Owns two fetches at the page level:
 *   /dashboard/summary  → DashboardSummary  (drives M1–M4, M6, M7)
 *   /mentees/summary    → MenteeSummary[]   (drives M5)
 *
 * Each widget receives either its loaded slice or null and renders its
 * own skeleton in place — the grid is stable from first paint.
 */

import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useSnackbar } from "@/hooks/useSnackbar";
import {
  dashboardService,
  type DashboardSummary,
} from "@/services/dashboard.service";
import {
  menteeService,
  type MenteeSummary,
} from "@/services/mentee.service";
import { getErrorMessage } from "@/utils/errors";
import { PendingMentorWorkWidget } from "@/components/dashboard/PendingMentorWorkWidget";
import { MenteesWidget } from "@/components/dashboard/MenteesWidget";
import { MyAnnualReviewWidget } from "@/components/dashboard/MyAnnualReviewWidget";
import { GoalsWidget } from "@/components/dashboard/GoalsWidget";
import { ActionItemsWidget } from "@/components/dashboard/ActionItemsWidget";
import { ActiveCycleWidget } from "@/components/dashboard/ActiveCycleWidget";
import { MenteeHealthListCard } from "@/components/dashboard/MenteeHealthListCard";

export function MentorDashboard() {
  const { user } = useAuth();
  const snackbar = useSnackbar();

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [mentees, setMentees] = useState<MenteeSummary[] | null>(null);

  // Personal summary fetch — drives M1–M4, M6, M7.
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

  // Mentee list fetch — drives M5 only. Kept separate so a slow
  // /mentees/summary doesn't gate the rest of the page from rendering.
  useEffect(() => {
    let cancelled = false;
    menteeService
      .getSummaries()
      .then((res) => {
        if (!cancelled) setMentees(res);
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
          Mentee pending work, your own queue, and review status.
        </p>
      </div>

      {/* Row 1: Pending Mentor Work (span 2) | My Mentees */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <div className="xl:col-span-2">
          {summary ? (
            <PendingMentorWorkWidget summary={summary} />
          ) : (
            <CardSkeleton />
          )}
        </div>
        {summary ? <MenteesWidget summary={summary} /> : <CardSkeleton />}
      </div>

      {/* Row 2: My Annual Review | My Annual Goals */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {summary ? (
          <MyAnnualReviewWidget summary={summary} />
        ) : (
          <CardSkeleton />
        )}
        {summary ? <GoalsWidget summary={summary} /> : <CardSkeleton />}
      </div>

      {/* Row 3: full-width mentee health radar */}
      <MenteeHealthListCard mentees={mentees} />

      {/* Row 4: My Action Items | Active Cycle */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {summary ? <ActionItemsWidget summary={summary} /> : <CardSkeleton />}
        {summary ? <ActiveCycleWidget summary={summary} /> : <CardSkeleton />}
      </div>
    </div>
  );
}

// Generic per-card skeleton matching the surface + padding of the
// loaded widgets, so the grid doesn't reflow when data lands. The
// individual widgets do not accept a null prop — gating at the page
// is simpler than refactoring six widgets to add a loading state.
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
