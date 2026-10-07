import { Lock } from "lucide-react";
import { StepBadge, TH_CLS } from "@/components/project-goals/ui";
import type { ReviewStep } from "@/services/goal.service";
import { cyLabel } from "@/utils/fy";
import { activeHalfAndFy } from "@/utils/goalStatus";
import { HALVES, halfOpen, halfStarted, stepStatus, type Half } from "@/components/annual-goals/helpers";

interface HalfSelectorProps {
  readonly fyYear: number;
  readonly activeCycleName: string | null | undefined;
  readonly value: Half;
  readonly onChange: (half: Half) => void;
  /** Optional per-half hints rendered under each pill (e.g. "Reviewed"). */
  readonly hints?: Partial<Record<Half, string>>;
}

/**
 * The H1 / H2 pills of one annual goal year: the annual-goals twin of the
 * Project Goals quarter selector. A half that has started is selectable;
 * the current one is marked while the year is the active one; a half not
 * reached yet is locked. H1 stays open for backfill during H2.
 */
export function HalfSelector({ fyYear, activeCycleName, value, onChange, hints }: HalfSelectorProps) {
  const current = activeHalfAndFy(activeCycleName);
  return (
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Half">
      <span className={`${TH_CLS} mr-1`}>Half</span>
      {HALVES.map((h) => {
        const started = halfStarted(h, fyYear, activeCycleName);
        const open = halfOpen(h, fyYear, activeCycleName);
        const selected = value === h;
        const isCurrent = !!current && current.fyYear === fyYear && current.half === h;
        const hint = hints?.[h];
        const sub = !started
          ? "Not started"
          : hint ?? (isCurrent ? cyLabel(fyYear) : open ? "Open for backfill" : "Closed");
        return (
          <button
            key={h}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={!started}
            onClick={() => started && onChange(h)}
            title={started ? `${h} · ${cyLabel(fyYear)}` : `${h} has not started yet`}
            className={`flex flex-col items-start rounded-lg border px-3 py-1.5 text-left transition-colors ${
              selected
                ? "border-brand bg-brand text-white"
                : started
                  ? "border-border bg-white text-text-main hover:bg-slate-50"
                  : "cursor-not-allowed border-dashed border-border bg-slate-50 text-text-muted"
            }`}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              {(!started || !open) && <Lock className="h-3 w-3" aria-hidden="true" />}
              {h}
              {isCurrent && (
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${selected ? "bg-white/20 text-white" : "bg-brand-light text-brand-accent"}`}>
                  current
                </span>
              )}
            </span>
            <span className={`text-[11px] ${selected ? "text-white/80" : "text-text-muted"}`}>{sub}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The selected half's two steps as badges. */
export function HalfProgress({
  selfStep,
  mentorStep,
  open,
}: Readonly<{ selfStep: ReviewStep; mentorStep: ReviewStep; open: boolean }>) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted" aria-label="Half progress">
      <span className="inline-flex items-center gap-1.5">
        Self-review <StepBadge status={stepStatus(selfStep)} />
      </span>
      <span className="h-px w-4 bg-border" aria-hidden="true" />
      <span className="inline-flex items-center gap-1.5">
        Mentor review <StepBadge status={stepStatus(mentorStep)} />
      </span>
      {!open && (
        <>
          <span className="h-px w-4 bg-border" aria-hidden="true" />
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3 w-3" aria-hidden="true" /> Half closed
          </span>
        </>
      )}
    </div>
  );
}

/** Year dropdown for the annual goals pages. Hidden when there is only one year. */
export function AnnualYearSelector({
  years,
  value,
  activeYear,
  onChange,
  id = "annual-goal-year",
}: Readonly<{
  years: readonly number[];
  value: number | null;
  activeYear: number | null;
  onChange: (year: number) => void;
  id?: string;
}>) {
  if (years.length <= 1) return null;
  return (
    <label className="flex items-center gap-2">
      <span className={TH_CLS}>Goal year</span>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {cyLabel(y)}
            {y === activeYear ? " (current)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
