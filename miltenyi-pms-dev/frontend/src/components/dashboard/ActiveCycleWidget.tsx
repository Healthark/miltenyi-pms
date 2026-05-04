import { CalendarDays } from "lucide-react";
import type { DashboardSummary } from "../../services/dashboard.service";

interface ActiveCycleWidgetProps {
  readonly summary: DashboardSummary;
}

export function ActiveCycleWidget({ summary }: ActiveCycleWidgetProps) {
  const { active_cycle } = summary;

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light">
          <CalendarDays className="h-5 w-5 text-brand" aria-hidden="true" />
        </div>
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
          Active Cycle
        </p>
      </div>

      {/* Cycle name */}
      {active_cycle ? (
        <>
          <p className="font-display text-2xl font-semibold text-text-main">
            {active_cycle}
          </p>
          <p className="text-sm text-text-muted -mt-2">
            All new goals and reviews are tagged to this period.
          </p>
        </>
      ) : (
        <>
          <p className="font-display text-lg font-medium text-text-muted">
            Not configured
          </p>
          <p className="text-sm text-text-muted -mt-2">
            Ask your administrator to set the active performance cycle.
          </p>
        </>
      )}
    </div>
  );
}
