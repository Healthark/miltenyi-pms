import { CalendarDays, Target } from "lucide-react";
import { formatFyLabel } from "@/utils/fy";

/**
 * ActiveCycleWidget — two display modes derived from the same active
 * cycle token (e.g. "H1 FY26-27").
 *
 *   variant="project" → "Active Project Cycle"
 *     Shows the raw cycle name ("H1 FY26-27" / "Q1 FY26-27") that
 *     project reviews are tagged to.
 *
 *   variant="goal" → "Active Goal Cycle"
 *     Shows the spanning FY label ("FY 2026-27") that annual goals are
 *     tagged to. Derived via formatFyLabel — the same helper used
 *     across goal surfaces — so the two cycle cards never drift.
 *
 * Callers pass the cycle string directly (from DashboardSummary on the
 * Staff/Mentor dashboards, or from SystemSettings on the HR dashboard).
 * When the org hasn't configured a cycle yet, both variants fall back
 * to the same neutral "Not configured" state.
 */

interface ActiveCycleWidgetProps {
  readonly activeCycle: string | null;
  /** Defaults to "project" to preserve the original callsite contract. */
  readonly variant?: "project" | "goal";
}

interface VariantCopy {
  readonly title: string;
  readonly icon: typeof CalendarDays;
  readonly resolveValue: (cycle: string) => string;
  readonly tagline: string;
}

const VARIANTS: Record<"project" | "goal", VariantCopy> = {
  project: {
    title: "Active Project Cycle",
    icon: CalendarDays,
    resolveValue: (cycle) => cycle,
    tagline: "All new project reviews are tagged to this period.",
  },
  goal: {
    title: "Active Goal Cycle",
    icon: Target,
    resolveValue: (cycle) => formatFyLabel(cycle),
    tagline: "All new annual goals are tagged to this fiscal year.",
  },
};

export function ActiveCycleWidget({
  activeCycle,
  variant = "project",
}: ActiveCycleWidgetProps) {
  const copy = VARIANTS[variant];
  const Icon = copy.icon;
  const value = activeCycle ? copy.resolveValue(activeCycle) : null;

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light">
          <Icon className="h-5 w-5 text-brand" aria-hidden="true" />
        </div>
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
          {copy.title}
        </p>
      </div>

      {/* Value */}
      {value ? (
        <>
          <p className="font-display text-2xl font-semibold text-text-main">
            {value}
          </p>
          <p className="text-sm text-text-muted -mt-2">{copy.tagline}</p>
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
