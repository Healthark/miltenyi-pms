/**
 * SecondaryEvalTab.tsx — Secondary Evaluator's Impact Statement Queue.
 *
 * Card view + Table view toggle matching PM Evaluation pattern.
 * Shows both pending and submitted reviews with edit option.
 */

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  UserCircle, Briefcase, Send, Loader2, X, ClipboardList,
  LayoutGrid, Table2, Search, CheckCircle2, Clock, Pencil,
} from "lucide-react";
import {
  projectReviewService,
  type ProjectReviewResponse,
  type SecondaryEvalPayload,
} from "../../services/project-review.service";
import { getErrorMessage } from "../../utils/errors";
import { useAuth } from "../../hooks/useAuth";
import { useToast } from "../../hooks/useToast";

type ViewMode = "grid" | "table";

const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none";

// ── Impact Statement Modal ──────────────────────────────────────────

interface ImpactModalProps {
  readonly review: ProjectReviewResponse;
  readonly onSubmit: (reviewId: number, payload: SecondaryEvalPayload) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly error: string;
  readonly isEditMode?: boolean;
  readonly existingImpact?: string;
}

function ImpactModal({ review, onSubmit, onClose, isSaving, error, isEditMode = false, existingImpact = "" }: ImpactModalProps) {
  const [impactStatement, setImpactStatement] = useState(existingImpact);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-labelledby="secondary-eval-title">
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <div className="flex items-center gap-2">
              {isEditMode && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">Editing</span>
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
            <label htmlFor="sec-impact" className="block text-xs font-semibold text-text-main mb-1">Impact Statement *</label>
            <p className="text-xs text-text-muted mb-2">Share your perspective on {review.employee_name}'s contribution to this project.</p>
            <textarea
              id="sec-impact"
              rows={5}
              className={TEXTAREA_CLS}
              value={impactStatement}
              onChange={(e) => setImpactStatement(e.target.value)}
              placeholder="Describe your observations about this team member's impact, collaboration, and contributions…"
            />
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors">Cancel</button>
          <button
            type="button"
            onClick={() => onSubmit(review.id, { impact_statement: impactStatement })}
            disabled={isSaving || !impactStatement.trim()}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {isSaving ? (isEditMode ? "Saving…" : "Submitting…") : (isEditMode ? "Save Changes" : "Submit")}
          </button>
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
          Write Impact Statement
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
        <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted mb-1">Your Impact Statement</p>
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

  const [reviews, setReviews] = useState<ProjectReviewResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("all");

  const [impactTarget, setImpactTarget] = useState<ProjectReviewResponse | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editImpact, setEditImpact] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  const loadReviews = useCallback(async () => {
    setIsLoading(true);
    try {
      setReviews(await projectReviewService.getSecondaryQueue());
    } catch {
      // stays empty
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { void loadReviews(); }, [loadReviews]);

  const getMySubmission = (review: ProjectReviewResponse) =>
    review.secondary_evaluations?.find((ev) => ev.evaluator_id === currentUserId);

  // Dropdown options
  const availableEmployees = Array.from(new Set(reviews.map((r) => r.employee_name).filter(Boolean)));

  // Filter
  const filteredReviews = reviews.filter((r) => {
    const isSubmitted = !!getMySubmission(r);
    if (statusFilter === "pending" && isSubmitted) return false;
    if (statusFilter === "submitted" && !isSubmitted) return false;
    if (employeeFilter !== "all" && r.employee_name !== employeeFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      if (
        !r.employee_name.toLowerCase().includes(q) &&
        !r.project_name.toLowerCase().includes(q) &&
        !r.project_code.toLowerCase().includes(q)
      ) return false;
    }
    return true;
  });

  const handleSubmit = async (reviewId: number, payload: SecondaryEvalPayload) => {
    setIsSaving(true);
    setModalError("");
    try {
      if (isEditMode) {
        await projectReviewService.updateSecondaryEval(reviewId, payload);
      } else {
        await projectReviewService.submitSecondaryEval(reviewId, payload);
      }
      await loadReviews();
      setImpactTarget(null);
      setIsEditMode(false);
      setEditImpact("");
      toast.success(isEditMode ? "Impact statement updated." : "Impact statement submitted.");
    } catch (err: unknown) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const openCreate = (review: ProjectReviewResponse) => {
    setIsEditMode(false); setEditImpact(""); setModalError(""); setImpactTarget(review);
  };
  const openEdit = (review: ProjectReviewResponse) => {
    const myEval = getMySubmission(review);
    setIsEditMode(true); setEditImpact(myEval?.impact_statement ?? ""); setModalError(""); setImpactTarget(review);
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
    <div className="space-y-5 animate-in fade-in duration-500">

      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Search employee or project..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-lg border border-border bg-white pl-9 pr-3 py-1.5 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand w-56"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[110px] cursor-pointer"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="submitted">Submitted</option>
            </select>
          </div>

          {/* Employee filter */}
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Employee</label>
            <select
              value={employeeFilter}
              onChange={(e) => setEmployeeFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[130px] cursor-pointer"
            >
              <option value="all">All</option>
              {availableEmployees.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
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
          {filteredReviews.map((r) => {
            const myEval = getMySubmission(r);
            return myEval ? (
              <SubmittedCard key={r.id} review={r} impactStatement={myEval.impact_statement ?? ""} onEdit={openEdit} />
            ) : (
              <SecondaryCard key={r.id} review={r} onWriteImpact={openCreate} />
            );
          })}
        </div>
      ) : (
        /* ── Table View ── */
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-border">
                <th className="text-left px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">Employee</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">Project</th>
                <th className="hidden sm:table-cell text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">Cycle</th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">Status</th>
                <th className="text-right px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredReviews.map((r) => {
                const myEval = getMySubmission(r);
                const isSubmitted = !!myEval;
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
                      {isSubmitted ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold uppercase text-green-700">
                          <CheckCircle2 className="h-3 w-3" /> Submitted
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-700">
                          <Clock className="h-3 w-3" /> Pending
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {isSubmitted ? (
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-[12px] font-medium text-green-700 hover:bg-green-100 transition-colors"
                        >
                          <Pencil className="h-3 w-3" /> Edit
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => openCreate(r)}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-600 px-3 py-1.5 text-[12px] font-medium text-white hover:bg-slate-700 transition-colors"
                        >
                          Write Impact
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
          onClose={() => { setImpactTarget(null); setIsEditMode(false); setEditImpact(""); setModalError(""); }}
          isSaving={isSaving}
          error={modalError}
          isEditMode={isEditMode}
          existingImpact={editImpact}
        />
      )}
    </div>
  );
}
