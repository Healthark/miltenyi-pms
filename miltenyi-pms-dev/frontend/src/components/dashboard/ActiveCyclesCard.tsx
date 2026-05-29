import { CalendarDays, CalendarRange, Target } from "lucide-react";
import { formatFyLabel } from "@/utils/fy";

/**
 * ActiveCyclesCard — combined cycle card for the Employee and HR dashboards.
 *
 * Renders three time anchors side-by-side, in this order:
 *   1. Fiscal Year         — the org's current FY span ("FY 2026-27").
 *   2. Goal Review Cycle   — the half (H1 / H2) the goal-review
 *                            window currently belongs to, plus the FY
 *                            token ("H1 FY26-27"). Goal reviews are
 *                            uniformly half-yearly even when the org's
 *                            project cadence is quarterly, so this can
 *                            differ from #3 below.
 *   3. Project Review Cycle — raw active cycle as configured by HR
 *                            ("H1 FY26-27" for half-yearly orgs, or
 *                            "Q2 FY26-27" / similar for quarterly orgs).
 *
 * All three are derived from the same `activeCycle` token (e.g.
 * "H1 FY26-27" or "Q2 FY26-27"). When `activeCycle` is null the
 * blocks render their "Not configured" state.
 *
 * `ActiveCycleWidget` (the single-variant card) stays around because
 * MentorDashboard still consumes it for its two-up cycle row.
 */

/** Which sub-blocks to render. The order in the array also drives
 *  the left-to-right rendering order on screen. */
export type ActiveCycleBlock = "fy" | "goal" | "project";

interface ActiveCyclesCardProps {
  readonly activeCycle: string | null;
  /** Which blocks to render. Defaults to all three (HR_MyOrg's full
   *  view). HR_Miltenyi passes `["fy", "project"]` since they don't
   *  own annual goal reviews. Order also drives visual order. */
  readonly blocks?: readonly ActiveCycleBlock[];
}

/** Derive the goal-review half from the active cycle string.
 *
 * Goal self- and mentor-reviews are always filed half-yearly (H1 / H2)
 * regardless of the org's `cycle_type`, so a quarterly org's
 * "Q3 FY26-27" maps to "H2 FY26-27" for the purpose of goal reviews.
 *
 * Quarter → half mapping mirrors backend `current_half_and_fy`:
 *   Q1, Q2 → H1
 *   Q3, Q4 → H2
 * Half-yearly orgs come back unchanged. Annual (no prefix) returns
 * the raw string so the block surfaces whatever's stored.
 */
function deriveGoalReviewCycle(activeCycle: string): string {
  const parts = activeCycle.trim().split(/\s+/);
  if (parts.length < 2) return activeCycle;
  const prefix = parts[0].toUpperCase();
  const fyToken = parts.slice(1).join(" ");
  if (prefix === "Q1" || prefix === "Q2") return `H1 ${fyToken}`;
  if (prefix === "Q3" || prefix === "Q4") return `H2 ${fyToken}`;
  return activeCycle;
}

const DEFAULT_BLOCKS: readonly ActiveCycleBlock[] = ["fy", "goal", "project"];

/** Static config per block kind so the rendering loop stays small.
 *  Each entry pairs its icon + label + tagline. The `value` function
 *  is computed per render against the active cycle string. */
const BLOCK_CONFIG: Record<
  ActiveCycleBlock,
  {
    readonly icon: typeof CalendarDays;
    readonly label: string;
    readonly tagline: string;
    readonly resolveValue: (activeCycle: string) => string;
  }
> = {
  fy: {
    icon: CalendarRange,
    label: "Fiscal Year",
    tagline: "The org's current fiscal year span.",
    resolveValue: (c) => formatFyLabel(c),
  },
  goal: {
    icon: Target,
    label: "Goal Review Cycle",
    tagline: "H1 / H2 window goal reviews are tagged to.",
    resolveValue: deriveGoalReviewCycle,
  },
  project: {
    icon: CalendarDays,
    label: "Project Review Cycle",
    tagline: "All new project reviews are tagged to this period.",
    resolveValue: (c) => c,
  },
};

/** Tailwind doesn't pick up arbitrary `grid-cols-${n}` strings from
 *  string interpolation — the class names need to appear literally in
 *  the source for the static analyser. Map block-count → class. */
const GRID_COLS_CLASS: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
};

export function ActiveCyclesCard({
  activeCycle,
  blocks = DEFAULT_BLOCKS,
}: ActiveCyclesCardProps) {
  const colsClass = GRID_COLS_CLASS[blocks.length] ?? "sm:grid-cols-3";

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4 h-full justify-center">
      {/* `justify-center` centers the cycle blocks vertically inside
          the card so when the parent grid stretches it to match a
          taller neighbour (PendingActionsCard on HR_MyOrg's grid;
          ActionItemsWidget on the PM dashboard), the empty space
          distributes evenly top + bottom rather than dumping a
          large gap at the bottom. With no stretch the card sizes to
          content and this is a no-op. */}
      {/* Body — N cycle blocks side-by-side with a thin vertical
          divider between them on sm+ screens. Stacks on the smallest
          viewports so values stay readable.
          Default order (HR_MyOrg): Fiscal Year → Goal Review →
          Project Review (broad time anchor first, then the more
          specific cycle windows). HR_Miltenyi passes
          `["fy", "project"]` — same broad-to-specific reading. */}
      <div
        className={`grid grid-cols-1 ${colsClass} gap-4 sm:gap-0 sm:divide-x sm:divide-border`}
      >
        {blocks.map((kind, idx) => {
          const config = BLOCK_CONFIG[kind];
          const value = activeCycle ? config.resolveValue(activeCycle) : null;
          // First block has no left padding (no preceding divider);
          // subsequent blocks get sm:pl-4 to sit cleanly against the
          // divider line.
          return (
            <div key={kind} className={idx === 0 ? "" : "sm:pl-4"}>
              <CycleBlock
                icon={config.icon}
                label={config.label}
                value={value}
                tagline={config.tagline}
              />
            </div>
          );
        })}
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
