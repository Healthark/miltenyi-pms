import { Lock } from "lucide-react";
import {
  quarterLabel,
  type GoalReview,
  type PeriodSettings,
  type StepStatus,
} from "@/services/project-goals.service";
import { StepBadge, TH_CLS, fmtDate } from "@/components/project-goals/ui";

interface QuarterSelectorProps {
  readonly period: PeriodSettings;
  readonly value: string | null;
  readonly onChange: (cycleLabel: string) => void;
  /** Optional per-quarter hints rendered under each pill (e.g. "Reviewed"). */
  readonly hints?: Record<string, string>;
  readonly compact?: boolean;
}

/**
 * The quarter pills. All four quarters of the period are shown: started
 * ones (seq ≤ current) are selectable, the current one is marked, future
 * ones are locked until the Admin rolls them out in System Settings.
 */
export function QuarterSelector({ period, value, onChange, hints, compact = false }: QuarterSelectorProps) {
  const current = period.current_quarter_seq ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Quarter">
      {!compact && <span className={`${TH_CLS} mr-1`}>Quarter</span>}
      {[1, 2, 3, 4].map((seq) => {
        const label = quarterLabel(period.period_label, seq);
        const started = period.is_active && seq <= current;
        const selected = value === label;
        const isCurrent = seq === current;
        const hint = hints?.[label];
        return (
          <button
            key={seq}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={!started}
            onClick={() => started && onChange(label)}
            title={started ? `Q${seq} · ${period.period_label}` : `Q${seq} has not started yet`}
            className={`flex flex-col items-start rounded-lg border px-3 py-1.5 text-left transition-colors ${
              selected
                ? "border-brand bg-brand text-white"
                : started
                  ? "border-border bg-white text-text-main hover:bg-slate-50"
                  : "cursor-not-allowed border-dashed border-border bg-slate-50 text-text-muted"
            }`}
          >
            <span className="flex items-center gap-1.5 text-sm font-semibold">
              {!started && <Lock className="h-3 w-3" aria-hidden="true" />}
              Q{seq}
              {isCurrent && (
                <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${selected ? "bg-white/20 text-white" : "bg-brand-light text-brand-accent"}`}>
                  current
                </span>
              )}
            </span>
            {!compact && (
              <span className={`text-[11px] ${selected ? "text-white/80" : "text-text-muted"}`}>
                {started ? hint ?? period.period_label : "Not started"}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** The selected quarter's two steps and read receipt, as badges. */
export function QuarterProgress({ review, quarterOpen }: Readonly<{ review: GoalReview | null; quarterOpen: boolean }>) {
  const selfStatus: StepStatus = review?.self_status ?? "not_started";
  const reviewStatus: StepStatus = review?.review_status ?? "not_started";
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted" aria-label="Quarter progress">
      <span className="inline-flex items-center gap-1.5">
        Self-review <StepBadge status={selfStatus} />
      </span>
      <span className="h-px w-4 bg-border" aria-hidden="true" />
      <span className="inline-flex items-center gap-1.5">
        Miltenyi review <StepBadge status={reviewStatus} />
      </span>
      {review?.acknowledged_at && (
        <>
          <span className="h-px w-4 bg-border" aria-hidden="true" />
          <span className="inline-flex items-center gap-1 text-emerald-700">Acknowledged {fmtDate(review.acknowledged_at)}</span>
        </>
      )}
      {!quarterOpen && (
        <>
          <span className="h-px w-4 bg-border" aria-hidden="true" />
          <span className="inline-flex items-center gap-1">
            <Lock className="h-3 w-3" aria-hidden="true" /> Quarter closed
          </span>
        </>
      )}
    </div>
  );
}
