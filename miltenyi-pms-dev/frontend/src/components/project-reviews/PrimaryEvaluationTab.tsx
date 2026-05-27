/**
 * PrimaryEvaluationTab.tsx — PM (Primary Evaluator) Queue.
 *
 * Lists every review the current PM owns: one row per (project, team
 * member, cycle). Rendered as a card grid or table with cycle / function
 * / project / employee / status filters. Submitting opens `EvalModal`.
 *
 * Secondary impact statements live in their own tab (`SecondaryEvalTab`).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  UserCircle, Briefcase, ClipboardList, Pencil,
  LayoutGrid, Table2, Search, CheckCircle2, Clock,
} from "lucide-react";
import {
  projectReviewService,
  type PMEvaluationPayload,
  type PMEvaluationDraftPayload,
  type RoleExpectation,
} from "@/services/project-review.service";
import { getErrorMessage } from "@/utils/errors";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { useToast } from "@/hooks/useToast";
import { SortableHeader } from "@/components/SortableHeader";
import { compareValues, type SortKind, type SortState, type SortValue } from "@/utils/sort";
import { EvalModal } from "@/components/project-reviews/EvalModal";
import { PerformanceRatingBadge } from "@/components/reviews/PerformanceRatingBadge";
import { ClearFiltersButton } from "@/components/common/ClearFiltersButton";
import { StringCombobox } from "@/components/common/StringCombobox";
import { setOrDeleteParam, searchParamsChanged } from "@/utils/searchParams";

// ── Constants ───────────────────────────────────────────────────────

type ViewMode = "grid" | "table";

type EvalSortKey =
  | "employee_name"
  | "project_name"
  | "cycle"
  | "function_name"
  | "review_status"
  | "performance_group";

interface PrimaryEvalRow {
  key: string;
  employee_name: string;
  project_id: number;
  project_name: string;
  project_code: string;
  function_name: string | null;
  designation_name: string | null;
  assignment_role: string | null;
  review_status: "pending" | "reviewed";
  review_id: number | null;
  user_id: number | null;
  cycle: string | null;
  performance_group: string | null;
  has_draft_content: boolean;
}

const EVAL_SORT_CONFIG: Record<EvalSortKey, { kind: SortKind; get: (r: PrimaryEvalRow) => SortValue }> = {
  employee_name:     { kind: "alpha",   get: (r) => r.employee_name },
  project_name:      { kind: "alpha",   get: (r) => r.project_name },
  cycle:             { kind: "cycle",   get: (r) => r.cycle },
  function_name:     { kind: "alpha",   get: (r) => r.function_name },
  review_status:     { kind: "alpha",   get: (r) => r.review_status },
  performance_group: { kind: "numeric", get: (r) => r.performance_group },
};

// ── Card View ───────────────────────────────────────────────────────

function EvalCard({
  row, onAction,
}: { readonly row: PrimaryEvalRow; readonly onAction: (row: PrimaryEvalRow) => void }) {
  const isDone = row.review_status === "reviewed";
  const hasDraft = !isDone && row.has_draft_content;

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
            <CheckCircle2 className="h-3 w-3" /> Reviewed
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
      </div>

      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-text-muted">
        {row.function_name && <span>Function: <span className="font-medium text-text-main">{row.function_name}</span></span>}
        {row.designation_name && <span>Desig: <span className="font-medium text-text-main">{row.designation_name}</span></span>}
      </div>

      <div className="mt-auto pt-2 border-t border-border/60">
        {isDone ? (
          <button type="button" onClick={() => onAction(row)}
            className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100 transition-colors">
            <Pencil className="h-3.5 w-3.5" /> Edit
          </button>
        ) : (
          <button type="button" onClick={() => onAction(row)}
            className="w-full rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity">
            Evaluate
          </button>
        )}
      </div>
    </div>
  );
}

// ── Tab Component ───────────────────────────────────────────────────

export function PrimaryEvaluationTab() {
  const { settings } = useSystemSettings();
  const activeCycle = settings?.active_cycle_name ?? null;
  const toast = useToast();

  const queryClient = useQueryClient();

  // ── Queries ────────────────────────────────────────────────────────
  // Two independent queries — TanStack runs them in parallel
  // automatically. roleExpectations is the SAME key the parent
  // ProjectReviews uses (PR #07), so when the PM lands here straight
  // from the page header, the expectations cache is already warm.
  const pmQueueQuery = useQuery({
    queryKey: queryKeys.projectReviews.pmQueue(),
    queryFn: projectReviewService.getPMQueue,
  });
  const expectationsQuery = useQuery({
    queryKey: queryKeys.projectReviews.roleExpectations(),
    queryFn: projectReviewService.getRoleExpectations,
  });
  const pmCards = pmQueueQuery.data ?? [];
  const expectations: RoleExpectation[] = expectationsQuery.data ?? [];
  const isLoading = pmQueueQuery.isPending;

  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [searchQuery, setSearchQuery] = useState("");
  // Status default is "pending" — answers the PM's most common
  // question ("what do I owe?") without forcing them to narrow on
  // first paint. Mirrors the same "show live work first" default
  // pattern applied elsewhere (UsersTab status=active, AnnualGoals
  // current-FY default).
  const [statusFilter, setStatusFilter] = useState<string>("pending");
  const [funcFilter, setFuncFilter] = useState<string>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");
  // Default the cycle filter to the active cycle once settings load.
  // Snapshot during render via React 19's "store info from previous
  // renders" pattern; the conditional gate prevents an infinite loop.
  const [cycleFilter, setCycleFilter] = useState<string>("");
  if (cycleFilter === "" && activeCycle) {
    setCycleFilter(activeCycle);
  }
  const [sort, setSort] = useState<SortState<EvalSortKey> | null>(null);

  // ── URL state ──────────────────────────────────────────────────────
  // Read deep-link params on first mount and seed filter state. Today's
  // senders:
  //   • ActionItemsWidget "Project reviews to write" → ?status=pending
  //   • Future: dashboard cards may carry ?cycle= / ?project=.
  // Write-back mirrors the current filter selection to URL so refresh
  // and share-link preserve the view. Both effects gated on the same
  // ref so the first render's empty/default state can't clobber URL
  // params before the reader has had a chance to seed state.
  const [searchParams, setSearchParams] = useSearchParams();
  const filtersDefaultedRef = useRef(false);
  useEffect(() => {
    if (filtersDefaultedRef.current) return;
    const urlStatus = searchParams.get("status");
    const urlCycle = searchParams.get("cycle");
    const urlFunc = searchParams.get("function");
    const urlProject = searchParams.get("project");
    const urlEmployee = searchParams.get("employee");
    if (urlStatus) setStatusFilter(urlStatus);
    if (urlCycle) setCycleFilter(urlCycle);
    if (urlFunc) setFuncFilter(urlFunc);
    if (urlProject) setProjectFilter(urlProject);
    if (urlEmployee) setEmployeeFilter(urlEmployee);
    filtersDefaultedRef.current = true;
  }, [searchParams]);

  useEffect(() => {
    if (!filtersDefaultedRef.current) return;
    const next = new URLSearchParams(searchParams);
    // Status: "pending" is the page default (not a missing-key
    // sentinel), and "all" is a real broadening choice the PM
    // explicitly picked. So we can't use setOrDeleteParam's standard
    // semantics here — we want the URL to be present whenever the
    // PM has deviated from the default, including when they chose
    // "all". Delete only when state matches the default.
    if (statusFilter && statusFilter !== "pending") {
      next.set("status", statusFilter);
    } else {
      next.delete("status");
    }
    // Cycle: only persist when it differs from the active-cycle default
    // so the URL stays clean for the common case (PM is on the current
    // cycle — that's the page's natural state, no need to encode it).
    setOrDeleteParam(
      next,
      "cycle",
      cycleFilter === activeCycle ? undefined : cycleFilter,
    );
    setOrDeleteParam(next, "function", funcFilter);
    setOrDeleteParam(next, "project", projectFilter);
    setOrDeleteParam(next, "employee", employeeFilter);
    if (searchParamsChanged(searchParams, next)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    statusFilter,
    cycleFilter,
    funcFilter,
    projectFilter,
    employeeFilter,
    activeCycle,
    searchParams,
    setSearchParams,
  ]);

  // Modal state
  const [evalTarget, setEvalTarget] = useState<PrimaryEvalRow | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [modalError, setModalError] = useState("");

  // ── Mutations ──────────────────────────────────────────────────────
  // Same broadcast-invalidation pattern as PR #22 (goals) / PR #27
  // (goal-approval): every write fans out to every cache entry under
  // ['project-reviews'] (catches Employee's mine, Mentor's mentees, HR's
  // org, the PM queue itself, the secondary queue) plus dashboard
  // (project_reviews_pending_primary / pending_secondary counts on
  // DashboardSummary).
  const invalidatePMScope = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.projectReviews.all,
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  }, [queryClient]);

  // updateReview edits an already-submitted PM evaluation (different
  // verb — PUT — and a different endpoint than submitPMEvaluation).
  // We treat it as a separate mutation instance to keep the UX flows
  // independent: editing a submitted row shows a different toast and
  // doesn't need the "row moves from pending to reviewed" UX.
  const updateReviewMutation = useMutation({
    mutationFn: (vars: { reviewId: number; payload: PMEvaluationPayload }) =>
      projectReviewService.updateReview(vars.reviewId, vars.payload),
    onSuccess: () => {
      invalidatePMScope();
      closeModal();
      toast.success("Evaluation updated.");
    },
    onError: (err) => setModalError(getErrorMessage(err)),
  });

  // submitPMEvaluation creates a new evaluation (POST /evaluate). Takes
  // 3 args (projectId, userId, payload) → pack-into-object pattern.
  const submitMutation = useMutation({
    mutationFn: (vars: {
      projectId: number;
      userId: number;
      payload: PMEvaluationPayload;
    }) =>
      projectReviewService.submitPMEvaluation(
        vars.projectId,
        vars.userId,
        vars.payload,
      ),
    onSuccess: () => {
      invalidatePMScope();
      closeModal();
      toast.success("Evaluation submitted.");
    },
    onError: (err) => setModalError(getErrorMessage(err)),
  });

  // savePMDraft (PATCH /evaluate/.../draft) — leaves the modal open
  // so the PM can keep editing. Same 3-arg pack-into-object pattern.
  const draftMutation = useMutation({
    mutationFn: (vars: {
      projectId: number;
      userId: number;
      payload: PMEvaluationDraftPayload;
    }) =>
      projectReviewService.savePMDraft(
        vars.projectId,
        vars.userId,
        vars.payload,
      ),
    onSuccess: () => {
      // Refresh the queue so the row picks up has_draft_content=true
      // and a real review_id (which switches the row's CTA from
      // "Start Evaluation" to "Continue Evaluation").
      invalidatePMScope();
      toast.success("Draft saved.");
    },
    onError: (err) => setModalError(getErrorMessage(err)),
  });

  // Build rows
  const rows: PrimaryEvalRow[] = pmCards.map((c) => ({
    key: `pm-${c.project_id}-${c.user_id}-${c.cycle ?? "none"}`,
    employee_name: c.employee_name,
    project_id: c.project_id,
    project_name: c.project_name,
    project_code: c.project_code,
    function_name: c.function_name,
    designation_name: c.designation_name,
    assignment_role: c.assignment_role,
    review_status: c.review_status === "reviewed" ? "reviewed" : "pending",
    review_id: c.review_id,
    user_id: c.user_id,
    cycle: c.cycle,
    performance_group: c.performance_group ?? null,
    has_draft_content: !!c.has_draft_content,
  }));

  // Filter dropdown sources. Functions / Employees are now sorted
  // alphabetically because they feed StringCombobox below — a sorted
  // option list reads more naturally when the user is type-narrowing.
  // Projects was already sorted; cycles stay in insertion order so the
  // newest cycle stays at the top of the dropdown.
  const availableFuncs = Array.from(
    new Set(rows.map((r) => r.function_name).filter(Boolean) as string[]),
  ).sort();
  const availableEmployees = Array.from(
    new Set(rows.map((r) => r.employee_name)),
  ).sort();
  const availableCycles = Array.from(new Set(rows.map((r) => r.cycle).filter((c): c is string => !!c)));
  const availableProjects = Array.from(new Set(rows.map((r) => r.project_name))).sort();

  const filteredRows = rows.filter((r) => {
    if (cycleFilter !== "all" && cycleFilter !== "" && r.cycle !== cycleFilter) return false;
    if (statusFilter === "pending"
        && (r.review_status !== "pending" || r.has_draft_content)) return false;
    if (statusFilter === "draft"
        && (r.review_status !== "pending" || !r.has_draft_content)) return false;
    if (statusFilter === "done" && r.review_status === "pending") return false;
    if (funcFilter !== "all" && r.function_name !== funcFilter) return false;
    if (projectFilter !== "all" && r.project_name !== projectFilter) return false;
    if (employeeFilter !== "all" && r.employee_name !== employeeFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (!r.employee_name.toLowerCase().includes(q) && !r.project_name.toLowerCase().includes(q) && !r.project_code.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const sortedRows = sort
    ? filteredRows.slice().sort((a, b) => {
        const { kind, get } = EVAL_SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : filteredRows;

  const getExpectation = (row: PrimaryEvalRow): RoleExpectation | null => {
    if (!row.function_name || !row.designation_name) return null;
    // GCC expectations are keyed by (function, career_level); match by
    // function + the employee's designation appearing in the row's
    // titles list.
    return expectations.find(
      (e) =>
        e.function_name === row.function_name &&
        e.designation_names.includes(row.designation_name!),
    ) ?? null;
  };

  const handleAction = (row: PrimaryEvalRow) => {
    setModalError("");
    setIsEditMode(row.review_status === "reviewed");
    setEvalTarget(row);
  };

  const closeModal = () => { setEvalTarget(null); setIsEditMode(false); setModalError(""); };

  // EvalModal awaits onSubmit / onSaveDraft to drive its "Saving..."
  // spinner, so mutateAsync + try/catch is the right pattern (matches
  // every previous modal flow: UserModal #20, GoalFormModal #22,
  // GoalSelfReviewModal #22, EvalDrawer #25, etc.). The catch swallow
  // is purely to preserve "onSubmit never throws" for the modal — the
  // actual error UX runs in the mutation's onError callback.
  const handlePMSubmit = async (payload: PMEvaluationPayload) => {
    if (!evalTarget) return;
    setModalError("");
    try {
      if (isEditMode && evalTarget.review_id != null) {
        await updateReviewMutation.mutateAsync({
          reviewId: evalTarget.review_id,
          payload,
        });
      } else {
        await submitMutation.mutateAsync({
          projectId: evalTarget.project_id,
          userId: evalTarget.user_id!,
          payload,
        });
      }
    } catch {
      /* handled by onError */
    }
  };

  const handlePMSaveDraft = async (payload: PMEvaluationDraftPayload) => {
    if (!evalTarget) return;
    setModalError("");
    try {
      await draftMutation.mutateAsync({
        projectId: evalTarget.project_id,
        userId: evalTarget.user_id!,
        payload,
      });
    } catch {
      /* handled by onError */
    }
  };

  const viewBtnCls = (mode: ViewMode) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${viewMode === mode ? "bg-brand/10 text-brand" : "text-text-muted hover:bg-slate-100"}`;

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse">Loading evaluation queue…</div>;
  }

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
        <ClipboardList className="h-10 w-10 text-text-muted mb-3" />
        <p className="font-display text-base font-medium text-text-main">No evaluations to complete</p>
        <p className="mt-1 text-sm text-text-muted">You're not the Primary evaluator on any active projects.</p>
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
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Status</label>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[110px] cursor-pointer">
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="draft">Draft</option>
              <option value="done">Completed</option>
            </select>
          </div>
          {/* Function / Project / Employee are the high-cardinality
              filters — a PM on multiple projects can have 20-40+
              employees across several functions. Migrated to
              StringCombobox so the PM can type-narrow ("eng" finds
              Engineering / Engineering Manager / etc.) instead of
              scrolling. State uses "all" as the no-filter sentinel;
              combobox uses "" — translate on both edges. Cycle +
              Status stay plain selects (small enumerated lists). */}
          {availableFuncs.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Function</label>
              <StringCombobox
                id="pm-eval-func-filter"
                options={availableFuncs}
                value={funcFilter === "all" ? "" : funcFilter}
                onChange={(v) => setFuncFilter(v === "" ? "all" : v)}
                placeholder="All Functions"
              />
            </div>
          )}
          {availableProjects.length > 0 && (
            <div className="flex items-center gap-2">
              <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Project</label>
              <StringCombobox
                id="pm-eval-project-filter"
                options={availableProjects}
                value={projectFilter === "all" ? "" : projectFilter}
                onChange={(v) => setProjectFilter(v === "" ? "all" : v)}
                placeholder="All Projects"
              />
            </div>
          )}
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Employee</label>
            <StringCombobox
              id="pm-eval-employee-filter"
              options={availableEmployees}
              value={employeeFilter === "all" ? "" : employeeFilter}
              onChange={(v) => setEmployeeFilter(v === "" ? "all" : v)}
              placeholder="All Employees"
            />
          </div>
          <ClearFiltersButton
            // Defaults the PM page settles into: status=pending +
            // cycle=active. Both count as "no filter applied" because
            // they're the natural entry-point state ("what do I owe
            // for this cycle?"). The button activates only when the
            // PM has deviated from one of those.
            active={
              searchQuery.trim().length > 0 ||
              statusFilter !== "pending" ||
              funcFilter !== "all" ||
              projectFilter !== "all" ||
              employeeFilter !== "all" ||
              (cycleFilter !== "" && cycleFilter !== activeCycle)
            }
            onClear={() => {
              setSearchQuery("");
              setStatusFilter("pending");
              setFuncFilter("all");
              setProjectFilter("all");
              setEmployeeFilter("all");
              setCycleFilter(activeCycle ?? "");
            }}
          />
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
          <table className="w-full min-w-max text-[13px]">
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
                  <SortableHeader label="Function" columnKey="function_name" sort={sort} onSort={setSort} />
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
                const rowHasDraft = !isDone && r.has_draft_content;
                return (
                  <tr key={r.key} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <UserCircle className="h-4 w-4 text-text-muted shrink-0" />
                        <span className="font-medium text-text-main">{r.employee_name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-text-main">{r.project_name}</div>
                      <div className="text-[11px] font-mono text-text-muted">{r.project_code}</div>
                    </td>
                    <td className="hidden sm:table-cell px-4 py-3 text-text-muted">
                      {r.cycle ?? "—"}
                    </td>
                    <td className="hidden md:table-cell px-4 py-3 text-text-muted">{r.function_name ?? "—"}</td>
                    <td className="px-4 py-3">
                      {isDone ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold uppercase text-green-700">
                          <CheckCircle2 className="h-3 w-3" /> Reviewed
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
                      <PerformanceRatingBadge value={r.performance_group} />
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
                          Evaluate
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

      {/* Modal */}
      {evalTarget && (
        <EvalModal card={evalTarget} expectation={getExpectation(evalTarget)} isEditMode={isEditMode}
          onSubmit={handlePMSubmit}
          onSaveDraft={isEditMode ? undefined : handlePMSaveDraft}
          onClose={closeModal}
          isSaving={submitMutation.isPending || updateReviewMutation.isPending}
          isDraftSaving={draftMutation.isPending}
          error={modalError} />
      )}
    </div>
  );
}
