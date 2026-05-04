/**
 * PMEvaluationTab.tsx — Unified Evaluation Queue (Primary + Secondary).
 *
 * Merges PM primary evaluations and secondary impact statements into one
 * table/card view with a Type column and filter.
 */

import { useState, useEffect, useCallback } from "react";
import {
  UserCircle, Briefcase, ClipboardList, Pencil,
  LayoutGrid, Table2, Search, CheckCircle2, Clock,
} from "lucide-react";
import {
  projectReviewService,
  type PMPendingReviewCard,
  type PMEvaluationPayload,
  type PMEvaluationDraftPayload,
  type ProjectReviewResponse,
  type SecondaryEvalPayload,
  type SecondaryEvalDraftPayload,
  type RoleExpectation,
} from "../../services/project-review.service";
import { getErrorMessage } from "../../utils/errors";
import { useAuth } from "../../hooks/useAuth";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { useToast } from "../../hooks/useToast";
import { SortableHeader } from "../SortableHeader";
import { compareValues, type SortKind, type SortState } from "../../utils/sort";
import { EvalModal } from "./EvalModal";
import { ImpactModal } from "./ImpactModal";

// ── Constants ───────────────────────────────────────────────────────

type ViewMode = "grid" | "table";
type EvalType = "primary" | "secondary";

// ── Sort column config ──────────────────────────────────────────────
// Employee / Project / Type / Dept are alpha; project_code is alphanumeric;
// rating (performance_group) is a 1–5 numeric-like string. Action is not sortable.
type EvalSortKey =
  | "employee_name"
  | "project_name"
  | "cycle"
  | "department_name"
  | "review_status"
  | "performance_group";

// Declared below the UnifiedEvalRow definition via an inline `Record` in the
// component — kept as SortKind values rather than a separate constant so the
// getters close over the right type.

// ── Unified Row Type ────────────────────────────────────────────────

interface UnifiedEvalRow {
  key: string;
  type: EvalType;
  employee_name: string;
  project_id: number;
  project_name: string;
  project_code: string;
  department_name: string | null;
  designation_name: string | null;
  assignment_role: string | null;
  review_status: string; // "pending" | "reviewed" | "submitted"
  review_id: number | null;
  user_id: number | null;
  cycle: string | null;
  performance_group: string | null;
  /** True iff a real draft has been saved (not just a pre-seeded
   *  placeholder pending row). Drives the Draft pill + filter. */
  has_draft_content: boolean;
  // Secondary-specific
  secondaryReview?: ProjectReviewResponse;
  existingImpact?: string;
}

const EVAL_SORT_CONFIG: Record<EvalSortKey, { kind: SortKind; get: (r: UnifiedEvalRow) => unknown }> = {
  employee_name:     { kind: "alpha",   get: (r) => r.employee_name },
  project_name:      { kind: "alpha",   get: (r) => r.project_name },
  cycle:             { kind: "cycle",   get: (r) => r.cycle },
  department_name:   { kind: "alpha",   get: (r) => r.department_name },
  review_status:     { kind: "alpha",   get: (r) => r.review_status },
  performance_group: { kind: "numeric", get: (r) => r.performance_group },
};

// ── Card View ───────────────────────────────────────────────────────

function EvalCard({
  row, onAction,
}: { readonly row: UnifiedEvalRow; readonly onAction: (row: UnifiedEvalRow) => void }) {
  const isPrimary = row.type === "primary";
  const isDone = row.review_status === "reviewed" || row.review_status === "submitted";
  // Primary pending row with PM-typed content == draft saved. Backend sets
  // has_draft_content=true only when at least one comment / rating / impact
  // statement is filled, so empty placeholder pending rows stay "Pending".
  const hasDraft = isPrimary && !isDone && row.has_draft_content;

  return (
    <div className={`rounded-xl border bg-surface p-4 shadow-sm flex flex-col gap-3 ${isDone ? "border-green-200 bg-green-50/30" : "border-border"}`}>
      <div className="flex items-center justify-between">
        {row.cycle ? (
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {row.cycle}
          </span>
        ) : (
          <span />
        )}
        {isDone ? (
          <span className="flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase text-green-700">
            <CheckCircle2 className="h-3 w-3" /> {row.review_status === "submitted" ? "Submitted" : "Reviewed"}
          </span>
        ) : hasDraft ? (
          <span className="flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[10px] font-bold uppercase text-brand">
            <Pencil className="h-3 w-3" /> Draft
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">
            <Clock className="h-3 w-3" /> Pending
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <UserCircle className="h-5 w-5 text-text-muted shrink-0" />
        <p className="text-[14px] font-semibold text-text-main">{row.employee_name}</p>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap text-[12px] text-text-muted">
        <Briefcase className="h-3 w-3 shrink-0" />
        <span className="truncate">{row.project_name}</span>
        <span className="font-mono text-[11px]">({row.project_code})</span>
        {!isPrimary && (
          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
            Secondary
          </span>
        )}
      </div>

      {isPrimary && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-muted">
          {row.department_name && <span>Dept: <span className="font-medium text-text-main">{row.department_name}</span></span>}
          {row.designation_name && <span>Desig: <span className="font-medium text-text-main">{row.designation_name}</span></span>}
        </div>
      )}

      <div className="mt-auto pt-2 border-t border-border/60">
        {isDone ? (
          <button type="button" onClick={() => onAction(row)}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100 transition-colors">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
        ) : (
          <button type="button" onClick={() => onAction(row)}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity">
            {isPrimary ? "Evaluate" : "Write Impact"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Tab Component ───────────────────────────────────────────────────

export function PMEvaluationTab() {
  const { user } = useAuth();
  const currentUserId = user?.user_id;
  const { settings } = useSystemSettings();
  const activeCycle = settings?.active_cycle_name ?? null;
  const toast = useToast();

  const [pmCards, setPmCards] = useState<PMPendingReviewCard[]>([]);
  const [secReviews, setSecReviews] = useState<ProjectReviewResponse[]>([]);
  const [expectations, setExpectations] = useState<RoleExpectation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  // Cycle filter — defaults to the active cycle so the page UX matches
  // what it was before we expanded the queue across all cycles. Setting
  // it to "" until settings load, then we sync below.
  const [cycleFilter, setCycleFilter] = useState<string>("");
  useEffect(() => {
    if (cycleFilter === "" && activeCycle) setCycleFilter(activeCycle);
  }, [activeCycle, cycleFilter]);
  const [sort, setSort] = useState<SortState<EvalSortKey> | null>(null);

  // Modal state
  const [evalTarget, setEvalTarget] = useState<UnifiedEvalRow | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [queueData, secData, expData] = await Promise.all([
        projectReviewService.getPMQueue(),
        projectReviewService.getSecondaryQueue().catch(() => []),
        projectReviewService.getRoleExpectations(),
      ]);
      setPmCards(queueData);
      setSecReviews(secData);
      setExpectations(expData);
    } catch { /* stays empty */ } finally { setIsLoading(false); }
  }, []);

  useEffect(() => { void loadData(); }, [loadData]);

  // Build unified rows
  const unifiedRows: UnifiedEvalRow[] = [];

  for (const c of pmCards) {
    unifiedRows.push({
      // Cycle is part of the key — same (project, user) can appear once
      // per cycle now that the queue spans all cycles.
      key: `pm-${c.project_id}-${c.user_id}-${c.cycle ?? "none"}`,
      type: "primary",
      employee_name: c.employee_name,
      project_id: c.project_id,
      project_name: c.project_name,
      project_code: c.project_code,
      department_name: c.department_name,
      designation_name: c.designation_name,
      assignment_role: c.assignment_role,
      review_status: c.review_status === "reviewed" ? "reviewed" : "pending",
      review_id: c.review_id,
      user_id: c.user_id,
      cycle: c.cycle,
      performance_group: c.performance_group ?? null,
      has_draft_content: !!c.has_draft_content,
    });
  }

  for (const r of secReviews) {
    const myEval = r.secondary_evaluations?.find((ev) => ev.evaluator_id === currentUserId);
    unifiedRows.push({
      key: `sec-${r.id}`,
      type: "secondary",
      employee_name: r.employee_name,
      project_id: r.project_id,
      project_name: r.project_name,
      project_code: r.project_code,
      department_name: null,
      designation_name: null,
      assignment_role: null,
      review_status: myEval ? "submitted" : "pending",
      review_id: r.id,
      user_id: r.user_id,
      cycle: r.cycle,
      performance_group: null,
      has_draft_content: false, // draft-pill semantics are PM-specific for now
      secondaryReview: r,
      existingImpact: myEval?.impact_statement ?? "",
    });
  }

  // Dropdown options
  const availableDepts = Array.from(new Set(unifiedRows.map((r) => r.department_name).filter(Boolean) as string[]));
  const availableEmployees = Array.from(new Set(unifiedRows.map((r) => r.employee_name)));
  const availableCycles = Array.from(new Set(unifiedRows.map((r) => r.cycle).filter((c): c is string => !!c)));
  const availableProjects = Array.from(new Set(unifiedRows.map((r) => r.project_name))).sort();

  // Filters
  const filteredRows = unifiedRows.filter((r) => {
    if (cycleFilter !== "all" && cycleFilter !== "" && r.cycle !== cycleFilter) return false;
    if (typeFilter !== "all" && r.type !== typeFilter) return false;
    // Status:
    //   pending → row is pending AND no draft content has been typed yet
    //   draft   → row is pending AND has_draft_content == true
    //   done    → submitted / reviewed
    if (statusFilter === "pending"
        && (r.review_status !== "pending" || r.has_draft_content)) return false;
    if (statusFilter === "draft"
        && (r.review_status !== "pending" || !r.has_draft_content)) return false;
    if (statusFilter === "done" && r.review_status === "pending") return false;
    if (deptFilter !== "all" && r.department_name !== deptFilter) return false;
    if (projectFilter !== "all" && r.project_name !== projectFilter) return false;
    if (employeeFilter !== "all" && r.employee_name !== employeeFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!r.employee_name.toLowerCase().includes(q) && !r.project_name.toLowerCase().includes(q) && !r.project_code.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  // Sorting layered on top of filtering. `slice()` first to avoid mutating state.
  const sortedRows = sort
    ? filteredRows.slice().sort((a, b) => {
        const { kind, get } = EVAL_SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : filteredRows;

  const getExpectation = (row: UnifiedEvalRow): RoleExpectation | null => {
    if (!row.department_name || !row.designation_name) return null;
    return expectations.find((e) => e.department_name === row.department_name && e.designation_name === row.designation_name) ?? null;
  };

  // Actions
  const handleAction = (row: UnifiedEvalRow) => {
    setModalError("");
    if (row.type === "primary") {
      setIsEditMode(row.review_status === "reviewed");
      setEvalTarget(row);
    } else {
      setEvalTarget(row);
    }
  };

  const closeModal = () => { setEvalTarget(null); setIsEditMode(false); setModalError(""); };

  const handlePMSubmit = async (payload: PMEvaluationPayload) => {
    if (!evalTarget) return;
    setIsSaving(true); setModalError("");
    try {
      if (isEditMode && evalTarget.review_id != null) {
        await projectReviewService.updateReview(evalTarget.review_id, payload);
        closeModal();
        toast.success("Evaluation updated.");
      } else {
        await projectReviewService.submitPMEvaluation(evalTarget.project_id, evalTarget.user_id!, payload);
        setPmCards((prev) => prev.map((c) =>
          c.project_id === evalTarget.project_id && c.user_id === evalTarget.user_id ? { ...c, review_status: "reviewed" } : c
        ));
        closeModal();
        toast.success("Evaluation submitted.");
      }
    } catch (err: unknown) { setModalError(getErrorMessage(err)); } finally { setIsSaving(false); }
  };

  const handleSecSubmit = async (reviewId: number, payload: SecondaryEvalPayload) => {
    setIsSaving(true); setModalError("");
    try {
      if (evalTarget?.review_status === "submitted") {
        await projectReviewService.updateSecondaryEval(reviewId, payload);
      } else {
        await projectReviewService.submitSecondaryEval(reviewId, payload);
      }
      await loadData();
      closeModal();
      toast.success("Impact statement saved.");
    } catch (err: unknown) { setModalError(getErrorMessage(err)); } finally { setIsSaving(false); }
  };

  const handlePMSaveDraft = async (payload: PMEvaluationDraftPayload) => {
    if (!evalTarget) return;
    setIsDraftSaving(true); setModalError("");
    try {
      await projectReviewService.savePMDraft(
        evalTarget.project_id,
        evalTarget.user_id!,
        payload,
      );
      // Refresh the queue so the card picks up the newly-created review_id.
      // Without this, the next time the PM opens the modal the draft fields
      // wouldn't preload (preload condition keys off review_id) AND the row
      // button stays "Evaluate" instead of flipping to "Continue Evaluation".
      await loadData();
      toast.success("Draft saved.");
    } catch (err: unknown) { setModalError(getErrorMessage(err)); } finally { setIsDraftSaving(false); }
  };

  const handleSecSaveDraft = async (
    reviewId: number,
    payload: SecondaryEvalDraftPayload,
  ) => {
    setIsDraftSaving(true); setModalError("");
    try {
      await projectReviewService.saveSecondaryDraft(reviewId, payload);
      await loadData();
      toast.success("Draft saved.");
    } catch (err: unknown) { setModalError(getErrorMessage(err)); } finally { setIsDraftSaving(false); }
  };

  const viewBtnCls = (mode: ViewMode) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${viewMode === mode ? "bg-brand/10 text-brand" : "text-text-muted hover:bg-slate-100"}`;

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse">Loading evaluation queue…</div>;
  }

  if (unifiedRows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
        <ClipboardList className="h-10 w-10 text-text-muted mb-3" />
        <p className="font-display text-base font-medium text-text-main">No evaluations to complete</p>
        <p className="mt-1 text-sm text-text-muted">You're not assigned as an evaluator on any active projects.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
            <input type="text" placeholder="Search employee or project..." value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-1.5 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand" />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-white p-0.5">
            <button type="button" className={viewBtnCls("grid")} onClick={() => setViewMode("grid")}><LayoutGrid className="h-3.5 w-3.5" /> Cards</button>
            <button type="button" className={viewBtnCls("table")} onClick={() => setViewMode("table")}><Table2 className="h-3.5 w-3.5" /> Table</button>
          </div>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Cycle</label>
            <select value={cycleFilter} onChange={(e) => setCycleFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[110px] cursor-pointer">
              <option value="all">All Cycles</option>
              {availableCycles.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Type</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[110px] cursor-pointer">
              <option value="all">All</option>
              <option value="primary">Primary</option>
              <option value="secondary">Secondary</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[110px] cursor-pointer">
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="draft">Draft</option>
              <option value="done">Completed</option>
            </select>
          </div>
          {availableDepts.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Dept</label>
              <select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}
                className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[110px] cursor-pointer">
                <option value="all">All Depts</option>
                {availableDepts.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          )}
          {availableProjects.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Project</label>
              <select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)}
                className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[160px] cursor-pointer">
                <option value="all">All Projects</option>
                {availableProjects.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Employee</label>
            <select value={employeeFilter} onChange={(e) => setEmployeeFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[130px] cursor-pointer">
              <option value="all">All</option>
              {availableEmployees.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Content */}
      {filteredRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center bg-background/50">
          <Search className="h-8 w-8 text-text-muted mb-2" />
          <p className="font-display text-sm font-medium text-text-main">No matching evaluations</p>
          <p className="mt-1 text-xs text-text-muted">Try adjusting your filters or search query.</p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sortedRows.map((r) => <EvalCard key={r.key} row={r} onAction={handleAction} />)}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-border">
                <th className="text-left px-5 py-2.5">
                  <SortableHeader label="Employee" columnKey="employee_name" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="Project" columnKey="project_name" sort={sort} onSort={setSort} />
                </th>
                <th className="hidden sm:table-cell text-left px-4 py-2.5">
                  <SortableHeader label="Cycle" columnKey="cycle" sort={sort} onSort={setSort} />
                </th>
                <th className="hidden md:table-cell text-left px-4 py-2.5">
                  <SortableHeader label="Dept" columnKey="department_name" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="Status" columnKey="review_status" sort={sort} onSort={setSort} />
                </th>
                <th className="hidden md:table-cell text-left px-4 py-2.5">
                  <SortableHeader label="Rating" columnKey="performance_group" sort={sort} onSort={setSort} />
                </th>
                <th className="text-right px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {sortedRows.map((r) => {
                const isDone = r.review_status !== "pending";
                const rowHasDraft = r.type === "primary" && !isDone && r.has_draft_content;
                return (
                  <tr key={r.key} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <UserCircle className="h-4 w-4 text-text-muted shrink-0" />
                        <span className="font-medium text-text-main">{r.employee_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5 text-text-main">
                        <span>{r.project_name}</span>
                        {r.type === "secondary" && (
                          <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600">
                            Secondary
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] font-mono text-text-muted">{r.project_code}</div>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 text-text-muted">
                      {r.cycle ?? "—"}
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-text-muted">{r.department_name ?? "—"}</td>
                    <td className="px-4 py-3">
                      {isDone ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold uppercase text-green-700">
                          <CheckCircle2 className="h-3 w-3" /> {r.review_status === "submitted" ? "Submitted" : "Reviewed"}
                        </span>
                      ) : rowHasDraft ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-brand/10 px-2 py-0.5 text-[11px] font-bold uppercase text-brand">
                          <Pencil className="h-3 w-3" /> Draft
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-700">
                          <Clock className="h-3 w-3" /> Pending
                        </span>
                      )}
                    </td>
                    <td className="hidden md:table-cell px-4 py-3">
                      {r.performance_group ? (
                        <span className="font-semibold text-text-main">{r.performance_group}</span>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isDone ? (
                        <button type="button" onClick={() => handleAction(r)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-[12px] font-medium text-green-700 hover:bg-green-100 transition-colors">
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                      ) : (
                        <button type="button" onClick={() => handleAction(r)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 transition-opacity">
                          {r.type === "primary" ? "Evaluate" : "Write Impact"}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {evalTarget?.type === "primary" && (
        <EvalModal card={evalTarget} expectation={getExpectation(evalTarget)} isEditMode={isEditMode}
          onSubmit={handlePMSubmit}
          onSaveDraft={isEditMode ? undefined : handlePMSaveDraft}
          onClose={closeModal} isSaving={isSaving} isDraftSaving={isDraftSaving} error={modalError} />
      )}
      {evalTarget?.type === "secondary" && (
        <ImpactModal row={evalTarget}
          onSubmit={handleSecSubmit}
          onSaveDraft={evalTarget.review_status === "submitted" ? undefined : handleSecSaveDraft}
          onClose={closeModal} isSaving={isSaving} isDraftSaving={isDraftSaving} error={modalError} />
      )}
    </div>
  );
}
