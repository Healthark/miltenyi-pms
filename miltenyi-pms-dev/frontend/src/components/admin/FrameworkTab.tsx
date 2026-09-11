/**
 * FrameworkTab — the Miltenyi goal-themes content behind Project Goals.
 *
 * Pick a function; the matrix shows one column per Level 1–4 (with the GCC
 * designations under each header) and three rows: Illustrative Business &
 * Strategic Outcomes, Illustrative Functional / Operational Excellence Goals,
 * and the KPI + weightage list. Edits are staged locally; Save writes every
 * changed row, Discard drops them. "Add Function" adds one role/level row
 * (title + the two paragraphs, then its KPI table), matching one row of the
 * Miltenyi document whose first column is headed "Function".
 *
 * Also here: the designation → level strip. The period switches (entry,
 * self-review, weightages, ratings) live in System Settings.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, FileQuestion, Loader2, Pencil, Plus, RotateCcw, Save, X } from "lucide-react";

import { queryKeys } from "@/lib/queryKeys";
import { getErrorMessage } from "@/utils/errors";
import { useToast } from "@/hooks/useToast";
import {
  goalFrameworkService,
  type FrameworkFunction,
  type FrameworkKpiInput,
  type FrameworkMatrix,
} from "@/services/goal-framework.service";
import type { FrameworkRow } from "@/services/project-goals.service";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, INPUT_CLS, KpiNumber, TEXTAREA_CLS, TH_CLS, WeightChip } from "@/components/project-goals/ui";

const LEVELS = [1, 2, 3, 4] as const;
const BAND: Record<number, string> = { 1: "Entry", 2: "Mid", 3: "Senior", 4: "Lead" };
const SELECT_CLS =
  "rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";

interface RowDraft {
  title: string;
  business_outcomes: string;
  functional_goals: string;
  kpis: FrameworkKpiInput[];
}

const draftOf = (row: FrameworkRow): RowDraft => ({
  title: row.title,
  business_outcomes: row.business_outcomes,
  functional_goals: row.functional_goals,
  kpis: row.kpis.map((k) => ({ text: k.text, weightage: k.weightage ?? 0 })),
});

const total = (kpis: FrameworkKpiInput[]) => kpis.reduce((a, k) => a + (Number(k.weightage) || 0), 0);

function TotalBadge({ value }: Readonly<{ value: number }>) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 font-mono text-[12px] font-semibold ${value === 100 ? "bg-emerald-100 text-emerald-700" : "bg-red-50 text-red-700"}`}>
      Total {value}%
    </span>
  );
}

function AutoTextarea({ value, onChange, placeholder, className }: Readonly<{ value: string; onChange: (v: string) => void; placeholder?: string; className?: string }>) {
  // Grows with content so long paragraphs never scroll inside the cell.
  const rows = Math.max(3, Math.min(14, Math.ceil(value.length / 48) + 1));
  return <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`${TEXTAREA_CLS} text-[13px] leading-relaxed ${className ?? ""}`} />;
}


export function FrameworkTab() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [error, setError] = useState("");

  const matrixQ = useQuery({ queryKey: queryKeys.admin.goalFrameworks(), queryFn: () => goalFrameworkService.getMatrix() });
  const matrix: FrameworkMatrix | undefined = matrixQ.data;

  const [fnId, setFnId] = useState<number | null>(null);
  useEffect(() => {
    if (!matrix || fnId !== null) return;
    const withRows = matrix.functions.find((f) => f.rows.length > 0) ?? matrix.functions[0];
    if (withRows) setFnId(withRows.function_id);
  }, [matrix, fnId]);
  const fn: FrameworkFunction | undefined = matrix?.functions.find((f) => f.function_id === fnId);
  const rowByLevel = useMemo(() => {
    const m = new Map<number, FrameworkRow>();
    fn?.rows.forEach((r) => m.set(r.level, r));
    return m;
  }, [fn]);

  // ── Staged edits ─────────────────────────────────────────────────
  const [drafts, setDrafts] = useState<Record<number, RowDraft>>({});
  const [editingKpis, setEditingKpis] = useState<Set<number>>(new Set());
  const dirty = Object.keys(drafts).length > 0;
  const draftFor = (row: FrameworkRow): RowDraft => drafts[row.id] ?? draftOf(row);
  const setDraft = (row: FrameworkRow, patch: Partial<RowDraft>) => setDrafts((d) => ({ ...d, [row.id]: { ...(d[row.id] ?? draftOf(row)), ...patch } }));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.projectGoals.all });
  };

  const saveAll = useMutation({
    mutationFn: async () => {
      for (const [rowId, d] of Object.entries(drafts)) {
        await goalFrameworkService.updateRow(Number(rowId), {
          title: d.title.trim(),
          business_outcomes: d.business_outcomes.trim(),
          functional_goals: d.functional_goals.trim(),
          kpis: d.kpis.map((k) => ({ text: k.text.trim(), weightage: Number(k.weightage) || 0 })),
        });
      }
    },
    onSuccess: () => { setError(""); setDrafts({}); setEditingKpis(new Set()); invalidate(); toast.success("Framework saved"); },
    onError: (e) => setError(getErrorMessage(e)),
  });
  const invalidDrafts = Object.values(drafts).some((d) => total(d.kpis) !== 100 || d.kpis.some((k) => !k.text.trim()) || !d.title.trim() || !d.business_outcomes.trim() || !d.functional_goals.trim());

  const setLevel = useMutation({
    mutationFn: ({ id, level }: { id: number; level: number }) => goalFrameworkService.setDesignationLevel(id, level),
    onSuccess: () => { invalidate(); toast.success("Designation level updated"); },
    onError: (e) => setError(getErrorMessage(e)),
  });

  // ── Add Function modal ───────────────────────────────────────────
  const [addOpen, setAddOpen] = useState<{ level: number | null } | null>(null);

  if (matrixQ.isPending) return <div className="p-5"><div className="h-80 animate-pulse rounded-lg bg-slate-100" /></div>;
  if (matrixQ.isError || !matrix) return <div className="p-5"><p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{matrixQ.error ? getErrorMessage(matrixQ.error) : "Could not load the framework."}</p></div>;

  const definedLevels = fn?.rows.length ?? 0;
  const kpiCount = fn?.rows.reduce((a, r) => a + r.kpis.length, 0) ?? 0;

  const emptyCell = (level: number) => (
    <div className="flex h-full min-h-[96px] items-center justify-center rounded-lg border border-dashed border-border text-center">
      <button type="button" onClick={() => setAddOpen({ level })} className="flex items-center gap-1.5 text-xs font-medium text-brand-accent hover:underline">
        <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Add level {level}
      </button>
    </div>
  );

  const kpiCell = (row: FrameworkRow) => {
    const d = draftFor(row);
    const t = total(d.kpis);
    const editing = editingKpis.has(row.id);
    if (!editing) {
      return (
        <>
          <ol className="space-y-2.5">
            {d.kpis.map((k, i) => (
              <li key={`${row.id}-${i}`} className="flex items-start gap-2.5">
                <KpiNumber n={i + 1} />
                <p className="flex-1 text-[13px] leading-snug text-text-main">{k.text || <span className="italic text-text-muted">Untitled KPI</span>}</p>
                <WeightChip weight={k.weightage} />
              </li>
            ))}
          </ol>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
            <button type="button" onClick={() => setEditingKpis((s) => new Set(s).add(row.id))} className="flex items-center gap-1 text-[12px] font-medium text-brand-accent hover:underline">
              <Pencil className="h-3 w-3" aria-hidden="true" /> Edit KPIs
            </button>
            <TotalBadge value={t} />
          </div>
        </>
      );
    }
    const setKpis = (kpis: FrameworkKpiInput[]) => setDraft(row, { kpis });
    return (
      <div className="space-y-2.5">
        {d.kpis.map((k, i) => (
          <div key={`${row.id}-${i}`} className="rounded-lg border border-border bg-white p-2.5">
            <div className="mb-1 flex items-center justify-between">
              <span className={TH_CLS}>KPI {i + 1}</span>
              <button type="button" onClick={() => setKpis(d.kpis.filter((_, j) => j !== i))} className="rounded p-0.5 text-text-muted hover:text-red-600" title="Remove KPI"><X className="h-3.5 w-3.5" /></button>
            </div>
            <AutoTextarea value={k.text} onChange={(v) => setKpis(d.kpis.map((x, j) => (j === i ? { ...x, text: v } : x)))} placeholder="KPI / success measure" />
            <div className="mt-1.5 flex items-center gap-2">
              <label className="text-[11px] text-text-muted">Weightage</label>
              <input type="number" min={0} max={100} value={k.weightage} onChange={(e) => setKpis(d.kpis.map((x, j) => (j === i ? { ...x, weightage: Number(e.target.value) } : x)))} className="w-20 rounded-lg border border-border bg-white px-2 py-1 text-right font-mono text-[13px] outline-none focus:border-brand" />
              <span className="text-[11px] text-text-muted">%</span>
            </div>
          </div>
        ))}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setKpis([...d.kpis, { text: "", weightage: 0 }])} className="flex items-center gap-1 text-[12px] font-medium text-brand-accent hover:underline"><Plus className="h-3 w-3" /> Add KPI</button>
            <button type="button" onClick={() => setEditingKpis((s) => { const n = new Set(s); n.delete(row.id); return n; })} className="flex items-center gap-1 rounded-md bg-brand-light px-2 py-0.5 text-[12px] font-medium text-brand-accent hover:bg-brand hover:text-white transition-colors"><Check className="h-3 w-3" /> Done</button>
          </div>
          <TotalBadge value={t} />
        </div>
      </div>
    );
  };

  const rowLabel = (title: string, sub: string) => (
    <th scope="row" className="w-[190px] border-b border-border bg-slate-50 px-3 py-3 text-left align-top">
      <div className="text-[13px] font-semibold text-text-main">{title}</div>
      <div className="mt-0.5 text-[11px] font-normal text-text-muted">{sub}</div>
    </th>
  );

  return (
    <div className="space-y-4 p-5">
      {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="fw-fn" className={TH_CLS}>Framework for</label>
            <select id="fw-fn" value={fnId ?? ""} onChange={(e) => { setFnId(Number(e.target.value)); setDrafts({}); setEditingKpis(new Set()); }} className={`${SELECT_CLS} min-w-[240px]`}>
              {matrix.functions.map((f) => <option key={f.function_id} value={f.function_id}>{f.function_name}{f.rows.length ? "" : " (no rows)"}</option>)}
            </select>
          </div>
          <span className="inline-flex items-center rounded-full border border-border bg-slate-100 px-2.5 py-0.5 text-xs text-text-main">{kpiCount} KPIs · {definedLevels} of 4 levels defined · {matrix.period_label}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" disabled={!dirty || saveAll.isPending} onClick={() => { setDrafts({}); setEditingKpis(new Set()); }} className={BTN_SECONDARY}><RotateCcw className="h-4 w-4" /> Discard</button>
          <button type="button" disabled={!dirty || invalidDrafts || saveAll.isPending} title={invalidDrafts ? "Every changed row needs a title, both paragraphs, KPI text and weights totalling 100" : undefined} onClick={() => saveAll.mutate()} className={BTN_PRIMARY}>
            {saveAll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </button>
          <button type="button" onClick={() => setAddOpen({ level: null })} className={BTN_PRIMARY}><Plus className="h-4 w-4" /> Add Function</button>
        </div>
      </div>
      <p className="text-xs text-text-muted">
        Define the framework each employee is evaluated against: per level, the two illustrative paragraphs and the KPIs with their weightages. Edits are staged; click Save to apply them all at once. "Add Function" adds one role/level row, as in the first column of Miltenyi's document.
      </p>

      {/* Designations → levels */}
      {fn && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <p className={TH_CLS}>Designations → levels</p>
          <p className="mt-0.5 text-xs text-text-muted">Map each GCC designation in {fn.function_name} to a level. The matrix below has one column per level. Changes apply immediately.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {fn.designations.length === 0 && <span className="text-xs italic text-text-muted">No designations are linked to this function yet.</span>}
            {fn.designations.map((d) => (
              <label key={d.id} className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 text-sm text-text-main">
                <span>{d.name}</span>
                <span className="text-xs text-text-muted">L</span>
                <select value={d.career_level ?? ""} onChange={(e) => setLevel.mutate({ id: d.id, level: Number(e.target.value) })} className="rounded-md border border-border bg-white px-1.5 py-0.5 text-[13px] outline-none focus:border-brand">
                  <option value="" disabled>—</option>
                  {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </label>
            ))}
          </div>
        </section>
      )}

      {/* Matrix or empty state */}
      {fn && definedLevels === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <FileQuestion className="h-8 w-8 text-text-muted" aria-hidden="true" />
          <p className="mt-3 font-medium text-text-main">No framework rows for {fn.function_name} yet.</p>
          <p className="mt-1 max-w-md text-sm text-text-muted">Employees in this function see a notice instead of goal boxes until rows exist. Add the first role/level row to start.</p>
          <button type="button" onClick={() => setAddOpen({ level: 1 })} className={`${BTN_PRIMARY} mt-4`}><Plus className="h-4 w-4" /> Add Function</button>
        </div>
      ) : fn ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[1420px] border-collapse">
            <thead className="bg-slate-50">
              <tr>
                <th className="w-[190px] border-b border-border px-3 py-2.5 text-left"><span className={TH_CLS}>Framework · {matrix.period_label}</span></th>
                {LEVELS.map((l) => {
                  const row = rowByLevel.get(l);
                  const ds = fn.designations.filter((d) => d.career_level === l).map((d) => d.name).join(", ");
                  return (
                    <th key={l} scope="col" className="min-w-[300px] border-b border-border px-3 py-2.5 text-left align-top">
                      <div className={TH_CLS}>Level {l} <span className="font-normal normal-case tracking-normal text-text-muted">· {BAND[l]}</span></div>
                      {row ? (
                        <input value={draftFor(row).title} onChange={(e) => setDraft(row, { title: e.target.value })} className="mt-0.5 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[13px] font-semibold text-text-main hover:border-border focus:border-brand focus:bg-white focus:outline-none" title="Role title, as printed in the document" />
                      ) : (
                        <div className="mt-0.5 text-[13px] italic text-text-muted">Not defined</div>
                      )}
                      <div className="mt-0.5 text-[11px] text-text-muted">{ds || "No designation at this level"}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody className="align-top">
              <tr>
                {rowLabel("Illustrative Business & Strategic Outcomes", "one paragraph per level")}
                {LEVELS.map((l) => { const row = rowByLevel.get(l); return <td key={l} className="border-b border-border px-3 py-3">{row ? <AutoTextarea value={draftFor(row).business_outcomes} onChange={(v) => setDraft(row, { business_outcomes: v })} placeholder="Business & strategic outcomes for this level" /> : emptyCell(l)}</td>; })}
              </tr>
              <tr>
                {rowLabel("Illustrative Functional / Operational Excellence Goals", "one paragraph per level")}
                {LEVELS.map((l) => { const row = rowByLevel.get(l); return <td key={l} className="border-b border-border px-3 py-3">{row ? <AutoTextarea value={draftFor(row).functional_goals} onChange={(v) => setDraft(row, { functional_goals: v })} placeholder="Functional / operational excellence goals for this level" /> : emptyCell(l)}</td>; })}
              </tr>
              <tr>
                {rowLabel("Illustrative KPI / Success Measures · Weightage", "4–7 KPIs per level, weightages total 100%")}
                {LEVELS.map((l) => { const row = rowByLevel.get(l); return <td key={l} className="px-3 py-3">{row ? kpiCell(row) : emptyCell(l)}</td>; })}
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}


      {addOpen && fn && (
        <AddFunctionModal
          functions={matrix.functions}
          defaultFunctionId={fn.function_id}
          defaultLevel={addOpen.level}
          periodLabel={matrix.period_label}
          onClose={() => setAddOpen(null)}
          onCreated={() => { setAddOpen(null); invalidate(); toast.success("Framework row added"); }}
        />
      )}
    </div>
  );
}

// ── Add Function (one role/level row) ───────────────────────────────

const DEFAULT_KPIS: FrameworkKpiInput[] = [
  { text: "", weightage: 30 }, { text: "", weightage: 25 }, { text: "", weightage: 20 }, { text: "", weightage: 15 }, { text: "", weightage: 10 },
];

function AddFunctionModal({
  functions, defaultFunctionId, defaultLevel, periodLabel, onClose, onCreated,
}: Readonly<{ functions: FrameworkFunction[]; defaultFunctionId: number; defaultLevel: number | null; periodLabel: string; onClose: () => void; onCreated: () => void }>) {
  const [step, setStep] = useState<1 | 2>(1);
  const [functionId, setFunctionId] = useState(defaultFunctionId);
  const usedLevels = useMemo(() => new Set((functions.find((f) => f.function_id === functionId)?.rows ?? []).map((r) => r.level)), [functions, functionId]);
  const firstFree = LEVELS.find((l) => !usedLevels.has(l)) ?? null;
  const [level, setLevel] = useState<number | null>(defaultLevel && !usedLevels.has(defaultLevel) ? defaultLevel : firstFree);
  useEffect(() => { if (level === null || usedLevels.has(level)) setLevel(LEVELS.find((l) => !usedLevels.has(l)) ?? null); }, [usedLevels, level]);
  const [title, setTitle] = useState("");
  const [outcomes, setOutcomes] = useState("");
  const [functional, setFunctional] = useState("");
  const [kpis, setKpis] = useState<FrameworkKpiInput[]>(DEFAULT_KPIS);
  const [error, setError] = useState("");

  const create = useMutation({
    mutationFn: () => goalFrameworkService.createRow({
      function_id: functionId, level: level!, period_label: periodLabel,
      title: title.trim(), business_outcomes: outcomes.trim(), functional_goals: functional.trim(),
      kpis: kpis.map((k) => ({ text: k.text.trim(), weightage: Number(k.weightage) || 0 })),
    }),
    onSuccess: onCreated,
    onError: (e) => setError(getErrorMessage(e)),
  });

  const step1Ok = level !== null && title.trim() && outcomes.trim() && functional.trim();
  const t = total(kpis);
  const step2Ok = kpis.length > 0 && kpis.every((k) => k.text.trim()) && t === 100;
  const fnName = functions.find((f) => f.function_id === functionId)?.function_name ?? "";

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col rounded-xl bg-surface shadow-xl">
        <div className="flex shrink-0 items-center justify-between border-b border-border px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display text-base font-semibold text-text-main">Add Function</h2>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">Step {step} of 2</span>
            </div>
            <p className="mt-0.5 text-xs text-text-muted">One row of the framework: the role at a level, its two illustrative paragraphs, then its KPIs and weightages.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {error && <p className="mb-3 rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
          {step === 1 ? (
            <div className="space-y-4 text-sm">
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-text-main">Function (department)</span>
                  <select value={functionId} onChange={(e) => setFunctionId(Number(e.target.value))} className={`${INPUT_CLS} cursor-pointer`}>
                    {functions.map((f) => <option key={f.function_id} value={f.function_id}>{f.function_name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-text-main">Level</span>
                  <select value={level ?? ""} onChange={(e) => setLevel(Number(e.target.value))} className={`${INPUT_CLS} cursor-pointer`}>
                    {LEVELS.map((l) => <option key={l} value={l} disabled={usedLevels.has(l)}>Level {l} · {BAND[l]}{usedLevels.has(l) ? " (defined)" : ""}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-text-main">Function <span className="font-normal text-text-muted">(role title, as in the PDF)</span></span>
                  <input className={INPUT_CLS} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Pharmacovigilance Analyst" maxLength={200} />
                </label>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-text-main">Illustrative Business &amp; Strategic Outcomes *</span>
                <textarea rows={3} maxLength={4000} className={TEXTAREA_CLS} value={outcomes} onChange={(e) => setOutcomes(e.target.value)} placeholder="What this role exists to deliver for the business." />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-semibold text-text-main">Illustrative Functional / Operational Excellence Goals *</span>
                <textarea rows={3} maxLength={4000} className={TEXTAREA_CLS} value={functional} onChange={(e) => setFunctional(e.target.value)} placeholder="How the role delivers it: activities, standards, collaboration." />
              </label>
              {level === null && <p className="text-xs text-amber-800">All four levels are already defined for {fnName}. Pick another function, or edit the existing rows in the matrix.</p>}
              <p className="text-xs text-text-muted">The KPI table opens after this step.</p>
            </div>
          ) : (
            <div className="space-y-4 text-sm">
              <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-[13px] text-blue-800"><b>{title.trim()}</b> · {fnName} · Level {level}. Now add the KPIs and their weightages.</div>
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="grid grid-cols-[40px_1fr_120px_44px] gap-3 border-b border-border bg-slate-50 px-4 py-2.5">
                  <span className={TH_CLS}>#</span><span className={TH_CLS}>Illustrative KPI / success measure</span><span className={`${TH_CLS} text-right`}>Weightage %</span><span />
                </div>
                {kpis.map((k, i) => (
                  <div key={i} className="grid grid-cols-[40px_1fr_120px_44px] items-center gap-3 border-b border-border px-4 py-2 last:border-b-0">
                    <span className="text-sm text-text-muted">{i + 1}</span>
                    <input value={k.text} onChange={(e) => setKpis(kpis.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} placeholder="KPI / success measure" className={INPUT_CLS} maxLength={2000} />
                    <input type="number" min={0} max={100} value={k.weightage} onChange={(e) => setKpis(kpis.map((x, j) => (j === i ? { ...x, weightage: Number(e.target.value) } : x)))} className={`${INPUT_CLS} text-right font-mono`} />
                    <button type="button" onClick={() => setKpis(kpis.filter((_, j) => j !== i))} className="rounded-md p-1.5 text-text-muted hover:text-red-600" title="Remove"><X className="h-4 w-4" /></button>
                  </div>
                ))}
                <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5">
                  <button type="button" onClick={() => setKpis([...kpis, { text: "", weightage: 0 }])} className="flex items-center gap-1.5 text-xs font-medium text-brand-accent hover:underline"><Plus className="h-3.5 w-3.5" /> Add KPI</button>
                  <div className="flex items-center gap-2 text-xs"><span className="text-text-muted">Total</span><span className={`font-mono text-sm font-semibold ${t === 100 ? "text-emerald-700" : "text-red-700"}`}>{t}%</span></div>
                </div>
              </div>
              <p className="text-xs text-text-muted">Weightages must total 100 before the row can be saved.</p>
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-6 py-4">
          <p className="text-xs text-text-muted">{step === 1 ? "Fields marked * are required." : "Weightages must total 100%."}</p>
          <div className="flex items-center gap-3">
            {step === 2 && <button type="button" onClick={() => setStep(1)} className={BTN_GHOST}>Back</button>}
            <button type="button" onClick={onClose} className={BTN_GHOST}>Cancel</button>
            {step === 1 ? (
              <button type="button" disabled={!step1Ok} onClick={() => setStep(2)} className={BTN_PRIMARY}>Next: KPIs <ArrowRight className="h-4 w-4" /></button>
            ) : (
              <button type="button" disabled={!step2Ok || create.isPending} onClick={() => create.mutate()} className={BTN_PRIMARY}>
                {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save row
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
