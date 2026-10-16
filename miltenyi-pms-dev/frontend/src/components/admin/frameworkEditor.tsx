/**
 * frameworkEditor — the framework column editor pieces shared by the
 * Framework tab (role columns) and the personal-framework modal (one staff
 * member's own framework, 16 Oct 2026): the total badge, the auto-growing
 * paragraph box and the KPI list with the pinned Additional goals row. The
 * draft shape and the 100% rule are in frameworkDraft.ts.
 */
import type { ReactNode } from "react";
import { Lock, Plus, X } from "lucide-react";

import type { FrameworkKpiInput } from "@/services/goal-framework.service";
import { TEXTAREA_CLS, TH_CLS } from "@/components/project-goals/ui";
import { kpiTotal } from "@/components/admin/frameworkDraft";

export function TotalBadge({ value }: Readonly<{ value: number }>) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 font-mono text-[12px] font-semibold ${value === 100 ? "bg-emerald-100 text-emerald-700" : "bg-red-50 text-red-700"}`}>
      Total {value}%
    </span>
  );
}

export function AutoTextarea({ value, onChange, placeholder, className, ariaLabel }: Readonly<{ value: string; onChange: (v: string) => void; placeholder?: string; className?: string; ariaLabel?: string }>) {
  // Grows with content so long paragraphs never scroll inside the cell.
  const rows = Math.max(3, Math.min(14, Math.ceil(value.length / 48) + 1));
  return <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={ariaLabel} className={`${TEXTAREA_CLS} text-[13px] leading-relaxed ${className ?? ""}`} />;
}

const WEIGHT_INPUT_CLS = "w-20 rounded-lg border border-border bg-white px-2 py-1 text-right font-mono text-[13px] outline-none focus:border-brand";
const DEFAULT_EXTRA_NOTE = "One free-text row at the end of every sheet; whether it shows is the year's switch in System Settings.";

/** The KPI list in edit mode: text + weightage per KPI, the pinned
 *  Additional goals row, Add KPI and the running total. `canAddRemove`
 *  false keeps the rows fixed (approved goals: texts and weights only). */
export function KpiListEditor<K extends FrameworkKpiInput>({
  idPrefix,
  kpis,
  onKpisChange,
  newKpi,
  extra,
  onExtraChange,
  canAddRemove = true,
  lockedReason,
  extraNote = DEFAULT_EXTRA_NOTE,
  kpiBadge,
  actions,
}: Readonly<{
  idPrefix: string;
  kpis: K[];
  onKpisChange: (kpis: K[]) => void;
  newKpi: () => K;
  extra: number;
  onExtraChange: (w: number) => void;
  canAddRemove?: boolean;
  lockedReason?: string;
  extraNote?: string;
  kpiBadge?: (k: K, i: number) => ReactNode;
  actions?: ReactNode;
}>) {
  const t = kpiTotal(kpis) + (Number(extra) || 0);
  return (
    <div className="space-y-2.5">
      {kpis.map((k, i) => (
        <div key={`${idPrefix}-${i}`} className="rounded-lg border border-border bg-white p-2.5">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className={TH_CLS}>KPI {i + 1}</span>
              {kpiBadge?.(k, i)}
            </span>
            {canAddRemove ? (
              <button type="button" onClick={() => onKpisChange(kpis.filter((_, j) => j !== i))} className="rounded p-0.5 text-text-muted hover:text-red-600" title="Remove KPI"><X className="h-3.5 w-3.5" /></button>
            ) : (
              <span className="rounded p-0.5 text-text-muted opacity-60" title={lockedReason}><Lock className="h-3.5 w-3.5" aria-hidden="true" /></span>
            )}
          </div>
          <AutoTextarea value={k.text} onChange={(v) => onKpisChange(kpis.map((x, j) => (j === i ? { ...x, text: v } : x)))} placeholder="KPI / success measure" ariaLabel={`KPI ${i + 1} text`} />
          <div className="mt-1.5 flex items-center gap-2">
            <label className="text-[11px] text-text-muted" htmlFor={`${idPrefix}-w-${i}`}>Weightage</label>
            <input id={`${idPrefix}-w-${i}`} type="number" min={0} max={100} value={k.weightage} onChange={(e) => onKpisChange(kpis.map((x, j) => (j === i ? { ...x, weightage: Number(e.target.value) } : x)))} className={WEIGHT_INPUT_CLS} />
            <span className="text-[11px] text-text-muted">%</span>
          </div>
        </div>
      ))}
      <div className="rounded-lg border border-dashed border-border bg-slate-50/70 p-2.5">
        <div className="mb-1 flex items-center justify-between">
          <span className={TH_CLS}>Additional goals</span>
          <span className="inline-flex items-center gap-1 text-[11px] text-text-muted" title="This row cannot be removed; set its weightage, or 0 when the year's switch is off"><Lock className="h-3 w-3" aria-hidden="true" /> fixed row</span>
        </div>
        <p className="text-[12px] text-text-muted">{extraNote}</p>
        <div className="mt-1.5 flex items-center gap-2">
          <label className="text-[11px] text-text-muted" htmlFor={`${idPrefix}-w-extra`}>Weightage</label>
          <input id={`${idPrefix}-w-extra`} type="number" min={0} max={100} value={extra} onChange={(e) => onExtraChange(Number(e.target.value))} className={WEIGHT_INPUT_CLS} />
          <span className="text-[11px] text-text-muted">%</span>
        </div>
      </div>
      <div className="flex items-center justify-between pt-1">
        <div className="flex items-center gap-3">
          <button type="button" disabled={!canAddRemove} title={canAddRemove ? undefined : lockedReason} onClick={() => onKpisChange([...kpis, newKpi()])} className="flex items-center gap-1 text-[12px] font-medium text-brand-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:no-underline"><Plus className="h-3 w-3" /> Add KPI</button>
          {actions}
        </div>
        <TotalBadge value={t} />
      </div>
    </div>
  );
}
