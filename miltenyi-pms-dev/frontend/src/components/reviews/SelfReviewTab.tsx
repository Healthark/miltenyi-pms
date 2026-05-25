/**
 * SelfReviewTab.tsx — "My Reviews" list for the logged-in user.
 *
 * Per-row actions: the page header no longer carries the Self-Review
 * button. Instead, this tab synthesises a row for the active fiscal
 * year when no AnnualReview row exists yet, surfacing the Start Self
 * Review action inline. Existing rows show Continue Draft (drafts) or
 * View (everything else).
 *
 * Mentor is the first column. Real rows carry their historical mentor
 * (resolved by the backend per row). The synthetic row carries the
 * caller's current mentor (fetched once via profileService).
 */

import { useEffect, useState } from "react";
import {
  Eye, LayoutGrid, Loader2, Lock, Pencil, Plus, Search, Table2, UserCircle,
  ClipboardCheck,
} from "lucide-react";
import type { AnnualReview } from "@/services/annual-review.service";
import { profileService } from "@/services/profile.service";
import { ReviewStatusBadge } from "@/components/reviews/ReviewStatusBadge";
import { ClearFiltersButton } from "@/components/common/ClearFiltersButton";
import { PerformanceRatingBadge } from "@/components/reviews/PerformanceRatingBadge";
import { AnnualReviewDetailModal } from "@/components/reviews/AnnualReviewDetailModal";
import { SortableHeader } from "@/components/SortableHeader";
import { compareValues, type SortKind, type SortState, type SortValue } from "@/utils/sort";
import { extractFyToken, formatFyLabel } from "@/utils/fy";
import { useSystemSettings } from "@/hooks/useSystemSettings";

// ── Display model ────────────────────────────────────────────────────
//
// The table renders a union of real AnnualReview rows and a synthetic
// "current fiscal year" row that appears only when no real row exists
// yet for the active cycle. The discriminator (`kind`) keeps the action
// logic clean — synthetic rows have no id and can't be viewed.

type DisplayRow =
  | { kind: "real"; id: number; review: AnnualReview }
  | { kind: "synthetic"; id: string; cycleName: string; mentorName: string | null };

/** Status values used by the filter dropdown + per-row badge. The
 *  synthetic row carries the frontend-only sentinel "not_started" so
 *  the filter can target it without touching the backend. */
type DisplayStatus =
  | "not_started"
  | "draft"
  | "pending_mentor"
  | "pending_management"
  | "completed";

function rowStatus(row: DisplayRow): DisplayStatus {
  return row.kind === "synthetic" ? "not_started" : (row.review.status as DisplayStatus);
}

function rowCycleName(row: DisplayRow): string {
  return row.kind === "synthetic" ? row.cycleName : row.review.cycle_name;
}

function rowMentorName(row: DisplayRow): string | null {
  return row.kind === "synthetic" ? row.mentorName : (row.review.mentor_name ?? null);
}

function rowSelfRating(row: DisplayRow): number | null {
  return row.kind === "synthetic" ? null : row.review.self_performance_rating;
}

function rowFinalRating(row: DisplayRow): number | null {
  return row.kind === "synthetic" ? null : row.review.final_performance_rating;
}

// ── Sort config ───────────────────────────────────────────────────────

type ViewMode = "grid" | "table";
type SortKey =
  | "mentor_name"
  | "cycle_name"
  | "status"
  | "self_performance_rating"
  | "final_performance_rating";

const SORT_CONFIG: Record<
  SortKey,
  { kind: SortKind; get: (r: DisplayRow) => SortValue }
> = {
  mentor_name:              { kind: "alpha",   get: (r) => rowMentorName(r) ?? "" },
  cycle_name:               { kind: "cycle",   get: (r) => rowCycleName(r) },
  status:                   { kind: "alpha",   get: (r) => rowStatus(r) },
  self_performance_rating:  { kind: "numeric", get: (r) => rowSelfRating(r) },
  final_performance_rating: { kind: "numeric", get: (r) => rowFinalRating(r) },
};

// ── Status filter options ─────────────────────────────────────────────

const STATUS_FILTER_OPTIONS: Array<{ value: DisplayStatus | "all"; label: string }> = [
  { value: "all",                label: "All" },
  { value: "not_started",        label: "Not Started" },
  { value: "draft",              label: "Draft" },
  { value: "pending_mentor",     label: "Pending Mentor" },
  { value: "pending_management", label: "Pending Management" },
  { value: "completed",          label: "Completed" },
];

// ── Inline badges ─────────────────────────────────────────────────────

function NotStartedBadge() {
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-700">
      Not Started
    </span>
  );
}

function FinalRatingHiddenBadge() {
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-text-muted/60">
      <Lock className="h-3 w-3" aria-hidden="true" /> Hidden
    </span>
  );
}

function StatusCell({ row }: { readonly row: DisplayRow }) {
  if (row.kind === "synthetic") return <NotStartedBadge />;
  return <ReviewStatusBadge status={row.review.status} />;
}

// ── Action button per row ─────────────────────────────────────────────

interface RowActionsProps {
  readonly row: DisplayRow;
  readonly submissionsOpen: boolean;
  readonly onStart: () => void;
  readonly onContinueDraft: (review: AnnualReview) => void;
  readonly onView: (review: AnnualReview) => void;
}

function RowActions({ row, submissionsOpen, onStart, onContinueDraft, onView }: RowActionsProps) {
  if (row.kind === "synthetic") {
    return (
      <button
        type="button"
        onClick={onStart}
        disabled={!submissionsOpen}
        title={submissionsOpen ? undefined : "Self-review submission window is closed"}
        className="flex items-center gap-1.5 rounded-md bg-brand px-2.5 py-1 text-[11px] font-medium text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        Start Self Review
      </button>
    );
  }
  if (row.review.status === "draft") {
    return (
      <button
        type="button"
        onClick={() => onContinueDraft(row.review)}
        className="flex items-center gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-700 hover:bg-amber-100 transition-colors"
      >
        <Pencil className="h-3 w-3" aria-hidden="true" />
        Continue Draft
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onView(row.review)}
      className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-text-muted hover:bg-brand/10 hover:text-brand transition-colors"
    >
      <Eye className="h-3 w-3" aria-hidden="true" /> View
    </button>
  );
}

// ── Card ──────────────────────────────────────────────────────────────

function SelfReviewCard({
  row,
  finalRatingVisible,
  submissionsOpen,
  onStart,
  onContinueDraft,
  onView,
}: {
  readonly row: DisplayRow;
  readonly finalRatingVisible: boolean;
  readonly submissionsOpen: boolean;
  readonly onStart: () => void;
  readonly onContinueDraft: (review: AnnualReview) => void;
  readonly onView: (review: AnnualReview) => void;
}) {
  const mentor = rowMentorName(row);
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm hover:shadow-md transition-shadow flex flex-col gap-3">
      {/* Mentor banner — first piece of info, matching the table's first column */}
      <div className="flex items-center gap-2 text-[11px] text-text-muted">
        <UserCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">
          Mentor: <span className="text-text-main font-medium">{mentor ?? "—"}</span>
        </span>
      </div>

      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardCheck className="h-5 w-5 text-text-muted shrink-0" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-medium text-text-main truncate">
              {formatFyLabel(rowCycleName(row))}
            </p>
            <p className="text-[11px] text-text-muted">Self-Review</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <StatusCell row={row} />
      </div>

      <div className="flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Self</span>
          <PerformanceRatingBadge value={rowSelfRating(row)} />
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-text-muted">Final</span>
          {finalRatingVisible ? (
            <PerformanceRatingBadge value={rowFinalRating(row)} />
          ) : (
            <FinalRatingHiddenBadge />
          )}
        </div>
      </div>

      <div className="mt-auto">
        <RowActions
          row={row}
          submissionsOpen={submissionsOpen}
          onStart={onStart}
          onContinueDraft={onContinueDraft}
          onView={onView}
        />
      </div>
    </div>
  );
}

// ── Empty / loading ───────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20 text-sm text-text-muted animate-pulse gap-2">
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      Loading your reviews…
    </div>
  );
}

function NoMatchEmpty() {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center">
      <UserCircle className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
      <p className="font-display text-base font-medium text-text-main">
        No reviews match this filter
      </p>
      <p className="mt-1 text-sm text-text-muted">
        Try adjusting the Fiscal Year or Status filter.
      </p>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────

interface SelfReviewTabProps {
  readonly reviews: readonly AnnualReview[];
  readonly isLoading: boolean;
  /** Active cycle name from system settings (e.g. "Q1 FY26-27"). Used
   *  to derive the FY for the synthetic current-cycle row. */
  readonly activeCycle: string;
  /** Whether the self-review submission window is currently open. The
   *  synthetic row's Start button is disabled when this is false. */
  readonly submissionsOpen: boolean;
  /** Open the form modal in "create" mode (no draft to pre-fill). */
  readonly onStartReview: () => void;
  /** Open the form modal in "continue draft" mode for an existing draft row. */
  readonly onContinueDraft: (review: AnnualReview) => void;
}

export function SelfReviewTab({
  reviews,
  isLoading,
  activeCycle,
  submissionsOpen,
  onStartReview,
  onContinueDraft,
}: SelfReviewTabProps) {
  const { settings } = useSystemSettings();
  const finalRatingVisible = settings?.annual_review_final_rating_visible ?? false;

  const [viewMode, setViewMode] = useState<ViewMode>("table");
  const [searchQuery, setSearchQuery] = useState("");
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<DisplayStatus | "all">("all");
  const [sort, setSort] = useState<SortState<SortKey> | null>(null);
  const [viewTarget, setViewTarget] = useState<AnnualReview | null>(null);

  // Fetch the caller's profile once so we know the current mentor name
  // for the synthetic current-FY row. The historical rows already carry
  // their own mentor_name from the backend.
  const [currentMentorName, setCurrentMentorName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    profileService
      .getProfile()
      .then((profile) => {
        if (!cancelled) setCurrentMentorName(profile.mentor_name);
      })
      .catch(() => {
        // Non-fatal — synthetic row shows "—" for mentor.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Build the synthetic row only when the active cycle has no real row yet.
  const activeFyToken = activeCycle ? extractFyToken(activeCycle) : "";
  const hasCurrentFyReview = activeFyToken !== ""
    && reviews.some((r) => r.cycle_name === activeFyToken);

  const rows: DisplayRow[] = [];
  if (activeFyToken && !hasCurrentFyReview) {
    rows.push({
      kind: "synthetic",
      id: `synthetic-${activeFyToken}`,
      cycleName: activeFyToken,
      mentorName: currentMentorName,
    });
  }
  for (const r of reviews) {
    rows.push({ kind: "real", id: r.id, review: r });
  }

  // Picker options come from the rendered rows (so the synthetic FY appears).
  const availableYears = Array.from(
    new Set(rows.map((r) => extractFyToken(rowCycleName(r)))),
  ).sort((a, b) => b.localeCompare(a));

  const filtered = rows
    .filter((r) =>
      yearFilter === "all" || extractFyToken(rowCycleName(r)) === yearFilter,
    )
    .filter((r) =>
      statusFilter === "all" || rowStatus(r) === statusFilter,
    )
    .filter((r) => {
      const q = searchQuery.trim().toLowerCase();
      if (q === "") return true;
      const cycle = rowCycleName(r).toLowerCase();
      const mentor = (rowMentorName(r) ?? "").toLowerCase();
      return cycle.includes(q) || mentor.includes(q);
    });

  const sorted = sort
    ? filtered.slice().sort((a, b) => {
        const { kind, get } = SORT_CONFIG[sort.key];
        return compareValues(get(a), get(b), kind, sort.direction);
      })
    : filtered;

  const viewBtnCls = (mode: ViewMode) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
      viewMode === mode
        ? "bg-brand/10 text-brand"
        : "text-text-muted hover:bg-slate-100"
    }`;

  if (isLoading) return <LoadingState />;

  // If the user has no reviews AND no synthetic row (no active cycle), show
  // the legacy empty state. This is the genuinely "nothing here" case.
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center">
        <ClipboardCheck className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
        <p className="font-display text-base font-medium text-text-main">
          No self-reviews yet
        </p>
        <p className="mt-1 text-sm text-text-muted max-w-sm">
          Reflect on your performance and submit when ready.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Toolbar — single row: search · FY filter · Status filter · view toggle */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap flex-1 min-w-0">
          <div className="relative w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Search by cycle or mentor…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-1.5 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand"
            />
          </div>
          <div className="flex items-center gap-2">
            <label
              htmlFor="self-review-fy-filter"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Fiscal Year
            </label>
            <select
              id="self-review-fy-filter"
              value={yearFilter}
              onChange={(e) => setYearFilter(e.target.value)}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[130px] cursor-pointer"
            >
              <option value="all">All Years</option>
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {formatFyLabel(y)}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label
              htmlFor="self-review-status-filter"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Status
            </label>
            <select
              id="self-review-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as DisplayStatus | "all")}
              className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[160px] cursor-pointer"
            >
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <ClearFiltersButton
            active={searchQuery.trim().length > 0 || statusFilter !== "all"}
            onClear={() => {
              setSearchQuery("");
              setStatusFilter("all");
            }}
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-white p-0.5 shrink-0">
          <button type="button" className={viewBtnCls("grid")} onClick={() => setViewMode("grid")}>
            <LayoutGrid className="h-3.5 w-3.5" /> Cards
          </button>
          <button type="button" className={viewBtnCls("table")} onClick={() => setViewMode("table")}>
            <Table2 className="h-3.5 w-3.5" /> Table
          </button>
        </div>
      </div>

      {/* Content */}
      {sorted.length === 0 ? (
        <NoMatchEmpty />
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((r) => (
            <SelfReviewCard
              key={r.id}
              row={r}
              finalRatingVisible={finalRatingVisible}
              submissionsOpen={submissionsOpen}
              onStart={onStartReview}
              onContinueDraft={onContinueDraft}
              onView={setViewTarget}
            />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-max text-[13px]">
            <thead>
              <tr className="bg-slate-50/80 border-b border-border">
                <th className="text-left px-5 py-2.5">
                  <SortableHeader label="Mentor" columnKey="mentor_name" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="Fiscal Year" columnKey="cycle_name" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="Status" columnKey="status" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="Self Rating" columnKey="self_performance_rating" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5">
                  <SortableHeader label="Final Rating" columnKey="final_performance_rating" sort={sort} onSort={setSort} />
                </th>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {sorted.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3 text-text-main">
                    {rowMentorName(r) ?? (
                      <span className="italic text-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium text-text-main">
                    <span className="text-[12.5px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                      {formatFyLabel(rowCycleName(r))}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <StatusCell row={r} />
                  </td>
                  <td className="px-4 py-3">
                    <PerformanceRatingBadge value={rowSelfRating(r)} />
                  </td>
                  <td className="px-4 py-3">
                    {finalRatingVisible ? (
                      <PerformanceRatingBadge value={rowFinalRating(r)} />
                    ) : (
                      <FinalRatingHiddenBadge />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <RowActions
                      row={r}
                      submissionsOpen={submissionsOpen}
                      onStart={onStartReview}
                      onContinueDraft={onContinueDraft}
                      onView={setViewTarget}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Read-only detail modal */}
      {viewTarget && (
        <AnnualReviewDetailModal
          review={viewTarget}
          title="Self Annual Review"
          subtitle={`Year: ${formatFyLabel(viewTarget.cycle_name)}`}
          onClose={() => setViewTarget(null)}
        />
      )}
    </div>
  );
}
