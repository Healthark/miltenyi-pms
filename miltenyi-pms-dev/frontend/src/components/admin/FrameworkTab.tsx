/**
 * FrameworkTab — the Miltenyi goal-themes content behind Project Goals.
 *
 * Pick a function; the matrix shows one column per defined level (with the
 * GCC designations under each header) and three rows: Illustrative Business
 * & Strategic Outcomes, Illustrative Functional / Operational Excellence
 * Goals, and the KPI + weightage list. Everything is edited in the table.
 * Edits are staged locally; Save writes every changed or new column, Discard
 * drops them. A new level is added as a column straight in the table.
 *
 * Reference data lives here too: add / rename a function, add / rename a
 * designation (with its level, 1–12), and the designation → level strip.
 * The period switches and the quarter roll-out are in System Settings.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileQuestion, Loader2, Pencil, Plus, RotateCcw, Save, X } from "lucide-react";

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

export const MAX_LEVEL = 12;
const LEVEL_OPTIONS = Array.from({ length: MAX_LEVEL }, (_, i) => i + 1);
/** Band names exist only for the four GCC levels; higher levels are just "Level N". */
const BAND: Record<number, string> = { 1: "Entry", 2: "Mid", 3: "Senior", 4: "Lead" };
const SELECT_CLS =
  "rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";
const DEFAULT_KPIS: FrameworkKpiInput[] = [30, 25, 20, 15, 10].map((w) => ({ text: "", weightage: w }));

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

const emptyDraft = (): RowDraft => ({ title: "", business_outcomes: "", functional_goals: "", kpis: DEFAULT_KPIS.map((k) => ({ ...k })) });

const total = (kpis: FrameworkKpiInput[]) => kpis.reduce((a, k) => a + (Number(k.weightage) || 0), 0);
const draftValid = (d: RowDraft) => total(d.kpis) === 100 && d.kpis.length > 0 && d.kpis.every((k) => k.text.trim()) && !!d.title.trim() && !!d.business_outcomes.trim() && !!d.functional_goals.trim();
const levelName = (l: number) => (BAND[l] ? `Level ${l} · ${BAND[l]}` : `Level ${l}`);

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

// ── Small modals ─────────────────────────────────────────────────────

function ModalShell({ title, subtitle, onClose, children, footer }: Readonly<{ title: string; subtitle?: string; onClose: () => void; children: React.ReactNode; footer: React.ReactNode }>) {
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-text-main">{title}</h2>
            {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
        <div className="space-y-4 px-6 py-5 text-sm">{children}</div>
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">{footer}</div>
      </div>
    </div>,
    document.body,
  );
}

/** Add or rename a function; rename a designation. One text field. */
function NameModal({ title, subtitle, label, initial, saveLabel, onClose, onSave, isSaving, error }: Readonly<{
  title: string; subtitle?: string; label: string; initial: string; saveLabel: string;
  onClose: () => void; onSave: (name: string) => void; isSaving: boolean; error: string;
}>) {
  const [name, setName] = useState(initial);
  const ok = name.trim().length > 0 && name.trim() !== initial.trim();
  return (
    <ModalShell title={title} subtitle={subtitle} onClose={onClose} footer={
      <>
        <button type="button" onClick={onClose} className={BTN_GHOST}>Cancel</button>
        <button type="button" disabled={!ok || isSaving} onClick={() => onSave(name.trim())} className={BTN_PRIMARY}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {saveLabel}
        </button>
      </>
    }>
      {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-text-main">{label}</span>
        <input className={INPUT_CLS} value={name} onChange={(e) => setName(e.target.value)} maxLength={120} autoFocus onKeyDown={(e) => { if (e.key === "Enter" && ok) onSave(name.trim()); }} />
      </label>
    </ModalShell>
  );
}

/** Add a designation to an existing function, with its level (1–12). */
function AddDesignationModal({ functions, defaultFunctionId, onClose, onSave, isSaving, error }: Readonly<{
  functions: FrameworkFunction[]; defaultFunctionId: number;
  onClose: () => void; onSave: (p: { name: string; function_id: number; career_level: number }) => void; isSaving: boolean; error: string;
}>) {
  const [name, setName] = useState("");
  const [functionId, setFunctionId] = useState(defaultFunctionId);
  const [level, setLevel] = useState<string>("1");
  const lvl = Number(level);
  const levelOk = Number.isInteger(lvl) && lvl >= 1 && lvl <= MAX_LEVEL;
  const ok = name.trim().length > 0 && levelOk;
  return (
    <ModalShell title="Add designation" subtitle="A GCC designation (job title) inside an existing function, at a level." onClose={onClose} footer={
      <>
        <button type="button" onClick={onClose} className={BTN_GHOST}>Cancel</button>
        <button type="button" disabled={!ok || isSaving} onClick={() => onSave({ name: name.trim(), function_id: functionId, career_level: lvl })} className={BTN_PRIMARY}>
          {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Add designation
        </button>
      </>
    }>
      {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-text-main">Designation name</span>
        <input className={INPUT_CLS} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Senior Pharmacovigilance Analyst" maxLength={120} autoFocus />
      </label>
      <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-text-main">Function</span>
          <select value={functionId} onChange={(e) => setFunctionId(Number(e.target.value))} className={`${INPUT_CLS} cursor-pointer`}>
            {functions.map((f) => <option key={f.function_id} value={f.function_id}>{f.function_name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-text-main">Level</span>
          <input type="number" min={1} max={MAX_LEVEL} step={1} className={`${INPUT_CLS} font-mono`} value={level} onChange={(e) => setLevel(e.target.value)} />
        </label>
      </div>
      <p className="text-xs text-text-muted">The level decides which framework column applies to staff holding this designation. Levels run 1–{MAX_LEVEL}; 1–4 carry the GCC band names (Entry, Mid, Senior, Lead).</p>
    </ModalShell>
  );
}

// ── The tab ──────────────────────────────────────────────────────────

type Modal =
  | { kind: "add-function" }
  | { kind: "rename-function"; id: number; name: string }
  | { kind: "add-designation" }
  | { kind: "rename-designation"; id: number; name: string }
  | null;

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

  // ── Staged edits: existing rows by id, new columns by level ──────
  const [drafts, setDrafts] = useState<Record<number, RowDraft>>({});
  const [newLevels, setNewLevels] = useState<Record<number, RowDraft>>({});
  const [editingKpis, setEditingKpis] = useState<Set<string>>(new Set());
  const [addLevel, setAddLevel] = useState<string>("");
  const dirty = Object.keys(drafts).length > 0 || Object.keys(newLevels).length > 0;
  const draftFor = (row: FrameworkRow): RowDraft => drafts[row.id] ?? draftOf(row);
  const setDraft = (row: FrameworkRow, patch: Partial<RowDraft>) => setDrafts((d) => ({ ...d, [row.id]: { ...(d[row.id] ?? draftOf(row)), ...patch } }));
  const setNew = (level: number, patch: Partial<RowDraft>) => setNewLevels((d) => ({ ...d, [level]: { ...(d[level] ?? emptyDraft()), ...patch } }));
  const resetStaged = () => { setDrafts({}); setNewLevels({}); setEditingKpis(new Set()); };

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
      for (const [level, d] of Object.entries(newLevels)) {
        await goalFrameworkService.createRow({
          function_id: fn!.function_id,
          level: Number(level),
          title: d.title.trim(),
          business_outcomes: d.business_outcomes.trim(),
          functional_goals: d.functional_goals.trim(),
          kpis: d.kpis.map((k) => ({ text: k.text.trim(), weightage: Number(k.weightage) || 0 })),
        });
      }
    },
    onSuccess: () => { setError(""); resetStaged(); invalidate(); toast.success("Framework saved"); },
    onError: (e) => setError(getErrorMessage(e)),
  });
  const invalidDrafts = Object.values(drafts).some((d) => !draftValid(d)) || Object.values(newLevels).some((d) => !draftValid(d));

  const setLevel = useMutation({
    mutationFn: ({ id, level }: { id: number; level: number }) => goalFrameworkService.updateDesignation(id, { career_level: level }),
    onSuccess: () => { invalidate(); toast.success("Designation level updated"); },
    onError: (e) => setError(getErrorMessage(e)),
  });

  // ── Reference-data modals ────────────────────────────────────────
  const [modal, setModal] = useState<Modal>(null);
  const [modalError, setModalError] = useState("");
  const closeModal = () => { setModal(null); setModalError(""); };
  const refMut = useMutation({
    mutationFn: async (m: NonNullable<Modal> & { value: string | { name: string; function_id: number; career_level: number } }) => {
      switch (m.kind) {
        case "add-function": return goalFrameworkService.createFunction(m.value as string);
        case "rename-function": return goalFrameworkService.renameFunction(m.id, m.value as string);
        case "add-designation": return goalFrameworkService.createDesignation(m.value as { name: string; function_id: number; career_level: number });
        case "rename-designation": return goalFrameworkService.updateDesignation(m.id, { name: m.value as string });
      }
    },
    onSuccess: (_res, m) => {
      const msg = m.kind === "add-function" ? "Function added" : m.kind === "add-designation" ? "Designation added" : m.kind === "rename-function" ? "Function renamed" : "Designation renamed";
      closeModal(); invalidate(); toast.success(msg);
      if (m.kind === "add-function" && _res && typeof _res === "object" && "id" in _res) setFnId((_res as { id: number }).id);
    },
    onError: (e) => setModalError(getErrorMessage(e)),
  });

  if (matrixQ.isPending) return <div className="p-5"><div className="h-80 animate-pulse rounded-lg bg-slate-100" /></div>;
  if (matrixQ.isError || !matrix) return <div className="p-5"><p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{matrixQ.error ? getErrorMessage(matrixQ.error) : "Could not load the framework."}</p></div>;

  const definedLevels = fn?.rows.length ?? 0;
  const kpiCount = fn?.rows.reduce((a, r) => a + r.kpis.length, 0) ?? 0;
  const levels = Array.from(new Set([...(fn?.rows.map((r) => r.level) ?? []), ...Object.keys(newLevels).map(Number)])).sort((a, b) => a - b);
  const freeLevels = LEVEL_OPTIONS.filter((l) => !levels.includes(l));
  const addLevelNum = Number(addLevel);
  const addLevelOk = Number.isInteger(addLevelNum) && freeLevels.includes(addLevelNum);

  const startLevel = () => {
    if (!addLevelOk) return;
    setNewLevels((d) => ({ ...d, [addLevelNum]: emptyDraft() }));
    setEditingKpis((s) => new Set(s).add(`new-${addLevelNum}`));
    setAddLevel("");
  };
  const dropNewLevel = (l: number) => {
    setNewLevels((d) => { const n = { ...d }; delete n[l]; return n; });
    setEditingKpis((s) => { const n = new Set(s); n.delete(`new-${l}`); return n; });
  };

  // ── KPI cell (existing row or new column) ────────────────────────
  const kpiEditor = (key: string, d: RowDraft, setKpis: (kpis: FrameworkKpiInput[]) => void, alwaysOpen: boolean) => {
    const t = total(d.kpis);
    const editing = alwaysOpen || editingKpis.has(key);
    if (!editing) {
      return (
        <>
          <ol className="space-y-2.5">
            {d.kpis.map((k, i) => (
              <li key={`${key}-${i}`} className="flex items-start gap-2.5">
                <KpiNumber n={i + 1} />
                <p className="flex-1 text-[13px] leading-snug text-text-main">{k.text || <span className="italic text-text-muted">Untitled KPI</span>}</p>
                <WeightChip weight={k.weightage} />
              </li>
            ))}
          </ol>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-2">
            <button type="button" onClick={() => setEditingKpis((s) => new Set(s).add(key))} className="flex items-center gap-1 text-[12px] font-medium text-brand-accent hover:underline">
              <Pencil className="h-3 w-3" aria-hidden="true" /> Edit KPIs
            </button>
            <TotalBadge value={t} />
          </div>
        </>
      );
    }
    return (
      <div className="space-y-2.5">
        {d.kpis.map((k, i) => (
          <div key={`${key}-${i}`} className="rounded-lg border border-border bg-white p-2.5">
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
            {!alwaysOpen && (
              <button type="button" onClick={() => setEditingKpis((s) => { const n = new Set(s); n.delete(key); return n; })} className="flex items-center gap-1 rounded-md bg-brand-light px-2 py-0.5 text-[12px] font-medium text-brand-accent hover:bg-brand hover:text-white transition-colors"><Check className="h-3 w-3" /> Done</button>
            )}
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

  /** One matrix column: an existing row (draft) or a new level (new draft). */
  const column = (l: number) => {
    const row = rowByLevel.get(l);
    const isNew = !row && l in newLevels;
    const d: RowDraft | null = row ? draftFor(row) : isNew ? newLevels[l] : null;
    const patch = (p: Partial<RowDraft>) => (row ? setDraft(row, p) : setNew(l, p));
    return { row, isNew, d, patch };
  };

  const addLevelCell = (
    <div className="flex h-full min-h-[96px] items-center justify-center rounded-lg border border-dashed border-border px-3 text-center text-xs text-text-muted">
      Fill the new column, then Save
    </div>
  );

  return (
    <div className="space-y-4 p-5">
      {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <label htmlFor="fw-fn" className={TH_CLS}>Framework for</label>
            <select id="fw-fn" value={fnId ?? ""} onChange={(e) => { setFnId(Number(e.target.value)); resetStaged(); }} className={`${SELECT_CLS} min-w-[240px]`}>
              {matrix.functions.map((f) => <option key={f.function_id} value={f.function_id}>{f.function_name}{f.rows.length ? "" : " (no levels yet)"}</option>)}
            </select>
            {fn && (
              <button type="button" onClick={() => setModal({ kind: "rename-function", id: fn.function_id, name: fn.function_name })} className="rounded-md p-1.5 text-text-muted hover:bg-brand-light hover:text-brand transition-colors" title="Rename this function">
                <Pencil className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <span className="inline-flex items-center rounded-full border border-border bg-slate-100 px-2.5 py-0.5 text-xs text-text-main">{kpiCount} KPIs · {definedLevels} {definedLevels === 1 ? "level" : "levels"} defined · {matrix.period_label}</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setModal({ kind: "add-function" })} className={BTN_SECONDARY}><Plus className="h-4 w-4" /> Add function</button>
          <button type="button" disabled={!fn} onClick={() => setModal({ kind: "add-designation" })} className={BTN_SECONDARY}><Plus className="h-4 w-4" /> Add designation</button>
          <span className="mx-1 h-6 w-px bg-border" aria-hidden="true" />
          <button type="button" disabled={!dirty || saveAll.isPending} onClick={resetStaged} className={BTN_SECONDARY}><RotateCcw className="h-4 w-4" /> Discard</button>
          <button type="button" disabled={!dirty || invalidDrafts || saveAll.isPending} title={invalidDrafts ? "Every changed or new column needs a role title, both paragraphs, KPI text and weights totalling 100" : undefined} onClick={() => saveAll.mutate()} className={BTN_PRIMARY}>
            {saveAll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
          </button>
        </div>
      </div>
      <p className="text-xs text-text-muted">
        One column per level: the role title, the two illustrative paragraphs and the KPIs with their weightages, all edited in the table. Edits are staged; click Save to apply them at once. Functions and designations are added or renamed with the buttons above; a designation's level decides which column its staff see.
      </p>

      {/* Designations → levels */}
      {fn && (
        <section className="rounded-lg border border-border bg-surface p-4">
          <p className={TH_CLS}>Designations → levels</p>
          <p className="mt-0.5 text-xs text-text-muted">Each GCC designation in {fn.function_name} and its level (1–{MAX_LEVEL}). Level changes apply immediately; the pencil renames.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {fn.designations.length === 0 && <span className="text-xs italic text-text-muted">No designations in this function yet — use "Add designation".</span>}
            {fn.designations.map((d) => (
              <span key={d.id} className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-1.5 text-sm text-text-main">
                <span>{d.name}</span>
                <label className="flex items-center gap-1 text-xs text-text-muted">
                  L
                  <select value={d.career_level ?? ""} onChange={(e) => setLevel.mutate({ id: d.id, level: Number(e.target.value) })} className="rounded-md border border-border bg-white px-1.5 py-0.5 text-[13px] text-text-main outline-none focus:border-brand" aria-label={`Level of ${d.name}`}>
                    <option value="" disabled>—</option>
                    {LEVEL_OPTIONS.map((l) => <option key={l} value={l}>{l}</option>)}
                  </select>
                </label>
                <button type="button" onClick={() => setModal({ kind: "rename-designation", id: d.id, name: d.name })} className="rounded p-0.5 text-text-muted hover:text-brand" title={`Rename ${d.name}`}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Matrix (existing levels + new columns) or the empty state with the add-level control */}
      {fn && levels.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-10 text-center">
          <FileQuestion className="h-8 w-8 text-text-muted" aria-hidden="true" />
          <p className="mt-3 font-medium text-text-main">No levels defined for {fn.function_name} yet.</p>
          <p className="mt-1 max-w-md text-sm text-text-muted">Staff in this function see a notice instead of goal boxes until a level column exists. Add the first level to start.</p>
          <div className="mt-4 flex items-center gap-2">
            <label className="text-xs text-text-muted" htmlFor="fw-add-level-empty">Level</label>
            <input id="fw-add-level-empty" type="number" min={1} max={MAX_LEVEL} step={1} value={addLevel} onChange={(e) => setAddLevel(e.target.value)} placeholder="1" className={`${INPUT_CLS} w-20 font-mono`} />
            <button type="button" disabled={!addLevelOk} onClick={startLevel} className={BTN_PRIMARY}><Plus className="h-4 w-4" /> Add level</button>
          </div>
        </div>
      ) : fn ? (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="border-collapse" style={{ minWidth: `${190 + (levels.length + 1) * 320}px` }}>
            <thead className="bg-slate-50">
              <tr>
                <th className="w-[190px] border-b border-border px-3 py-2.5 text-left"><span className={TH_CLS}>Framework · {matrix.period_label}</span></th>
                {levels.map((l) => {
                  const { row, isNew, d, patch } = column(l);
                  const ds = fn.designations.filter((x) => x.career_level === l).map((x) => x.name).join(", ");
                  return (
                    <th key={l} scope="col" className={`min-w-[300px] border-b border-border px-3 py-2.5 text-left align-top ${isNew ? "bg-brand-light/40" : ""}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className={TH_CLS}>{levelName(l)}{isNew && <span className="ml-1.5 rounded-full bg-brand px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">new</span>}</span>
                        {isNew && (
                          <button type="button" onClick={() => dropNewLevel(l)} className="rounded p-0.5 text-text-muted hover:text-red-600" title="Drop this new column"><X className="h-3.5 w-3.5" /></button>
                        )}
                      </div>
                      {d && (
                        <input value={d.title} onChange={(e) => patch({ title: e.target.value })} placeholder="Role title, as printed in the document" className="mt-0.5 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-[13px] font-semibold text-text-main placeholder:font-normal placeholder:italic placeholder:text-text-muted hover:border-border focus:border-brand focus:bg-white focus:outline-none" title="Role title, as printed in the document" />
                      )}
                      <div className="mt-0.5 text-[11px] text-text-muted">{ds || (row || isNew ? "No designation at this level" : "")}</div>
                    </th>
                  );
                })}
                <th scope="col" className="min-w-[300px] border-b border-border px-3 py-2.5 text-left align-top">
                  <span className={TH_CLS}>Add level</span>
                  <div className="mt-1.5 flex items-center gap-2">
                    <input type="number" min={1} max={MAX_LEVEL} step={1} value={addLevel} onChange={(e) => setAddLevel(e.target.value)} placeholder={freeLevels[0] ? String(freeLevels[0]) : "—"} className={`${INPUT_CLS} w-20 font-mono`} aria-label="New level number" disabled={freeLevels.length === 0} />
                    <button type="button" disabled={!addLevelOk} onClick={startLevel} className="flex items-center gap-1.5 rounded-md bg-brand-light px-2.5 py-1.5 text-xs font-medium text-brand-accent hover:bg-brand hover:text-white transition-colors disabled:opacity-50 disabled:hover:bg-brand-light disabled:hover:text-brand-accent"><Plus className="h-3.5 w-3.5" /> Add</button>
                  </div>
                  <div className="mt-0.5 text-[11px] text-text-muted">{freeLevels.length === 0 ? `All ${MAX_LEVEL} levels are defined` : `Free: ${freeLevels.slice(0, 6).join(", ")}${freeLevels.length > 6 ? "…" : ""}`}</div>
                </th>
              </tr>
            </thead>
            <tbody className="align-top">
              <tr>
                {rowLabel("Illustrative Business & Strategic Outcomes", "one paragraph per level")}
                {levels.map((l) => { const { isNew, d, patch } = column(l); return <td key={l} className={`border-b border-border px-3 py-3 ${isNew ? "bg-brand-light/20" : ""}`}>{d && <AutoTextarea value={d.business_outcomes} onChange={(v) => patch({ business_outcomes: v })} placeholder="Business & strategic outcomes for this level" />}</td>; })}
                <td className="border-b border-border px-3 py-3">{addLevelCell}</td>
              </tr>
              <tr>
                {rowLabel("Illustrative Functional / Operational Excellence Goals", "one paragraph per level")}
                {levels.map((l) => { const { isNew, d, patch } = column(l); return <td key={l} className={`border-b border-border px-3 py-3 ${isNew ? "bg-brand-light/20" : ""}`}>{d && <AutoTextarea value={d.functional_goals} onChange={(v) => patch({ functional_goals: v })} placeholder="Functional / operational excellence goals for this level" />}</td>; })}
                <td className="border-b border-border px-3 py-3">{addLevelCell}</td>
              </tr>
              <tr>
                {rowLabel("Illustrative KPI / Success Measures · Weightage", "4–7 KPIs per level, weightages total 100%")}
                {levels.map((l) => {
                  const { row, isNew, d, patch } = column(l);
                  return <td key={l} className={`px-3 py-3 ${isNew ? "bg-brand-light/20" : ""}`}>{d && kpiEditor(row ? String(row.id) : `new-${l}`, d, (kpis) => patch({ kpis }), isNew)}</td>;
                })}
                <td className="px-3 py-3">{addLevelCell}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : null}

      {modal?.kind === "add-function" && (
        <NameModal title="Add function" subtitle="A function (department) staff belong to, e.g. Pharmacovigilance." label="Function name" initial="" saveLabel="Add function" onClose={closeModal} isSaving={refMut.isPending} error={modalError} onSave={(name) => refMut.mutate({ kind: "add-function", value: name })} />
      )}
      {modal?.kind === "rename-function" && (
        <NameModal title="Rename function" subtitle={modal.name} label="Function name" initial={modal.name} saveLabel="Rename" onClose={closeModal} isSaving={refMut.isPending} error={modalError} onSave={(name) => refMut.mutate({ kind: "rename-function", id: modal.id, name: modal.name, value: name })} />
      )}
      {modal?.kind === "rename-designation" && (
        <NameModal title="Rename designation" subtitle={modal.name} label="Designation name" initial={modal.name} saveLabel="Rename" onClose={closeModal} isSaving={refMut.isPending} error={modalError} onSave={(name) => refMut.mutate({ kind: "rename-designation", id: modal.id, name: modal.name, value: name })} />
      )}
      {modal?.kind === "add-designation" && fn && (
        <AddDesignationModal functions={matrix.functions} defaultFunctionId={fn.function_id} onClose={closeModal} isSaving={refMut.isPending} error={modalError} onSave={(p) => refMut.mutate({ kind: "add-designation", value: p })} />
      )}
    </div>
  );
}
