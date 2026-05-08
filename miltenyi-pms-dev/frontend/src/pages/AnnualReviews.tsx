import { useCallback, useEffect, useState, Fragment } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/hooks/useConfirm";
import { SelfReviewTab } from "@/components/reviews/SelfReviewTab";
import { TeamReviewTab } from "@/components/reviews/TeamReviewTab";
import { SelfReviewFormModal } from "@/components/reviews/SelfReviewFormModal";
import { PerformanceRatingBadge } from "@/components/reviews/PerformanceRatingBadge";
import { StringCombobox } from "@/components/common/StringCombobox";
import { SortableHeader } from "@/components/SortableHeader";
import { compareValues, type SortKind, type SortState } from "@/utils/sort";
import {
  annualReviewService,
  type AnnualReview,
  type SelfReviewPayload,
  type SelfReviewDraftPayload,
} from "@/services/annual-review.service";
import { getErrorMessage } from "@/utils/errors";
import { formatFyLabel } from "@/utils/fy";

type AllReviewsSortKey =
  | "employee_name"
  | "function"
  | "designation"
  | "cycle_name"
  | "status"
  | "self_performance_rating"
  | "mentor_performance_rating"
  | "final_performance_rating";

const ALL_REVIEWS_SORT_CONFIG: Record<
  AllReviewsSortKey,
  { kind: SortKind; get: (r: AnnualReview) => unknown }
> = {
  employee_name:             { kind: "alpha",   get: (r) => r.employee_name ?? `User #${r.user_id}` },
  function:                  { kind: "alpha",   get: (r) => r.function },
  designation:               { kind: "alpha",   get: (r) => r.designation },
  cycle_name:                { kind: "cycle",   get: (r) => r.cycle_name },
  status:                    { kind: "alpha",   get: (r) => r.status },
  self_performance_rating:   { kind: "numeric", get: (r) => r.self_performance_rating },
  mentor_performance_rating: { kind: "numeric", get: (r) => r.mentor_performance_rating },
  final_performance_rating:  { kind: "numeric", get: (r) => r.final_performance_rating },
};

// Static lifecycle list keeps the Status dropdown stable even when only
// some statuses are present in the loaded rows.
const ALL_REVIEWS_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "draft",              label: "Draft" },
  { value: "pending_mentor",     label: "Pending Mentor" },
  { value: "pending_management", label: "Pending Management" },
  { value: "completed",          label: "Completed" },
];

type ActiveTab = "my" | "team" | "all";

export function AnnualReviews() {
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const toast = useToast();
  const confirm = useConfirm();

  // Role-based detection. Replaces the previous `has_mentees` shortcut so
  // HR_MyOrg gets their view-only "All Reviews" tab instead of falling
  // through to the Staff layout.
  const isStaff = user?.role === "Staff";
  const isMentor = user?.role === "Mentor";
  const isHRMyOrg = user?.role === "HR_MyOrg";

  const activeCycle = settings?.active_cycle_name ?? "";
  const submissionsOpen = settings?.reviews_submission_open ?? false;

  const fyLabel = settings?.active_cycle_name
    ? formatFyLabel(settings.active_cycle_name)
    : null;

  const [activeTab, setActiveTab] = useState<ActiveTab>("my");

  // Switch to the role's primary tab once auth resolves.
  useEffect(() => {
    if (isMentor) setActiveTab("team");
    else if (isHRMyOrg) setActiveTab("all");
    else setActiveTab("my");
  }, [isMentor, isHRMyOrg]);

  const [reviews, setReviews] = useState<AnnualReview[]>([]);
  const [allReviews, setAllReviews] = useState<AnnualReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      if (isHRMyOrg) {
        setAllReviews(await annualReviewService.getAllReviews());
      } else if (isStaff) {
        setReviews(await annualReviewService.getMyReviewHistory());
      } else {
        // Mentor: TeamReviewTab loads its own data
      }
    } catch {
      /* stays empty */
    } finally {
      setIsLoading(false);
    }
  }, [isHRMyOrg, isStaff]);

  useEffect(() => {
    void load();
  }, [load]);

  // Lookup the active-cycle row (if any). May be a draft (still editable),
  // or one of the post-draft statuses (locked).
  const currentReview =
    reviews.find((r) => r.cycle_name === activeCycle) ?? null;
  const isCurrentDraft = currentReview?.status === "draft";
  // Can open the form when there's no row yet, OR when the existing row
  // is still a draft. Past-draft statuses lock the modal closed.
  const canStart =
    !!activeCycle &&
    submissionsOpen &&
    (!currentReview || isCurrentDraft) &&
    !isLoading;

  const handleSubmit = async (payload: SelfReviewPayload) => {
    const ok = await confirm({
      title: "Submit annual self-review?",
      message: `Submit your self-review for ${
        fyLabel ?? "this cycle"
      }. Once submitted you can't edit your responses, and your mentor will receive it for evaluation.`,
      variant: "warning",
      confirmText: "Submit",
    });
    if (!ok) return;
    setIsSaving(true);
    setFormError("");
    try {
      const saved = await annualReviewService.submitSelfReview(payload);
      // submitSelfReview can either create a new row or promote a draft;
      // upsert into local state by id.
      setReviews((prev) => {
        const idx = prev.findIndex((r) => r.id === saved.id);
        if (idx === -1) return [saved, ...prev];
        const next = prev.slice();
        next[idx] = saved;
        return next;
      });
      setShowForm(false);
      toast.success("Self-review submitted.");
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDraft = async (payload: SelfReviewDraftPayload) => {
    setIsDraftSaving(true);
    setFormError("");
    try {
      // First save calls POST /self/draft to create the row; subsequent
      // saves use PATCH /draft on the existing row.
      const saved = currentReview
        ? await annualReviewService.saveDraft(currentReview.id, payload)
        : await annualReviewService.createSelfDraft(payload);
      setReviews((prev) => {
        const idx = prev.findIndex((r) => r.id === saved.id);
        if (idx === -1) return [saved, ...prev];
        const next = prev.slice();
        next[idx] = saved;
        return next;
      });
      toast.success("Draft saved.");
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setIsDraftSaving(false);
    }
  };

  const tabCls = (tab: ActiveTab) =>
    `px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
      activeTab === tab
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  // Header text per role. Staff/Mentor keep the existing "Team Reviews"
  // label (per the audit answer); HR_MyOrg gets a distinct "All Reviews"
  // header signalling org-wide view-only scope.
  const headerTitle = isHRMyOrg ? "All Reviews" : "Team Reviews";
  const headerSubtitle = isHRMyOrg
    ? "View-only access to every annual review across the org."
    : "Complete your team review and provide feedback for your team members.";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-main">
            {headerTitle}
            {fyLabel && (
              <span className="ml-2 text-sm font-normal text-text-muted">
                · {fyLabel}
              </span>
            )}
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">{headerSubtitle}</p>
        </div>
        {/* Self-Review button is Staff-only — never shown for Mentor or HR. */}
        {isStaff && activeTab === "my" && canStart && (
          <button
            type="button"
            onClick={() => {
              setFormError("");
              setShowForm(true);
            }}
            className="shrink-0 flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {isCurrentDraft ? "Continue Draft" : "Self-Review"}
          </button>
        )}
      </div>

      {/* Tab container */}
      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        <div className="flex border-b border-border px-2">
          {isStaff && (
            <button
              type="button"
              className={tabCls("my")}
              onClick={() => setActiveTab("my")}
            >
              My Reviews
            </button>
          )}
          {isMentor && (
            <button
              type="button"
              className={tabCls("team")}
              onClick={() => setActiveTab("team")}
            >
              Team Review
            </button>
          )}
          {isHRMyOrg && (
            <button
              type="button"
              className={tabCls("all")}
              onClick={() => setActiveTab("all")}
            >
              All Reviews
            </button>
          )}
        </div>

        <div className="p-5">
          {isStaff && activeTab === "my" && (
            <SelfReviewTab reviews={reviews} isLoading={isLoading} />
          )}
          {isMentor && activeTab === "team" && <TeamReviewTab />}
          {isHRMyOrg && activeTab === "all" && (
            <AllReviewsTab reviews={allReviews} isLoading={isLoading} />
          )}
        </div>
      </div>

      {/* Form modal lives at page scope so the header button can open it */}
      {showForm && activeCycle && (
        <SelfReviewFormModal
          cycleName={activeCycle}
          draft={isCurrentDraft ? currentReview : null}
          onSubmit={handleSubmit}
          onSaveDraft={handleSaveDraft}
          onClose={() => {
            setShowForm(false);
            setFormError("");
          }}
          isSaving={isSaving}
          isDraftSaving={isDraftSaving}
          error={formError}
        />
      )}
    </div>
  );
}

// ── HR_MyOrg "All Reviews" view-only table ──────────────────────────

function AllReviewsTab({
  reviews,
  isLoading,
}: {
  readonly reviews: AnnualReview[];
  readonly isLoading: boolean;
}) {
  const [cycleFilter, setCycleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [functionFilter, setFunctionFilter] = useState<string>("all");
  const [designationFilter, setDesignationFilter] = useState<string>("all");
  // Employee filter is a typeable combobox (StringCombobox) — looks like a
  // standard scrollable dropdown but accepts free-text typing to narrow
  // the list. Empty string means "no employee filter applied".
  const [employeeQuery, setEmployeeQuery] = useState<string>("");
  const [sort, setSort] = useState<SortState<AllReviewsSortKey> | null>(null);
  // Inline expansion: clicking a row reveals the self + mentor narrative
  // side-by-side. Only one row at a time; clicking the same row again
  // collapses it.
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const cycles = Array.from(
    new Set(reviews.map((r) => r.cycle_name).filter(Boolean)),
  ).sort((a, b) => b.localeCompare(a));
  const employees = Array.from(
    new Set(
      reviews.map((r) => r.employee_name).filter((n): n is string => !!n),
    ),
  ).sort();
  const functions = Array.from(
    new Set(reviews.map((r) => r.function).filter((n): n is string => !!n)),
  ).sort();
  const designations = Array.from(
    new Set(reviews.map((r) => r.designation).filter((n): n is string => !!n)),
  ).sort();

  const filtered = reviews.filter((r) => {
    if (cycleFilter !== "all" && r.cycle_name !== cycleFilter) return false;
    if (statusFilter !== "all" && r.status !== statusFilter) return false;
    if (functionFilter !== "all" && r.function !== functionFilter) return false;
    if (designationFilter !== "all" && r.designation !== designationFilter) return false;
    // Combobox commits the exact selected name, so an equality check is
    // both faster and consistent with the other dropdown filters.
    if (employeeQuery && r.employee_name !== employeeQuery) return false;
    return true;
  });

  const sorted = sort
    ? filtered.slice().sort((a, b) => {
        const { kind, get } = ALL_REVIEWS_SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : filtered;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-text-muted">
        Loading reviews…
      </div>
    );
  }
  if (reviews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
        <p className="font-display text-base font-medium text-text-main">
          No annual reviews recorded
        </p>
        <p className="mt-1 text-sm text-text-muted">
          Reviews will appear here once Staff submit self-reviews and mentors
          start evaluating.
        </p>
      </div>
    );
  }

  const labelCls =
    "text-[11px] font-bold uppercase tracking-wider text-text-muted";
  const selectCls =
    "rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4 flex-wrap">
        {/* Employee filter — typeable combobox styled like the PM picker
            in ProjectModal. Typing narrows the suggestion list; clicking
            an option commits the filter. Click the X to clear. */}
        <div className="flex items-center gap-2">
          <label htmlFor="all-rev-employee" className={labelCls}>
            Employee
          </label>
          <StringCombobox
            id="all-rev-employee"
            options={employees}
            value={employeeQuery}
            onChange={setEmployeeQuery}
            placeholder="Type a name…"
          />
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="all-rev-cycle" className={labelCls}>
            Cycle
          </label>
          <select
            id="all-rev-cycle"
            value={cycleFilter}
            onChange={(e) => setCycleFilter(e.target.value)}
            className={`${selectCls} min-w-[120px]`}
          >
            <option value="all">All</option>
            {cycles.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="all-rev-status" className={labelCls}>
            Status
          </label>
          <select
            id="all-rev-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={`${selectCls} min-w-[150px]`}
          >
            <option value="all">All</option>
            {ALL_REVIEWS_STATUS_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </div>

        {functions.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="all-rev-function" className={labelCls}>
              Function
            </label>
            <select
              id="all-rev-function"
              value={functionFilter}
              onChange={(e) => setFunctionFilter(e.target.value)}
              className={`${selectCls} min-w-[130px]`}
            >
              <option value="all">All</option>
              {functions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        )}

        {designations.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="all-rev-designation" className={labelCls}>
              Designation
            </label>
            <select
              id="all-rev-designation"
              value={designationFilter}
              onChange={(e) => setDesignationFilter(e.target.value)}
              className={`${selectCls} min-w-[150px]`}
            >
              <option value="all">All</option>
              {designations.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
        )}

        <span className="text-xs text-text-muted">
          {filtered.length} of {reviews.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-slate-50/80 border-b border-border">
              <th className="text-left px-5 py-2.5">
                <SortableHeader label="Employee" columnKey="employee_name" sort={sort} onSort={setSort} />
              </th>
              <th className="text-left px-4 py-2.5">
                <SortableHeader label="Function" columnKey="function" sort={sort} onSort={setSort} />
              </th>
              <th className="text-left px-4 py-2.5">
                <SortableHeader label="Designation" columnKey="designation" sort={sort} onSort={setSort} />
              </th>
              <th className="text-left px-4 py-2.5">
                <SortableHeader label="Cycle" columnKey="cycle_name" sort={sort} onSort={setSort} />
              </th>
              <th className="text-left px-4 py-2.5">
                <SortableHeader label="Status" columnKey="status" sort={sort} onSort={setSort} />
              </th>
              <th className="text-left px-4 py-2.5">
                <SortableHeader label="Self" columnKey="self_performance_rating" sort={sort} onSort={setSort} />
              </th>
              <th className="text-left px-4 py-2.5">
                <SortableHeader label="Mentor" columnKey="mentor_performance_rating" sort={sort} onSort={setSort} />
              </th>
              <th className="text-left px-4 py-2.5">
                <SortableHeader label="Final" columnKey="final_performance_rating" sort={sort} onSort={setSort} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-5 py-10 text-center">
                  <p className="text-[13px] text-text-main font-medium">
                    No matching reviews
                  </p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    Try adjusting your filters or clearing the search.
                  </p>
                </td>
              </tr>
            ) : sorted.map((r) => {
              const isExpanded = expandedId === r.id;
              return (
                <Fragment key={r.id}>
                  <tr
                    className={`cursor-pointer transition-colors ${
                      isExpanded ? "bg-brand/5" : "hover:bg-slate-50/60"
                    }`}
                    onClick={() => setExpandedId(isExpanded ? null : r.id)}
                  >
                    <td className="px-5 py-3 font-medium text-text-main">
                      <div className="flex items-center gap-2">
                        <ChevronDown
                          className={`h-4 w-4 text-text-muted shrink-0 transition-transform duration-200 ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                          aria-hidden="true"
                        />
                        {r.employee_name ?? `User #${r.user_id}`}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {r.function ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {r.designation ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                        {r.cycle_name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-muted capitalize">
                      {r.status.replace("_", " ")}
                    </td>
                    <td className="px-4 py-3">
                      <PerformanceRatingBadge value={r.self_performance_rating} />
                    </td>
                    <td className="px-4 py-3">
                      <PerformanceRatingBadge value={r.mentor_performance_rating} />
                    </td>
                    <td className="px-4 py-3">
                      <PerformanceRatingBadge value={r.final_performance_rating} />
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr>
                      <td
                        colSpan={8}
                        className="bg-slate-50/40 border-t border-brand/10 px-5 py-5"
                      >
                        <ReviewNarrativePanel review={r} />
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Inline narrative panel (Self + Mentor side-by-side) ─────────────

function ReviewNarrativePanel({ review }: { readonly review: AnnualReview }) {
  const empty = (
    <span className="text-text-muted italic">Not provided yet.</span>
  );
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="rounded-lg border border-border bg-white overflow-hidden">
        <div className="bg-slate-100 px-4 py-2 border-b border-border">
          <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
            Self Review
          </p>
        </div>
        <div className="p-4">
          <p className="text-sm text-text-main whitespace-pre-wrap">
            {review.self_overall_review || empty}
          </p>
        </div>
      </div>
      <div className="rounded-lg border border-blue-100 bg-white overflow-hidden">
        <div className="bg-blue-50 px-4 py-2 border-b border-blue-100">
          <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
            Mentor Review
          </p>
        </div>
        <div className="p-4">
          <p className="text-sm text-blue-900 whitespace-pre-wrap">
            {review.mentor_overall_review || empty}
          </p>
        </div>
      </div>
    </div>
  );
}
