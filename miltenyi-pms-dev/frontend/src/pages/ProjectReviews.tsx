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

import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
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
  type AllProjectReviewsFilters,
  type AllProjectReviewsSortBy,
  type MyProjectCard,
  type ProjectReviewResponse,
  type RoleExpectation,
} from "@/services/project-review.service";
import { queryKeys } from "@/lib/queryKeys";
import { useAuth } from "@/hooks/useAuth";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import type { CycleType } from "@/services/system-settings.service";
import {
  extractCyclePeriod,
  fyStartYearToToken,
  fyTokenToStartYear,
  formatFyYearSpan,
} from "@/utils/fy";
import {
  groupProjectReviews,
  type CycleSlot,
  type GroupedReviewRow,
} from "@/utils/groupProjectReviews";
import { CycleReviewChip } from "@/components/reviews/CycleReviewChip";
import { PrimaryEvaluationTab } from "@/components/project-reviews/PrimaryEvaluationTab";
import { SecondaryEvalTab } from "@/components/project-reviews/SecondaryEvalTab";
import { PerformanceRatingBadge } from "@/components/reviews/PerformanceRatingBadge";
import { ProjectSummaryCard } from "@/components/project-reviews/ProjectSummaryCard";
import { ReviewDetailPanel } from "@/components/project-reviews/ReviewDetailPanel";
import { TableExpandedRow } from "@/components/project-reviews/TableExpandedRow";
import { ProjectReviewDetailModal } from "@/components/project-reviews/ProjectReviewDetailModal";
import { MyReviewsToolbar } from "@/components/project-reviews/MyReviewsToolbar";
import { CycleReviewsLegendButton } from "@/components/reviews/CycleReviewsLegendButton";
import { setOrDeleteParam, searchParamsChanged } from "@/utils/searchParams";
import {
  GridSkeleton,
  TableSkeleton,
} from "@/components/project-reviews/MyReviewsSkeletons";
import { SortableHeader } from "@/components/SortableHeader";
import { ExportExcelButton } from "@/components/admin/ExportExcelButton";
import { StringCombobox } from "@/components/common/StringCombobox";
import { ClearFiltersButton } from "@/components/common/ClearFiltersButton";
import { Pagination } from "@/components/common/Pagination";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { useProjectReviewCycles } from "@/hooks/useProjectReviewCycles";
import { useOrgProjectNames } from "@/hooks/useOrgProjectNames";
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
// Operates on GROUPED rows (one per employee, project, FY) — not flat
// review rows. The previously-supported cycle / status /
// performance_group sort keys are dropped because each group spans
// multiple cycles and would need an aggregation choice (latest cycle?
// max rating? completion %?) that isn't a single value. If HR wants to
// see "rows with at least one pending" they use the Status filter; if
// they want "best-rated employees" we'd add an explicit "Latest Rating"
// or "Avg Rating" derived column later.
type ReadOnlySortKey =
  | "employee_name"
  | "project_name"
  | "pm_name"
  | "fy_year"
  | "progress";

const READ_ONLY_SORT_CONFIG: Record<
  ReadOnlySortKey,
  { kind: SortKind; get: (r: GroupedReviewRow) => SortValue }
> = {
  employee_name: { kind: "alpha",   get: (r) => r.employee_name },
  project_name:  { kind: "alpha",   get: (r) => r.project_name },
  pm_name:       { kind: "alpha",   get: (r) => r.pm_name },
  fy_year:       { kind: "numeric", get: (r) => r.fy_year },
  // Completion ratio — most-complete first when sorted desc. Avoids
  // a divide-by-zero edge case by handling empty slots explicitly.
  progress:      {
    kind: "numeric",
    get: (r) => (r.totalSlots === 0 ? 0 : r.reviewedCount / r.totalSlots),
  },
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

  // Canonical filter option sources for the HR "All Reviews" tab. These
  // back the cycle / project / pm / employee dropdowns there so they
  // don't shrink to just the currently-selected value once a filter is
  // applied (the data side IS server-filtered; deriving options from it
  // would lock the user into their selection).
  //
  // Gated on `isHR` because /admin/users and /projects?include_completed
  // both require admin role on the backend — Employee/PM/Mentor would
  // hit 403s if the queries fired for them.
  // Employee combobox is sourced from `employeeNames` (role="Employee"
  // only), not the full org user list. Project reviews are only ever
  // written for Employees (ProjectModal limits members to that role),
  // so the dropdown should mirror the universe of names that can
  // actually appear in the result set. Earlier we used `allUserNames`
  // here — which surfaced Mentor / HR / PM names in the picker that
  // would always yield zero matches when selected, leaving HR with a
  // confusing empty result and no hint why.
  //
  // Caveat documented for completeness: a user promoted from Employee
  // → Mentor since their review was written disappears from this
  // dropdown but their historical reviews remain in the result list
  // (reviews are keyed by user_id, not by current role). HR can still
  // find those rows by reading the Employee column or by clearing the
  // filter. If this becomes a real friction point we can move to a
  // backend "reviewable users" endpoint that includes promoted users.
  const { mentorNames: hrMentorNames, pmNames: hrPmNames, employeeNames: hrEmployeeNames } =
    useOrgUsers(isHR);
  const { cycles: hrCycleTokens } = useProjectReviewCycles(isHR);
  const { projectNames: hrProjectNames } = useOrgProjectNames(isHR);
  // `hrMentorNames` is referenced via the spread above so TS doesn't
  // complain about an unused destructure (project review filters don't
  // surface a mentor column today; keeping the destructure forward-
  // compatible if one's added).
  void hrMentorNames;

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
  // Classic-pagination rewrite (PR #74): useInfiniteQuery → useQuery
  // + <Pagination>. page is 1-indexed; pageSize 10/25/50 (default 25).
  const [allReviewsPage, setAllReviewsPage] = useState(1);
  const [allReviewsPageSize, setAllReviewsPageSize] = useState(25);
  const [allReviewsFilters, setAllReviewsFilters] =
    useState<AllProjectReviewsFilters>({});
  // Sort state was moved into ReadOnlyReviewsList itself — the new
  // grouped view's sort keys (employee_name / project_name / pm_name /
  // fy_year / progress) don't map cleanly to a backend ORDER BY
  // column, so sort is client-side over the grouped rows. See the
  // comment on `ReadOnlyReviewsList`'s sort declaration for the
  // rationale.

  // First time we know the active cycle, pre-fill the Year + Period
  // filters on the All Reviews tab. HR almost always wants the
  // current cycle ("which reviews are pending in Q1 FY26-27 right
  // now") — defaulting both to "All" forces them to narrow every
  // session.
  //
  // The Cycle dropdown was split into Year + Period (a single combined
  // dropdown grew long once multiple FYs accumulated). Reader honours
  // three URL shapes in priority order:
  //   1. `?fy_year=` and/or `?period=`     — native two-param shape
  //   2. `?cycle=H1 FY26-27`               — legacy shape (back-compat
  //      with dashboard deep-links). Parsed into fy_year + period.
  //   3. Nothing                           — default both from settings.
  //
  // Ref guard fires once per mount; later user edits to the filters
  // are preserved.
  const [searchParams, setSearchParams] = useSearchParams();
  // HR All-Reviews tab reader. Gated on `isHR` so an Employee
  // landing here (My Reviews tab) doesn't seed allReviewsFilters
  // from URL — there's a separate Employee reader below targeting
  // selectedCycle / statusFilter / projectFilter / pmFilter.
  const allReviewsDefaultedRef = useRef(false);
  useEffect(() => {
    if (!isHR) return;
    if (allReviewsDefaultedRef.current) return;
    if (!settings?.active_cycle_name) return;

    const urlFyYear = searchParams.get("fy_year");
    const urlCycle = searchParams.get("cycle");
    // `?period=` is intentionally NOT read anymore — see the Period
    // filter removal note below the parser branches.
    // `?status=` is intentionally NOT read anymore — the per-review
    // Status filter was replaced by a group-level Progress filter
    // when the table moved to grouped rows. Legacy dashboard
    // deep-links of the form `/project-reviews?cycle=...&status=
    // pending` still narrow by cycle correctly; the status part is
    // a silent no-op rather than applying a hidden server filter
    // that the UI no longer exposes.

    const updates: Partial<AllProjectReviewsFilters> = {};
    // Period is no longer surfaced as a filter in the grouped view —
    // chip column position aligns same-period chips across rows so a
    // narrowing dropdown adds no value. We deliberately DON'T set
    // `period` on filter state here, even when legacy URLs supply
    // it: doing so would tell the backend to narrow review rows by
    // period, which would then make the chip cadence misrepresent
    // reality (e.g. a fetched-only-H1 response would render an
    // "upcoming H2" chip even when H2 reviews exist in the DB).
    if (urlFyYear) {
      const parsed = Number(urlFyYear);
      if (!Number.isNaN(parsed)) updates.fy_year = parsed;
    } else if (urlCycle) {
      // Legacy: ?cycle=H1 FY26-27 → take the FY portion only.
      const parsedYear = fyTokenToStartYear(urlCycle);
      if (parsedYear !== null) updates.fy_year = parsedYear;
    } else {
      // No URL override → default Year to the active FY.
      const activeYear = fyTokenToStartYear(settings.active_cycle_name);
      if (activeYear !== null) updates.fy_year = activeYear;
    }

    if (Object.keys(updates).length > 0) {
      setAllReviewsFilters((prev) => ({ ...prev, ...updates }));
    }
    allReviewsDefaultedRef.current = true;
  }, [isHR, settings?.active_cycle_name, searchParams]);

  // Employee My-Reviews tab URL reader + writer. Mirrors the
  // selectedCycle / statusFilter / projectFilter / pmFilter state to
  // URL so refresh + share-link preserves the view, AND honours
  // deep-links carrying ?status= (e.g.
  // "/project-reviews?status=pending" from emails or shared URLs)
  // which would otherwise land the Employee on an unfiltered view
  // because no reader existed for their filter state. Search query
  // is intentionally NOT URL-synced (typing-into-URL is jarring;
  // debouncing happens server-side anyway).
  const myReviewsDefaultedRef = useRef(false);
  useEffect(() => {
    if (!isEmployee) return;
    if (myReviewsDefaultedRef.current) return;
    const urlStatus = searchParams.get("status");
    const urlCycle = searchParams.get("cycle");
    const urlProject = searchParams.get("project");
    const urlPm = searchParams.get("pm");
    if (urlStatus) setStatusFilter(urlStatus);
    if (urlCycle) setSelectedCycle(urlCycle);
    if (urlProject) setProjectFilter(urlProject);
    if (urlPm) setPmFilter(urlPm);
    myReviewsDefaultedRef.current = true;
  }, [isEmployee, searchParams]);

  useEffect(() => {
    if (!isEmployee) return;
    if (!myReviewsDefaultedRef.current) return;
    const next = new URLSearchParams(searchParams);
    setOrDeleteParam(next, "status", statusFilter);
    // Cycle is sticky-defaulted to the org's active cycle (lazy init
    // above) — don't echo the default into the URL so it stays clean
    // for the common case (Employee is on the active cycle). Only
    // mirror the value when it deviates from the active cycle.
    const activeCycle = settings?.active_cycle_name ?? "";
    setOrDeleteParam(
      next,
      "cycle",
      selectedCycle === activeCycle ? undefined : selectedCycle,
    );
    setOrDeleteParam(next, "project", projectFilter);
    setOrDeleteParam(next, "pm", pmFilter);
    if (searchParamsChanged(searchParams, next)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    isEmployee,
    statusFilter,
    selectedCycle,
    projectFilter,
    pmFilter,
    settings?.active_cycle_name,
    searchParams,
    setSearchParams,
  ]);
  // Strip empty / undefined values so cache keys for "no filter X" and
  // "filter X = '' " collapse to the same entry. See doc 26 Part 2's
  // "empty-filters trap" for the rationale.
  //
  // Year + Period composition: when both are set the pair describes a
  // single composite cycle ("H1 FY26-27") — collapse to the exact
  // `cycle` param so the backend hits its direct equality index
  // instead of running two LIKE filters. Only one of the three (cycle
  // OR fy_year/period) is ever sent on the wire; the cache key stays
  // structurally identical for equivalent selections (= no duplicate
  // cache entries from picking the same cycle two different ways).
  const allReviewsFilterParams: Record<string, string> = (() => {
    const composed: Record<string, string | number | undefined> = {
      ...allReviewsFilters,
    };
    if (
      !composed.cycle &&
      composed.fy_year !== undefined &&
      composed.period
    ) {
      composed.cycle = `${composed.period} ${fyStartYearToToken(
        composed.fy_year as number,
      )}`;
      composed.fy_year = undefined;
      composed.period = undefined;
    }
    return Object.fromEntries(
      Object.entries(composed)
        .filter(([, v]) => v !== undefined && v !== "")
        .map(([k, v]) => [k, String(v)]),
    ) as Record<string, string>;
  })();
  // Sort dimension is no longer wired through to the server — the
  // grouped view's sort keys don't have a single ProjectReview
  // column they could map onto. Request params == filter params.
  const allReviewsRequestParams: Record<string, string> =
    allReviewsFilterParams;
  // Reset to page 1 whenever filters change.
  const allReviewsRequestParamsKey = JSON.stringify(allReviewsRequestParams);
  useEffect(() => {
    setAllReviewsPage(1);
  }, [allReviewsRequestParamsKey]);

  const allReviewsQueryKeyParams: Record<string, string | number> = {
    ...allReviewsRequestParams,
    _page: allReviewsPage,
    _pageSize: allReviewsPageSize,
  };
  const allReviewsQuery = useQuery({
    queryKey: queryKeys.projectReviews.org(
      allReviewsQueryKeyParams as Record<string, string | undefined>,
    ),
    queryFn: () =>
      projectReviewService.getAllReviews({
        ...(allReviewsRequestParams as Record<string, string> & {
          sort_by?: AllProjectReviewsSortBy;
        }),
        limit: allReviewsPageSize,
        offset: (allReviewsPage - 1) * allReviewsPageSize,
      }),
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
  // Single-page slice — useQuery returns one Paginated payload.
  const allReviews = allReviewsQuery.data?.items ?? [];
  // Total review count returned by the server for this filter set.
  const allReviewsTotal = allReviewsQuery.data?.total ?? 0;

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
              // Default Cycle to the active cycle so Mentor lands on
              // "this cycle's mentee reviews" rather than the
              // multi-cycle history dump. HR's controlled-mode branch
              // achieves the same via its `filters` prop; the Mentor
              // consumer goes through the uncontrolled defaultCycle.
              defaultCycle={settings?.active_cycle_name}
              // Grouping needs the cadence to know how many chip
              // slots to render for current/future FYs.
              cycleType={settings?.cycle_type ?? null}
              activeCycle={settings?.active_cycle_name ?? null}
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
                // Server-side filter mode (PR #45, doc 28). Sort is
                // now client-side over grouped rows; no server-sort
                // wiring needed here.
                filters={allReviewsFilters}
                onFiltersChange={setAllReviewsFilters}
                serverTotal={allReviewsTotal}
                // Running row-number offset so the # column reads as
                // the row's absolute position (1-based) across pages.
                rowNumberOffset={(allReviewsPage - 1) * allReviewsPageSize}
                // Canonical filter options — keeps the dropdowns stable
                // across filter changes. Mentor consumer above omits
                // this prop and falls back to the derive-from-reviews
                // behavior (correct there because its `reviews` is the
                // full unfiltered mentee roster).
                filterOptionsOverride={{
                  cycles: hrCycleTokens,
                  projects: hrProjectNames,
                  pms: hrPmNames,
                  employees: hrEmployeeNames,
                }}
                cycleType={settings?.cycle_type ?? null}
                activeCycle={settings?.active_cycle_name ?? null}
              />

              {/* Pagination toolbar — outside ReadOnlyReviewsList
                  because that component stays pure presentational and
                  is also used by Mentor's mentee-reviews view (which
                  isn't paginated). The Pagination component handles
                  its own zero-total state; we only suppress it during
                  the very first load to avoid flashing controls on a
                  skeleton table. */}
              {!isLoading && (
                <div className="mt-2">
                  <Pagination
                    page={allReviewsPage}
                    pageSize={allReviewsPageSize}
                    total={allReviewsTotal}
                    onPageChange={setAllReviewsPage}
                    onPageSizeChange={(n) => {
                      setAllReviewsPageSize(n);
                      setAllReviewsPage(1);
                    }}
                    entityLabel="reviews"
                  />
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

// Shared CSS Grid layout for the 6-column virtualized read-only
// review list. Each row represents one (employee, project, FY) group;
// the Cycle Reviews cell holds a strip of chips encoding per-cycle
// state. The old per-cycle Status / Rating / Actions / Cycle columns
// collapsed into that single cell — chips are clickable so a separate
// Actions column became redundant.
//
// Column shape (HR + Mentor — both consumers share this template):
//   1. Employee / Mentee — single-line name, anchors the row
//   2. Project           — single-line project name
//   3. Project Code      — monospace project slug (e.g. ALPHA-001)
//   4. PM                — medium
//   5. Year              — FY span (e.g. "FY 2026-27")
//   6. Cycle Reviews     — "X of N reviewed" + chip strip
//
// Project Code was previously stacked under the project name in a
// single cell — splitting gives it column-level alignment so HR can
// scan codes vertically and gives the Project cell more horizontal
// room for long names. The fr weight on Project is intentionally
// the largest because project names dominate this table's truncation
// budget — codes are short, PM names are first-last, FY is fixed.
// Cycle Reviews holds only 2-4 small chips + a short fraction line,
// so its fr is kept modest (1.5fr) — letting it stay at 2+fr would
// leave dead cell space on the right while Project clips. The 220px
// minimum on Cycle Reviews still guarantees 4 chips fit without
// wrapping at narrow viewports.
// First column is the running row number ("#") — tightly capped
// 32-40px range. Same fixed range used for both consumers (HR
// paginated + Mentor non-paginated) so the grid template is shared.
const READ_ONLY_GRID_TEMPLATE_COLUMNS =
  "minmax(32px, 40px) minmax(160px, 1.3fr) minmax(220px, 2.6fr) minmax(110px, 0.9fr) " +
  "minmax(160px, 1.3fr) minmax(120px, 0.9fr) minmax(220px, 1.5fr)";

// Sum of the READ_ONLY_GRID_TEMPLATE_COLUMNS minimums plus a little
// breathing room. Drives the table's min-width so the outer horizontal-
// scroll wrapper engages BEFORE the body's implicit overflow-x (legacy
// CSS pairing for overflow-y: auto) does — otherwise the body scrolls
// horizontally on its own and the header stays put. Mirrors the same
// fix in ManagementReview.tsx.
// 7-column total: 32 + 160 + 220 + 110 + 160 + 120 + 220 = 1022 + ~50 breathing.
const READ_ONLY_TABLE_MIN_WIDTH_PX = 1072;

// Starting guess for the collapsed row height (project cell's 2-line
// content + py-3 padding ≈ 60-64px). measureElement corrects after
// render — most rows are uniform, but long project names can wrap and
// push the height higher. Using variable-height pattern from PR #16
// to handle that edge case correctly.
//
// Note: this table has NO inline expansion (the View button opens a
// Virtualizer constants removed (PR #74). At max 50 rows per page
// the previous virtualization overhead (variable-height measurement,
// scroll container sizing) wasn't paying for itself.

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
  rowNumberOffset = 0,
  filterOptionsOverride,
  defaultCycle,
  cycleType,
  activeCycle,
}: {
  readonly isLoading: boolean;
  readonly reviews: ProjectReviewResponse[];
  readonly projectRatingsVisible: boolean;
  readonly employeeColumnLabel: string;
  readonly emptyTitle: string;
  readonly emptySubtitle: string;
  /** Initial Cycle value for the uncontrolled-mode (Mentor) consumer.
   *  Passing the active cycle name as the default lands Mentor on
   *  "this cycle's mentee reviews" instead of the multi-cycle dump.
   *  Ignored in controlled mode — HR drives Cycle via the `filters`
   *  prop directly. */
  readonly defaultCycle?: string;
  /** Org cadence (`half_yearly` / `quarterly` / `annual`). Drives how
   *  many chip slots each row renders for the current/future FY — see
   *  `groupProjectReviews` for the full slot-derivation rules. Past
   *  FYs always render only the existing rows, so this prop is
   *  effectively a hint for the active FY's expected shape. */
  readonly cycleType: CycleType | null;
  /** Org's active cycle name (e.g. "Q3 FY26-27"). Used by the chip
   *  state derivation to distinguish "awaiting PM" (active cycle, no
   *  row yet — chase target) from "upcoming" (future cycle). */
  readonly activeCycle: string | null;
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
  /** 0-based offset for the running row-number column. Passed by the
   *  HR consumer as `(page - 1) * pageSize` so the # cell reads as the
   *  row's absolute position across pages (matches the "Showing N–M of
   *  T" counter). Defaults to 0 — the Mentor (uncontrolled) consumer
   *  isn't paginated and just numbers from 1. */
  readonly rowNumberOffset?: number;
  // Sort is now client-side only — operates on GROUPED rows, not flat
  // review rows. The server's cycle-desc default still influences the
  // order reviews arrive in (which affects which group is first if
  // sort=null), but the user-driven sort lives inside this component.
  // The previously-controlled `sort` + `onSortChange` props were
  // removed because the new sort keys (employee_name, project_name,
  // pm_name, fy_year, progress) don't map cleanly to backend ORDER BY
  // — there's no single ProjectReview column that represents a
  // group's progress, and grouping breaks any per-row sort anyway.
  /** Canonical filter option lists. Pass from the HR consumer (where
   *  `reviews` is server-filtered) so dropdown options don't shrink
   *  to just the selected value as filters narrow the data. Each
   *  field is optional — keys that are omitted fall back to the local
   *  derive-from-reviews behavior, which is correct for the Mentor
   *  consumer (its `reviews` is the full unfiltered mentee roster). */
  readonly filterOptionsOverride?: {
    readonly cycles?: readonly string[];
    readonly projects?: readonly string[];
    readonly pms?: readonly string[];
    readonly employees?: readonly string[];
  };
}) {
  // Local fallback state — used only when the parent doesn't pass
  // `filters` + `onFiltersChange`. Mentor's mentees view is the
  // current uncontrolled consumer (not paginated). Three legacy
  // sentinels remain (`""` for combobox, `"all"` for select) so the
  // local-state path keeps the existing UI conventions; the
  // controlled-mode `filters` object uses `undefined` for "no filter
  // applied" (matching the pattern from docs 26 + 27).
  // Initialize the uncontrolled-mode filter state with the default
  // cycle's year + period when supplied. Mentor lands on "this
  // cycle's mentee reviews" instead of a multi-cycle dump on first
  // paint. Lazy init so the value is captured once at mount;
  // subsequent changes to `defaultCycle` (rare — settings refetch)
  // don't clobber the user's own filter picks afterwards.
  //
  // We seed `fy_year` + `period` (not `cycle`) so the two new
  // dropdowns paint with the default selected and the user can
  // independently change one without losing the other. The request-
  // params builder upstream collapses the pair back to `cycle` when
  // both are set, so the wire format is unchanged.
  const [localFilters, setLocalFilters] = useState<AllProjectReviewsFilters>(
    () => {
      if (!defaultCycle) return {};
      const init: AllProjectReviewsFilters = {};
      const y = fyTokenToStartYear(defaultCycle);
      // `period` is deliberately not seeded — see the URL reader's
      // note above. Setting it would narrow the backend response and
      // make the chip cadence misrepresent reality (an "upcoming H2"
      // would render even when H2 review rows exist in the DB).
      if (y !== null) init.fy_year = y;
      return init;
    },
  );
  const isControlled = filters !== undefined && onFiltersChange !== undefined;
  const activeFilters: AllProjectReviewsFilters = filters ?? localFilters;
  const setActiveFilters = onFiltersChange ?? setLocalFilters;
  // Boolean used by counter + empty-state branching to decide which
  // narrative to show. In controlled mode this means "server-filtered
  // and at least one dim is non-empty"; in uncontrolled mode it means
  // "user has narrowed via the local dropdowns".
  //
  // Uncontrolled mode skips the default Year + Period pair derived
  // from `defaultCycle` so the Clear Filters button doesn't activate
  // on first paint just because the Mentor's cycle pin is set.
  const defaultYear = defaultCycle ? fyTokenToStartYear(defaultCycle) : null;
  // Sort is now purely client-side and operates on the GROUPED rows
  // (see `groupedRows` below). The previous controlled-sort path was
  // dropped — none of the new sort keys map cleanly to a single
  // ProjectReview column, so server-side ORDER BY can't represent
  // them. Switching to local state simplifies the API (the parent no
  // longer needs to plumb sort state through) and keeps the cache
  // key stable across sort changes (filter changes still trigger
  // fresh fetches; sort doesn't).
  const [sort, setSort] = useState<SortState<ReadOnlySortKey> | null>(null);

  // Progress filter — a group-level narrowing that replaces the old
  // per-review Status filter (Pending PM / Reviewed). Status didn't
  // translate cleanly to the grouped view because a single group can
  // hold multiple statuses (one per chip). Progress is purely
  // derived from the chip strip:
  //   - complete     → every slot is reviewed
  //   - in_progress  → at least one reviewed, at least one not
  //   - not_started  → zero reviewed
  // Lives in component-local state because it's derived from grouped
  // data which is itself a render-time computation. Adding it to the
  // server-side filter set would break the grouping (the server
  // returns flat rows; "progress" only exists after we group them).
  //
  // Declared BEFORE hasActiveFilters so the latter can reference it
  // — `const` declarations have a temporal dead zone, so the original
  // order (progressFilter below hasActiveFilters) threw a runtime
  // ReferenceError on first paint.
  const [progressFilter, setProgressFilter] = useState<
    "all" | "complete" | "in_progress" | "not_started"
  >("all");
  const hasActiveFilters =
    progressFilter !== "all" ||
    Object.entries(activeFilters).some(([key, value]) => {
      if (value === undefined || value === "") return false;
      if (isControlled) return true;
      if (key === "cycle" && value === defaultCycle) return false;
      if (key === "fy_year" && value === defaultYear) return false;
      // `period` shouldn't be set in uncontrolled mode anymore (we
      // stopped seeding it from defaultCycle), but defensive: if it
      // somehow appears in activeFilters, don't flag it as "active"
      // since the user has no way to see/clear it via the UI.
      if (key === "period") return false;
      return true;
    });
  // Read-only modal target. Mentors and HR both need a way to read the
  // PM's competency comments + impact statement, not just the rating —
  // setting this opens the detail modal in place.
  const [viewTarget, setViewTarget] = useState<ProjectReviewResponse | null>(null);

  // Filter dropdown options. When a canonical override is passed (HR
  // consumer, where `reviews` is server-filtered), use it directly so
  // the dropdown stays stable as filters narrow. Otherwise derive from
  // `reviews` — that's correct for the uncontrolled Mentor consumer
  // whose `reviews` is the full unfiltered mentee roster.
  const cycles = useMemo(
    () =>
      filterOptionsOverride?.cycles
        ? [...filterOptionsOverride.cycles]
        : Array.from(
            new Set(reviews.map((r) => r.cycle).filter(Boolean)),
          ).sort((a, b) => b.localeCompare(a)),
    [reviews, filterOptionsOverride?.cycles],
  );

  // Year list derived from `cycles` for the Year dropdown — scales
  // linearly with FY count (typically 1-5 entries) and stays short
  // even as historical FYs accumulate. The Period dropdown was
  // dropped when the table moved to grouped rows (chips encode the
  // period directly via column position), so we no longer derive a
  // separate periods array.
  const cycleYears = useMemo(() => {
    const years = new Set<number>();
    for (const c of cycles) {
      const y = fyTokenToStartYear(c);
      if (y !== null) years.add(y);
    }
    return Array.from(years).sort((a, b) => b - a);
  }, [cycles]);
  const projects = useMemo(
    () =>
      filterOptionsOverride?.projects
        ? [...filterOptionsOverride.projects]
        : Array.from(
            new Set(reviews.map((r) => r.project_name).filter(Boolean)),
          ).sort(),
    [reviews, filterOptionsOverride?.projects],
  );
  const pms = useMemo(
    () =>
      filterOptionsOverride?.pms
        ? [...filterOptionsOverride.pms]
        : Array.from(
            new Set(
              reviews
                .map((r) => r.pm_name ?? r.reviewer_name ?? null)
                .filter((n): n is string => !!n),
            ),
          ).sort(),
    [reviews, filterOptionsOverride?.pms],
  );
  const employees = useMemo(
    () =>
      filterOptionsOverride?.employees
        ? [...filterOptionsOverride.employees]
        : Array.from(
            new Set(reviews.map((r) => r.employee_name).filter(Boolean)),
          ).sort(),
    [reviews, filterOptionsOverride?.employees],
  );

  const filtered = useMemo(() => {
    // In controlled (server-filtered) mode, `reviews` already matches
    // the active filter set — skip the client-side narrowing entirely.
    // In uncontrolled (Mentor) mode this is what does the actual
    // filtering.
    if (isControlled) return reviews;
    return reviews.filter((r) => {
      // Cycle composition mirrors the server-side path in the
      // controlled branch: exact `cycle` wins; otherwise fy_year +
      // period each narrow independently. Lets the Year + Period
      // dropdowns behave identically for Mentor's uncontrolled
      // mode as they do for HR's controlled mode.
      if (activeFilters.cycle) {
        if (r.cycle !== activeFilters.cycle) return false;
      } else {
        if (activeFilters.fy_year !== undefined) {
          const rowYear = r.cycle ? fyTokenToStartYear(r.cycle) : null;
          if (rowYear !== activeFilters.fy_year) return false;
        }
        if (activeFilters.period) {
          const rowPeriod = r.cycle ? extractCyclePeriod(r.cycle) : null;
          if (rowPeriod !== activeFilters.period) return false;
        }
      }
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

  // Group the filtered review rows into (employee, project, FY) rows
  // so the table displays one row per relationship + FY instead of
  // one row per individual review (which stacked 4 lines per person
  // for quarterly orgs). The chip strip inside each row carries the
  // per-cycle state. Grouping is memoised on `filtered` because it's
  // an O(n) bucket pass.
  const groupedRows = useMemo(
    () => groupProjectReviews(filtered, cycleType, activeCycle),
    [filtered, cycleType, activeCycle],
  );

  // Sort applies to the GROUPED rows. Defaults: when no explicit sort
  // is set, fall through to the deterministic order from
  // `groupProjectReviews` (employee asc, then FY desc).
  const sortedGroups = useMemo(() => {
    if (!sort) return groupedRows;
    return groupedRows.slice().sort((a, b) => {
      const { kind, get } = READ_ONLY_SORT_CONFIG[sort.key];
      return compareValues(get(a), get(b), kind, sort.direction);
    });
  }, [groupedRows, sort]);

  // Apply the Progress filter AFTER sort so toggling Progress doesn't
  // re-trigger the sort comparator. Reads `reviewedCount` /
  // `totalSlots` already computed during grouping — O(N) pass.
  const visibleGroups = useMemo(() => {
    if (progressFilter === "all") return sortedGroups;
    return sortedGroups.filter((g) => {
      if (g.totalSlots === 0) return false;
      if (progressFilter === "complete") return g.reviewedCount === g.totalSlots;
      if (progressFilter === "not_started") return g.reviewedCount === 0;
      // in_progress: at least one reviewed, at least one not
      return g.reviewedCount > 0 && g.reviewedCount < g.totalSlots;
    });
  }, [sortedGroups, progressFilter]);

  // Count of actual review ROWS backing the currently-visible groups.
  // Sum of slots that have a real `review` object — excludes
  // upcoming/awaiting placeholders (those don't correspond to a DB
  // row). Used by the toolbar counter so the displayed total updates
  // with both server-side filters AND the client-side Progress
  // filter. Without this the counter staid stuck on `serverTotal`
  // — which only reflects the server filter set.
  const visibleReviewCount = useMemo(
    () =>
      visibleGroups.reduce(
        (sum, g) => sum + g.slots.filter((s) => s.review !== null).length,
        0,
      ),
    [visibleGroups],
  );

  // Virtualizer dropped (PR #74). At max 50 rows per page the
  // virtualization overhead doesn't pay off and complicated the
  // variable-height Project cell wrap. Plain map() is enough.

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
                    {/* StringCombobox so this filter behaves like its
                        siblings (Employee, Project) on the same row.
                        Empty string is the no-filter sentinel; the
                        underlying setFilter handles the translation
                        back to the AllProjectReviewsFilters shape. */}
                    <StringCombobox
                      id="ro-pm-filter"
                      options={pms}
                      value={activeFilters.pm ?? ""}
                      onChange={(v) => setFilter("pm", v)}
                      placeholder="All PMs"
                    />
                  </div>
                )}
                {/* Year + Period replace the single Cycle dropdown.
                    The flat list of (period × FY) cycles grew long
                    once multiple FYs accumulated — a single dropdown
                    forced HR to scan 8-10+ rows to pick "H1 of last
                    year". Splitting maps to the two cognitive steps
                    HR already takes (year first, then period) and
                    keeps each dropdown short forever. */}
                {cycleYears.length > 0 && (
                  <div className="flex items-center gap-2">
                    <label htmlFor="ro-fy-filter" className={filterLabelCls}>
                      Year
                    </label>
                    <select
                      id="ro-fy-filter"
                      value={
                        activeFilters.fy_year !== undefined
                          ? String(activeFilters.fy_year)
                          : "all"
                      }
                      onChange={(e) => {
                        // Clearing the cycle override is important
                        // because once both Year + Period are picked,
                        // the request-params builder collapses them
                        // to `cycle` — leaving a stale `cycle` in
                        // state would shadow the new Year selection
                        // on subsequent picks.
                        const next: AllProjectReviewsFilters = { ...activeFilters };
                        next.cycle = undefined;
                        next.fy_year =
                          e.target.value === "all"
                            ? undefined
                            : Number(e.target.value);
                        setActiveFilters(next);
                      }}
                      className={`${filterSelectCls} min-w-[120px]`}
                    >
                      <option value="all">All Years</option>
                      {cycleYears.map((y) => (
                        <option key={y} value={String(y)}>
                          {formatFyYearSpan(y)}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                {/* Period filter was dropped when the table moved to
                    grouped rows — chip-column position already aligns
                    same-period chips across rows (Q3 always sits 3rd
                    from the left), so a "narrow to H1" dropdown didn't
                    add narrowing power. The chip-cell legend conveys
                    state directly. Year still narrows row count; the
                    period dim/highlight UI is gone with the dropdown. */}
                {/* Progress filter — replaces the legacy Status
                    dropdown (Pending PM / Reviewed). Status's
                    per-review semantics break under grouping (a
                    group has multiple statuses, one per chip).
                    Progress narrows at the GROUP level: "show me
                    everyone with at least one cycle still owed" =
                    In Progress + Not Started; "show me where all
                    work is done" = Complete. Client-side only — no
                    server roundtrip on toggle. */}
                <div className="flex items-center gap-2">
                  <label htmlFor="ro-progress-filter" className={filterLabelCls}>
                    Progress
                  </label>
                  <select
                    id="ro-progress-filter"
                    value={progressFilter}
                    onChange={(e) =>
                      setProgressFilter(
                        e.target.value as typeof progressFilter,
                      )
                    }
                    className={`${filterSelectCls} min-w-[140px]`}
                  >
                    {/* Labels chosen for self-explanatory reading:
                        each option states the relationship to the
                        "reviewed" state of cycles in the row. The
                        underlying values stay unchanged so the
                        filter logic in `visibleGroups` doesn't need
                        to know about the renaming. */}
                    <option value="all">All</option>
                    <option value="complete">Fully Reviewed</option>
                    <option value="in_progress">Partially Reviewed</option>
                    <option value="not_started">Not Reviewed</option>
                  </select>
                </div>
              </>
            );
          })()}
          <span className="text-xs text-text-muted">
            {/* Counter reflects what's actually visible: groups (the
                row unit) + the underlying review count. Both update
                with every filter change — server-side ones reshape
                `visibleGroups` via the request, the client-side
                Progress filter narrows it again. Using
                `visibleReviewCount` instead of `serverTotal` keeps
                the count in sync with the post-Progress-filter view;
                `serverTotal` lags because it only reflects the
                server filter set. */}
            {visibleGroups.length}{" "}
            {visibleGroups.length === 1 ? "row" : "rows"}
            {visibleReviewCount > 0 && (
              <>
                {" · "}
                {visibleReviewCount}{" "}
                {visibleReviewCount === 1 ? "review" : "reviews"}
              </>
            )}
          </span>
          <ClearFiltersButton
            active={hasActiveFilters}
            // In uncontrolled mode (Mentor) reset to the page default
            // (Year + Period parsed from defaultCycle) rather than a
            // fully empty filter object — "Clear" means "go back to
            // the entry state", which here is "this cycle's mentee
            // reviews", not the multi-cycle history view. Controlled
            // mode (HR) drives the filter set via
            // `filters`/`onFiltersChange`, so the empty fallback
            // there is fine — HR's parent owns the default-cycle
            // re-pin separately.
            onClear={() => {
              if (!isControlled && defaultCycle) {
                const reset: AllProjectReviewsFilters = {};
                if (defaultYear !== null) reset.fy_year = defaultYear;
                // period intentionally not restored — see URL reader.
                setActiveFilters(reset);
              } else {
                setActiveFilters({});
              }
              // Progress is a separate axis from the server-side
              // filter set — reset it too so "Clear" really clears.
              setProgressFilter("all");
            }}
          />
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
          aria-rowcount={visibleGroups.length}
          className="text-[13px]"
          style={{ minWidth: READ_ONLY_TABLE_MIN_WIDTH_PX }}
        >
          {/* Header — non-virtualized, pinned at top. 5 columns:
              Employee | Project | PM | Year | Cycle Reviews. The
              previous per-cycle Status / Rating / Actions / Cycle
              columns collapsed into the Cycle Reviews chip strip. */}
          <div role="rowgroup" className="bg-slate-50/80 border-b border-border">
            <div
              role="row"
              className="grid items-center"
              style={{ gridTemplateColumns: READ_ONLY_GRID_TEMPLATE_COLUMNS }}
            >
              {/* Running row number ("#") — cumulative across pages
                  via `rowNumberOffset` for the HR (paginated) consumer.
                  The Mentor consumer (non-paginated, offset=0) just
                  numbers from 1; the column stays for visual
                  consistency with the HR view. */}
              <div
                role="columnheader"
                className="text-center px-2 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted"
              >
                #
              </div>
              <div role="columnheader" className="text-left px-5 py-2.5">
                <SortableHeader
                  label={employeeColumnLabel}
                  columnKey="employee_name"
                  sort={sort}
                  onSort={setSort}
                />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Project" columnKey="project_name" sort={sort} onSort={setSort} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                {/* Non-sortable header. Wraps the label in an
                    inline-flex span so the inner-text geometry
                    matches the sortable headers' <SortableHeader>
                    (which renders a <button> with inline-flex). The
                    outer <div> uses the same px-4 / py-2.5 padding,
                    and the inner span carries the typography — so a
                    "Project Code" header text aligns at the exact
                    same x-offset as the body cell's
                    "MIL-PRJ-101". */}
                <span className="inline-flex items-center text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Project Code
                </span>
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader
                  label="Project Manager"
                  columnKey="pm_name"
                  sort={sort}
                  onSort={setSort}
                />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                <SortableHeader label="Year" columnKey="fy_year" sort={sort} onSort={setSort} />
              </div>
              <div role="columnheader" className="text-left px-4 py-2.5">
                {/* Sortable header + a popover legend button so HR
                    can see real chip swatches alongside the
                    descriptions. The popover renders via portal so
                    the table's `overflow-x-auto` wrapper doesn't
                    clip it; hover-with-delay + click-to-pin gives
                    both casual and keyboard / touch users an
                    equivalent path. */}
                <div className="flex items-center gap-1.5">
                  <SortableHeader
                    label="Cycle Reviews"
                    columnKey="progress"
                    sort={sort}
                    onSort={setSort}
                  />
                  <CycleReviewsLegendButton />
                </div>
              </div>
            </div>
          </div>

          {/* Body — either the no-matches branch or the virtualized
              scroll container. */}
          {visibleGroups.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <Search className="h-6 w-6 text-text-muted mx-auto mb-1" aria-hidden="true" />
              <p className="text-[13px] text-text-main font-medium">No matching reviews</p>
              <p className="text-[11px] text-text-muted mt-0.5">
                Try adjusting your filters or search query.
              </p>
            </div>
          ) : (
            <div role="rowgroup">
              {visibleGroups.map((group, idx) => {
                return (
                    <div
                      role="row"
                      aria-rowindex={idx + 1}
                      key={group.key}
                      style={{
                        gridTemplateColumns: READ_ONLY_GRID_TEMPLATE_COLUMNS,
                      }}
                      className="grid items-center hover:bg-slate-50/60 transition-colors border-b border-border/50"
                    >
                      {/* # — `rowNumberOffset` is `(page - 1) * pageSize`
                          for the HR consumer, 0 for Mentor. */}
                      <div
                        role="cell"
                        className="px-2 py-3 text-center text-text-muted tabular-nums text-xs"
                      >
                        {(rowNumberOffset + idx + 1).toLocaleString()}
                      </div>
                      <div role="cell" className="px-5 py-3 font-medium text-text-main truncate">
                        {group.employee_name}
                      </div>
                      <div role="cell" className="px-4 py-3 font-medium text-text-main truncate">
                        {group.project_name}
                      </div>
                      <div role="cell" className="px-4 py-3 font-mono text-[11px] text-text-muted truncate">
                        {group.project_code}
                      </div>
                      <div role="cell" className="px-4 py-3 text-text-muted truncate">
                        {group.pm_name ?? "—"}
                      </div>
                      <div role="cell" className="px-4 py-3">
                        <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                          {formatFyYearSpan(group.fy_year)}
                        </span>
                      </div>
                      <div role="cell" className="px-4 py-3">
                        {/* "X of N reviewed" fraction. Lock indicator
                            replaces the count when the org-wide
                            project_ratings_visible gate is off and
                            the viewer would be downstream of that
                            gate (HR + Mentor consumers bypass it via
                            their parent passing true). */}
                        {projectRatingsVisible ? (
                          <p className="text-[11px] text-text-muted mb-1.5">
                            <span className="font-semibold text-text-main tabular-nums">
                              {group.reviewedCount}
                            </span>
                            {" "}of{" "}
                            <span className="tabular-nums">{group.totalSlots}</span>
                            {" "}reviewed
                          </p>
                        ) : (
                          <p className="text-[11px] text-text-muted/60 mb-1.5 inline-flex items-center gap-1">
                            <Lock className="h-3 w-3" /> Ratings hidden
                          </p>
                        )}
                        <div className="flex flex-wrap items-center gap-1">
                          {group.slots.map((slot) => (
                            <CycleReviewChip
                              key={slot.cycleName}
                              slot={slot}
                              onClick={(s) => {
                                if (s.review) setViewTarget(s.review);
                              }}
                            />
                          ))}
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      </div>

      {/* Read-only review detail modal — opened from the View button on
          the HR All Reviews tab and Mentor Team Reviews tab. The row
          payload already carries every field the modal renders, so this
          is purely a presentation step (no extra fetch).

          `projectRatingsVisible={true}` is correct here: both surfaces
          that open this modal (HR / Mentor) bypass the org-wide
          `project_ratings_visible` gate, which only governs what an
          Employee sees on their own reviews. Hiding the rating from
          the user who *set* it defeats the purpose. */}
      {viewTarget && (
        <ProjectReviewDetailModal
          review={viewTarget}
          onClose={() => setViewTarget(null)}
          projectRatingsVisible={true}
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
