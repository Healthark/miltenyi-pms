/**
 * FrameworkMappingTab — Employee · Function · GCC designation · Level ·
 * Reviewer (Mentor) · Miltenyi reviewer · Status.
 *
 * Function, designation and its level come from the user record and are
 * read-only here (designation levels are set on the Framework tab). HR edits
 * only the two reviewer fields: the mentor (who is the Healthark reviewer of
 * record for Project Goals) and the Miltenyi reviewer's name.
 */
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Save, Search, X } from "lucide-react";

import { queryKeys } from "@/lib/queryKeys";
import { getErrorMessage } from "@/utils/errors";
import { adminService, type UserResponse } from "@/services/admin.service";
import { goalFrameworkService, type MappingRow, type MappingStatus } from "@/services/goal-framework.service";
import { useToast } from "@/hooks/useToast";
import { BTN_GHOST, BTN_PRIMARY, INPUT_CLS, TH_CLS } from "@/components/project-goals/ui";

const SELECT_CLS =
  "rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";
const GRID =
  "grid-cols-[minmax(200px,1.5fr)_minmax(160px,1.1fr)_minmax(200px,1.3fr)_minmax(120px,0.8fr)_minmax(150px,1fr)_minmax(160px,1.1fr)_minmax(130px,0.9fr)_56px]";

const STATUS_LABEL: Record<MappingStatus, { label: string; dot: string; text: string }> = {
  mapped: { label: "Mapped", dot: "bg-green-500", text: "text-green-600" },
  no_framework: { label: "No framework", dot: "bg-red-500", text: "text-red-600" },
  no_designation: { label: "No level", dot: "bg-amber-500", text: "text-amber-700" },
  no_function: { label: "No function", dot: "bg-amber-500", text: "text-amber-700" },
};

function StatusPill({ status }: Readonly<{ status: MappingStatus }>) {
  const s = STATUS_LABEL[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${s.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} aria-hidden="true" />
      {s.label}
    </span>
  );
}

interface EditState {
  row: MappingRow;
  mentorId: string;
  reviewer: string;
}

export function FrameworkMappingTab({ users }: Readonly<{ users: UserResponse[] }>) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [search, setSearch] = useState("");
  const [fn, setFn] = useState("all");
  const [st, setSt] = useState("all");
  const [edit, setEdit] = useState<EditState | null>(null);
  const [error, setError] = useState("");

  const q = useQuery({ queryKey: queryKeys.admin.goalMapping(), queryFn: () => goalFrameworkService.getMapping() });
  const rows = q.data ?? [];

  const mentors = useMemo(() => users.filter((u) => u.role === "Mentor" && !u.is_deleted).sort((a, b) => a.full_name.localeCompare(b.full_name)), [users]);
  const functions = useMemo(() => Array.from(new Set(rows.map((r) => r.function_name).filter((x): x is string => !!x))).sort(), [rows]);

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
    mutationFn: (e: EditState) =>
      adminService.updateUser(e.row.user_id, {
        mentor_id: e.mentorId ? Number(e.mentorId) : null,
        miltenyi_reviewer_name: e.reviewer.trim() || null,
      }),
    onSuccess: () => {
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

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-[220px] max-w-xs flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" aria-hidden="true" />
            <input type="text" placeholder="Search employees..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full rounded-lg border border-border bg-white py-1.5 pl-9 pr-3 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand" />
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="map-fn" className={TH_CLS}>Function</label>
            <select id="map-fn" value={fn} onChange={(e) => setFn(e.target.value)} className={`${SELECT_CLS} min-w-[170px]`}>
              <option value="all">All functions</option>
              {functions.map((f) => <option key={f} value={f}>{f}</option>)}
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
          <div className="min-w-[1200px]">
            <div className={`grid ${GRID} gap-3 border-b border-border bg-slate-50 px-4 py-2.5`}>
              <span className={TH_CLS}>Employee</span>
              <span className={TH_CLS}>Function</span>
              <span className={TH_CLS}>GCC designation</span>
              <span className={TH_CLS}>Designation level</span>
              <span className={TH_CLS}>Reviewer (Mentor)</span>
              <span className={TH_CLS}>Miltenyi reviewer</span>
              <span className={TH_CLS}>Status</span>
              <span />
            </div>
            {filtered.length === 0 && <div className="px-4 py-8 text-center text-sm text-text-muted">No employees match these filters.</div>}
            {filtered.map((r) => (
              <div key={r.user_id} className={`grid ${GRID} items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-slate-50`}>
                <div className="min-w-0">
                  <div className="text-sm font-medium text-text-main">{r.full_name}</div>
                  <div className="truncate text-xs text-text-muted">{r.email}</div>
                </div>
                <div className="text-sm text-text-main">{r.function_name ?? <span className="italic text-text-muted">—</span>}</div>
                <div className="text-sm text-text-main">{r.designation_name ?? <span className="italic text-text-muted">—</span>}</div>
                <div>
                  {r.level ? (
                    <span className="inline-flex items-center rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-semibold text-brand-accent">L{r.level} · {r.level_label}</span>
                  ) : (
                    <span className="text-xs italic text-text-muted">—</span>
                  )}
                </div>
                <div className={`text-sm ${r.mentor_name ? "text-text-main" : "italic text-text-muted"}`}>{r.mentor_name ?? "No mentor"}</div>
                <div className={`text-sm ${r.miltenyi_reviewer_name ? "text-text-main" : "italic text-text-muted"}`}>{r.miltenyi_reviewer_name ?? "Not set"}</div>
                <div><StatusPill status={r.status} /></div>
                <div className="text-right">
                  <button type="button" onClick={() => setEdit({ row: r, mentorId: r.mentor_id ? String(r.mentor_id) : "", reviewer: r.miltenyi_reviewer_name ?? "" })} className="rounded-md p-1.5 text-text-muted hover:bg-brand-light hover:text-brand transition-colors" title="Edit reviewers">
                    <Pencil className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <p className="text-xs text-text-muted">
        Function, GCC designation and its level come from the user record. The designation's level decides which framework row the employee sees; set designation levels in the Framework tab. HR edits only the reviewer (mentor) and the Miltenyi reviewer here.
      </p>

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
                <div className="grid gap-3 rounded-lg border border-border bg-slate-50 px-4 py-3 text-[13px] sm:grid-cols-3">
                  <div><p className={TH_CLS}>Function</p><p className="text-text-main">{edit.row.function_name ?? "—"}</p></div>
                  <div><p className={TH_CLS}>GCC designation</p><p className="text-text-main">{edit.row.designation_name ?? "—"}</p></div>
                  <div><p className={TH_CLS}>Level</p><p className="text-text-main">{edit.row.level ? `L${edit.row.level} · ${edit.row.level_label}` : "—"}</p></div>
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
