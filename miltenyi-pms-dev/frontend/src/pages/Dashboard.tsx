import { useState, useEffect } from "react";
import {
  dashboardService,
  type DashboardSummary,
} from "../services/dashboard.service";
import { useAuth } from "../hooks/useAuth";
import { ActionItemsWidget } from "../components/dashboard/ActionItemsWidget";
import { GoalsWidget } from "../components/dashboard/GoalsWidget";
import { MyAnnualReviewWidget } from "../components/dashboard/MyAnnualReviewWidget";
import { ActiveCycleWidget } from "../components/dashboard/ActiveCycleWidget";
import { PendingMentorWorkWidget } from "../components/dashboard/PendingMentorWorkWidget";
import { MenteesWidget } from "../components/dashboard/MenteesWidget";

// Skeleton shown while the summary is loading. Matches the widget card
// dimensions so the layout doesn't jump on first paint.
function WidgetSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm animate-pulse">
      <div className="flex items-center gap-2 mb-4">
        <div className="h-9 w-9 rounded-lg bg-slate-100" />
        <div className="h-3 w-24 rounded bg-slate-100" />
      </div>
      <div className="h-7 w-16 rounded bg-slate-100 mb-3" />
      <div className="space-y-2">
        <div className="h-2.5 w-full rounded bg-slate-100" />
        <div className="h-2.5 w-3/4 rounded bg-slate-100" />
      </div>
    </div>
  );
}

/**
 * Section header used to delineate the role-additive layers (Personal,
 * Mentor, …). Kept inline because the markup is trivial and only used
 * here — pulling it into its own file would be premature abstraction.
 */
function SectionHeader({
  title,
  subtitle,
}: {
  readonly title: string;
  readonly subtitle: string;
}) {
  return (
    <div>
      <h2 className="font-display text-sm font-semibold text-text-main uppercase tracking-wider">
        {title}
      </h2>
      <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>
    </div>
  );
}

export function Dashboard() {
  const { user, hasFeature } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    dashboardService
      .getSummary()
      .then(setSummary)
      .catch(() => setError(true))
      .finally(() => setIsLoading(false));
  }, []);

  // Layer flags — drive which sections render. The Mentor layer light up
  // additively on top of Personal; both feature-gating ("mentoring" must be
  // enabled at the org level) and relationship gating (`has_mentees`) need
  // to hold, mirroring the sidebar's own visibility check.
  const showMentorLayer =
    hasFeature("mentoring") && (user?.has_mentees ?? false);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        <p className="text-sm">
          Failed to load dashboard. Please refresh the page.
        </p>
      </div>
    );
  }

  // Loading state — render skeletons that mimic the eventual layout so the
  // page doesn't reflow on data arrival. We only show the Personal grid in
  // the loading state; the Mentor section can fade in once we know the
  // gate flags from `user`.
  if (isLoading || !summary) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-main">
            Welcome back{user?.full_name ? `, ${user.full_name.split(" ")[0]}` : ""}
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">
            Here's a summary of what's on your plate.
          </p>
        </div>
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          <WidgetSkeleton />
          <WidgetSkeleton />
          <WidgetSkeleton />
          <WidgetSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">
          Welcome back, {user?.full_name.split(" ")[0]}
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">
          Here's a summary of what's on your plate.
        </p>
      </div>

      {/* ── Personal layer — every authenticated user ──────────────── */}
      <section className="space-y-4">
        <SectionHeader
          title="Personal"
          subtitle="Your work, your status."
        />
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
          {/* Action Items leads — it's the "what should I do today" answer. */}
          <ActionItemsWidget summary={summary} />
          <GoalsWidget summary={summary} />
          <MyAnnualReviewWidget summary={summary} />
          <ActiveCycleWidget summary={summary} />
        </div>
      </section>

      {/* ── Mentor layer — only when caller has direct mentees ─────── */}
      {showMentorLayer && (
        <section className="space-y-4">
          <SectionHeader
            title="Mentor"
            subtitle="What your team needs from you."
          />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
            <PendingMentorWorkWidget summary={summary} />
            <MenteesWidget summary={summary} />
          </div>
        </section>
      )}
    </div>
  );
}
