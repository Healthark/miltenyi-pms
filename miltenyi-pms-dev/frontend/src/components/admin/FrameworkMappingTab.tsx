/**
 * FrameworkMappingTab — Staff member · Function · GCC designation · Level ·
 * Reviewer (Mentor) · Miltenyi reviewer · Status.
 *
 * The Admin edits the staff member's function and GCC designation (the
 * level follows from the designation, set on the Framework tab), the mentor
 * (the Healthark reviewer of record) and the Miltenyi reviewer's name. All
 * four write to the same user record the Users tab edits.
 *
 * Function and designation are locked while the staff member has this
 * year's goal set in progress: the set was built from one framework row and
 * keeps it. Promotions are recorded between goal years.
 *
 * "Personalise framework" (16 Oct 2026) gives one staff member their own
 * framework for the year (PersonalFrameworkModal); a personalised row shows
 * the chip. Changing a personalised person's function or level removes the
 * personal framework after a confirmation that says what happens.
 */
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Lock, Pencil, Save, Search, UserCog, X } from "lucide-react";

import { queryKeys } from "@/lib/queryKeys";
import { getErrorMessage } from "@/utils/errors";
import { adminService, type DesignationBrief, type FunctionBrief, type UserResponse } from "@/services/admin.service";
import { goalFrameworkService, type MappingRow, type MappingStatus } from "@/services/goal-framework.service";
import { useToast } from "@/hooks/useToast";
import { BTN_GHOST, BTN_PRIMARY, INPUT_CLS, PersonalisedChip, TH_CLS } from "@/components/project-goals/ui";
import { PersonalFrameworkModal } from "@/components/admin/PersonalFrameworkModal";
import { updateUserConfirmingPersonalFramework } from "@/components/admin/personalFrameworkConfirm";
import { useConfirm } from "@/hooks/useConfirm";

const SELECT_CLS =
  "rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";
// Fixed last column: every row is its own grid, so an auto width would put
// the header out of line. The two actions stack; side by side on 2xl.
const GRID =
  "grid-cols-[minmax(160px,1.4fr)_minmax(110px,1fr)_minmax(140px,1.2fr)_minmax(92px,0.7fr)_minmax(110px,1fr)_minmax(110px,1fr)_minmax(104px,0.8fr)_144px] " +
  "2xl:grid-cols-[minmax(160px,1.4fr)_minmax(110px,1fr)_minmax(140px,1.2fr)_minmax(92px,0.7fr)_minmax(110px,1fr)_minmax(110px,1fr)_minmax(104px,0.8fr)_200px]";

const STATUS_LABEL: Record<MappingStatus, { label: string; dot: string; text: string }> = {
  mapped: { label: "Mapped", dot: "bg-green-500", text: "text-green-600" },
  no_framework: { label: "No framework", dot: "bg-red-500", text: "text-red-600" },
  no_designation: { label: "No level", dot: "bg-amber-500", text: "text-amber-700" },
  no_function: { label: "No function", dot: "bg-amber-500", text: "text-amber-700" },
};

const GOALS_STATUS_LABEL: Record<string, string> = { draft: "Draft", submitted: "Submitted", approved: "Approved" };

/** Function and designation stay put while this year's goals exist. */
const mappingLocked = (r: MappingRow) => r.has_active_set;

function StatusPill({ status }: Readonly<{ status: MappingStatus }>) {
  const s = STATUS_LABEL[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}

function LevelChip({ level, label }: Readonly<{ level: number | null; label: string | null }>) {
  if (!level) return <span className="text-xs italic text-text-muted">—</span>;
  return (
    <span className="inline-flex items-center rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-semibold text-brand-accent">
      L{level}{label ? ` · ${label}` : ""}
    </span>
  );
}

interface EditState {
  row: MappingRow;
  functionId: string;
  designationId: string;
  mentorId: string;
  reviewer: string;
}

export function FrameworkMappingTab({ users }: Readonly<{ users: UserResponse[] }>) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [search, setSearch] = useState("");
  const [fn, setFn] = useState("all");
  const [st, setSt] = useState("all");
  const [edit, setEdit] = useState<EditState | null>(null);
  const [error, setError] = useState("");
  const [customise, setCustomise] = useState<number | null>(null);

  const q = useQuery({ queryKey: queryKeys.admin.goalMapping(), queryFn: () => goalFrameworkService.getMapping() });
  const rows = q.data ?? [];
  const functionsQ = useQuery({ queryKey: queryKeys.admin.functions(), queryFn: adminService.getFunctions });
  const designationsQ = useQuery({ queryKey: queryKeys.admin.designations(), queryFn: adminService.getDesignations });
  const allFunctions: FunctionBrief[] = functionsQ.data ?? [];
  const allDesignations: DesignationBrief[] = designationsQ.data ?? [];

  const mentors = useMemo(() => users.filter((u) => u.role === "Mentor" && !u.is_deleted).sort((a, b) => a.full_name.localeCompare(b.full_name)), [users]);
  const functionNames = useMemo(() => Array.from(new Set(rows.map((r) => r.function_name).filter((x): x is string => !!x))).sort(), [rows]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (fn !== "all" && r.function_name !== fn) return false;
      if (st !== "all" && r.status !== st) return false;
      if (s && !`${r.full_name} ${r.email} ${r.designation_name ?? ""} ${r.mentor_name ?? ""} ${r.miltenyi_reviewer_name ?? ""}`.toLowerCase().includes(s)) return false;
      return true;
    });
  }, [rows, search, fn, st]);

  const counts = useMemo(() => rows.reduce<Record<string, number>>((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a; }, {}), [rows]);

  const save = useMutation({
    mutationFn: (e: EditState) => {
      const payload: Parameters<typeof adminService.updateUser>[1] = {
        mentor_id: e.mentorId ? Number(e.mentorId) : null,
        miltenyi_reviewer_name: e.reviewer.trim() || null,
      };
      if (!mappingLocked(e.row)) {
        payload.function_id = e.functionId ? Number(e.functionId) : null;
        payload.designation_id = e.designationId ? Number(e.designationId) : null;
      }
      return updateUserConfirmingPersonalFramework(confirm, e.row.user_id, payload);
    },
    onSuccess: (updated) => {
      if (!updated) return; // the Admin kept the personal framework; the dialog stays open
      setError("");
      setEdit(null);
      queryClient.invalidateQueries({ queryKey: queryKeys.admin.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.projectGoals.all });
      toast.success("Mapping saved");
    },
    onError: (e) => setError(getErrorMessage(e)),
  });

  const chip = (status: MappingStatus) => (
    <span key={status} className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-xs text-text-main">
      <span className={`h-1.5 w-1.5 rounded-full ${STATUS_LABEL[status].dot}`} aria-hidden="true" />
      {STATUS_LABEL[status].label} <span className="font-semibold">{counts[status] ?? 0}</span>
    </span>
  );

  const openEdit = (r: MappingRow) => setEdit({
    row: r,
    functionId: r.function_id ? String(r.function_id) : "",
    designationId: r.designation_id ? String(r.designation_id) : "",
    mentorId: r.mentor_id ? String(r.mentor_id) : "",
    reviewer: r.miltenyi_reviewer_name ?? "",
  });

  // Designations offered in the dialog: those of the chosen function, plus
  // the current one so a legacy title without a function link stays visible.
  const designationOptions = (e: EditState) =>
    allDesignations.filter((d) => (e.functionId ? d.function_id === Number(e.functionId) : true) || String(d.id) === e.designationId);
  const chosenDesignation = (e: EditState) => allDesignations.find((d) => String(d.id) === e.designationId) ?? null;

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" aria-hidden="true" />
            <input type="text" placeholder="Search staff..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full rounded-lg border border-border bg-white py-1.5 pl-9 pr-3 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand" />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="map-fn" className={TH_CLS}>Function</label>
            <select id="map-fn" value={fn} onChange={(e) => setFn(e.target.value)} className={`${SELECT_CLS} min-w-[170px]`}>
              <option value="all">All functions</option>
              {functionNames.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="map-st" className={TH_CLS}>Status</label>
            <select id="map-st" value={st} onChange={(e) => setSt(e.target.value)} className={`${SELECT_CLS} min-w-[150px]`}>
              <option value="all">All</option>
              <option value="mapped">Mapped</option>
              <option value="no_framework">No framework</option>
              <option value="no_designation">No level</option>
              <option value="no_function">No function</option>
            </select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">{(["mapped", "no_framework", "no_designation", "no_function"] as MappingStatus[]).map(chip)}</div>
      </div>

      {q.isPending && <div className="h-64 animate-pulse rounded-lg bg-slate-100" />}
      {q.isError && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{getErrorMessage(q.error)}</p>}
      {q.isSuccess && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <div className="min-w-[1040px]">
            <div className={`grid ${GRID} gap-2.5 border-b border-border bg-slate-50 px-4 py-2.5`}>
              <span className={TH_CLS}>Staff member</span>
              <span className={TH_CLS}>Function</span>
              <span className={TH_CLS}>GCC designation</span>
              <span className={TH_CLS}>Designation level</span>
              <span className={TH_CLS}>Reviewer (Mentor)</span>
              <span className={TH_CLS}>Miltenyi reviewer</span>
              <span className={TH_CLS}>Status</span>
              <span />
            </div>
            {filtered.length === 0 && <div className="px-4 py-8 text-center text-sm text-text-muted">No staff match these filters.</div>}
            {filtered.map((r) => (
              <div key={r.user_id} className={`grid ${GRID} items-center gap-2.5 border-b border-border px-4 py-3 last:border-b-0 hover:bg-slate-50`}>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-main">{r.full_name}</div>
                  <div className="truncate text-xs text-text-muted">{r.email}</div>
                </div>
                <div className="text-sm text-text-main">{r.function_name ?? <span className="italic text-text-muted">—</span>}</div>
                <div className="text-sm text-text-main">{r.designation_name ?? <span className="italic text-text-muted">—</span>}</div>
                <div><LevelChip level={r.level} label={r.level_label} /></div>
                <div className={`text-sm ${r.mentor_name ? "text-text-main" : "italic text-text-muted"}`}>{r.mentor_name ?? "No mentor"}</div>
                <div className={`text-sm ${r.miltenyi_reviewer_name ? "text-text-main" : "italic text-text-muted"}`}>{r.miltenyi_reviewer_name ?? "Not set"}</div>
                <div className="flex flex-col items-start gap-0.5">
                  <StatusPill status={r.status} />
                  {r.personalised && <PersonalisedChip title="This staff member has their own framework for the year" />}
                  {r.has_active_set && (
                    <span className="inline-flex items-center gap-1 text-[11px] text-text-muted" title="Function and designation are locked while this year's goals are in progress">
                      <Lock className="h-3 w-3" aria-hidden="true" /> Goals {GOALS_STATUS_LABEL[r.active_set_status ?? ""] ?? "in progress"}
                    </span>
                  )}
                </div>
                <div className="flex flex-col items-stretch gap-1 2xl:flex-row 2xl:items-center 2xl:justify-end">
                  <button
                    type="button"
                    disabled={r.status !== "mapped"}
                    onClick={() => setCustomise(r.user_id)}
                    className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium text-brand-accent hover:bg-brand-light transition-colors disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                    title={r.status === "mapped" ? "Give this staff member their own framework for the year" : "Map a function, a level and its framework column first"}
                    aria-label={`Personalise framework for ${r.full_name}`}
                  >
                    <UserCog className="h-4 w-4" aria-hidden="true" /> Personalise framework
                  </button>
                  <button type="button" onClick={() => openEdit(r)} className="flex items-center gap-1.5 whitespace-nowrap rounded-md px-2 py-1.5 text-xs font-medium text-brand-accent hover:bg-brand-light transition-colors" title="Edit mapping" aria-label={`Edit mapping for ${r.full_name}`}>
                    <Pencil className="h-4 w-4" aria-hidden="true" /> Edit
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-text-muted">
        Function, GCC designation, mentor and Miltenyi reviewer are the same fields as on the Users tab. The designation's level (set on the Framework tab) decides which framework column the staff member sees. Function and designation cannot change while the staff member's goals for the current year are in progress — record promotions between goal years. <b>Personalise framework</b> gives one staff member their own framework for the year (their own title, paragraphs, KPIs and weightages).
      </p>

      {customise !== null && <PersonalFrameworkModal userId={customise} onClose={() => setCustomise(null)} />}

      {edit &&
        createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
            <div className="w-full max-w-lg rounded-xl bg-surface shadow-xl">
              <div className="flex items-center justify-between border-b border-border px-6 py-4">
                <div>
                  <h2 className="font-display text-base font-semibold text-text-main">Edit mapping</h2>
                  <p className="mt-0.5 text-xs text-text-muted">{edit.row.full_name} · {edit.row.email}</p>
                </div>
                <button type="button" onClick={() => setEdit(null)} className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors" aria-label="Close"><X className="h-5 w-5" /></button>
              </div>
              <div className="space-y-4 px-6 py-5 text-sm">
                {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
                {edit.row.has_active_set && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      {edit.row.full_name}'s goals for this year are {GOALS_STATUS_LABEL[edit.row.active_set_status ?? ""]?.toLowerCase() ?? "in progress"}. Function and designation are locked until the next goal year starts; the reviewer fields can still change.
                    </span>
                  </div>
                )}
                {!edit.row.has_active_set && edit.row.personalised && (
                  <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <UserCog className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      {edit.row.full_name} has a personal framework for this year. Changing the function or the level removes it and {edit.row.full_name} follows the new role's framework; you are asked to confirm first. Another designation at the same level keeps it.
                    </span>
                  </div>
                )}
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-text-main">Function</span>
                    <select value={edit.functionId} disabled={mappingLocked(edit.row)} onChange={(e) => setEdit({ ...edit, functionId: e.target.value, designationId: "" })} className={`${INPUT_CLS} cursor-pointer disabled:cursor-not-allowed`}>
                      <option value="">No function</option>
                      {allFunctions.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-semibold text-text-main">GCC designation</span>
                    <select value={edit.designationId} disabled={mappingLocked(edit.row)} onChange={(e) => setEdit({ ...edit, designationId: e.target.value })} className={`${INPUT_CLS} cursor-pointer disabled:cursor-not-allowed`}>
                      <option value="">No designation</option>
                      {designationOptions(edit).map((d) => <option key={d.id} value={d.id}>{d.name}{d.career_level ? ` · L${d.career_level}` : ""}</option>)}
                    </select>
                    <span className="mt-0.5 block text-[11px] text-text-muted">
                      Level {chosenDesignation(edit)?.career_level ?? "—"}{chosenDesignation(edit)?.career_level_label ? ` · ${chosenDesignation(edit)?.career_level_label}` : ""} — follows the designation; change it on the Framework tab.
                    </span>
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-text-main">Reviewer (Mentor)</span>
                  <select value={edit.mentorId} onChange={(e) => setEdit({ ...edit, mentorId: e.target.value })} className={`${INPUT_CLS} cursor-pointer`}>
                    <option value="">No mentor</option>
                    {mentors.map((m) => <option key={m.id} value={m.id}>{m.full_name}</option>)}
                  </select>
                  <span className="mt-0.5 block text-[11px] text-text-muted">The mentor is the Healthark reviewer of record and enters the Miltenyi reviewer's inputs. Changing it here changes the mentor assignment.</span>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-semibold text-text-main">Miltenyi reviewer</span>
                  <input className={INPUT_CLS} value={edit.reviewer} onChange={(e) => setEdit({ ...edit, reviewer: e.target.value })} placeholder="Name of the Miltenyi manager whose comments are entered" maxLength={200} />
                </label>
              </div>
              <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
                <button type="button" onClick={() => setEdit(null)} className={BTN_GHOST}>Cancel</button>
                <button type="button" disabled={save.isPending} onClick={() => save.mutate(edit)} className={BTN_PRIMARY}>
                  {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
