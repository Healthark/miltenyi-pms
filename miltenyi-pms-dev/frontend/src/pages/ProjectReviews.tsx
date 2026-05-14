/**
 * ProjectReviews.tsx — Project Reviews Page (per-role tabs).
 *
 * Tabs are role-gated:
 *   My Reviews            — Staff, expands rows into ReviewDetailPanel /
 *                           TableExpandedRow.
 *   Primary Evaluation    — PM, owned by `PrimaryEvaluationTab`.
 *   Secondary Evaluation  — anyone listed as `Project.secondary_evaluator_id`
 *                           on at least one project (Staff / HR), owned by
 *                           `SecondaryEvalTab`. Visibility is driven by a
 *                           lightweight queue probe at mount.
 *   Mentees' Reviews      — Mentor, read-only over getMenteeReviews().
 *   All Reviews           — HR_MyOrg / HR_Miltenyi, read-only org-wide.
 *
 * The bulk of presentation logic lives in the extracted components in
 * `components/project-reviews/`. This file owns the page-level state,
 * data load, derived filters/sort, and the conditional render that
 * picks between Skeleton / Empty / Grid / Table.
 */

import { useState, useEffect, useMemo, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Briefcase,
  CheckCircle2,
  Clock,
  Eye,
  Lock,
  Search,
  ChevronDown,
} from "lucide-react";
import {
  projectReviewService,
  type MyProjectCard,
  type ProjectReviewResponse,
  type RoleExpectation,
} from "@/services/project-review.service";
import { queryKeys } from "@/lib/queryKeys";
import { useAuth } from "@/hooks/useAuth";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { PrimaryEvaluationTab } from "@/components/project-reviews/PrimaryEvaluationTab";
import { SecondaryEvalTab } from "@/components/project-reviews/SecondaryEvalTab";
import { PerformanceRatingBadge } from "@/components/reviews/PerformanceRatingBadge";
import { ProjectSummaryCard } from "@/components/project-reviews/ProjectSummaryCard";
import { ReviewDetailPanel } from "@/components/project-reviews/ReviewDetailPanel";
import { TableExpandedRow } from "@/components/project-reviews/TableExpandedRow";
import { ProjectReviewDetailModal } from "@/components/project-reviews/ProjectReviewDetailModal";
import { MyReviewsToolbar } from "@/components/project-reviews/MyReviewsToolbar";
import {
  GridSkeleton,
  TableSkeleton,
} from "@/components/project-reviews/MyReviewsSkeletons";
import { SortableHeader } from "@/components/SortableHeader";
import { ExportExcelButton } from "@/components/admin/ExportExcelButton";
import { StringCombobox } from "@/components/common/StringCombobox";
import { compareValues, type SortKind, type SortState, type SortValue } from "@/utils/sort";

type ActiveTab = "my" | "primary" | "secondary" | "mentees" | "all-reviews";
type ViewMode = "grid" | "table";

// Sortable columns in the My Reviews table + their value extractors and type.
// Project/PM are plain alphabetical; project_code and cycle are alphanumeric
// (so "PRJ-9" sorts before "PRJ-10", "H1 FY25" before "H2 FY25"); rating is
// a numeric 1–5 string from the backend so gets numeric compare.
type MyReviewsSortKey =
  | "project_name"
  | "project_code"
  | "function_name"
  | "pm_name"
  | "cycle"
  | "review_status"
  | "performance_group";

const MY_REVIEWS_SORT_CONFIG: Record<
  MyReviewsSortKey,
  { kind: SortKind; get: (c: MyProjectCard) => SortValue }
> = {
  project_name:      { kind: "alpha",   get: (c) => c.project_name },
  project_code:      { kind: "natural", get: (c) => c.project_code },
  function_name:   { kind: "alpha",   get: (c) => c.function_name },
  pm_name:           { kind: "alpha",   get: (c) => c.pm_name },
  cycle:             { kind: "cycle",   get: (c) => c.cycle },
  review_status:     { kind: "alpha",   get: (c) => c.review_status },
  performance_group: { kind: "numeric", get: (c) => c.performance_group },
};

// Read-only review list (Mentor's mentees + HR's all-reviews) sort config.
type ReadOnlySortKey =
  | "employee_name"
  | "project_name"
  | "pm_name"
  | "cycle"
  | "status"
  | "performance_group";

const READ_ONLY_SORT_CONFIG: Record<
  ReadOnlySortKey,
  { kind: SortKind; get: (r: ProjectReviewResponse) => SortValue }
> = {
  employee_name:     { kind: "alpha",   get: (r) => r.employee_name },
  project_name:      { kind: "alpha",   get: (r) => r.project_name },
  pm_name:           { kind: "alpha",   get: (r) => r.pm_name ?? r.reviewer_name },
  cycle:             { kind: "cycle",   get: (r) => r.cycle },
  status:            { kind: "alpha",   get: (r) => r.status },
  performance_group: { kind: "numeric", get: (r) => r.performance_group },
};

const cardKey = (c: MyProjectCard) => `${c.project_id}-${c.cycle}`;

export function ProjectReviews() {
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const projectRatingsVisible = settings?.project_ratings_visible ?? false;

  // Role-based tab gating. The page used to drive everything off
  // `has_mentees`, which conflated "PM with a team" and "Mentor with
  // mentees" — wrong under the current taxonomy because Mentors are
  // not project reviewers.
  const isStaff = user?.role === "Staff";
  const isPM = user?.role === "PM";
  const isMentor = user?.role === "Mentor";
  const isHR = user?.role === "HR_MyOrg" || user?.role === "HR_Miltenyi";

  const [activeTab, setActiveTab] = useState<ActiveTab>("my");
  const [viewMode, setViewMode] = useState<ViewMode>("table");
  // Lazy-init from settings so we don't run a follow-up effect just to
  // copy `settings.active_cycle_name` into local state on first paint.
  const [selectedCycle, setSelectedCycle] = useState<string>(
    () => settings?.active_cycle_name ?? "",
  );
  const [selectedCardKey, setSelectedCardKey] = useState<string | null>(null);
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [pmFilter, setPmFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [projectFilter, setProjectFilter] = useState("all");
  const [sort, setSort] = useState<SortState<MyReviewsSortKey> | null>(null);

  // ── Queries ────────────────────────────────────────────────────────
  // Five role-gated queries. All register unconditionally to respect
  // the Rules of Hooks; `enabled` keeps each parked unless the current
  // role actually needs the data.
  //
  // The PM branch is conspicuously absent: PrimaryEvaluationTab (the
  // child component) owns its own pm-queue fetch. Migrating it to
  // useQuery is a follow-up PR; until then the PM flow stays
  // imperative inside that tab.
  const cardsQuery = useQuery({
    queryKey: queryKeys.projectReviews.mine(),
    queryFn: projectReviewService.getMyProjects,
    enabled: isStaff,
  });
  const expectationsQuery = useQuery({
    queryKey: queryKeys.projectReviews.roleExpectations(),
    queryFn: projectReviewService.getRoleExpectations,
    enabled: isStaff,
  });
  const menteeReviewsQuery = useQuery({
    queryKey: queryKeys.projectReviews.mentees(),
    queryFn: projectReviewService.getMenteeReviews,
    enabled: isMentor,
  });
  const allReviewsQuery = useQuery({
    queryKey: queryKeys.projectReviews.org(),
    queryFn: projectReviewService.getAllReviews,
    enabled: isHR,
  });

  // The secondary queue is a peek-at-the-count probe: we only need to
  // know "are there any rows?" to decide whether to render the tab
  // button. PMs and Mentors can never be Secondary (route validator
  // rejects them), so we gate the probe for them. As a bonus, when the
  // tab IS rendered and the user clicks it, SecondaryEvalTab can read
  // this same cache entry instead of refetching — the probe warms the
  // cache for the tab's own consumption.
  const canBeSecondary = !isPM && !isMentor;
  const secondaryQueueQuery = useQuery({
    queryKey: queryKeys.projectReviews.secondaryQueue(),
    queryFn: projectReviewService.getSecondaryQueue,
    enabled: canBeSecondary,
  });
  const hasSecondaryWork = (secondaryQueueQuery.data?.length ?? 0) > 0;

  // `?? []` defaults keep downstream code working with arrays.
  const cards = cardsQuery.data ?? [];
  const expectations = expectationsQuery.data ?? [];
  const menteeReviews = menteeReviewsQuery.data ?? [];
  const allReviews = allReviewsQuery.data ?? [];

  // `isLoading` follows the role-appropriate query's pending flag. PM
  // doesn't have a page-level query (their tab loads its own data), so
  // they get a hard `false` — the child tab handles its own loading
  // state.
  const isLoading = isStaff
    ? cardsQuery.isPending
    : isMentor
      ? menteeReviewsQuery.isPending
      : isHR
        ? allReviewsQuery.isPending
        : false;

  // Auto-switch to the role's primary tab once auth resolves.
  useEffect(() => {
    if (isPM) setActiveTab("primary");
    else if (isMentor) setActiveTab("mentees");
    else if (isHR) setActiveTab("all-reviews");
    else setActiveTab("my");
  }, [isPM, isMentor, isHR]);

  // ── Derived filter sources + filtered/sorted cards (memoised) ──────

  const availableCycles = useMemo(
    () =>
      Array.from(
        new Set(cards.map((c) => c.cycle).filter(Boolean) as string[]),
      ),
    [cards],
  );
  const availablePMs = useMemo(
    () =>
      Array.from(
        new Set(cards.map((c) => c.pm_name).filter(Boolean) as string[]),
      ),
    [cards],
  );
  const availableProjects = useMemo(
    () => Array.from(new Set(cards.map((c) => c.project_name))).sort(),
    [cards],
  );

  const filteredCards = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return cards.filter((c) => {
      if (selectedCycle && selectedCycle !== "all" && c.cycle !== selectedCycle)
        return false;
      if (pmFilter !== "all" && c.pm_name !== pmFilter) return false;
      if (statusFilter !== "all" && c.review_status !== statusFilter)
        return false;
      if (projectFilter !== "all" && c.project_name !== projectFilter)
        return false;
      if (q) {
        const matchesName = c.project_name.toLowerCase().includes(q);
        const matchesCode = c.project_code.toLowerCase().includes(q);
        if (!matchesName && !matchesCode) return false;
      }
      return true;
    });
  }, [cards, selectedCycle, pmFilter, statusFilter, projectFilter, searchQuery]);

  const sortedCards = useMemo(() => {
    if (!sort) return filteredCards;
    return filteredCards.slice().sort((a, b) => {
      const { kind, get } = MY_REVIEWS_SORT_CONFIG[sort.key];
      return compareValues(get(a), get(b), kind, sort.direction);
    });
  }, [filteredCards, sort]);

  // The selected card's validity is a function of the current filtered
  // set — derive instead of clearing via effect when filters change.
  const selectedCard =
    selectedCardKey === null
      ? null
      : sortedCards.find((c) => cardKey(c) === selectedCardKey) ?? null;
  const expandedRowVisible =
    expandedRowKey !== null &&
    sortedCards.some((c) => cardKey(c) === expandedRowKey);

  const tabCls = (tab: ActiveTab) =>
    `px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
      activeTab === tab
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  // Header text follows the active tab so Staff / HR who flip into the
  // Secondary tab see context that matches what they're doing.
  const headerTitle =
    activeTab === "primary"
      ? "Primary Evaluation"
      : activeTab === "secondary"
        ? "Secondary Evaluation"
        : activeTab === "mentees"
          ? "Team Review"
          : activeTab === "all-reviews"
            ? "All Project Reviews"
            : "My Project Reviews";
  const headerSubtitle =
    activeTab === "primary"
      ? "Provide feedback for projects and team members."
      : activeTab === "secondary"
        ? "Add an impact statement for projects where you are the Secondary evaluator."
        : activeTab === "mentees"
          ? "View your mentees' project reviews across cycles."
          : activeTab === "all-reviews"
            ? "View-only access to every project review across the org."
            : "Track your project review status across cycles.";

  return (
    <div className="flex flex-col gap-6 pb-10 animate-in fade-in duration-500">
      {/* ── Page Header ── */}
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">
          {headerTitle}
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">{headerSubtitle}</p>
      </div>

      {/* ── Main Content Container ── */}
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
          {isPM && (
            <button
              type="button"
              className={tabCls("primary")}
              onClick={() => setActiveTab("primary")}
            >
              Primary Evaluation
            </button>
          )}
          {isMentor && (
            <button
              type="button"
              className={tabCls("mentees")}
              onClick={() => setActiveTab("mentees")}
            >
              Team Review
            </button>
          )}
          {isHR && (
            <button
              type="button"
              className={tabCls("all-reviews")}
              onClick={() => setActiveTab("all-reviews")}
            >
              All Reviews
            </button>
          )}
          {hasSecondaryWork && (
            <button
              type="button"
              className={tabCls("secondary")}
              onClick={() => setActiveTab("secondary")}
            >
              Secondary Evaluation
            </button>
          )}
        </div>

        <div className="p-5">
          {isStaff && activeTab === "my" && (
            <div className="flex flex-col gap-5">
              {!isLoading && cards.length > 0 && (
                <MyReviewsToolbar
                  searchQuery={searchQuery}
                  onSearchChange={setSearchQuery}
                  viewMode={viewMode}
                  onViewModeChange={setViewMode}
                  selectedCycle={selectedCycle}
                  onSelectedCycleChange={setSelectedCycle}
                  availableCycles={availableCycles}
                  projectFilter={projectFilter}
                  onProjectFilterChange={setProjectFilter}
                  availableProjects={availableProjects}
                  pmFilter={pmFilter}
                  onPmFilterChange={setPmFilter}
                  availablePMs={availablePMs}
                  statusFilter={statusFilter}
                  onStatusFilterChange={setStatusFilter}
                />
              )}

              {renderMyReviewsBody({
                isLoading,
                viewMode,
                cardsCount: cards.length,
                filteredCount: filteredCards.length,
                sortedCards,
                selectedCardKey,
                onSelectCard: (key) =>
                  setSelectedCardKey(selectedCardKey === key ? null : key),
                selectedCard,
                expandedRowKey: expandedRowVisible ? expandedRowKey : null,
                onToggleExpandedRow: (key) =>
                  setExpandedRowKey(expandedRowKey === key ? null : key),
                onClearSelection: () => setSelectedCardKey(null),
                expectations,
                projectRatingsVisible,
                sort,
                onSort: setSort,
              })}
            </div>
          )}

          {isPM && activeTab === "primary" && <PrimaryEvaluationTab />}

          {activeTab === "secondary" && hasSecondaryWork && <SecondaryEvalTab />}

          {isMentor && activeTab === "mentees" && (
            <ReadOnlyReviewsList
              isLoading={isLoading}
              reviews={menteeReviews}
              projectRatingsVisible={projectRatingsVisible}
              employeeColumnLabel="Mentee"
              emptyTitle="No mentee project reviews yet"
              emptySubtitle="Reviews will appear here once your mentees are assigned to a project and the PM has started evaluating."
            />
          )}

          {isHR && activeTab === "all-reviews" && (
            <ReadOnlyReviewsList
              isLoading={isLoading}
              reviews={allReviews}
              // HR can see project ratings any time — the system-wide
              // project_ratings_visible toggle is a Staff-facing gate
              // and shouldn't blind HR's own org-wide review.
              projectRatingsVisible={true}
              employeeColumnLabel="Employee"
              emptyTitle="No project reviews recorded"
              emptySubtitle="Reviews will appear here once PMs start evaluating their teams."
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Read-only review list (Mentor + HR) ────────────────────────────

function ReadOnlyReviewsList({
  isLoading,
  reviews,
  projectRatingsVisible,
  employeeColumnLabel,
  emptyTitle,
  emptySubtitle,
}: {
  readonly isLoading: boolean;
  readonly reviews: ProjectReviewResponse[];
  readonly projectRatingsVisible: boolean;
  readonly employeeColumnLabel: string;
  readonly emptyTitle: string;
  readonly emptySubtitle: string;
}) {
  const [cycleFilter, setCycleFilter] = useState<string>("all");
  // Employee + Project use typeable StringCombobox — empty string = no filter
  // (its convention), the other dropdowns stay as plain selects with "all".
  // The standalone search bar was dropped once Employee/Project became
  // typeable; project_code search died with it but is rarely the way HR
  // looks for a project anyway.
  const [projectFilter, setProjectFilter] = useState<string>("");
  const [pmFilter, setPmFilter] = useState<string>("all");
  const [employeeFilter, setEmployeeFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sort, setSort] = useState<SortState<ReadOnlySortKey> | null>(null);
  // Read-only modal target. Mentors and HR both need a way to read the
  // PM's competency comments + impact statement, not just the rating —
  // setting this opens the detail modal in place.
  const [viewTarget, setViewTarget] = useState<ProjectReviewResponse | null>(null);

  const cycles = useMemo(
    () =>
      Array.from(new Set(reviews.map((r) => r.cycle).filter(Boolean))).sort(
        (a, b) => b.localeCompare(a),
      ),
    [reviews],
  );
  const projects = useMemo(
    () =>
      Array.from(
        new Set(reviews.map((r) => r.project_name).filter(Boolean)),
      ).sort(),
    [reviews],
  );
  const pms = useMemo(
    () =>
      Array.from(
        new Set(
          reviews
            .map((r) => r.pm_name ?? r.reviewer_name ?? null)
            .filter((n): n is string => !!n),
        ),
      ).sort(),
    [reviews],
  );
  const employees = useMemo(
    () =>
      Array.from(
        new Set(reviews.map((r) => r.employee_name).filter(Boolean)),
      ).sort(),
    [reviews],
  );

  const filtered = useMemo(() => {
    return reviews.filter((r) => {
      if (cycleFilter !== "all" && r.cycle !== cycleFilter) return false;
      if (projectFilter && r.project_name !== projectFilter) return false;
      if (pmFilter !== "all" && (r.pm_name ?? r.reviewer_name) !== pmFilter) return false;
      if (employeeFilter && r.employee_name !== employeeFilter) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      return true;
    });
  }, [reviews, cycleFilter, projectFilter, pmFilter, employeeFilter, statusFilter]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    return filtered.slice().sort((a, b) => {
      const { kind, get } = READ_ONLY_SORT_CONFIG[sort.key];
      return compareValues(get(a), get(b), kind, sort.direction);
    });
  }, [filtered, sort]);

  if (isLoading) {
    return <TableSkeleton />;
  }
  if (reviews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
        <Briefcase
          className="h-10 w-10 text-text-muted mb-3"
          aria-hidden="true"
        />
        <p className="font-display text-base font-medium text-text-main">
          {emptyTitle}
        </p>
        <p className="mt-1 text-sm text-text-muted">{emptySubtitle}</p>
      </div>
    );
  }

  const filterLabelCls =
    "text-[11px] font-bold uppercase tracking-wider text-text-muted";
  const filterSelectCls =
    "rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";

  return (
    <div className="flex flex-col gap-4">
      {/* Filter toolbar — search + per-column dropdowns. The same set
          drives both the Mentor view ("Mentees' Reviews") and the HR
          view ("All Reviews"); all dropdowns derive their options
          from the loaded rows so empty options never appear. */}
      <div className="flex items-start justify-between gap-4">
       <div className="flex items-center gap-4 flex-wrap flex-1 min-w-0">
          {employees.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="ro-employee-filter" className={filterLabelCls}>
                {employeeColumnLabel}
              </label>
              <StringCombobox
                id="ro-employee-filter"
                options={employees}
                value={employeeFilter}
                onChange={setEmployeeFilter}
                placeholder="Type a name…"
              />
            </div>
          )}
          {projects.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="ro-project-filter" className={filterLabelCls}>
                Project
              </label>
              <StringCombobox
                id="ro-project-filter"
                options={projects}
                value={projectFilter}
                onChange={setProjectFilter}
                placeholder="Type a project…"
              />
            </div>
          )}
          {pms.length > 0 && (
            <div className="flex items-center gap-2">
              <label htmlFor="ro-pm-filter" className={filterLabelCls}>
                PM
              </label>
              <select
                id="ro-pm-filter"
                value={pmFilter}
                onChange={(e) => setPmFilter(e.target.value)}
                className={`${filterSelectCls} min-w-[140px]`}
              >
                <option value="all">All</option>
                {pms.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </div>
          )}
          <div className="flex items-center gap-2">
            <label htmlFor="ro-cycle-filter" className={filterLabelCls}>
              Cycle
            </label>
            <select
              id="ro-cycle-filter"
              value={cycleFilter}
              onChange={(e) => setCycleFilter(e.target.value)}
              className={`${filterSelectCls} min-w-[120px]`}
            >
              <option value="all">All</option>
              {cycles.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="ro-status-filter" className={filterLabelCls}>
              Status
            </label>
            <select
              id="ro-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={`${filterSelectCls} min-w-[120px]`}
            >
              <option value="all">All</option>
              <option value="pending">Pending PM</option>
              <option value="reviewed">Reviewed</option>
            </select>
          </div>
          <span className="text-xs text-text-muted">
            {filtered.length} of {reviews.length}
          </span>
         </div>
         <div className="shrink-0">
           <ExportExcelButton kind="project-reviews" />
         </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-slate-50/80 border-b border-border">
              <th className="text-left px-5 py-2.5">
                <SortableHeader label="Project" columnKey="project_name" sort={sort} onSort={setSort} />
              </th>
              <th className="text-left px-4 py-2.5">
                <SortableHeader
                  label={employeeColumnLabel}
                  columnKey="employee_name"
                  sort={sort}
                  onSort={setSort}
                />
              </th>
              <th className="text-left px-4 py-2.5">
                <SortableHeader label="PM" columnKey="pm_name" sort={sort} onSort={setSort} />
              </th>
              <th className="text-left px-4 py-2.5">
                <SortableHeader label="Cycle" columnKey="cycle" sort={sort} onSort={setSort} />
              </th>
              <th className="text-left px-4 py-2.5">
                <SortableHeader label="Status" columnKey="status" sort={sort} onSort={setSort} />
              </th>
              <th className="text-left px-4 py-2.5">
                <SortableHeader label="Rating" columnKey="performance_group" sort={sort} onSort={setSort} />
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center">
                  <Search className="h-6 w-6 text-text-muted mx-auto mb-1" aria-hidden="true" />
                  <p className="text-[13px] text-text-main font-medium">No matching reviews</p>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    Try adjusting your filters or search query.
                  </p>
                </td>
              </tr>
            ) : sorted.map((r) => {
              const isReviewed = r.status === "reviewed";
              return (
                <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3">
                    <div className="font-medium text-text-main">
                      {r.project_name}
                    </div>
                    <div className="font-mono text-[11px] text-text-muted">
                      {r.project_code}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-medium text-text-main">
                    {r.employee_name}
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {r.pm_name ?? r.reviewer_name ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                      {r.cycle}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {isReviewed ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold uppercase text-green-700">
                        <CheckCircle2 className="h-3 w-3" /> Reviewed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-700">
                        <Clock className="h-3 w-3" /> Pending PM
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {!projectRatingsVisible ? (
                      <span className="inline-flex items-center gap-1 text-[11px] text-text-muted/60">
                        <Lock className="h-3 w-3" /> Hidden
                      </span>
                    ) : (
                      <PerformanceRatingBadge value={r.performance_group} />
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isReviewed ? (
                      <button
                        type="button"
                        onClick={() => setViewTarget(r)}
                        className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-text-muted hover:bg-brand/10 hover:text-brand transition-colors"
                      >
                        <Eye className="h-3 w-3" /> View
                      </button>
                    ) : (
                      <span className="text-[11px] italic text-text-muted/70">
                        Awaiting PM
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Read-only review detail modal — opened from the View button.
          The row payload already carries every field the modal renders,
          so this is purely a presentation step (no extra fetch). */}
      {viewTarget && (
        <ProjectReviewDetailModal
          review={viewTarget}
          onClose={() => setViewTarget(null)}
        />
      )}
    </div>
  );
}

// ── Render helpers ─────────────────────────────────────────────────

function renderMyReviewsBody(args: {
  isLoading: boolean;
  viewMode: ViewMode;
  cardsCount: number;
  filteredCount: number;
  sortedCards: MyProjectCard[];
  selectedCardKey: string | null;
  onSelectCard: (key: string) => void;
  selectedCard: MyProjectCard | null;
  expandedRowKey: string | null;
  onToggleExpandedRow: (key: string) => void;
  onClearSelection: () => void;
  expectations: RoleExpectation[];
  projectRatingsVisible: boolean;
  sort: SortState<MyReviewsSortKey> | null;
  onSort: (s: SortState<MyReviewsSortKey> | null) => void;
}) {
  const {
    isLoading,
    viewMode,
    cardsCount,
    filteredCount,
    sortedCards,
    selectedCardKey,
    onSelectCard,
    selectedCard,
    expandedRowKey,
    onToggleExpandedRow,
    onClearSelection,
    expectations,
    projectRatingsVisible,
    sort,
    onSort,
  } = args;

  if (isLoading) {
    return viewMode === "grid" ? <GridSkeleton /> : <TableSkeleton />;
  }
  if (cardsCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
        <Briefcase
          className="h-10 w-10 text-text-muted mb-3"
          aria-hidden="true"
        />
        <p className="font-display text-base font-medium text-text-main">
          No projects assigned
        </p>
        <p className="mt-1 text-sm text-text-muted">
          You'll see your project evaluations here once HR assigns them.
        </p>
      </div>
    );
  }
  if (filteredCount === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-12 text-center bg-background/50">
        <Search className="h-8 w-8 text-text-muted mb-2" aria-hidden="true" />
        <p className="font-display text-sm font-medium text-text-main">
          No matching reviews
        </p>
        <p className="mt-1 text-xs text-text-muted">
          Try adjusting your filters or search query.
        </p>
      </div>
    );
  }
  if (viewMode === "grid") {
    return (
      <>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sortedCards.map((card) => {
            const key = cardKey(card);
            return (
              <ProjectSummaryCard
                key={key}
                card={card}
                isSelected={selectedCardKey === key}
                onClick={() => onSelectCard(key)}
              />
            );
          })}
        </div>

        {selectedCard && (
          <ReviewDetailPanel
            key={selectedCardKey}
            card={selectedCard}
            expectations={expectations}
            onClose={onClearSelection}
          />
        )}
      </>
    );
  }
  // Table view
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="bg-slate-50/80 border-b border-border">
            <th className="text-left px-5 py-2.5">
              <SortableHeader
                label="Project"
                columnKey="project_name"
                sort={sort}
                onSort={onSort}
              />
            </th>
            <th className="text-left px-4 py-2.5">
              <SortableHeader
                label="Code"
                columnKey="project_code"
                sort={sort}
                onSort={onSort}
              />
            </th>
            <th className="text-left px-4 py-2.5">
              <SortableHeader
                label="Function"
                columnKey="function_name"
                sort={sort}
                onSort={onSort}
              />
            </th>
            <th className="hidden sm:table-cell text-left px-4 py-2.5">
              <SortableHeader
                label="PM"
                columnKey="pm_name"
                sort={sort}
                onSort={onSort}
              />
            </th>
            <th className="text-left px-4 py-2.5">
              <SortableHeader
                label="Cycle"
                columnKey="cycle"
                sort={sort}
                onSort={onSort}
              />
            </th>
            <th className="text-left px-4 py-2.5">
              <SortableHeader
                label="Status"
                columnKey="review_status"
                sort={sort}
                onSort={onSort}
              />
            </th>
            <th className="text-left px-4 py-2.5">
              <SortableHeader
                label="Rating"
                columnKey="performance_group"
                sort={sort}
                onSort={onSort}
              />
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {sortedCards.map((card) => {
            const key = cardKey(card);
            const isExpanded = expandedRowKey === key;
            const isReviewed = card.review_status === "reviewed";

            return (
              <Fragment key={key}>
                <tr
                  className={`transition-colors cursor-pointer ${
                    isExpanded ? "bg-brand/5" : "hover:bg-slate-50/60"
                  }`}
                  onClick={() => onToggleExpandedRow(key)}
                >
                  <td className="px-5 py-3 font-medium text-text-main">
                    <div className="flex items-center gap-2">
                      <ChevronDown
                        className={`h-4 w-4 text-text-muted shrink-0 transition-transform duration-200 ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                      />
                      {card.project_name}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-text-muted text-[12px]">
                    {card.project_code}
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {card.function_name ?? "—"}
                  </td>
                  <td className="hidden sm:table-cell px-4 py-3 text-text-muted">
                    {card.pm_name ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                      {card.cycle ?? "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {isReviewed ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold uppercase text-green-700">
                        <CheckCircle2 className="h-3 w-3" /> Reviewed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-700">
                        <Clock className="h-3 w-3" /> Pending
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{renderRatingCell(card, projectRatingsVisible)}</td>
                </tr>
                {isExpanded && (
                  <TableExpandedRow card={card} expectations={expectations} />
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function renderRatingCell(card: MyProjectCard, visible: boolean) {
  if (!visible) {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] text-text-muted/60">
        <Lock className="h-3 w-3" /> Hidden
      </span>
    );
  }
  return <PerformanceRatingBadge value={card.performance_group} />;
}
