import { CalendarDays, CalendarRange, ClipboardList, Target } from "lucide-react";
import { cyLabel, cycleAsCy, formatFyLabel, startYearOf } from "@/utils/fy";
import { quarterDisplay, type PeriodSettings } from "@/services/project-goals.service";

/** The two period fields the card reads; satisfied by PeriodSettings and PeriodBrief alike. */
export type PeriodLike = Pick<PeriodSettings, "period_label" | "current_quarter_label">;

/**
 * ActiveCyclesCard — the "where are we now" strip at the top of every
 * dashboard. Blocks render side by side, in the order given.
 *
 * Project Goals orgs (the Miltenyi instance) show:
 *   goalYear — the Project Goals year ("CY 26-27"), set once a year
 *   quarter  — the current review quarter ("Q3 · CY 26-27")
 *   annual   — the half the annual goal reviews sit in ("H1 · CY 26-27")
 *
 * Other orgs keep the legacy blocks derived from
 * `SystemSettings.active_cycle_name`:
 *   fy       — the year span, goal — the H1/H2 goal-review half,
 *   project  — the raw project-review cycle (only with that feature on).
 *
 * Every year is spelled as a calendar-year span ("CY 26-27"); "FY26-27"
 * stays a stored token only.
 */
export type ActiveCycleBlock = "goalYear" | "quarter" | "annual" | "fy" | "goal" | "project";

export const PROJECT_GOALS_BLOCKS: readonly ActiveCycleBlock[] = ["goalYear", "quarter", "annual"];
export const LEGACY_BLOCKS: readonly ActiveCycleBlock[] = ["fy", "goal"];
export const LEGACY_BLOCKS_WITH_PROJECT_REVIEWS: readonly ActiveCycleBlock[] = ["fy", "goal", "project"];

interface ActiveCyclesCardProps {
  /** `SystemSettings.active_cycle_name`, e.g. "H1 FY26-27". */
  readonly activeCycle: string | null;
  /** The Project Goals period: undefined while loading, null when none is active. */
  readonly period?: PeriodLike | null;
  readonly blocks?: readonly ActiveCycleBlock[];
}

interface Resolved {
  readonly value: string | null;
  readonly hint: string;
  readonly loading?: boolean;
}

const LOADING: Resolved = { value: null, hint: "", loading: true };
const NOT_CONFIGURED: Resolved = { value: null, hint: "Ask your administrator to set the active cycle." };

/** Goal self- and mentor-reviews are filed half-yearly regardless of the
 *  cadence: "Q3 FY26-27" → "H2 FY26-27"; half-yearly names pass through. */
function deriveGoalReviewCycle(activeCycle: string): string {
  const parts = activeCycle.trim().split(/\s+/);
  if (parts.length < 2) return activeCycle;
  const prefix = parts[0].toUpperCase();
  const token = parts.slice(1).join(" ");
  if (prefix === "Q1" || prefix === "Q2") return `H1 ${token}`;
  if (prefix === "Q3" || prefix === "Q4") return `H2 ${token}`;
  return activeCycle;
}

function resolve(kind: ActiveCycleBlock, activeCycle: string | null, period: PeriodLike | null | undefined): Resolved {
  switch (kind) {
    case "goalYear":
      if (period === undefined) return LOADING;
      return period
        ? { value: period.period_label, hint: "Project goals are set once for this year." }
        : { value: null, hint: "No goal year is active. The Admin starts one in System Settings → Project Goals." };
    case "quarter":
      if (period === undefined) return LOADING;
      if (!period) return { value: null, hint: "Quarterly reviews start with the goal year." };
      return period.current_quarter_label
        ? { value: quarterDisplay(period.current_quarter_label), hint: "Self-reviews and Miltenyi reviews are open for this quarter; earlier quarters stay open for backfill while the Admin allows it." }
        : { value: null, hint: "Quarterly reviews start when the Admin rolls out Q1." };
    case "annual":
      return activeCycle
        ? { value: cycleAsCy(activeCycle), hint: "Annual goal reviews run half-yearly; the annual review is once a year." }
        : NOT_CONFIGURED;
    case "fy": {
      if (!activeCycle) return NOT_CONFIGURED;
      const y = startYearOf(activeCycle);
      return { value: y ? cyLabel(y) : formatFyLabel(activeCycle), hint: "The org's current year." };
    }
    case "goal":
      return activeCycle
        ? { value: cycleAsCy(deriveGoalReviewCycle(activeCycle)), hint: "The half goal reviews are tagged to." }
        : NOT_CONFIGURED;
    case "project":
      return activeCycle
        ? { value: activeCycle, hint: "All new project reviews are tagged to this period." }
        : NOT_CONFIGURED;
  }
}

const BLOCK_META: Record<ActiveCycleBlock, { readonly icon: typeof CalendarDays; readonly label: string }> = {
  goalYear: { icon: ClipboardList, label: "Goal year" },
  quarter: { icon: CalendarDays, label: "Current quarter" },
  annual: { icon: Target, label: "Annual goals & reviews" },
  fy: { icon: CalendarRange, label: "Year" },
  goal: { icon: Target, label: "Goal review cycle" },
  project: { icon: CalendarDays, label: "Project review cycle" },
};

/** Tailwind needs the class names spelled out for its static analysis. */
const GRID_COLS_CLASS: Record<number, string> = {
  1: "sm:grid-cols-1",
  2: "sm:grid-cols-2",
  3: "sm:grid-cols-3",
};

export function ActiveCyclesCard({ activeCycle, period, blocks = PROJECT_GOALS_BLOCKS }: ActiveCyclesCardProps) {
  const colsClass = GRID_COLS_CLASS[blocks.length] ?? "sm:grid-cols-3";

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4 h-full justify-center">
      <div className={`grid grid-cols-1 ${colsClass} gap-4 sm:gap-0 sm:divide-x sm:divide-border`}>
        {blocks.map((kind, idx) => {
          const meta = BLOCK_META[kind];
          const r = resolve(kind, activeCycle, period);
          const Icon = meta.icon;
          return (
            <div key={kind} className={idx === 0 ? "" : "sm:pl-4"}>
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1.5 text-text-muted">
                  <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="text-[11px] font-medium uppercase tracking-wide">{meta.label}</span>
                </div>
                {r.loading ? (
                  <div className="animate-pulse space-y-1.5" aria-label="Loading">
                    <div className="h-6 w-28 rounded bg-slate-100" />
                    <div className="h-3 w-40 rounded bg-slate-100" />
                  </div>
                ) : r.value ? (
                  <>
                    <p className="font-display text-xl font-semibold text-text-main">{r.value}</p>
                    <p className="text-xs text-text-muted">{r.hint}</p>
                  </>
                ) : (
                  <>
                    <p className="font-display text-base font-medium text-text-muted">Not set</p>
                    <p className="text-xs text-text-muted">{r.hint}</p>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}
