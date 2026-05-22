/**
 * ProjectReviews.tsx — Project Reviews Page (per-role tabs).
 *
 * Tabs are role-gated:
 *   My Reviews            — Employee, expands rows into ReviewDetailPanel /
 *                           TableExpandedRow.
 *   Primary Evaluation    — PM, owned by `PrimaryEvaluationTab`.
 *   Secondary Evaluation  — anyone listed as `Project.secondary_evaluator_id`
 *                           on at least one project (Employee / HR), owned by
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

import { useMemo, useRef, useState, Fragment } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
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
  type AllProjectReviewsFilters,
  type AllProjectReviewsSortBy,
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
  const isEmployee = user?.role === "Employee";
  const isPM = user?.role === "PM";
  const isMentor = user?.role === "Mentor";
  const isHR = user?.role === "HR_MyOrg" || user?.role === "HR_Miltenyi";

  // Role-driven default tab + explicit-click override (see AnnualReviews
  // for the same pattern). `null` ⇒ "no click yet, honour the default".
  const [userPickedTab, setUserPickedTab] = useState<ActiveTab | null>(null);
  const defaultTab: ActiveTab = isPM
    ? "primary"
    : isMentor
      ? "mentees"
      : isHR
        ? "all-reviews"
        : "my";
  const activeTab = userPickedTab ?? defaultTab;
  const setActiveTab = setUserPickedTab;
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
    enabled: isEmployee,
  });
  const expectationsQuery = useQuery({
    queryKey: queryKeys.projectReviews.roleExpectations(),
    queryFn: projectReviewService.getRoleExpectations,
    enabled: isEmployee,
  });
  const menteeReviewsQuery = useQuery({
    queryKey: queryKeys.projectReviews.mentees(),
    queryFn: projectReviewService.getMenteeReviews,
    enabled: isMentor,
  });
  // Paginated as of PR #39 (doc 22). Same useInfiniteQuery template as
  // PR #36's /annual-reviews/all: each row = one ProjectReview, so
  // `total` and `items.length` are the same unit.
  //
  // ── Server-side filters (PR #45, doc 28) ─────────────────────────
  // Filter state lives at this page-level so it can be baked into the
  // queryKey. Each distinct filter set is its own cache entry; changing
  // a filter triggers a fresh paginated fetch from offset=0. ReadOnly-
  // ReviewsList consumes the filter state + setter via optional props
  // (the Mentor consumer doesn't pass them and keeps its legacy
  // local-state behavior — it's not paginated).
  //
  // - initialPageParam: 0  → first request: ?offset=0&limit=50
  // - getNextPageParam: derives from has_more on the latest page.
  // - enabled: isHR  → Mentor and Employee don't pre-fetch this; HR's
  //                     mentees query has its own key + observer.
  const ALL_REVIEWS_PAGE_SIZE = 50;
  const [allReviewsFilters, setAllReviewsFilters] =
    useState<AllProjectReviewsFilters>({});
  const [allReviewsSort, setAllReviewsSort] = useState<
    SortState<ReadOnlySortKey> | null
  >(null);
  // Strip empty / undefined values so cache keys for "no filter X" and
  // "filter X = '' " collapse to the same entry. See doc 26 Part 2's
  // "empty-filters trap" for the rationale.
  const allReviewsFilterParams: Record<string, string> = Object.fromEntries(
    Object.entries(allReviewsFilters).filter(
      ([, v]) => v !== undefined && v !== "",
    ),
  ) as Record<string, string>;
  // Merge sort into request params (doc 30 Part 1).
  const allReviewsRequestParams: Record<string, string> = {
    ...allReviewsFilterParams,
    ...(allReviewsSort
      ? { sort_by: allReviewsSort.key, sort_dir: allReviewsSort.direction }
      : {}),
  };
  const allReviewsQuery = useInfiniteQuery({
    queryKey: queryKeys.projectReviews.org(allReviewsRequestParams),
    queryFn: ({ pageParam }) =>
      projectReviewService.getAllReviews({
        ...(allReviewsRequestParams as Record<string, string> & {
          sort_by?: AllProjectReviewsSortBy;
        }),
        limit: ALL_REVIEWS_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.offset + lastPage.limit : undefined,
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

  // `?? []` defaults keep downstream code working with arrays. Memoised
  // so the fallback doesn't manufacture a fresh array each render —
  // every downstream useMemo depending on `cards`/`expectations`/
  // `menteeReviews` would otherwise rebuild on every render.
  const cards = useMemo(
    () => cardsQuery.data ?? [],
    [cardsQuery.data],
  );
  const expectations = useMemo(
    () => expectationsQuery.data ?? [],
    [expectationsQuery.data],
  );
  const menteeReviews = useMemo(
    () => menteeReviewsQuery.data ?? [],
    [menteeReviewsQuery.data],
  );
  // Flatten loaded pages → review array (PR #39). Downstream filter /
  // sort / virtualizer code reads one combined list.
  const allReviews =
    allReviewsQuery.data?.pages.flatMap((p) => p.items) ?? [];
  // Total review count across all pages — read off the latest page
  // (server returns the same value on every paginated response).
  // Drives the "Loaded N of T" counter alongside the Load More button.
  const allReviewsTotal =
    allReviewsQuery.data?.pages[allReviewsQuery.data.pages.length - 1]?.total ?? 0;

  // `isLoading` follows the role-appropriate query's pending flag. PM
  // doesn't have a page-level query (their tab loads its own data), so
  // they get a hard `false` — the child tab handles its own loading
  // state.
  const isLoading = isEmployee
    ? cardsQuery.isPending
    : isMentor
      ? menteeReviewsQuery.isPending
      : isHR
        ? allReviewsQuery.isPending
        : false;

  // Tab auto-selection now lives in the derived `defaultTab` + `activeTab`
  // computation above — no effect needed.

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

  // Header text follows the active tab so Employee / HR who flip into the
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
            : "Track your project reviews across cycles.";

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
          {isEmployee && (
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
          {isEmployee && activeTab === "my" && (
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
            <>
              <ReadOnlyReviewsList
                isLoading={isLoading}
                reviews={allReviews}
                // HR can see project ratings any time — the system-wide
                // project_ratings_visible toggle is an Employee-facing gate
                // and shouldn't blind HR's own org-wide review.
                projectRatingsVisible={true}
                employeeColumnLabel="Employee"
                emptyTitle="No project reviews recorded"
                emptySubtitle="Reviews will appear here once PMs start evaluating their teams."
                // Server-side filter mode (PR #45, doc 28) + sort
                // mode (PR #48, doc 31). Passing these triggers the
                // controlled code paths in ReadOnlyReviewsList; the
                // Mentor consumer below continues to use local state.
                filters={allReviewsFilters}
                onFiltersChange={setAllReviewsFilters}
                serverTotal={allReviewsTotal}
                sort={allReviewsSort}
                onSortChange={setAllReviewsSort}
              />

              {/* Load More — outside ReadOnlyReviewsList because that
                  component stays pure (presentational only) and is
                  also used by Mentor's mentee-reviews view, which
                  isn't paginated. Hidden when the server reports no
                  more pages. `rows.length` and `allReviewsTotal` are
                  the same unit (review rows) so the counter is terse
                  — unlike doc 20 where the unit shift required
                  explicit "employees" labelling. */}
              {allReviewsQuery.hasNextPage && (
                <div className="mt-4 flex items-center gap-3 justify-center">
                  <button
                    type="button"
                    onClick={() => {
                      void allReviewsQuery.fetchNextPage();
                    }}
                    disabled={allReviewsQuery.isFetchingNextPage}
                    className="inline-flex items-center gap-2 rounded-lg border border-border bg-white px-4 py-2 text-[13px] font-medium text-text-main hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                  >
                    {allReviewsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
                  </button>
                  <span className="text-xs text-text-muted">
                    Loaded {allReviews.length} of {allReviewsTotal}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Read-only review list (Mentor + HR) ────────────────────────────

// Shared CSS Grid layout for the 7-column virtualized read-only review
// list. `minmax(floor, weight)` keeps narrow columns readable and lets
// wide ones expand to fill space.
//
// Column shape:
//   1. Project (name + code — two visible lines, widest)
//   2. Employee/Mentee (medium)
//   3. PM (medium)
//   4. Cycle (badge)
//   5. Status (badge with icon)
//   6. Rating (badge or Lock indicator)
//   7. Actions (View button or "Awaiting PM" italic text)
const READ_ONLY_GRID_TEMPLATE_COLUMNS =
  "minmax(220px, 2.2fr) minmax(140px, 1.4fr) minmax(140px, 1.4fr) " +
  "minmax(100px, 1fr) minmax(120px, 1.1fr) minmax(120px, 1.1fr) " +
  "minmax(100px, 0.9fr)";

// Sum of the READ_ONLY_GRID_TEMPLATE_COLUMNS minimums plus a little
// breathing room. Drives the table's min-width so the outer horizontal-
// scroll wrapper engages BEFORE the body's implicit overflow-x (legacy
// CSS pairing for overflow-y: auto) does — otherwise the body scrolls
// horizontally on its own and the header stays put. Mirrors the same
// fix in ManagementReview.tsx.
const READ_ONLY_TABLE_MIN_WIDTH_PX = 1000;

// Starting guess for the collapsed row height (project cell's 2-line
// content + py-3 padding ≈ 60-64px). measureElement corrects after
// render — most rows are uniform, but long project names can wrap and
// push the height higher. Using variable-height pattern from PR #16
// to handle that edge case correctly.
//
// Note: this table has NO inline expansion (the View button opens a
// MODAL, not an inline panel). We could have used fixed-height
// virtualization like PR #15. We chose variable-height anyway because
// (a) project names can wrap, (b) it keeps the codebase consistent
// with PR #16's template, (c) the cost vs fixed-height is minimal.
const READ_ONLY_ESTIMATE_ROW_PX = 64;

const READ_ONLY_SCROLL_HEIGHT_PX = 600;
const READ_ONLY_OVERSCAN = 6;

function ReadOnlyReviewsList({
  isLoading,
  reviews,
  projectRatingsVisible,
  employeeColumnLabel,
  emptyTitle,
  emptySubtitle,
  filters,
  onFiltersChange,
  serverTotal,
  sort: controlledSort,
  onSortChange,
}: {
  readonly isLoading: boolean;
  readonly reviews: ProjectReviewResponse[];
  readonly projectRatingsVisible: boolean;
  readonly employeeColumnLabel: string;
  readonly emptyTitle: string;
  readonly emptySubtitle: string;
  /** Controlled-mode filter state. Pass together with
   *  `onFiltersChange` (HR consumer, PR #45 / doc 28). When BOTH are
   *  omitted the component falls back to local state (Mentor consumer
   *  which isn't paginated). When provided, the component skips its
   *  client-side filter loop — `reviews` is assumed to already match
   *  the active filter set (server-filtered). */
  readonly filters?: AllProjectReviewsFilters;
  /** Setter for the controlled-mode filter state. */
  readonly onFiltersChange?: (next: AllProjectReviewsFilters) => void;
  /** Server-side count of reviews matching the active filter set.
   *  Provided in controlled mode so the counter reads filtered total
   *  (matching what Load More pages through) instead of the loaded
   *  array length. */
  readonly serverTotal?: number;
  /** Controlled-mode sort state (PR #48, doc 31). Pass together with
   *  `onSortChange`. When both omitted, falls back to local state
   *  (Mentor consumer's client-side sort). */
  readonly sort?: SortState<ReadOnlySortKey> | null;
  /** Setter for the controlled-mode sort. */
  readonly onSortChange?: (next: SortState<ReadOnlySortKey> | null) => void;
}) {
  // Local fallback state — used only when the parent doesn't pass
  // `filters` + `onFiltersChange`. Mentor's mentees view is the
  // current uncontrolled consumer (not paginated). Three legacy
  // sentinels remain (`""` for combobox, `"all"` for select) so the
  // local-state path keeps the existing UI conventions; the
  // controlled-mode `filters` object uses `undefined` for "no filter
  // applied" (matching the pattern from docs 26 + 27).
  const [localFilters, setLocalFilters] = useState<AllProjectReviewsFilters>(
    {},
  );
  const isControlled = filters !== undefined && onFiltersChange !== undefined;
  const activeFilters: AllProjectReviewsFilters = filters ?? localFilters;
  const setActiveFilters = onFiltersChange ?? setLocalFilters;
  // Boolean used by counter + empty-state branching to decide which
  // narrative to show. In controlled mode this means "server-filtered
  // and at least one dim is non-empty"; in uncontrolled mode it means
  // "user has narrowed via the local dropdowns".
  const hasActiveFilters = Object.values(activeFilters).some(
    (v) => v !== undefined && v !== "",
  );
  // Sort: same dual-mode pattern. Controlled when both `controlledSort`
  // and `onSortChange` are supplied (HR / server-side); otherwise
  // local state drives the legacy client-side sort (Mentor consumer).
  const [localSort, setLocalSort] = useState<
    SortState<ReadOnlySortKey> | null
  >(null);
  const isSortControlled =
    controlledSort !== undefined && onSortChange !== undefined;
  const sort: SortState<ReadOnlySortKey> | null =
    controlledSort ?? localSort;
  const setSort = onSortChange ?? setLocalSort;
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
    // In controlled (server-filtered) mode, `reviews` already matches
    // the active filter set — skip the client-side narrowing entirely.
    // In uncontrolled (Mentor) mode this is what does the actual
    // filtering.
    if (isControlled) return reviews;
    return reviews.filter((r) => {
      if (activeFilters.cycle && r.cycle !== activeFilters.cycle) return false;
      if (activeFilters.project && r.project_name !== activeFilters.project) return false;
      if (
        activeFilters.pm &&
        (r.pm_name ?? r.reviewer_name) !== activeFilters.pm
      ) {
        return false;
      }
      if (activeFilters.employee && r.employee_name !== activeFilters.employee) return false;
      if (activeFilters.status && r.status !== activeFilters.status) return false;
      return true;
    });
  }, [reviews, activeFilters, isControlled]);

  const sorted = useMemo(() => {
    // In controlled mode, server already ordered; passthrough.
    if (isSortControlled) return filtered;
    if (!sort) return filtered;
    return filtered.slice().sort((a, b) => {
      const { kind, get } = READ_ONLY_SORT_CONFIG[sort.key];
      return compareValues(get(a), get(b), kind, sort.direction);
    });
  }, [filtered, sort, isSortControlled]);

  // Variable-height virtualizer (same template as PR #16 / doc #16).
  // We use measureElement here primarily for the long-project-name
  // edge case where the cell wraps to two display lines. The rest of
  // the row is fixed-height; ResizeObserver fires once per row and
  // the virtualizer caches that height for the row's lifetime.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual's useVirtualizer returns non-memoisable functions; React Compiler logs a benign skip here.
  const rowVirtualizer = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => READ_ONLY_ESTIMATE_ROW_PX,
    overscan: READ_ONLY_OVERSCAN,
  });

  if (isLoading) {
    return <TableSkeleton />;
  }
  // Empty-state branching for the controlled (HR) case: empty
  // `reviews` can now mean either "no reviews in the org" or "filter
  // set returned nothing on the server". The Mentor consumer's empty
  // case keeps the legacy copy because there's no filter universe to
  // narrow against (their `reviews` is the full mentee set).
  if (reviews.length === 0) {
    const filtersEmpty = isControlled && hasActiveFilters;
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
        <Briefcase
          className="h-10 w-10 text-text-muted mb-3"
          aria-hidden="true"
        />
        <p className="font-display text-base font-medium text-text-main">
          {filtersEmpty ? "No reviews match these filters" : emptyTitle}
        </p>
        <p className="mt-1 text-sm text-text-muted">
          {filtersEmpty
            ? "Try clearing one or more filters above to broaden the result."
            : emptySubtitle}
        </p>
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
          {/* Helper to write a single filter dimension. Reads "all" /
              "" sentinels from the UI and maps to undefined inside the
              filters object; the controlled-mode parent uses that
              shape, the uncontrolled local-state path also does. */}
          {(() => {
            const setFilter = <K extends keyof AllProjectReviewsFilters>(
              key: K,
              value: AllProjectReviewsFilters[K] | "" | "all",
            ) => {
              setActiveFilters({
                ...activeFilters,
                [key]: value === "" || value === "all" ? undefined : value,
              });
            };
            return (
              <>
                {employees.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label htmlFor="ro-employee-filter" className={filterLabelCls}>
                      {employeeColumnLabel}
                    </label>
                    <StringCombobox
                      id="ro-employee-filter"
                      options={employees}
                      value={activeFilters.employee ?? ""}
                      onChange={(v) => setFilter("employee", v)}
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
                      value={activeFilters.project ?? ""}
                      onChange={(v) => setFilter("project", v)}
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
                      value={activeFilters.pm ?? "all"}
                      onChange={(e) => setFilter("pm", e.target.value)}
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
                    value={activeFilters.cycle ?? "all"}
                    onChange={(e) => setFilter("cycle", e.target.value)}
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
                    value={activeFilters.status ?? "all"}
                    onChange={(e) => setFilter("status", e.target.value)}
                    className={`${filterSelectCls} min-w-[120px]`}
                  >
                    <option value="all">All</option>
                    <option value="pending">Pending PM</option>
                    <option value="reviewed">Reviewed</option>
                  </select>
                </div>
              </>
            );
          })()}
          <span className="text-xs text-text-muted">
            {/* Controlled mode (HR): serverTotal is the universe count
                matching active filters; `filtered.length` equals
                `reviews.length` because the client-side loop is
                skipped — so "{serverTotal} matches" is the clean read.
                Uncontrolled mode (Mentor): legacy "filtered / total"
                framing where total is the un-paginated mentee count. */}
            {isControlled
              ? `${serverTotal ?? 0} ${(serverTotal ?? 0) === 1 ? "match" : "matches"}`
              : `${filtered.length} of ${reviews.length}`}
          </span>
         </div>
         <div className="shrink-0">
           <ExportExcelButton kind="project-reviews" />
         </div>
      </div>

      {/* Virtualized read-only review list (variable-height via
          measureElement; see doc #17). Outer div handles horizontal
          overflow for narrow viewports (header + body x-scroll
          together). Inner scroll container handles vertical
          virtualization. Empty / no-match states render outside the
          virtualized container. */}
      <div className="overflow-x-auto rounded-lg border border-border">
        <div
          role="table"
          aria-label="Read-only project reviews"
          aria-rowcount={sorted.length}
          className="text-[13px]"
          style={{ minWidth: READ_ONLY_TABLE_MIN_WIDTH_PX }}
        >
          {/* Header — non-virtualized, pinned at top */}
          <div role="rowgroup" className="bg-slate-50/80 border-b border-border">
            <div
              role="row"
              className="grid items-center"
              style={{ gridTemplateColumns: READ_ONLY_GRID_TEMPLATE_COLUMNS }}
            >
              <div role="columnheader" className="text-left px-5 py-2.5">
                <SortableHeader label="Project" columnKey="project_name" sort={sort} onSort={setSort} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader
                  label={employeeColumnLabel}
                  columnKey="employee_name"
                  sort={sort}
                  onSort={setSort}
                />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="PM" columnKey="pm_name" sort={sort} onSort={setSort} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Cycle" columnKey="cycle" sort={sort} onSort={setSort} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Status" columnKey="status" sort={sort} onSort={setSort} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Rating" columnKey="performance_group" sort={sort} onSort={setSort} />
              </div>
              <div
                role="columnheader"
                className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted"
              >
                Actions
              </div>
            </div>
          </div>

          {/* Body — either the no-matches branch or the virtualized
              scroll container. */}
          {sorted.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <Search className="h-6 w-6 text-text-muted mx-auto mb-1" aria-hidden="true" />
              <p className="text-[13px] text-text-main font-medium">No matching reviews</p>
              <p className="text-[11px] text-text-muted mt-0.5">
                Try adjusting your filters or search query.
              </p>
            </div>
          ) : (
            <div
              ref={scrollContainerRef}
              role="rowgroup"
              style={{ height: READ_ONLY_SCROLL_HEIGHT_PX }}
              className="overflow-y-auto"
            >
              <div
                style={{
                  height: rowVirtualizer.getTotalSize(),
                  position: "relative",
                  width: "100%",
                }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const r = sorted[virtualRow.index];
                  const isReviewed = r.status === "reviewed";
                  return (
                    <div
                      role="row"
                      aria-rowindex={virtualRow.index + 1}
                      key={r.id}
                      // data-index is REQUIRED by measureElement to map
                      // the ResizeObserver entry back to this row's
                      // index in the virtualizer's size cache. See
                      // doc #16 part 1.
                      data-index={virtualRow.index}
                      ref={rowVirtualizer.measureElement}
                      style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        transform: `translateY(${virtualRow.start}px)`,
                        gridTemplateColumns: READ_ONLY_GRID_TEMPLATE_COLUMNS,
                      }}
                      className="grid items-center hover:bg-slate-50/60 transition-colors border-b border-border/50"
                    >
                      <div role="cell" className="px-5 py-3">
                        <div className="font-medium text-text-main">
                          {r.project_name}
                        </div>
                        <div className="font-mono text-[11px] text-text-muted">
                          {r.project_code}
                        </div>
                      </div>
                      <div role="cell" className="px-4 py-3 font-medium text-text-main truncate">
                        {r.employee_name}
                      </div>
                      <div role="cell" className="px-4 py-3 text-text-muted truncate">
                        {r.pm_name ?? r.reviewer_name ?? "—"}
                      </div>
                      <div role="cell" className="px-4 py-3">
                        <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                          {r.cycle}
                        </span>
                      </div>
                      <div role="cell" className="px-4 py-3">
                        {isReviewed ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold uppercase text-green-700">
                            <CheckCircle2 className="h-3 w-3" /> Reviewed
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold uppercase text-amber-700">
                            <Clock className="h-3 w-3" /> Pending PM
                          </span>
                        )}
                      </div>
                      <div role="cell" className="px-4 py-3">
                        {!projectRatingsVisible ? (
                          <span className="inline-flex items-center gap-1 text-[11px] text-text-muted/60">
                            <Lock className="h-3 w-3" /> Hidden
                          </span>
                        ) : (
                          <PerformanceRatingBadge value={r.performance_group} />
                        )}
                      </div>
                      <div role="cell" className="px-4 py-3">
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
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
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
          You'll see your projects here once they are assigned.
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
      <table className="w-full min-w-max text-[13px]">
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
