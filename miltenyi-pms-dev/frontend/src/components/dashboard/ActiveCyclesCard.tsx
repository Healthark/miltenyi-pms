import { CalendarDays, Target } from "lucide-react";
import { formatFyLabel } from "@/utils/fy";

/**
 * ActiveCyclesCard — combined cycle card for the Employee dashboard.
 *
 * Replaces the previous two-card row (Active Project Cycle + Active
 * Goal Cycle) with a single card that lists both categories
 * side-by-side in two columns. Keeps the card's height in line with
 * the My Mentor card sitting next to it on Row 1, instead of
 * stretching tall like a stacked layout would.
 *
 * Both values are derived from the same `activeCycle` token (e.g.
 * "H1 FY26-27"): the project line shows the raw cycle, the goal line
 * shows the spanning FY via `formatFyLabel` — same helper used
 * everywhere else, so the two never drift.
 *
 * `ActiveCycleWidget` (the single-variant card) stays around because
 * MentorDashboard still consumes it for its two-up cycle row.
 */

interface ActiveCyclesCardProps {
  readonly activeCycle: string | null;
}

export function ActiveCyclesCard({ activeCycle }: ActiveCyclesCardProps) {
  const projectValue = activeCycle;
  const goalValue = activeCycle ? formatFyLabel(activeCycle) : null;

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light">
          <CalendarDays className="h-5 w-5 text-brand" aria-hidden="true" />
        </div>
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
          Active Cycles
        </p>
      </div>

      {/* Body — two cycle blocks side-by-side with a thin vertical
          divider between them on sm+ screens. Stacks on the smallest
          viewports so values stay readable. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-0 sm:divide-x sm:divide-border">
        <CycleBlock
          icon={CalendarDays}
          label="Project Cycle"
          value={projectValue}
          tagline="All new project reviews are tagged to this period."
        />
        <div className="sm:pl-4">
          <CycleBlock
            icon={Target}
            label="Goal Cycle"
            value={goalValue}
            tagline="All new annual goals are tagged to this fiscal year."
          />
        </div>
      </div>
    </article>
  );
}

interface CycleBlockProps {
  readonly icon: typeof CalendarDays;
  readonly label: string;
  readonly value: string | null;
  readonly tagline: string;
}

function CycleBlock({ icon: Icon, label, value, tagline }: CycleBlockProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-text-muted">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="text-[11px] font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      {value ? (
        <>
          <p className="font-display text-xl font-semibold text-text-main">
            {value}
          </p>
          <p className="text-xs text-text-muted">{tagline}</p>
        </>
      ) : (
        <>
          <p className="font-display text-base font-medium text-text-muted">
            Not configured
          </p>
          <p className="text-xs text-text-muted">
            Ask your administrator to set the active performance cycle.
          </p>
        </>
      )}
    </div>
  );
}
