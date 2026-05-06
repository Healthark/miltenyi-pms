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

import { useState, useEffect, useCallback, useMemo, Fragment } from "react";
import {
  Briefcase,
  CheckCircle2,
  Clock,
  Lock,
  Search,
  ChevronDown,
} from "lucide-react";
import {
  projectReviewService,
  type MyProjectCard,
  type ProjectReviewResponse,
  type RoleExpectation,
} from "../services/project-review.service";
import { useAuth } from "../hooks/useAuth";
import { useSystemSettings } from "../hooks/useSystemSettings";
import { PrimaryEvaluationTab } from "../components/project-reviews/PrimaryEvaluationTab";
import { SecondaryEvalTab } from "../components/project-reviews/SecondaryEvalTab";
import { ProjectSummaryCard } from "../components/project-reviews/ProjectSummaryCard";
import { ReviewDetailPanel } from "../components/project-reviews/ReviewDetailPanel";
import { TableExpandedRow } from "../components/project-reviews/TableExpandedRow";
import { MyReviewsToolbar } from "../components/project-reviews/MyReviewsToolbar";
import {
  GridSkeleton,
  TableSkeleton,
} from "../components/project-reviews/MyReviewsSkeletons";
import { SortableHeader } from "../components/SortableHeader";
import { compareValues, type SortKind, type SortState } from "../utils/sort";

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
  { kind: SortKind; get: (c: MyProjectCard) => unknown }
> = {
  project_name:      { kind: "alpha",   get: (c) => c.project_name },
  project_code:      { kind: "natural", get: (c) => c.project_code },
  function_name:   { kind: "alpha",   get: (c) => c.function_name },
  pm_name:           { kind: "alpha",   get: (c) => c.pm_name },
  cycle:             { kind: "cycle",   get: (c) => c.cycle },
  review_status:     { kind: "alpha",   get: (c) => c.review_status },
  performance_group: { kind: "numeric", get: (c) => c.performance_group },
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

  const [cards, setCards] = useState<MyProjectCard[]>([]);
  const [menteeReviews, setMenteeReviews] = useState<ProjectReviewResponse[]>([]);
  const [allReviews, setAllReviews] = useState<ProjectReviewResponse[]>([]);
  const [expectations, setExpectations] = useState<RoleExpectation[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Probe the secondary queue once at mount. Drives visibility of the
  // "Secondary Evaluation" tab — Staff and HR who are listed as
  // `Project.secondary_evaluator_id` on at least one project. PMs are
  // blocked from being Secondary by the route validator, and Mentors
  // can't be Secondary either, so we skip the call for them.
  const canBeSecondary = !isPM && !isMentor;
  const [hasSecondaryWork, setHasSecondaryWork] = useState(false);
  useEffect(() => {
    if (!canBeSecondary) {
      setHasSecondaryWork(false);
      return;
    }
    let cancelled = false;
    void projectReviewService
      .getSecondaryQueue()
      .then((rows) => { if (!cancelled) setHasSecondaryWork(rows.length > 0); })
      .catch(() => { if (!cancelled) setHasSecondaryWork(false); });
    return () => { cancelled = true; };
  }, [canBeSecondary]);

  // Auto-switch to the role's primary tab once auth resolves.
  useEffect(() => {
    if (isPM) setActiveTab("primary");
    else if (isMentor) setActiveTab("mentees");
    else if (isHR) setActiveTab("all-reviews");
    else setActiveTab("my");
  }, [isPM, isMentor, isHR]);

  // Load Staff data (own project cards + role expectations for the modal).
  const loadStaffData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [projectsData, expectationsData] = await Promise.all([
        projectReviewService.getMyProjects(),
        projectReviewService.getRoleExpectations(),
      ]);
      setCards(projectsData);
      setExpectations(expectationsData);
    } catch {
      // Stays empty on error
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load Mentor data (read-only mentee project reviews).
  const loadMentorData = useCallback(async () => {
    setIsLoading(true);
    try {
      const reviews = await projectReviewService.getMenteeReviews();
      setMenteeReviews(reviews);
    } catch {
      // Stays empty on error
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Load HR data (read-only org-wide project reviews, every cycle).
  const loadHRData = useCallback(async () => {
    setIsLoading(true);
    try {
      const reviews = await projectReviewService.getAllReviews();
      setAllReviews(reviews);
    } catch {
      // Stays empty on error
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isStaff) void loadStaffData();
    else if (isMentor) void loadMentorData();
    else if (isHR) void loadHRData();
    else setIsLoading(false); // PM uses PrimaryEvaluationTab which loads itself
  }, [isStaff, isMentor, isHR, loadStaffData, loadMentorData, loadHRData]);

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
              projectRatingsVisible={projectRatingsVisible}
              employeeColumnLabel="Employee"
              emptyTitle="No project reviews recorded"
              emptySubtitle="Reviews will appear here once PMs start evaluating their teams."
              showCycleFilter
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
  showCycleFilter = false,
}: {
  readonly isLoading: boolean;
  readonly reviews: ProjectReviewResponse[];
  readonly projectRatingsVisible: boolean;
  readonly employeeColumnLabel: string;
  readonly emptyTitle: string;
  readonly emptySubtitle: string;
  /** When true, show a Cycle dropdown above the table (defaults to "all"). */
  readonly showCycleFilter?: boolean;
}) {
  const [cycleFilter, setCycleFilter] = useState<string>("all");

  const cycles = useMemo(
    () =>
      Array.from(new Set(reviews.map((r) => r.cycle).filter(Boolean))).sort(
        (a, b) => b.localeCompare(a),
      ),
    [reviews],
  );

  const filtered = useMemo(() => {
    if (!showCycleFilter || cycleFilter === "all") return reviews;
    return reviews.filter((r) => r.cycle === cycleFilter);
  }, [reviews, cycleFilter, showCycleFilter]);

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

  return (
    <div className="flex flex-col gap-4">
      {showCycleFilter && cycles.length > 0 && (
        <div className="flex items-center gap-2">
          <label
            htmlFor="ro-cycle-filter"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            Cycle
          </label>
          <select
            id="ro-cycle-filter"
            value={cycleFilter}
            onChange={(e) => setCycleFilter(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer"
          >
            <option value="all">All Cycles</option>
            {cycles.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span className="text-xs text-text-muted">
            {filtered.length} of {reviews.length}
          </span>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-slate-50/80 border-b border-border">
              <th className="text-left px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                {employeeColumnLabel}
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Project
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                PM
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Cycle
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Status
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Rating
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filtered.map((r) => {
              const isReviewed = r.status === "reviewed";
              return (
                <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                  <td className="px-5 py-3 font-medium text-text-main">
                    {r.employee_name}
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-text-main">
                      {r.project_name}
                    </div>
                    <div className="font-mono text-[11px] text-text-muted">
                      {r.project_code}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    {r.reviewer_name ?? "—"}
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
                    ) : r.performance_group ? (
                      <span className="font-semibold text-text-main">
                        {r.performance_group}
                      </span>
                    ) : (
                      <span className="text-text-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
  if (card.performance_group) {
    return (
      <span className="font-semibold text-text-main">
        {card.performance_group}
      </span>
    );
  }
  return <span className="text-text-muted">—</span>;
}
