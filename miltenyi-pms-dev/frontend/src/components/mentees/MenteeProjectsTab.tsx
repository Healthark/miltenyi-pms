import { useCallback, useEffect, useState } from "react";
import {
  Briefcase,
  CheckCircle2,
  ClipboardList,
  Clock,
  Eye,
  LayoutGrid,
  Pencil,
  Search,
  Table2,
  UserCircle,
} from "lucide-react";
import {
  projectReviewService,
  type PMEvaluationPayload,
  type PMEvaluationDraftPayload,
  type ProjectReviewResponse,
  type RoleExpectation,
  type SecondaryEvalPayload,
  type SecondaryEvalDraftPayload,
} from "../../services/project-review.service";
import type { MenteeProjectAssignment } from "../../services/mentee.service";
import { getErrorMessage } from "../../utils/errors";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";
import { SortableHeader } from "../SortableHeader";
import { compareValues, type SortKind, type SortState } from "../../utils/sort";
import { EvalModal, type EvalModalCard } from "../project-reviews/EvalModal";
import { ImpactModal, type ImpactModalRow } from "../project-reviews/ImpactModal";
import { PerformanceRatingBadge } from "../reviews/PerformanceRatingBadge";

// ── Local row shape ────────────────────────────────────────────────
// Built from MenteeProjectAssignment. Carries the minimum the modals need
// via the EvalModalCard / ImpactModalRow structural shapes.

interface MenteeEvalRow {
  key: string;
  project_id: number;
  project_name: string;
  project_code: string;
  assignment_role: string | null;
  /** PM (Primary evaluator) on this project. */
  pm_name: string | null;
  /** The MENTOR's evaluator_type — drives the action button. */
  viewer_evaluator_role: string | null;
  cycle: string | null;
  review_status: string | null;    // "pending" | "reviewed" | null
  performance_group: string | null;
  review_id: number | null;
  review_detail: ProjectReviewResponse | null;
}

type ViewMode = "grid" | "table";
type StatusFilterValue = "all" | "pending" | "reviewed";

type SortKey =
  | "project_name"
  | "pm_name"
  | "cycle"
  | "review_status"
  | "performance_group";

const SORT_CONFIG: Record<SortKey, { kind: SortKind; get: (r: MenteeEvalRow) => unknown }> = {
  project_name:      { kind: "alpha",   get: (r) => r.project_name },
  pm_name:           { kind: "alpha",   get: (r) => r.pm_name },
  cycle:             { kind: "cycle",   get: (r) => r.cycle },
  review_status:     { kind: "alpha",   get: (r) => r.review_status ?? "pending" },
  performance_group: { kind: "numeric", get: (r) => r.performance_group },
};

// ── Status badge ───────────────────────────────────────────────────

function StatusBadge({ status }: { readonly status: string | null }) {
  if (status === "reviewed") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold uppercase text-green-700">
        <CheckCircle2 className="h-3 w-3" /> Reviewed
      </span>
    );
  }
  // Null (active-cycle placeholder row) and "pending" both render as
  // Pending — they mean the same thing from the mentor's perspective.
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-700">
      <Clock className="h-3 w-3" /> Pending
    </span>
  );
}

// ── Action button logic ─────────────────────────────────────────────

type ActionVariant =
  | { kind: "none" }
  | { kind: "evaluate" }     // viewer=Primary, pending
  | { kind: "write_impact" } // viewer=Secondary, pending
  | { kind: "edit" }         // viewer=Primary, reviewed
  | { kind: "view" }         // reviewed, viewer is not Primary
  | { kind: "pending_label" }; // pending, viewer cannot act

function resolveAction(row: MenteeEvalRow): ActionVariant {
  // null (active-cycle placeholder) and "pending" are treated identically.
  if (row.review_status == null || row.review_status === "pending") {
    if (row.viewer_evaluator_role === "Primary") return { kind: "evaluate" };
    if (row.viewer_evaluator_role === "Secondary") return { kind: "write_impact" };
    return { kind: "pending_label" };
  }
  if (row.review_status === "reviewed") {
    if (row.viewer_evaluator_role === "Primary") return { kind: "edit" };
    return { kind: "view" };
  }
  return { kind: "none" };
}

function ActionButton({
  row,
  onEvaluate,
  onWriteImpact,
  onView,
}: {
  readonly row: MenteeEvalRow;
  readonly onEvaluate: (r: MenteeEvalRow) => void;
  readonly onWriteImpact: (r: MenteeEvalRow) => void;
  readonly onView: (r: MenteeEvalRow) => void;
}) {
  const a = resolveAction(row);
  if (a.kind === "none") return <span className="text-text-muted">—</span>;
  if (a.kind === "pending_label") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-text-muted italic">
        <Clock className="h-3 w-3" /> Pending
      </span>
    );
  }
  if (a.kind === "evaluate") {
    return (
      <button
        type="button"
        onClick={() => onEvaluate(row)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-brand px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 transition-opacity"
      >
        Evaluate
      </button>
    );
  }
  if (a.kind === "write_impact") {
    return (
      <button
        type="button"
        onClick={() => onWriteImpact(row)}
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 transition-opacity"
      >
        Write Impact
      </button>
    );
  }
  if (a.kind === "edit") {
    return (
      <button
        type="button"
        onClick={() => onEvaluate(row)}
        className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-[12px] font-medium text-green-700 hover:bg-green-100 transition-colors"
      >
        <Pencil className="h-3 w-3" /> Edit
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onView(row)}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-medium text-text-main hover:bg-slate-50 transition-colors"
    >
      <Eye className="h-3 w-3" /> View
    </button>
  );
}

// ── Card view ───────────────────────────────────────────────────────

function EvalCard({
  row,
  onEvaluate,
  onWriteImpact,
  onView,
}: {
  readonly row: MenteeEvalRow;
  readonly onEvaluate: (r: MenteeEvalRow) => void;
  readonly onWriteImpact: (r: MenteeEvalRow) => void;
  readonly onView: (r: MenteeEvalRow) => void;
}) {
  const isDone = row.review_status === "reviewed";
  return (
    <div
      className={`rounded-xl border bg-surface p-4 shadow-sm flex flex-col gap-3 ${
        isDone ? "border-green-200 bg-green-50/30" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between">
        {row.cycle ? (
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
            {row.cycle}
          </span>
        ) : (
          <span />
        )}
        <StatusBadge status={row.review_status} />
      </div>
      <div className="flex items-center gap-2">
        <Briefcase className="h-4 w-4 text-text-muted shrink-0" />
        <div className="min-w-0">
          <p className="text-[14px] font-semibold text-text-main truncate">
            {row.project_name}
          </p>
          <p className="text-[11px] font-mono text-text-muted">{row.project_code}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-text-muted">
        {row.pm_name && (
          <span className="flex items-center gap-1">
            <UserCircle className="h-3 w-3" />
            PM: <span className="font-medium text-text-main">{row.pm_name}</span>
          </span>
        )}
        {row.assignment_role && (
          <span>
            Role: <span className="font-medium text-text-main">{row.assignment_role}</span>
          </span>
        )}
        {row.performance_group && (
          <span className="inline-flex items-center gap-1.5">
            Rating:
            <PerformanceRatingBadge value={Number(row.performance_group)} />
          </span>
        )}
      </div>
      <div className="mt-auto pt-2 border-t border-border/60">
        <ActionButton
          row={row}
          onEvaluate={onEvaluate}
          onWriteImpact={onWriteImpact}
          onView={onView}
        />
      </div>
    </div>
  );
}

// ── Main tab ───────────────────────────────────────────────────────

interface MenteeProjectsTabProps {
  readonly assignments: MenteeProjectAssignment[];
  readonly menteeName: string;
  /** Needed for the create-path of EvalModal (submitPMEvaluation). */
  readonly menteeUserId: number;
  readonly onReload: () => void;
}

export function MenteeProjectsTab({
  assignments,
  menteeName,
  menteeUserId,
  onReload,
}: MenteeProjectsTabProps) {
  const { user } = useAuth();
  const currentUserId = user?.user_id ?? null;
  const toast = useToast();

  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [searchQuery, setSearchQuery] = useState("");
  // "all" = every cycle; specific cycle name otherwise.
  const [cycleFilter, setCycleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [sort, setSort] = useState<SortState<SortKey> | null>(null);
  const [expectations, setExpectations] = useState<RoleExpectation[]>([]);

  // Modal state
  const [evalTarget, setEvalTarget] = useState<MenteeEvalRow | null>(null);
  const [evalMode, setEvalMode] = useState<"create" | "edit" | "view">("create");
  const [impactTarget, setImpactTarget] = useState<MenteeEvalRow | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  // Role expectations only matter when the mentor will actually evaluate.
  // Fetching is cheap and cached at the service layer — same call the
  // Project Reviews page makes.
  useEffect(() => {
    projectReviewService
      .getRoleExpectations()
      .then(setExpectations)
      .catch(() => setExpectations([]));
  }, []);

  // Build row list from assignments. Backend now emits one assignment row
  // per (project, cycle), so we map 1:1.
  const rows: MenteeEvalRow[] = assignments.map((a, i) => ({
    key: `${a.project_id}-${a.cycle ?? "none"}-${i}`,
    project_id: a.project_id,
    project_name: a.project_name,
    project_code: a.project_code,
    assignment_role: a.assignment_role,
    pm_name: a.pm_name,
    viewer_evaluator_role: a.viewer_evaluator_role,
    cycle: a.cycle,
    review_status: a.review_status,
    performance_group: a.performance_group,
    review_id: a.review_detail?.id ?? null,
    review_detail: a.review_detail,
  }));

  // Cycles available in the data (newest-cycle ordering matches whatever
  // the backend already does — we just dedupe).
  const availableCycles = Array.from(
    new Set(rows.map((r) => r.cycle).filter((c): c is string => !!c)),
  );

  const filteredRows = rows.filter((r) => {
    if (cycleFilter !== "all" && r.cycle !== cycleFilter) return false;
    // null and "pending" are treated identically by the Pending filter.
    if (statusFilter === "pending" && r.review_status === "reviewed") return false;
    if (statusFilter === "reviewed" && r.review_status !== "reviewed") return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (
        !r.project_name.toLowerCase().includes(q) &&
        !r.project_code.toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });

  const sortedRows = sort
    ? filteredRows.slice().sort((a, b) => {
        const { kind, get } = SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : filteredRows;

  const getExpectation = (row: MenteeEvalRow): RoleExpectation | null => {
    // Best-effort: match by assignment_role when available. If the mentor
    // doesn't get a match the expectation panel just won't render.
    if (!row.assignment_role) return null;
    return (
      expectations.find((e) => e.designation_name === row.assignment_role) ?? null
    );
  };

  // Build the EvalModalCard shape for the modal
  const toEvalCard = useCallback(
    (row: MenteeEvalRow): EvalModalCard => ({
      employee_name: menteeName,
      project_name: row.project_name,
      project_code: row.project_code,
      department_name: null,
      review_id: row.review_id,
    }),
    [menteeName],
  );

  // Build ImpactModalRow shape. When viewer is Secondary on a pending review,
  // we need the ProjectReviewResponse to POST against. If review_detail is
  // null (pending), we fetch the review stub via getReview — requires a
  // review_id which we may not have for "no review yet" rows. We gate the
  // button on review_status === "pending" which implies a review exists.
  const [impactLoading, setImpactLoading] = useState(false);

  const handleEvaluate = (row: MenteeEvalRow) => {
    setModalError("");
    setEvalMode(row.review_status === "reviewed" ? "edit" : "create");
    setEvalTarget(row);
  };

  const handleView = async (row: MenteeEvalRow) => {
    setModalError("");
    setEvalMode("view");
    setEvalTarget(row);
  };

  const handleWriteImpact = async (row: MenteeEvalRow) => {
    setModalError("");
    if (row.review_id == null) return;
    // We need the full ProjectReviewResponse to identify the mentor's own
    // secondary_evaluation row (if any) for edit mode. Fetch on demand —
    // review_detail on row is only populated for "reviewed" rows; we need
    // the pending one too.
    setImpactLoading(true);
    try {
      const review = await projectReviewService.getReview(row.review_id);
      setImpactTarget({
        ...row,
        review_detail: review,
      } as MenteeEvalRow);
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setImpactLoading(false);
    }
  };

  const closeEval = () => {
    setEvalTarget(null);
    setModalError("");
  };
  const closeImpact = () => {
    setImpactTarget(null);
    setModalError("");
  };

  const handlePMSubmit = async (payload: PMEvaluationPayload) => {
    if (!evalTarget) return;
    setIsSaving(true);
    setModalError("");
    try {
      const isEdit = evalMode === "edit" && evalTarget.review_id != null;
      if (isEdit) {
        await projectReviewService.updateReview(evalTarget.review_id!, payload);
      } else {
        await projectReviewService.submitPMEvaluation(
          evalTarget.project_id,
          menteeUserId,
          payload,
        );
      }
      onReload();
      closeEval();
      toast.success(isEdit ? "Evaluation updated." : "Evaluation submitted.");
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handlePMSaveDraft = async (payload: PMEvaluationDraftPayload) => {
    if (!evalTarget) return;
    setIsDraftSaving(true);
    setModalError("");
    try {
      await projectReviewService.savePMDraft(
        evalTarget.project_id,
        menteeUserId,
        payload,
      );
      onReload();
      toast.success("Draft saved.");
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsDraftSaving(false);
    }
  };

  const handleSecSaveDraft = async (
    reviewId: number,
    payload: SecondaryEvalDraftPayload,
  ) => {
    setIsDraftSaving(true);
    setModalError("");
    try {
      await projectReviewService.saveSecondaryDraft(reviewId, payload);
      onReload();
      toast.success("Draft saved.");
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsDraftSaving(false);
    }
  };

  const handleSecSubmit = async (
    reviewId: number,
    payload: SecondaryEvalPayload,
  ) => {
    if (!impactTarget) return;
    setIsSaving(true);
    setModalError("");
    try {
      // If the mentor already wrote an impact here, PUT — otherwise POST.
      const mine = impactTarget.review_detail?.secondary_evaluations.find(
        (ev) => ev.evaluator_id === currentUserId,
      );
      if (mine) {
        await projectReviewService.updateSecondaryEval(reviewId, payload);
      } else {
        await projectReviewService.submitSecondaryEval(reviewId, payload);
      }
      onReload();
      closeImpact();
      toast.success(mine ? "Impact statement updated." : "Impact statement submitted.");
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const viewBtnCls = (mode: ViewMode) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
      viewMode === mode
        ? "bg-brand/10 text-brand"
        : "text-text-muted hover:bg-slate-100"
    }`;

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
        <ClipboardList className="h-10 w-10 text-text-muted mb-3" />
        <p className="font-display text-base font-medium text-text-main">
          {menteeName} has no project assignments
        </p>
        <p className="mt-1 text-sm text-text-muted">
          When HR adds them to a project, you'll see it here.
        </p>
      </div>
    );
  }

  const myExistingSecondary = impactTarget?.review_detail?.secondary_evaluations.find(
    (ev) => ev.evaluator_id === currentUserId,
  );
  const impactModalRow: ImpactModalRow | null = impactTarget
    ? {
        employee_name: menteeName,
        project_name: impactTarget.project_name,
        review_status: myExistingSecondary ? "submitted" : "pending",
        secondaryReview: impactTarget.review_detail ?? undefined,
        existingImpact: myExistingSecondary?.impact_statement ?? "",
      }
    : null;

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Search by project name or code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-1.5 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-white p-0.5">
            <button
              type="button"
              className={viewBtnCls("grid")}
              onClick={() => setViewMode("grid")}
            >
              <LayoutGrid className="h-3.5 w-3.5" /> Cards
            </button>
            <button
              type="button"
              className={viewBtnCls("table")}
              onClick={() => setViewMode("table")}
            >
              <Table2 className="h-3.5 w-3.5" /> Table
            </button>
          </div>
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2">
            <label
              htmlFor="mentee-proj-cycle"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Cycle
            </label>
            <select
              id="mentee-proj-cycle"
              value={cycleFilter}
              onChange={(e) => setCycleFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[130px] cursor-pointer"
            >
              <option value="all">All Cycles</option>
              {availableCycles.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label
              htmlFor="mentee-proj-status"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Status
            </label>
            <select
              id="mentee-proj-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilterValue)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[130px] cursor-pointer"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="reviewed">Reviewed</option>
            </select>
          </div>
        </div>
      </div>

      {/* Impact fetch spinner */}
      {impactLoading && (
        <div className="rounded-md bg-slate-50 px-4 py-2 text-xs text-text-muted animate-pulse">
          Loading review…
        </div>
      )}

      {/* Content */}
      {filteredRows.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center bg-background/50">
          <Search className="h-8 w-8 text-text-muted mb-2" />
          <p className="font-display text-sm font-medium text-text-main">
            No projects match
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Try adjusting the filters or search.
          </p>
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sortedRows.map((r) => (
            <EvalCard
              key={r.key}
              row={r}
              onEvaluate={handleEvaluate}
              onWriteImpact={handleWriteImpact}
              onView={handleView}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-border">
                <th className="text-left px-5 py-2.5">
                  <SortableHeader
                    label="Project"
                    columnKey="project_name"
                    sort={sort}
                    onSort={setSort}
                  />
                </th>
                <th className="hidden sm:table-cell text-left px-4 py-2.5">
                  <SortableHeader
                    label="PM"
                    columnKey="pm_name"
                    sort={sort}
                    onSort={setSort}
                  />
                </th>
                <th className="hidden md:table-cell text-left px-4 py-2.5">
                  <SortableHeader
                    label="Cycle"
                    columnKey="cycle"
                    sort={sort}
                    onSort={setSort}
                  />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader
                    label="Status"
                    columnKey="review_status"
                    sort={sort}
                    onSort={setSort}
                  />
                </th>
                <th className="hidden md:table-cell text-left px-4 py-2.5">
                  <SortableHeader
                    label="Rating"
                    columnKey="performance_group"
                    sort={sort}
                    onSort={setSort}
                  />
                </th>
                <th className="text-right px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {sortedRows.map((r) => (
                <tr key={r.key} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3">
                    <div className="font-medium text-text-main">{r.project_name}</div>
                    <div className="text-[11px] font-mono text-text-muted">
                      {r.project_code}
                      {r.assignment_role && (
                        <span className="ml-2 text-text-muted">· {r.assignment_role}</span>
                      )}
                    </div>
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3">
                    {r.pm_name ? (
                      <div className="flex items-center gap-1.5 text-text-main">
                        <UserCircle className="h-3.5 w-3.5 text-text-muted shrink-0" />
                        <span className="truncate">{r.pm_name}</span>
                      </div>
                    ) : (
                      <span className="text-text-muted italic text-[12px]">
                        Unassigned
                      </span>
                    )}
                  </td>
                  <td className="hidden md:table-cell px-4 py-3 text-text-muted">
                    {r.cycle ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={r.review_status} />
                  </td>
                  <td className="hidden md:table-cell px-4 py-3">
                    <PerformanceRatingBadge
                      value={r.performance_group ? Number(r.performance_group) : null}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">
                    <ActionButton
                      row={r}
                      onEvaluate={handleEvaluate}
                      onWriteImpact={handleWriteImpact}
                      onView={handleView}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modals */}
      {evalTarget && (
        <EvalModal
          card={toEvalCard(evalTarget)}
          expectation={getExpectation(evalTarget)}
          isEditMode={evalMode !== "create"}
          readOnly={evalMode === "view"}
          onSubmit={handlePMSubmit}
          onSaveDraft={evalMode === "create" ? handlePMSaveDraft : undefined}
          onClose={closeEval}
          isSaving={isSaving}
          isDraftSaving={isDraftSaving}
          error={modalError}
        />
      )}
      {impactTarget && impactModalRow && (
        <ImpactModal
          row={impactModalRow}
          onSubmit={handleSecSubmit}
          onSaveDraft={
            impactModalRow.review_status === "submitted"
              ? undefined
              : handleSecSaveDraft
          }
          onClose={closeImpact}
          isSaving={isSaving}
          isDraftSaving={isDraftSaving}
          error={modalError}
        />
      )}
    </div>
  );
}
