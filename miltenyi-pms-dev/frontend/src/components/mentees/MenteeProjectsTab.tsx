import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
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
} from "@/services/project-review.service";
import type { MenteeProjectAssignment } from "@/services/mentee.service";
import { getErrorMessage } from "@/utils/errors";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { SortableHeader } from "@/components/SortableHeader";
import { compareValues, type SortKind, type SortState, type SortValue } from "@/utils/sort";
import { EvalModal, type EvalModalCard } from "@/components/project-reviews/EvalModal";
import { ImpactModal, type ImpactModalRow } from "@/components/project-reviews/ImpactModal";
import { PerformanceRatingBadge } from "@/components/reviews/PerformanceRatingBadge";
import { ClearFiltersButton } from "@/components/common/ClearFiltersButton";

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

const SORT_CONFIG: Record<SortKey, { kind: SortKind; get: (r: MenteeEvalRow) => SortValue }> = {
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
            <PerformanceRatingBadge value={row.performance_group} />
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
  /** Needed for the create-path of EvalModal (submitPMEvaluation)
   *  AND for invalidating the parent mentee's detail cache entry
   *  after any write here. Replaces the old `onReload` callback that
   *  used to bubble up to MenteeDetail — this component now manages
   *  its own cache invalidation directly. */
  readonly menteeUserId: number;
}

export function MenteeProjectsTab({
  assignments,
  menteeName,
  menteeUserId,
}: MenteeProjectsTabProps) {
  const { user } = useAuth();
  const currentUserId = user?.user_id ?? null;
  const toast = useToast();
  const queryClient = useQueryClient();

  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [searchQuery, setSearchQuery] = useState("");
  // "all" = every cycle; specific cycle name otherwise.
  const [cycleFilter, setCycleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>("all");
  const [sort, setSort] = useState<SortState<SortKey> | null>(null);

  // Modal state — pure client state. The saving flags are gone
  // (mutations expose isPending instead); the active modal target and
  // mode stay local.
  const [evalTarget, setEvalTarget] = useState<MenteeEvalRow | null>(null);
  const [evalMode, setEvalMode] = useState<"create" | "edit" | "view">("create");
  const [impactReviewId, setImpactReviewId] = useState<number | null>(null);
  const [impactRow, setImpactRow] = useState<MenteeEvalRow | null>(null);
  const [modalError, setModalError] = useState("");

  // Role expectations only matter when the mentor will actually
  // evaluate. Reuses the factory key from PR #07 — same cache entry
  // that ProjectReviews/PrimaryEvaluationTab use, so any mentor who
  // touched those pages first gets warm data here.
  const expectationsQuery = useQuery({
    queryKey: queryKeys.projectReviews.roleExpectations(),
    queryFn: projectReviewService.getRoleExpectations,
  });
  const expectations: RoleExpectation[] = expectationsQuery.data ?? [];

  // On-demand detail fetch for the impact-statement modal. Same
  // "modal-driven on-demand" pattern as ManagementReview's Rate modal
  // (PR #26): `enabled` gates on `impactReviewId` being non-null
  // (modal is open AND we have a valid review_id).
  //
  // The ?? -1 sentinel is for the closed-modal placeholder (factory
  // expects `number`, not `number | null`). enabled keeps the inert
  // cache entry from ever firing. Same trick as PR #26.
  const detailQuery = useQuery({
    queryKey: queryKeys.projectReviews.detail(impactReviewId ?? -1),
    queryFn: () => projectReviewService.getReview(impactReviewId as number),
    enabled: impactReviewId !== null,
  });
  const impactLoading = impactReviewId !== null && detailQuery.isPending;

  // When the detail query resolves and we have an impact target row,
  // merge the fetched ProjectReviewResponse into the row so the modal
  // can identify the mentor's own secondary_evaluation entry. This
  // happens in a render-time derivation (instead of useEffect+setState)
  // because the data flows one-way from query → derived row.
  const impactTarget: MenteeEvalRow | null = impactRow && detailQuery.data
    ? ({ ...impactRow, review_detail: detailQuery.data } as MenteeEvalRow)
    : impactRow;

  // ── Mutations ──────────────────────────────────────────────────────
  // Four cache invalidations per write — mix of specific (per-mentee)
  // and broadcast (cross-namespace):
  //
  //   mentees.detail(menteeUserId)  → SPECIFIC: this mentee's
  //                                   project_assignments (the parent
  //                                   payload that drives this tab's
  //                                   `assignments` prop) needs to
  //                                   refresh
  //   mentees.summaries()           → mentor's roster:
  //                                   projects.pending_reviews_count
  //                                   and projects.latest_performance_
  //                                   group change for this mentee
  //   projectReviews.all            → BROADCAST: pm queue, secondary
  //                                   queue, staff mine, hr org —
  //                                   anyone watching project reviews
  //                                   anywhere
  //   dashboard.all                 → BROADCAST: project_reviews_
  //                                   pending_primary / _secondary
  //                                   counts on Employee/HR dashboards
  //
  // The mentees side stays specific (PR #27's pattern — per-mentee
  // data; broadcasting would over-invalidate other mentees we have
  // cached). The cross-namespace side uses broadcast because there's
  // no per-mentee shape there — every project-review consumer cares.
  const invalidateScope = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.mentees.detail(menteeUserId),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.mentees.summaries(),
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.projectReviews.all,
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  }, [queryClient, menteeUserId]);

  // ── PM-side mutations (3) ──────────────────────────────────────────
  const updateReviewMutation = useMutation({
    mutationFn: (vars: { reviewId: number; payload: PMEvaluationPayload }) =>
      projectReviewService.updateReview(vars.reviewId, vars.payload),
    onSuccess: () => {
      invalidateScope();
      closeEval();
      toast.success("Evaluation updated.");
    },
    onError: (err) => setModalError(getErrorMessage(err)),
  });

  const submitPMEvalMutation = useMutation({
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
      invalidateScope();
      closeEval();
      toast.success("Evaluation submitted.");
    },
    onError: (err) => setModalError(getErrorMessage(err)),
  });

  const savePMDraftMutation = useMutation({
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
      invalidateScope();
      toast.success("Draft saved.");
    },
    onError: (err) => setModalError(getErrorMessage(err)),
  });

  // ── Secondary-side mutations (3) ───────────────────────────────────
  const updateSecondaryMutation = useMutation({
    mutationFn: (vars: { reviewId: number; payload: SecondaryEvalPayload }) =>
      projectReviewService.updateSecondaryEval(vars.reviewId, vars.payload),
    onSuccess: () => {
      invalidateScope();
      closeImpact();
      toast.success("Impact statement updated.");
    },
    onError: (err) => setModalError(getErrorMessage(err)),
  });

  const submitSecondaryMutation = useMutation({
    mutationFn: (vars: { reviewId: number; payload: SecondaryEvalPayload }) =>
      projectReviewService.submitSecondaryEval(vars.reviewId, vars.payload),
    onSuccess: () => {
      invalidateScope();
      closeImpact();
      toast.success("Impact statement submitted.");
    },
    onError: (err) => setModalError(getErrorMessage(err)),
  });

  const saveSecondaryDraftMutation = useMutation({
    mutationFn: (vars: {
      reviewId: number;
      payload: SecondaryEvalDraftPayload;
    }) =>
      projectReviewService.saveSecondaryDraft(vars.reviewId, vars.payload),
    onSuccess: () => {
      invalidateScope();
      toast.success("Draft saved.");
    },
    onError: (err) => setModalError(getErrorMessage(err)),
  });

  // Aggregated saving flags for the two modals (each modal has both
  // submit and edit paths — OR the relevant mutations together).
  const isEvalSaving =
    submitPMEvalMutation.isPending || updateReviewMutation.isPending;
  const isEvalDraftSaving = savePMDraftMutation.isPending;
  const isImpactSaving =
    submitSecondaryMutation.isPending || updateSecondaryMutation.isPending;
  const isImpactDraftSaving = saveSecondaryDraftMutation.isPending;

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
    // GCC role expectations are keyed by (function, career_level); one
    // row covers every designation in that band, listed in
    // `designation_names`. Best-effort match by assignment_role
    // appearing in that list — if the mentor doesn't get a hit the
    // expectation panel just won't render.
    if (!row.assignment_role) return null;
    return (
      expectations.find((e) => e.designation_names.includes(row.assignment_role!)) ?? null
    );
  };

  // Build the EvalModalCard shape for the modal
  const toEvalCard = useCallback(
    (row: MenteeEvalRow): EvalModalCard => ({
      employee_name: menteeName,
      project_name: row.project_name,
      project_code: row.project_code,
      function_name: null,
      review_id: row.review_id,
    }),
    [menteeName],
  );

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

  const handleWriteImpact = (row: MenteeEvalRow) => {
    setModalError("");
    if (row.review_id == null) return;
    // Setting impactReviewId enables the detailQuery (defined above)
    // which fetches the full ProjectReviewResponse. The render-time
    // `impactTarget` derivation merges the response into the row when
    // it arrives. No imperative fetch needed here — the cache
    // architecture handles it.
    setImpactRow(row);
    setImpactReviewId(row.review_id);
  };

  const closeEval = () => {
    setEvalTarget(null);
    setModalError("");
  };
  const closeImpact = () => {
    setImpactRow(null);
    setImpactReviewId(null);
    setModalError("");
  };

  // Modal-await contract: EvalModal and ImpactModal both await their
  // submit callbacks to drive "Saving..." spinners. mutateAsync +
  // try/catch (the established pattern from PR #20 onwards).
  const handlePMSubmit = async (payload: PMEvaluationPayload) => {
    if (!evalTarget) return;
    setModalError("");
    const isEdit = evalMode === "edit" && evalTarget.review_id != null;
    try {
      if (isEdit) {
        await updateReviewMutation.mutateAsync({
          reviewId: evalTarget.review_id!,
          payload,
        });
      } else {
        await submitPMEvalMutation.mutateAsync({
          projectId: evalTarget.project_id,
          userId: menteeUserId,
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
      await savePMDraftMutation.mutateAsync({
        projectId: evalTarget.project_id,
        userId: menteeUserId,
        payload,
      });
    } catch {
      /* handled by onError */
    }
  };

  const handleSecSaveDraft = async (
    reviewId: number,
    payload: SecondaryEvalDraftPayload,
  ) => {
    setModalError("");
    try {
      await saveSecondaryDraftMutation.mutateAsync({ reviewId, payload });
    } catch {
      /* handled by onError */
    }
  };

  const handleSecSubmit = async (
    reviewId: number,
    payload: SecondaryEvalPayload,
  ) => {
    if (!impactTarget) return;
    setModalError("");
    // If the mentor already wrote an impact here, PUT — otherwise POST.
    const mine = impactTarget.review_detail?.secondary_evaluations.find(
      (ev) => ev.evaluator_id === currentUserId,
    );
    try {
      if (mine) {
        await updateSecondaryMutation.mutateAsync({ reviewId, payload });
      } else {
        await submitSecondaryMutation.mutateAsync({ reviewId, payload });
      }
    } catch {
      /* handled by onError */
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
          <ClearFiltersButton
            active={
              searchQuery.trim().length > 0 ||
              cycleFilter !== "all" ||
              statusFilter !== "all"
            }
            onClear={() => {
              setSearchQuery("");
              setCycleFilter("all");
              setStatusFilter("all");
            }}
          />
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
          <table className="w-full min-w-max text-[13px]">
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
                    <PerformanceRatingBadge value={r.performance_group} />
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
          isSaving={isEvalSaving}
          isDraftSaving={isEvalDraftSaving}
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
          isSaving={isImpactSaving}
          isDraftSaving={isImpactDraftSaving}
          error={modalError}
        />
      )}
    </div>
  );
}
