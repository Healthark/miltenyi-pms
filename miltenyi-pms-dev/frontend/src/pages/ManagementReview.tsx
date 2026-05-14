/**
 * ManagementReview.tsx — Standalone Management Review page.
 *
 * Only routable for HR_MyOrg (the platform owner's HR). The backend
 * enforces the same gate via `_require_management` on every endpoint
 * this page touches — this is purely a UI affordance.
 *
 * Lists every active Staff user in the org for the active cycle,
 * LEFT-joined against their AnnualReview row, and lets HR_MyOrg
 * set/override the management rating inline once the mentor has
 * submitted. View and Edit affordances are gated per stage.
 */

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  ChevronsUpDown,
  Eye,
  Loader2,
  Pencil,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import {
  annualReviewService,
  type CalibrationRow,
  type ReviewStatus,
} from "@/services/annual-review.service";
import { queryKeys } from "@/lib/queryKeys";
import { PerformanceRatingBadge } from "@/components/reviews/PerformanceRatingBadge";
import { PerformanceRatingSelect } from "@/components/reviews/PerformanceRatingSelect";
import { ReviewStatusBadge } from "@/components/reviews/ReviewStatusBadge";
import { getErrorMessage } from "@/utils/errors";
import { useConfirm } from "@/hooks/useConfirm";
import { useSystemSettings } from "@/hooks/useSystemSettings";

type RatingValue = number | "";
type StatusFilter = "all" | ReviewStatus;
type SortKey =
  | "employee_name"
  | "employee_email"
  | "mentor_name"
  | "function"
  | "designation"
  | "status"
  | "self_performance_rating"
  | "mentor_performance_rating"
  | "management_performance_rating";
type SortDir = "asc" | "desc";

type ModalMode = "view" | "rate";

interface EditTarget {
  readonly row: CalibrationRow;
  readonly mode: ModalMode;
  readonly draft: RatingValue;
}

const COLUMN_DEFS: Array<{ label: string; key: SortKey | null }> = [
  { label: "User",               key: "employee_name" },
  { label: "Email",              key: "employee_email" },
  { label: "Mentor",             key: "mentor_name" },
  { label: "Function",           key: "function" },
  { label: "Designation",        key: "designation" },
  { label: "Status",             key: "status" },
  { label: "Self Review",        key: "self_performance_rating" },
  { label: "Mentor Review",      key: "mentor_performance_rating" },
  { label: "Management Rating",  key: "management_performance_rating" },
  { label: "Actions",            key: null },
];

const STATUS_FILTER_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: "all",                label: "All" },
  { value: "not_started",        label: "Not Started" },
  { value: "draft",              label: "Draft" },
  { value: "pending_mentor",     label: "Pending Mentor" },
  { value: "pending_management", label: "Pending Management" },
  { value: "completed",          label: "Completed" },
];

// Sort weight for the synthetic `Status` column so an asc/desc click
// orders the stages by lifecycle progression rather than alphabetically.
const STATUS_SORT_WEIGHT: Record<ReviewStatus, number> = {
  not_started:        0,
  draft:              1,
  pending_mentor:     2,
  pending_management: 3,
  completed:          4,
};

export function ManagementReview() {
  const { settings } = useSystemSettings();
  // Extract bare FY label ("H1 FY26" -> "FY26") for the page header.
  const fyLabel = settings?.active_cycle_name
    ? settings.active_cycle_name.split(" ").find((t) => t.startsWith("FY")) ??
      settings.active_cycle_name
    : null;

  const queryClient = useQueryClient();
  const confirm = useConfirm();

  // ── Queries ────────────────────────────────────────────────────────
  // 1. The calibration grid (page-level table). Single fetch on mount;
  //    background-refreshes via the broadcast invalidation in
  //    setManagementRating's onSuccess (and on window focus via the
  //    global default).
  const gridQuery = useQuery({
    queryKey: queryKeys.annualReviews.calibration(),
    queryFn: annualReviewService.getCalibrationGrid,
  });
  const rows: CalibrationRow[] = gridQuery.data ?? [];
  const isLoading = gridQuery.isPending;
  const loadError = gridQuery.isError ? getErrorMessage(gridQuery.error) : "";

  const [searchQuery, setSearchQuery] = useState("");
  const [funcFilter, setFuncFilter] = useState<string>("all");
  const [designationFilter, setDesignationFilter] = useState<string>("all");
  const [mentorFilter, setMentorFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [sortKey, setSortKey] = useState<SortKey>("employee_name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [saveError, setSaveError] = useState("");

  // 2. The per-review detail — on-demand. `enabled` gates on the Rate
  //    modal actually being open AND having a valid review_id. The
  //    queryKey embeds the id, so opening successive Rate modals
  //    populates separate cache entries (visit two HR sessions, close
  //    the first, and the second is still cached for next-open).
  //
  //    Tradeoff vs the old useEffect: same network round-trip on first
  //    open, but a second open of the SAME review is instant (cache
  //    hit). The legacy code refetched every time the modal opened.
  const editReviewId = editTarget?.row.review_id ?? null;
  const editReviewQuery = useQuery({
    queryKey: queryKeys.annualReviews.detail(editReviewId ?? -1),
    queryFn: () =>
      annualReviewService.getReview(editReviewId as number),
    enabled: editReviewId !== null,
  });
  const editReview = editReviewQuery.data ?? null;
  const isEditReviewLoading = editReviewId !== null && editReviewQuery.isPending;
  const editReviewError = editReviewQuery.isError
    ? getErrorMessage(editReviewQuery.error)
    : "";

  const closeEdit = () => {
    setEditTarget(null);
    setSaveError("");
  };

  // ── Mutation ───────────────────────────────────────────────────────
  // Publishes the management rating for a single review. Broadcast-
  // invalidates everything under `annual-reviews` (catches calibration
  // grid + this review's detail + mentee history + HR's all-reviews)
  // and `dashboard` (the AnnualReviewFunnelCard's completed-count
  // moves when management ratings publish).
  //
  // We could narrow the invalidation to just calibration + detail(id)
  // + dashboard, but the broadcast pattern (established in PR #22) is
  // cleaner — three keys catch every consumer of the affected data,
  // and the wasted-refetch cost on dormant entries is essentially
  // zero (no observer = no refetch).
  const setRatingMutation = useMutation({
    mutationFn: (vars: { reviewId: number; rating: number }) =>
      annualReviewService.setManagementRating(vars.reviewId, {
        management_performance_rating: vars.rating,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: queryKeys.annualReviews.all,
      });
      void queryClient.invalidateQueries({
        queryKey: queryKeys.dashboard.all,
      });
      closeEdit();
    },
    onError: (err) => setSaveError(getErrorMessage(err)),
  });
  const isSaving = setRatingMutation.isPending;

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const getSortIcon = (key: SortKey) => {
    if (sortKey !== key) return <ChevronsUpDown className="h-3 w-3 opacity-40" aria-hidden="true" />;
    if (sortDir === "asc") return <ChevronUp className="h-3 w-3" aria-hidden="true" />;
    return <ChevronDown className="h-3 w-3" aria-hidden="true" />;
  };

  const availableFuncs = useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.function).filter((d): d is string => !!d)),
      ).sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const availableDesignations = useMemo(
    () =>
      Array.from(
        new Set(
          rows.map((r) => r.designation).filter((d): d is string => !!d),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const availableMentors = useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.mentor_name).filter((m): m is string => !!m)),
      ).sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  const visibleRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const result = rows.filter((r) => {
      if (funcFilter !== "all" && (r.function ?? "") !== funcFilter) return false;
      if (designationFilter !== "all" && (r.designation ?? "") !== designationFilter) return false;
      if (mentorFilter !== "all" && (r.mentor_name ?? "") !== mentorFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!q) return true;
      return (
        r.employee_name.toLowerCase().includes(q) ||
        (r.employee_email ?? "").toLowerCase().includes(q) ||
        (r.mentor_name ?? "").toLowerCase().includes(q) ||
        (r.function ?? "").toLowerCase().includes(q)
      );
    });

    return result.sort((a, b) => {
      // Status sorts by lifecycle order (Not Started -> Completed) so
      // toggling asc/desc reads as workflow progress, not alphabetically.
      if (sortKey === "status") {
        const av = STATUS_SORT_WEIGHT[a.status] ?? -1;
        const bv = STATUS_SORT_WEIGHT[b.status] ?? -1;
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      const cmp =
        typeof av === "string"
          ? av.localeCompare(bv as string)
          : (av as number) - (bv as number);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rows, searchQuery, funcFilter, designationFilter, mentorFilter, statusFilter, sortKey, sortDir]);

  const handleSave = async () => {
    if (!editTarget) return;
    if (editTarget.row.review_id == null) {
      // Edit is UI-gated on canEdit, which requires review_id to exist —
      // this branch should be unreachable in practice but narrows the
      // type for setManagementRating().
      setSaveError("This review row has no underlying record yet.");
      return;
    }
    if (editTarget.draft === "") {
      setSaveError("Please select a rating.");
      return;
    }
    const isOverwrite =
      editTarget.row.management_performance_rating != null;
    const ok = await confirm({
      title: isOverwrite
        ? `Overwrite management rating for ${editTarget.row.employee_name}?`
        : `Publish management rating for ${editTarget.row.employee_name}?`,
      message: isOverwrite
        ? `Replace the existing management rating with ${editTarget.draft}/5. ${editTarget.row.employee_name} will see the updated rating immediately.`
        : `Publish a management rating of ${editTarget.draft}/5 for ${editTarget.row.employee_name}. Once saved, ${editTarget.row.employee_name} will be able to see this rating in their own annual review.`,
      variant: isOverwrite ? "warning" : "default",
      confirmText: isOverwrite ? "Overwrite Rating" : "Publish Rating",
    });
    if (!ok) return;
    setSaveError("");
    // Fire-and-forget — onSuccess closes the modal, onError surfaces
    // saveError inline. No caller awaits the result, so plain
    // mutate() is correct (mutateAsync would force an unused await).
    setRatingMutation.mutate({
      reviewId: editTarget.row.review_id,
      rating: editTarget.draft,
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">
          Management Review
          {fyLabel && (
            <span className="ml-2 text-sm font-normal text-text-muted">
              · {fyLabel}
            </span>
          )}
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">
          Calibrate management ratings across the org's annual reviews for the active cycle.
        </p>
      </div>

      {/* Card */}
      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse gap-2">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Loading reviews…
          </div>
        ) : loadError ? (
          <div className="p-5">
            <p className="text-sm text-rose-600">{loadError}</p>
          </div>
        ) : (
          <>
            {/* Toolbar */}
            <div className="border-b border-border px-5 py-4 flex flex-col gap-3">
              <div className="relative max-w-sm">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  placeholder="Search name, email, mentor…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-4 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
                  aria-label="Search management reviews"
                />
              </div>

              <div className="flex items-center gap-4 flex-wrap">
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="mgmt-review-func-filter"
                    className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
                  >
                    Function
                  </label>
                  <select
                    id="mgmt-review-func-filter"
                    value={funcFilter}
                    onChange={(e) => setFuncFilter(e.target.value)}
                    className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[140px] cursor-pointer"
                  >
                    <option value="all">All Functions</option>
                    {availableFuncs.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="mgmt-review-desig-filter"
                    className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
                  >
                    Designation
                  </label>
                  <select
                    id="mgmt-review-desig-filter"
                    value={designationFilter}
                    onChange={(e) => setDesignationFilter(e.target.value)}
                    className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[150px] cursor-pointer"
                  >
                    <option value="all">All Designations</option>
                    {availableDesignations.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="mgmt-review-mentor-filter"
                    className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
                  >
                    Mentor
                  </label>
                  <select
                    id="mgmt-review-mentor-filter"
                    value={mentorFilter}
                    onChange={(e) => setMentorFilter(e.target.value)}
                    className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[160px] cursor-pointer"
                  >
                    <option value="all">All Mentors</option>
                    {availableMentors.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <label
                    htmlFor="mgmt-review-status-filter"
                    className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
                  >
                    Status
                  </label>
                  <select
                    id="mgmt-review-status-filter"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                    className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[170px] cursor-pointer"
                  >
                    {STATUS_FILTER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Table / Empty state */}
            {visibleRows.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <ShieldCheck
                  className="h-10 w-10 text-text-muted mb-3"
                  aria-hidden="true"
                />
                <p className="font-display text-base font-medium text-text-main">
                  {rows.length === 0
                    ? "No reviews yet"
                    : "No reviews match your filters"}
                </p>
                <p className="mt-1 text-sm text-text-muted">
                  {rows.length === 0
                    ? "No active Staff users in this cycle yet."
                    : "Try a different search term or adjust your filters."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-slate-50 text-left">
                      {COLUMN_DEFS.map((col) => {
                        // Capture the key once so TS narrows it inside the closure;
                        // `col.key` is widened back to `SortKey | null` in the
                        // arrow body and the type guard wouldn't carry through.
                        const sortKey = col.key;
                        return sortKey ? (
                          <th
                            key={col.label}
                            className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted cursor-pointer select-none hover:text-text-main"
                            onClick={() => handleSort(sortKey)}
                          >
                            <span className="inline-flex items-center gap-1">
                              {col.label}
                              {getSortIcon(sortKey)}
                            </span>
                          </th>
                        ) : (
                          <th
                            key={col.label}
                            className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted"
                          >
                            {col.label}
                          </th>
                        );
                      })}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {visibleRows.map((r) => {
                      // Action gating per stage:
                      //   not_started / draft  -> no actions (mentee work is
                      //     either nonexistent or private)
                      //   pending_mentor       -> View only (self-review)
                      //   pending_management / completed -> View + Edit
                      const canView =
                        r.review_id != null &&
                        (r.status === "pending_mentor" ||
                          r.status === "pending_management" ||
                          r.status === "completed");
                      const canEdit =
                        r.review_id != null &&
                        (r.status === "pending_management" ||
                          r.status === "completed");
                      return (
                        <tr
                          key={r.user_id}
                          className="transition-colors hover:bg-slate-50"
                        >
                          <td className="px-5 py-3.5 font-medium text-text-main">
                            {r.employee_name}
                          </td>
                          <td className="px-5 py-3.5 text-text-muted">
                            {r.employee_email ?? "—"}
                          </td>
                          <td className="px-5 py-3.5 text-text-muted">
                            {r.mentor_name ?? "—"}
                          </td>
                          <td className="px-5 py-3.5 text-text-muted">
                            {r.function ?? "—"}
                          </td>
                          <td className="px-5 py-3.5 text-text-muted">
                            {r.designation ?? "—"}
                          </td>
                          <td className="px-5 py-3.5">
                            <ReviewStatusBadge status={r.status} />
                          </td>
                          <td className="px-5 py-3.5">
                            <PerformanceRatingBadge value={r.self_performance_rating} />
                          </td>
                          <td className="px-5 py-3.5">
                            <PerformanceRatingBadge
                              value={r.mentor_performance_rating}
                            />
                          </td>
                          <td className="px-5 py-3.5">
                            <PerformanceRatingBadge
                              value={r.management_performance_rating}
                            />
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {canView && r.review_id != null && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSaveError("");
                                    setEditTarget({
                                      row: r,
                                      mode: "view",
                                      draft: r.management_performance_rating ?? "",
                                    });
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md border border-border bg-white dark:bg-slate-700/40 px-2 py-1 text-[12px] font-medium text-text-muted hover:bg-brand-light hover:text-brand-accent hover:border-brand-light transition-colors"
                                  aria-label={`View review for ${r.employee_name}`}
                                >
                                  <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                                  View
                                </button>
                              )}
                              {canEdit && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSaveError("");
                                    setEditTarget({
                                      row: r,
                                      mode: "rate",
                                      draft: r.management_performance_rating ?? "",
                                    });
                                  }}
                                  className="inline-flex items-center gap-1 rounded-md bg-brand px-2 py-1 text-[12px] font-medium text-white hover:opacity-90 transition-opacity"
                                  aria-label={`Rate review for ${r.employee_name}`}
                                >
                                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                                  Rate
                                </button>
                              )}
                              {!canView && !canEdit && (
                                <span className="text-xs italic text-text-muted">
                                  —
                                </span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      {editTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mgmt-rating-modal-title"
        >
          <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between border-b border-border px-5 py-3 shrink-0">
              <div>
                <h3
                  id="mgmt-rating-modal-title"
                  className="font-display text-sm font-semibold text-text-main"
                >
                  {editTarget.mode === "rate"
                    ? "Management Rating"
                    : "Annual Review"}
                </h3>
                <p className="mt-0.5 text-xs text-text-muted">
                  {editTarget.row.employee_name} ·{" "}
                  {editTarget.row.function ?? "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={closeEdit}
                className="rounded-md p-1 text-text-muted hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {isEditReviewLoading ? (
                <div className="flex items-center justify-center py-8 text-sm text-text-muted gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                  Loading review…
                </div>
              ) : editReviewError ? (
                <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700">
                  Could not load full review: {editReviewError}.
                </p>
              ) : null}

              {/* Self Review */}
              <section className="rounded-lg border border-border overflow-hidden">
                <div className="flex items-center justify-between bg-slate-50 px-4 py-2 border-b border-border">
                  <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
                    Self Review
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-text-muted">Rating</span>
                    <PerformanceRatingBadge
                      value={editTarget.row.self_performance_rating}
                    />
                  </div>
                </div>
                <div className="p-3">
                  <p className="text-sm text-text-main whitespace-pre-wrap">
                    {editReview?.self_overall_review || (
                      <span className="italic text-text-muted">
                        {isEditReviewLoading ? "…" : "Not submitted."}
                      </span>
                    )}
                  </p>
                </div>
              </section>

              {/* Mentor Review */}
              <section className="rounded-lg border border-blue-100 overflow-hidden">
                <div className="flex items-center justify-between bg-blue-50 px-4 py-2 border-b border-blue-100">
                  <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
                    Mentor Review
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-blue-700/70">Rating</span>
                    <PerformanceRatingBadge
                      value={editTarget.row.mentor_performance_rating}
                    />
                  </div>
                </div>
                <div className="p-3">
                  <p className="text-sm text-blue-900 whitespace-pre-wrap">
                    {editReview?.mentor_overall_review || (
                      <span className="italic text-blue-900/60">
                        {isEditReviewLoading ? "…" : "Not submitted."}
                      </span>
                    )}
                  </p>
                </div>
              </section>

              {/* Management Rating — input in rate mode, read-only badge in view mode */}
              <section className="rounded-lg border border-border bg-slate-50/40 px-4 py-3">
                {editTarget.mode === "rate" ? (
                  <>
                    <PerformanceRatingSelect
                      id="management-rating-input"
                      label="Management Rating"
                      value={editTarget.draft}
                      onChange={(next) =>
                        setEditTarget({ ...editTarget, draft: next })
                      }
                      disabled={isSaving}
                    />
                    {saveError && (
                      <p className="mt-2 text-xs text-rose-600">{saveError}</p>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-text-muted">
                      Management Rating
                    </span>
                    {editTarget.row.management_performance_rating != null ? (
                      <PerformanceRatingBadge
                        value={editTarget.row.management_performance_rating}
                      />
                    ) : (
                      <span className="text-xs italic text-text-muted">
                        Not rated yet
                      </span>
                    )}
                  </div>
                )}
              </section>
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3 shrink-0">
              {editTarget.mode === "rate" ? (
                <>
                  <button
                    type="button"
                    onClick={closeEdit}
                    disabled={isSaving}
                    className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-text-main hover:bg-slate-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={isSaving}
                    className="rounded-lg bg-brand px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {isSaving ? "Saving…" : "Save"}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={closeEdit}
                  className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium text-text-main hover:bg-slate-50"
                >
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

