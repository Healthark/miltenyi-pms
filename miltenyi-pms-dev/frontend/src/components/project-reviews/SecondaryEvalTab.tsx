/**
 * SecondaryEvalTab.tsx — Secondary Evaluator's Impact Statement Queue.
 *
 * Card view + Table view toggle matching PM Evaluation pattern.
 * Shows both pending and submitted reviews with edit option.
 */

import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { createPortal } from "react-dom";
import {
  UserCircle, Briefcase, Send, Loader2, Save, X, ClipboardList,
  LayoutGrid, Table2, Search, CheckCircle2, Clock, Pencil,
} from "lucide-react";
import {
  projectReviewService,
  type ProjectReviewResponse,
  type SecondaryEvalPayload,
  type SecondaryEvalDraftPayload,
} from "@/services/project-review.service";
import { getErrorMessage } from "@/utils/errors";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { SortableHeader } from "@/components/SortableHeader";
import { StringCombobox } from "@/components/common/StringCombobox";
import { compareValues, type SortKind, type SortState, type SortValue } from "@/utils/sort";

type ViewMode = "grid" | "table";

type SecondarySortKey =
  | "employee_name"
  | "project_name"
  | "cycle"
  | "submission_status";

const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";

// ── Impact Statement Modal ──────────────────────────────────────────

interface ImpactModalProps {
  readonly review: ProjectReviewResponse;
  readonly onSubmit: (reviewId: number, payload: SecondaryEvalPayload) => Promise<void>;
  readonly onSaveDraft?: (reviewId: number, payload: SecondaryEvalDraftPayload) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly isDraftSaving?: boolean;
  readonly error: string;
  readonly isEditMode?: boolean;
  readonly isDraftMode?: boolean;
  readonly existingImpact?: string;
}

function ImpactModal({
  review,
  onSubmit,
  onSaveDraft,
  onClose,
  isSaving,
  isDraftSaving = false,
  error,
  isEditMode = false,
  isDraftMode = false,
  existingImpact = "",
}: ImpactModalProps) {
  const [impactStatement, setImpactStatement] = useState(existingImpact);
  // Save Draft is only meaningful when the row hasn't been submitted
  // yet — editing an already-submitted statement skips it.
  const showSaveDraft = !isEditMode && !!onSaveDraft;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="secondary-eval-title">
      <div className="w-full max-w-2xl rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              {isEditMode && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">Editing</span>
              )}
              {isDraftMode && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">Draft</span>
              )}
              <h2 id="secondary-eval-title" className="font-display text-base font-semibold text-text-main">
                {isEditMode ? "Edit" : "Secondary"} Feedback
              </h2>
            </div>
            <p className="mt-0.5 text-xs text-text-muted">{review.employee_name} — {review.project_name}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
          <div>
            <label htmlFor="sec-impact" className="block text-xs font-semibold text-text-main mb-1">Review *</label>
            <p className="text-xs text-text-muted mb-2">Share your perspective on {review.employee_name}'s contribution to this project.</p>
            <textarea
              id="sec-impact"
              rows={8}
              className={TEXTAREA_CLS}
              value={impactStatement}
              onChange={(e) => setImpactStatement(e.target.value)}
              placeholder="Describe your observations about this team member's impact, collaboration, and contributions…"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border px-6 py-4">
          <p className="text-xs text-text-muted">
            {isEditMode
              ? "Update your submitted review."
              : isDraftMode
                ? "Draft saved — keep editing or submit when ready."
                : "Drafts can be saved and edited; submit when ready."}
          </p>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors">Cancel</button>
            {showSaveDraft && (
              <button
                type="button"
                onClick={() => onSaveDraft!(review.id, { impact_statement: impactStatement })}
                disabled={isSaving || isDraftSaving || !impactStatement.trim()}
                className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-main hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                {isDraftSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {isDraftSaving ? "Saving…" : "Save Draft"}
              </button>
            )}
            <button
              type="button"
              onClick={() => onSubmit(review.id, { impact_statement: impactStatement })}
              disabled={isSaving || isDraftSaving || !impactStatement.trim()}
              className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {isSaving ? (isEditMode ? "Saving…" : "Submitting…") : (isEditMode ? "Save Changes" : "Submit")}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Card View: Pending Card ─────────────────────────────────────────

function SecondaryCard({
  review,
  onWriteImpact,
}: {
  readonly review: ProjectReviewResponse;
  readonly onWriteImpact: (review: ProjectReviewResponse) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono text-text-muted bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
          {review.project_code}
        </span>
        <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">
          <Clock className="h-3 w-3" /> Pending
        </span>
      </div>

      <div className="flex items-center gap-2">
        <UserCircle className="h-5 w-5 text-text-muted shrink-0" />
        <p className="text-[14px] font-semibold text-text-main">{review.employee_name}</p>
      </div>

      <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
        <Briefcase className="h-3 w-3 shrink-0" />
        <span className="truncate">{review.project_name}</span>
      </div>

      <div className="mt-auto pt-2 border-t border-border/60">
        <button
          type="button"
          onClick={() => onWriteImpact(review)}
          className="w-full rounded-lg bg-slate-600 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 transition-colors"
        >
          Write Review
        </button>
      </div>
    </div>
  );
}

// ── Card View: Draft Card ───────────────────────────────────────────

function DraftCard({
  review,
  impactStatement,
  onContinueDraft,
}: {
  readonly review: ProjectReviewResponse;
  readonly impactStatement: string;
  readonly onContinueDraft: (review: ProjectReviewResponse) => void;
}) {
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/30 p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono text-text-muted bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
          {review.project_code}
        </span>
        <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">
          <Pencil className="h-3 w-3" /> Draft
        </span>
      </div>

      <div className="flex items-center gap-2">
        <UserCircle className="h-5 w-5 text-text-muted shrink-0" />
        <p className="text-[14px] font-semibold text-text-main">{review.employee_name}</p>
      </div>

      <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
        <Briefcase className="h-3 w-3 shrink-0" />
        <span className="truncate">{review.project_name}</span>
      </div>

      {impactStatement.trim() && (
        <div className="rounded-md bg-white border border-amber-100 px-3 py-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1">Draft (not submitted)</p>
          <p className="text-[13px] text-text-main whitespace-pre-wrap line-clamp-3">{impactStatement}</p>
        </div>
      )}

      <div className="mt-auto pt-2 border-t border-border/60">
        <button
          type="button"
          onClick={() => onContinueDraft(review)}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100 transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" /> Continue Draft
        </button>
      </div>
    </div>
  );
}

// ── Card View: Submitted Card ───────────────────────────────────────

function SubmittedCard({
  review,
  impactStatement,
  onEdit,
}: {
  readonly review: ProjectReviewResponse;
  readonly impactStatement: string;
  readonly onEdit: (review: ProjectReviewResponse) => void;
}) {
  return (
    <div className="rounded-xl border border-green-200 bg-green-50/30 p-4 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono text-text-muted bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
          {review.project_code}
        </span>
        <span className="flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold uppercase text-green-700">
          <CheckCircle2 className="h-3 w-3" /> Submitted
        </span>
      </div>

      <div className="flex items-center gap-2">
        <UserCircle className="h-5 w-5 text-text-muted shrink-0" />
        <p className="text-[14px] font-semibold text-text-main">{review.employee_name}</p>
      </div>

      <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
        <Briefcase className="h-3 w-3 shrink-0" />
        <span className="truncate">{review.project_name}</span>
      </div>

      <div className="rounded-md bg-white border border-green-100 px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1">Your Review</p>
        <p className="text-[13px] text-text-main whitespace-pre-wrap line-clamp-3">{impactStatement}</p>
      </div>

      <div className="mt-auto pt-2 border-t border-border/60">
        <button
          type="button"
          onClick={() => onEdit(review)}
          className="w-full flex items-center justify-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-100 transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" /> Edit
        </button>
      </div>
    </div>
  );
}

// ── Tab Component ───────────────────────────────────────────────────

export function SecondaryEvalTab() {
  const { user } = useAuth();
  const currentUserId = user?.user_id;
  const toast = useToast();

  const queryClient = useQueryClient();

  // Cache-warming payoff: the parent ProjectReviews page (PR #07)
  // already fires a probe query on this exact key to decide whether
  // to render this tab's button. When this tab mounts, `data` is
  // already populated — no second network round-trip. Per doc #07's
  // "cache-warming probe" promise, this is the consumer that finally
  // realizes the win.
  const queueQuery = useQuery({
    queryKey: queryKeys.projectReviews.secondaryQueue(),
    queryFn: projectReviewService.getSecondaryQueue,
  });
  const reviews: ProjectReviewResponse[] = queueQuery.data ?? [];
  const isLoading = queueQuery.isPending;

  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [cycleFilter, setCycleFilter] = useState<string>("all");
  // Employee + Project use typeable StringCombobox — empty string = no filter.
  // Replaced the standalone search box; the comboboxes type-narrow over the
  // same fields the search used to scan (employee name, project name).
  const [employeeFilter, setEmployeeFilter] = useState<string>("");
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [sort, setSort] = useState<SortState<SecondarySortKey> | null>(null);

  const [impactTarget, setImpactTarget] = useState<ProjectReviewResponse | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [isDraftMode, setIsDraftMode] = useState(false);
  const [editImpact, setEditImpact] = useState("");
  const [modalError, setModalError] = useState("");

  // ── Mutations ──────────────────────────────────────────────────────
  // Same broadcast-invalidation footprint as the PM side:
  //   projectReviews.all  → secondaryQueue, pmQueue, mine, mentees, org
  //   dashboard.all       → project_reviews_pending_secondary count
  const invalidateSecondaryScope = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.projectReviews.all,
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  }, [queryClient]);

  // updateSecondaryEval edits an already-submitted impact statement;
  // submitSecondaryEval creates a new one or promotes a draft. Two
  // mutation instances for two flows (same endpoint family, different
  // UX) — same DRY-vs-clarity trade we've been making since PR #20's
  // create vs update user.
  const updateSecondaryMutation = useMutation({
    mutationFn: (vars: {
      reviewId: number;
      payload: SecondaryEvalPayload;
    }) =>
      projectReviewService.updateSecondaryEval(vars.reviewId, vars.payload),
    onSuccess: () => {
      invalidateSecondaryScope();
      closeImpactModal();
      toast.success("Review updated.");
    },
    onError: (err) => setModalError(getErrorMessage(err)),
  });

  const submitSecondaryMutation = useMutation({
    mutationFn: (vars: {
      reviewId: number;
      payload: SecondaryEvalPayload;
    }) =>
      projectReviewService.submitSecondaryEval(vars.reviewId, vars.payload),
    onSuccess: () => {
      invalidateSecondaryScope();
      closeImpactModal();
      toast.success("Review submitted.");
    },
    onError: (err) => setModalError(getErrorMessage(err)),
  });

  // saveSecondaryDraft (PATCH /secondary/draft) — keeps the modal
  // open so the user can keep editing.
  const draftSecondaryMutation = useMutation({
    mutationFn: (vars: {
      reviewId: number;
      payload: SecondaryEvalDraftPayload;
    }) =>
      projectReviewService.saveSecondaryDraft(vars.reviewId, vars.payload),
    onSuccess: (_data, vars) => {
      invalidateSecondaryScope();
      // Flip into draft mode so the badge + footer copy reflect the
      // saved draft state. editImpact stays whatever the user typed
      // (we don't reset the textarea on draft-save).
      setIsDraftMode(true);
      setEditImpact(vars.payload.impact_statement ?? "");
      toast.success("Draft saved.");
    },
    onError: (err) => setModalError(getErrorMessage(err)),
  });

  // Helper to centralize modal close-and-reset.
  function closeImpactModal() {
    setImpactTarget(null);
    setIsEditMode(false);
    setIsDraftMode(false);
    setEditImpact("");
  }

  const getMySubmission = (review: ProjectReviewResponse) =>
    review.secondary_evaluations?.find((ev) => ev.evaluator_id === currentUserId);

  /** Three-way status the queue treats per review:
   *    "none"      — no row at all yet, secondary needs to write
   *    "draft"     — secondary saved a draft, hasn't submitted
   *    "submitted" — final, locked (edit reopens for amendment)
   */
  const myEvalStatus = (review: ProjectReviewResponse): "none" | "draft" | "submitted" => {
    const my = getMySubmission(review);
    if (!my) return "none";
    return my.status === "submitted" ? "submitted" : "draft";
  };

  // Dropdown options — derived from currently loaded reviews so the lists
  // never offer a value that wouldn't match anything.
  const availableEmployees = Array.from(
    new Set(reviews.map((r) => r.employee_name).filter(Boolean)),
  ).sort();
  const availableProjects = Array.from(
    new Set(reviews.map((r) => r.project_name).filter(Boolean)),
  ).sort();
  const availableCycles = Array.from(
    new Set(reviews.map((r) => r.cycle).filter(Boolean)),
  ).sort((a, b) => b.localeCompare(a));

  // Filter
  const filteredReviews = reviews.filter((r) => {
    const evalStatus = myEvalStatus(r);
    if (statusFilter === "pending" && evalStatus !== "none") return false;
    if (statusFilter === "draft" && evalStatus !== "draft") return false;
    if (statusFilter === "submitted" && evalStatus !== "submitted") return false;
    if (employeeFilter && r.employee_name !== employeeFilter) return false;
    if (projectFilter && r.project_name !== projectFilter) return false;
    if (cycleFilter !== "all" && r.cycle !== cycleFilter) return false;
    return true;
  });

  const SECONDARY_SORT_CONFIG: Record<
    SecondarySortKey,
    { kind: SortKind; get: (r: ProjectReviewResponse) => SortValue }
  > = {
    employee_name:     { kind: "alpha", get: (r) => r.employee_name },
    project_name:      { kind: "alpha", get: (r) => r.project_name },
    cycle:             { kind: "cycle", get: (r) => r.cycle },
    submission_status: { kind: "alpha", get: (r) => myEvalStatus(r) },
  };

  const sortedReviews = sort
    ? filteredReviews.slice().sort((a, b) => {
        const { kind, get } = SECONDARY_SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : filteredReviews;

  // Impact modal awaits onSubmit + onSaveDraft to drive its
  // "Saving..." spinners (same modal pattern we've used since PR #20).
  // mutateAsync + try/catch preserves the legacy contract; onError
  // already routed the failure to setModalError for inline display.
  const handleSubmit = async (reviewId: number, payload: SecondaryEvalPayload) => {
    setModalError("");
    try {
      if (isEditMode) {
        await updateSecondaryMutation.mutateAsync({ reviewId, payload });
      } else {
        await submitSecondaryMutation.mutateAsync({ reviewId, payload });
      }
    } catch {
      /* handled by onError */
    }
  };

  const handleSaveDraft = async (
    reviewId: number,
    payload: SecondaryEvalDraftPayload,
  ) => {
    setModalError("");
    try {
      await draftSecondaryMutation.mutateAsync({ reviewId, payload });
    } catch {
      /* handled by onError */
    }
  };

  const openCreate = (review: ProjectReviewResponse) => {
    setIsEditMode(false); setIsDraftMode(false); setEditImpact(""); setModalError(""); setImpactTarget(review);
  };
  const openContinueDraft = (review: ProjectReviewResponse) => {
    const myEval = getMySubmission(review);
    setIsEditMode(false);
    setIsDraftMode(true);
    setEditImpact(myEval?.impact_statement ?? "");
    setModalError("");
    setImpactTarget(review);
  };
  const openEdit = (review: ProjectReviewResponse) => {
    const myEval = getMySubmission(review);
    setIsEditMode(true);
    setIsDraftMode(false);
    setEditImpact(myEval?.impact_statement ?? "");
    setModalError("");
    setImpactTarget(review);
  };

  const viewBtnCls = (mode: ViewMode) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
      viewMode === mode ? "bg-brand/10 text-brand" : "text-text-muted hover:bg-slate-100"
    }`;

  if (isLoading) {
    return <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse">Loading secondary reviews…</div>;
  }

  if (reviews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
        <ClipboardList className="h-10 w-10 text-text-muted mb-3" />
        <p className="font-display text-base font-medium text-text-main">No secondary reviews</p>
        <p className="mt-1 text-sm text-text-muted">Reviews will appear here after the PM completes their evaluations.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Employee filter — typeable */}
          <div className="flex items-center gap-2">
            <label htmlFor="sec-employee-filter" className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              Employee
            </label>
            <StringCombobox
              id="sec-employee-filter"
              options={availableEmployees}
              value={employeeFilter}
              onChange={setEmployeeFilter}
              placeholder="Type a name…"
            />
          </div>

          {/* Project filter — typeable */}
          <div className="flex items-center gap-2">
            <label htmlFor="sec-project-filter" className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              Project
            </label>
            <StringCombobox
              id="sec-project-filter"
              options={availableProjects}
              value={projectFilter}
              onChange={setProjectFilter}
              placeholder="Type a project…"
            />
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="sec-cycle-filter" className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              Cycle
            </label>
            <select
              id="sec-cycle-filter"
              value={cycleFilter}
              onChange={(e) => setCycleFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[120px] cursor-pointer"
            >
              <option value="all">All</option>
              {availableCycles.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="sec-status-filter" className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              Status
            </label>
            <select
              id="sec-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[110px] cursor-pointer"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
            </select>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-lg border border-border bg-white p-0.5">
          <button type="button" className={viewBtnCls("grid")} onClick={() => setViewMode("grid")}>
            <LayoutGrid className="h-3.5 w-3.5" /> Cards
          </button>
          <button type="button" className={viewBtnCls("table")} onClick={() => setViewMode("table")}>
            <Table2 className="h-3.5 w-3.5" /> Table
          </button>
        </div>
      </div>

      {/* Content */}
      {filteredReviews.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center bg-background/50">
          <Search className="h-8 w-8 text-text-muted mb-2" />
          <p className="font-display text-sm font-medium text-text-main">No matching reviews</p>
          <p className="mt-1 text-xs text-text-muted">Try adjusting your filters or search query.</p>
        </div>
      ) : viewMode === "grid" ? (
        /* ── Card View ── */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sortedReviews.map((r) => {
            const status = myEvalStatus(r);
            const myEval = getMySubmission(r);
            if (status === "submitted") {
              return (
                <SubmittedCard
                  key={r.id}
                  review={r}
                  impactStatement={myEval?.impact_statement ?? ""}
                  onEdit={openEdit}
                />
              );
            }
            if (status === "draft") {
              return (
                <DraftCard
                  key={r.id}
                  review={r}
                  impactStatement={myEval?.impact_statement ?? ""}
                  onContinueDraft={openContinueDraft}
                />
              );
            }
            return <SecondaryCard key={r.id} review={r} onWriteImpact={openCreate} />;
          })}
        </div>
      ) : (
        /* ── Table View ── */
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
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="Status" columnKey="submission_status" sort={sort} onSort={setSort} />
                </th>
                <th className="text-right px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {sortedReviews.map((r) => {
                const status = myEvalStatus(r);
                return (
                  <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
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
                    <td className="hidden sm:table-cell px-4 py-3">
                      <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                        {r.cycle}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {status === "submitted" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold uppercase text-green-700">
                          <CheckCircle2 className="h-3 w-3" /> Submitted
                        </span>
                      ) : status === "draft" ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-700">
                          <Pencil className="h-3 w-3" /> Draft
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-700">
                          <Clock className="h-3 w-3" /> Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {status === "submitted" ? (
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-[12px] font-medium text-green-700 hover:bg-green-100 transition-colors"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                      ) : status === "draft" ? (
                        <button
                          type="button"
                          onClick={() => openContinueDraft(r)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-[12px] font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                        >
                          <Pencil className="h-3 w-3" /> Continue Draft
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openCreate(r)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-700 transition-colors"
                        >
                          Write Review
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
      {impactTarget && (
        <ImpactModal
          review={impactTarget}
          onSubmit={handleSubmit}
          onSaveDraft={handleSaveDraft}
          onClose={() => {
            setImpactTarget(null);
            setIsEditMode(false);
            setIsDraftMode(false);
            setEditImpact("");
            setModalError("");
          }}
          isSaving={
            submitSecondaryMutation.isPending ||
            updateSecondaryMutation.isPending
          }
          isDraftSaving={draftSecondaryMutation.isPending}
          error={modalError}
          isEditMode={isEditMode}
          isDraftMode={isDraftMode}
          existingImpact={editImpact}
        />
      )}
    </div>
  );
}
