/**
 * ManagementReviewTab.tsx — Management Review grid for the AdminPanel.
 *
 * Only rendered when the current user is role === "Admin" AND
 * is_management === true. The backend also enforces both via
 * _require_management, so this gate is purely a UI affordance — the API
 * will 403 anyone else.
 *
 * Renders all annual reviews in the active cycle that have cleared the
 * mentor stage (pending_management + completed) as a single table, and
 * lets management set/override the management rating inline via a modal.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
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
} from "../../services/annual-review.service";
import { PerformanceRatingBadge } from "../reviews/PerformanceRatingBadge";
import { PerformanceRatingSelect } from "../reviews/PerformanceRatingSelect";
import { AnnualReviewDetailModal } from "../reviews/AnnualReviewDetailModal";
import { getErrorMessage } from "../../utils/errors";
import { useConfirm } from "../../hooks/useConfirm";

type RatingValue = number | "";
type StatusFilter = "all" | "pending" | "rated";

interface EditTarget {
  readonly row: CalibrationRow;
  readonly draft: RatingValue;
}

const TABLE_HEADERS = [
  "User",
  "Email",
  "Mentor",
  "Department",
  "Self Review",
  "Mentor Review",
  "Management Rating",
  "Actions",
];

export function ManagementReviewTab() {
  const [rows, setRows] = useState<CalibrationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  const [searchQuery, setSearchQuery] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");
  const [mentorFilter, setMentorFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");

  const [viewReviewId, setViewReviewId] = useState<number | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const confirm = useConfirm();

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError("");
    try {
      setRows(await annualReviewService.getCalibrationGrid());
    } catch (err) {
      setLoadError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const availableDepts = useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.department).filter((d): d is string => !!d)),
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

  const filtered = rows.filter((r) => {
    if (deptFilter !== "all" && (r.department ?? "") !== deptFilter) return false;
    if (mentorFilter !== "all" && (r.mentor_name ?? "") !== mentorFilter) return false;
    if (statusFilter === "pending" && r.management_performance_rating != null) return false;
    if (statusFilter === "rated" && r.management_performance_rating == null) return false;

    const q = searchQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      r.employee_name.toLowerCase().includes(q) ||
      (r.employee_email ?? "").toLowerCase().includes(q) ||
      (r.mentor_name ?? "").toLowerCase().includes(q) ||
      (r.department ?? "").toLowerCase().includes(q)
    );
  });

  const handleSave = async () => {
    if (!editTarget) return;
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
    setIsSaving(true);
    setSaveError("");
    try {
      await annualReviewService.setManagementRating(editTarget.row.review_id, {
        management_performance_rating: editTarget.draft,
      });
      setEditTarget(null);
      await load();
    } catch (err) {
      setSaveError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse gap-2">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Loading reviews…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-5">
        <p className="text-sm text-rose-600">{loadError}</p>
      </div>
    );
  }

  return (
    <div>
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
              htmlFor="mgmt-review-dept-filter"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Dept
            </label>
            <select
              id="mgmt-review-dept-filter"
              value={deptFilter}
              onChange={(e) => setDeptFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[140px] cursor-pointer"
            >
              <option value="all">All Depts</option>
              {availableDepts.map((d) => (
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
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[120px] cursor-pointer"
            >
              <option value="all">All</option>
              <option value="pending">Pending</option>
              <option value="rated">Rated</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table / Empty state */}
      {filtered.length === 0 ? (
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
              ? "Reviews appear here once they clear the mentor evaluation stage."
              : "Try a different search term or adjust your filters."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-slate-50 text-left">
                {TABLE_HEADERS.map((h) => (
                  <th
                    key={h}
                    className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((r) => (
                <tr
                  key={r.review_id}
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
                    {r.department ?? "—"}
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
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setViewReviewId(r.review_id)}
                        title={`View review for ${r.employee_name}`}
                        className="rounded-md p-1.5 text-text-muted hover:bg-brand-light hover:text-brand transition-colors"
                        aria-label={`View review for ${r.employee_name}`}
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setSaveError("");
                          setEditTarget({
                            row: r,
                            draft: r.management_performance_rating ?? "",
                          });
                        }}
                        title={
                          r.management_performance_rating == null
                            ? "Add management rating"
                            : "Edit management rating"
                        }
                        className="rounded-md p-1.5 text-text-muted hover:bg-brand-light hover:text-brand transition-colors"
                        aria-label={`Edit management rating for ${r.employee_name}`}
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {viewReviewId != null && (
        <ReviewDetailLoader
          reviewId={viewReviewId}
          onClose={() => setViewReviewId(null)}
        />
      )}

      {editTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-border px-5 py-3">
              <div>
                <h3 className="font-display text-sm font-semibold text-text-main">
                  Management Rating
                </h3>
                <p className="mt-0.5 text-xs text-text-muted">
                  {editTarget.row.employee_name} ·{" "}
                  {editTarget.row.department ?? "—"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditTarget(null)}
                className="rounded-md p-1 text-text-muted hover:bg-slate-100"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-text-muted">Self Rating</p>
                  <PerformanceRatingBadge
                    value={editTarget.row.self_performance_rating}
                  />
                </div>
                <div>
                  <p className="text-text-muted">Mentor Rating</p>
                  <PerformanceRatingBadge
                    value={editTarget.row.mentor_performance_rating}
                  />
                </div>
              </div>
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
                <p className="text-xs text-rose-600">{saveError}</p>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
              <button
                type="button"
                onClick={() => setEditTarget(null)}
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
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ReviewDetailLoader({
  reviewId,
  onClose,
}: {
  readonly reviewId: number;
  readonly onClose: () => void;
}) {
  const [review, setReview] = useState<
    Awaited<ReturnType<typeof annualReviewService.getReview>> | null
  >(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    annualReviewService
      .getReview(reviewId)
      .then((r) => {
        if (alive) setReview(r);
      })
      .catch((err) => {
        if (alive) setError(getErrorMessage(err));
      });
    return () => {
      alive = false;
    };
  }, [reviewId]);

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
          <p className="text-sm text-rose-600">{error}</p>
          <div className="mt-3 text-right">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-slate-50"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!review) return null;

  return (
    <AnnualReviewDetailModal
      review={review}
      title="Annual Review"
      subtitle={`Year: ${review.cycle_name}`}
      onClose={onClose}
    />
  );
}
