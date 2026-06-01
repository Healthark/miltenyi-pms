import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Pencil, UserX, UserCheck } from "lucide-react";
import { setOrDeleteParam, searchParamsChanged } from "@/utils/searchParams";
import {
  adminService,
  type UserResponse,
  type UsersPaginatedSortBy,
} from "@/services/admin.service";
import { queryKeys } from "@/lib/queryKeys";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { RoleBadge } from "@/components/admin/RoleBadge";
import { ExportExcelButton } from "@/components/admin/ExportExcelButton";
import { SortableHeader } from "@/components/SortableHeader";
import { StringCombobox } from "@/components/common/StringCombobox";
import { ClearFiltersButton } from "@/components/common/ClearFiltersButton";
import { Pagination } from "@/components/common/Pagination";
import { useAuth } from "@/hooks/useAuth";
import {
  type SortState,
} from "@/utils/sort";

interface UsersTabProps {
  readonly users: UserResponse[];
  readonly isLoading: boolean;
  readonly searchQuery: string;
  readonly onSearchChange: (query: string) => void;
  readonly onEdit: (user: UserResponse) => void;
  readonly onDeactivate: (user: UserResponse) => void;
  readonly onReactivate: (user: UserResponse) => void;
}

// Sort keys the SERVER can ORDER BY (mirrors backend `_USERS_SORT_COLUMNS`).
// mentor_name + project_manager_names sorts are intentionally deferred —
// they'd need correlated subqueries. Status column sort is also dropped
// (frontend can derive it from is_deleted but the backend doesn't expose
// a corresponding column); HR can use the Status filter instead.
type UsersSortKey =
  | "full_name"
  | "email"
  | "role"
  | "function_name"
  | "designation_name";

type RoleFilter = "all" | "HR_MyOrg" | "HR_Miltenyi" | "Mentor" | "PM" | "Employee";
type StatusFilter = "all" | "active" | "inactive";

// ── Virtualised-table layout constants ────────────────────────────────
// Shared 9-column CSS Grid template — applies to BOTH the header row
// and every body row so columns stay perfectly aligned (no <table>
// magic doing the alignment for us). Widths are tuned so the densest
// columns (Employee, Email) get the most room while badge/icon columns
// stay narrow. `minmax(Npx, Mfr)` lets each cell shrink to its minimum
// before flexing — important because the table sits inside a horizontal
// scroll wrapper on narrow viewports.
const USERS_GRID_TEMPLATE_COLUMNS =
  "minmax(32px, 40px) " +      // # (tight cap — no flex growth)
  "minmax(180px, 1.4fr) " +    // Employee (name + employee_code)
  "minmax(180px, 1.6fr) " +    // Email
  "minmax(110px, 0.8fr) " +    // Role
  "minmax(130px, 1.1fr) " +    // Function
  "minmax(130px, 1.1fr) " +    // Designation
  "minmax(150px, 1.2fr) " +    // Mentor / Project Manager
  "minmax(110px, 0.9fr) " +    // Phone
  "minmax(90px, 0.7fr) " +     // Status
  "minmax(110px, 0.8fr)";      // Actions

// Sum of the minimums above + breathing room. Drives the outer wrapper's
// min-width so the wrapper's horizontal scroll engages BEFORE any
// inner div overflows. Mirrors the pattern in AnnualGoals / ManagementReview.
const USERS_TABLE_MIN_WIDTH_PX = 1322;

// Uniform row height — applied as inline style now that the virtualizer
// (PR #74) no longer enforces it implicitly. text-sm + py-3.5 + two
// stacked lines in the Employee cell ≈ 58px observed in dev.
const USERS_ROW_HEIGHT_PX = 58;

// Body scroll-viewport + overscan constants removed (PR #74). At max
// 50 rows per page the previous virtualization isn't paying off.

/** Mentor-filter sentinel meaning "rows whose mentor_id is NULL".
 *  Distinct from "all" (no filter) so HR can specifically find
 *  unmentored Employees — a frequent setup-time chase. Uses the
 *  literal display label as the wire value so it can sit directly
 *  inside StringCombobox's flat string[] options (no wrapper / value-
 *  vs-label mapping needed). Parentheses + leading space make
 *  collision with a real full_name impossible. */
const NO_MENTOR_SENTINEL = "(No mentor)";

const ROLE_OPTIONS: { value: RoleFilter; label: string }[] = [
  { value: "all", label: "All Roles" },
  { value: "HR_MyOrg", label: "HR · Healthark" },
  { value: "HR_Miltenyi", label: "HR · Miltenyi" },
  { value: "Mentor", label: "Mentor" },
  { value: "PM", label: "PM" },
  { value: "Employee", label: "Employee" },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Deactivated" },
];

// HR_Miltenyi cannot edit or deactivate Mentor / HR_MyOrg rows (security boundary).
const PROTECTED_ROLES = new Set<string>(["Mentor", "HR_MyOrg"]);

// USERS_SORT_CONFIG removed (PR #74). Sort now flows to the server via
// `sort_by` / `sort_dir` query params; the per-column comparators are
// no longer needed on the client.

const FILTER_LABEL_CLS =
  "text-[11px] font-bold uppercase tracking-wider text-text-muted";
const FILTER_SELECT_CLS =
  "rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";

export function UsersTab({
  users,
  isLoading,
  searchQuery,
  onSearchChange,
  onEdit,
  onDeactivate,
  onReactivate,
}: UsersTabProps) {
  const [sort, setSort] = useState<SortState<UsersSortKey> | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  // Default Status to "active" — HR almost always wants the live
  // roster first; deactivated rows are a less-frequent audit need
  // (mirrors ProjectsTab's status=active default). HR can still
  // click "All" or "Inactive" to broaden.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");
  const [functionFilter, setFunctionFilter] = useState<string>("all");
  const [designationFilter, setDesignationFilter] = useState<string>("all");
  const [mentorFilter, setMentorFilter] = useState<string>("all");
  // Parallel filter for HR_Miltenyi viewers — the Mentor column is
  // replaced with Project Manager for them, so the relation filter
  // beside it tracks PM names instead.
  const [pmFilter, setPmFilter] = useState<string>("all");

  // Read deep-link params on first mount and seed the filters. Today's
  // known senders: HeadcountCard legend rows could deep-link to
  // /admin?tab=users&role=Mentor (future); generic ?status=…&role=…
  // covers anything else. Ref guard fires once per mount; user edits
  // afterwards are preserved.
  const [searchParams, setSearchParams] = useSearchParams();
  const usersTabDefaultedRef = useRef(false);
  useEffect(() => {
    if (usersTabDefaultedRef.current) return;
    const urlRole = searchParams.get("role");
    const urlStatus = searchParams.get("status");
    // `?mentor=` accepts a literal full_name OR the `(No mentor)`
    // sentinel meaning unmentored. MentorCoverageCard's "View all"
    // uses this to land HR directly on the unmentored-Employee list.
    const urlMentor = searchParams.get("mentor");
    const urlPm = searchParams.get("pm");
    const urlFunction = searchParams.get("function");
    const urlDesignation = searchParams.get("designation");
    if (urlRole) setRoleFilter(urlRole as RoleFilter);
    if (urlStatus) setStatusFilter(urlStatus as StatusFilter);
    if (urlMentor) setMentorFilter(urlMentor);
    if (urlPm) setPmFilter(urlPm);
    if (urlFunction) setFunctionFilter(urlFunction);
    if (urlDesignation) setDesignationFilter(urlDesignation);
    usersTabDefaultedRef.current = true;
  }, [searchParams]);

  // Write-back: mirror UsersTab filter state to URL so refresh +
  // share-link preserves the view. Preserves `?tab=` and any other
  // unrelated AdminPanel-level params (we only set/delete the keys
  // this component owns). Gated on the reader ref so first render's
  // defaults can't clobber URL params before they're consumed.
  useEffect(() => {
    if (!usersTabDefaultedRef.current) return;
    const next = new URLSearchParams(searchParams);
    setOrDeleteParam(next, "role", roleFilter);
    setOrDeleteParam(next, "status", statusFilter);
    setOrDeleteParam(next, "function", functionFilter);
    setOrDeleteParam(next, "designation", designationFilter);
    setOrDeleteParam(next, "mentor", mentorFilter);
    setOrDeleteParam(next, "pm", pmFilter);
    if (searchParamsChanged(searchParams, next)) {
      setSearchParams(next, { replace: true });
    }
  }, [
    roleFilter,
    statusFilter,
    functionFilter,
    designationFilter,
    mentorFilter,
    pmFilter,
    searchParams,
    setSearchParams,
  ]);

  // Dropdown options derived from the loaded users so we never show
  // a function/designation that has no row to match.
  const availableFunctions = useMemo(
    () =>
      Array.from(
        new Set(
          users.map((u) => u.function?.name).filter((n): n is string => !!n),
        ),
      ).sort(),
    [users],
  );
  const availableDesignations = useMemo(
    () =>
      Array.from(
        new Set(
          users.map((u) => u.designation?.name).filter((n): n is string => !!n),
        ),
      ).sort(),
    [users],
  );
  // Resolve each row's mentor_id back to a full_name so the dropdown
  // is a stable name-keyed list. Anyone referenced by at least one
  // user.mentor_id qualifies, regardless of their own role.
  const availableMentors = useMemo(() => {
    const mentorIds = new Set(
      users.map((u) => u.mentor_id).filter((id): id is number => id !== null),
    );
    return Array.from(
      new Set(
        users
          .filter((u) => mentorIds.has(u.id))
          .map((u) => u.full_name),
      ),
    ).sort();
  }, [users]);
  // Available PMs = the union of every Employee's project_manager_names.
  // Drives the Project Manager filter dropdown for HR_Miltenyi viewers.
  const availableProjectManagers = useMemo(() => {
    const names = new Set<string>();
    for (const u of users) {
      for (const name of u.project_manager_names) {
        names.add(name);
      }
    }
    return Array.from(names).sort();
  }, [users]);

  const { user: currentUser } = useAuth();
  const isViewerMiltenyiHR = currentUser?.role === "HR_Miltenyi";

  // True when any filter (or the search box) is narrowing the result
  // set. `statusFilter` defaults to "all" — same as every other filter
  // — so the check is uniform.
  const hasActiveFilters =
    searchQuery.trim().length > 0 ||
    roleFilter !== "all" ||
    statusFilter !== "all" ||
    functionFilter !== "all" ||
    designationFilter !== "all" ||
    mentorFilter !== "all" ||
    pmFilter !== "all";

  const clearFilters = () => {
    onSearchChange("");
    setRoleFilter("all");
    setStatusFilter("all");
    setFunctionFilter("all");
    setDesignationFilter("all");
    setMentorFilter("all");
    setPmFilter("all");
  };

  /** True if the current viewer is allowed to edit/deactivate this row.
   *  HR_MyOrg can touch any user; HR_Miltenyi cannot touch Mentor or HR_MyOrg rows. */
  const canMutateRow = (target: UserResponse): boolean => {
    if (!isViewerMiltenyiHR) return true;
    return !PROTECTED_ROLES.has(target.role);
  };

  // ── Server-side paginated query (PR #74) ────────────────────────────
  // Switch from client-side filter/sort against the `users` prop (still
  // received from AdminPanel for dropdown options + mentor lookup) to a
  // separate paginated query that pushes the filter + sort + page state
  // to GET /admin/users/paginated. The `users` prop is the FULL
  // roster — keeping it as the dropdown-options + mentor-name-lookup
  // source means no filter-option shrink-on-narrow bug. The new query
  // drives only what the table body renders.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  // Build the wire params from filter state. The legacy `"all"` /
  // `""` sentinels collapse to "no filter" by omitting the field.
  const queryFilterParams = useMemo(() => {
    const params: Record<string, string | number> = {};
    const search = searchQuery.trim();
    if (search) params.search = search;
    if (roleFilter !== "all") params.role = roleFilter;
    if (statusFilter !== "all") params.status = statusFilter;
    if (functionFilter !== "all") params.function_name = functionFilter;
    if (designationFilter !== "all") params.designation_name = designationFilter;
    if (mentorFilter !== "all") params.mentor_name = mentorFilter;
    if (pmFilter !== "all") params.pm_name = pmFilter;
    if (sort) {
      params.sort_by = sort.key;
      params.sort_dir = sort.direction;
    }
    return params;
  }, [
    searchQuery,
    roleFilter,
    statusFilter,
    functionFilter,
    designationFilter,
    mentorFilter,
    pmFilter,
    sort,
  ]);

  // Reset to page 1 when filters or sort change — otherwise a user
  // narrowing the result set from page 5 lands on an empty table.
  const queryFilterParamsKey = JSON.stringify(queryFilterParams);
  useEffect(() => {
    setPage(1);
  }, [queryFilterParamsKey]);

  const paginatedQuery = useQuery({
    queryKey: queryKeys.admin.usersPaginated({
      ...queryFilterParams,
      _page: page,
      _pageSize: pageSize,
    }),
    queryFn: () =>
      adminService.getUsersPaginated({
        ...queryFilterParams,
        sort_by: sort?.key as UsersPaginatedSortBy | undefined,
        sort_dir: sort?.direction,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
  });

  // Page-slice rows + server total. `visibleUsers` keeps the same name
  // the old client-side code used so downstream JSX is unchanged.
  // Viewer-role scope filter still runs client-side on the page slice:
  // HR_Miltenyi shouldn't see Mentor/HR_MyOrg rows. The server doesn't
  // know about that viewer-role projection (it's a UI concern), so we
  // strip them after the page lands. The `total` shown by the
  // Pagination toolbar still reflects the SERVER total — slightly
  // overstated for HR_Miltenyi when Mentor/HR_MyOrg rows exist. Per
  // the plan that's an acceptable trade-off (the protection lives at
  // the mutation layer; HR_Miltenyi never sees actionable buttons on
  // those rows anyway). Future: push the viewer-role projection
  // server-side so the count agrees.
  const pageItems = paginatedQuery.data?.items ?? [];
  const totalCount = paginatedQuery.data?.total ?? 0;
  const visibleUsers = useMemo(
    () =>
      isViewerMiltenyiHR
        ? pageItems.filter((u) => !PROTECTED_ROLES.has(u.role))
        : pageItems,
    [pageItems, isViewerMiltenyiHR],
  );

  // Loading state — `isPending` is only true on the very first fetch.
  // Subsequent page changes keep previous rows visible while the new
  // page lands. Falls back to the prop's `isLoading` when the
  // paginated query hasn't fired yet (paranoid; covers a race where
  // both arrive at once).
  const isPaginatedLoading = paginatedQuery.isPending || isLoading;

  // Role-filter dropdown: HR_Miltenyi never sees Mentor or HR_MyOrg
  // options (those buckets would always read zero for them).
  const visibleRoleOptions = useMemo(
    () =>
      isViewerMiltenyiHR
        ? ROLE_OPTIONS.filter((o) => !PROTECTED_ROLES.has(o.value))
        : ROLE_OPTIONS,
    [isViewerMiltenyiHR],
  );

  // Virtualizer dropped (PR #74). At max 50 rows per page the
  // virtualization overhead isn't paying off. Plain .map() renders
  // the page slice; outer page wrapper keeps the scroll context.

  return (
    <div className="p-5 flex flex-col gap-4">
      {/* Toolbar — search + filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search by name, email or code…"
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-4 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
            aria-label="Search users"
          />
        </div>
        {/* UsersTab-specific toolbar order:
              Search · Function · Designation · Mentor/PM · Role · Status
            Most admin-accessible pages put Role-style categories
            directly after Search (next to Identity), but on the
            Users surface HR usually scans by Function/Designation
            first and only narrows by Role late in the flow — Role
            therefore sits next to Status (both narrow the row count
            in similar ways). Function/Designation stay as the
            primary Category narrowing; Mentor/PM is the Relation
            dimension; Status is the rightmost narrowing before
            actions, consistent with the rest of the app. */}
        {availableFunctions.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="user-function-filter" className={FILTER_LABEL_CLS}>
              Function
            </label>
            <StringCombobox
              id="user-function-filter"
              options={availableFunctions}
              // State uses "all" as the no-filter sentinel; the
              // combobox uses "" — translate on both edges.
              value={functionFilter === "all" ? "" : functionFilter}
              onChange={(v) => setFunctionFilter(v === "" ? "all" : v)}
              placeholder="All"
            />
          </div>
        )}
        {availableDesignations.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="user-designation-filter" className={FILTER_LABEL_CLS}>
              Designation
            </label>
            <StringCombobox
              id="user-designation-filter"
              options={availableDesignations}
              value={designationFilter === "all" ? "" : designationFilter}
              onChange={(v) => setDesignationFilter(v === "" ? "all" : v)}
              placeholder="All"
            />
          </div>
        )}
        {/* Relation filter: HR_MyOrg picks a Mentor; HR_Miltenyi picks
            a Project Manager. Same dropdown slot, different relationship
            and different name source. The other filter's state stays
            on "all" (it's not rendered for the off-side role anyway). */}
        {!isViewerMiltenyiHR && availableMentors.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="user-mentor-filter" className={FILTER_LABEL_CLS}>
              Mentor
            </label>
            <StringCombobox
              id="user-mentor-filter"
              // Prepend the "(No mentor)" sentinel as the first option
              // so HR can pick it directly via type-to-filter (typing
              // "no" narrows to it). Sentinel value === display label
              // — no value/label split needed because parens + space
              // guarantee no collision with a real full_name.
              options={[NO_MENTOR_SENTINEL, ...availableMentors]}
              // State uses "all" as the no-filter sentinel; combobox
              // uses "" — translate on both edges (matches the
              // Function/Designation pattern above).
              value={mentorFilter === "all" ? "" : mentorFilter}
              onChange={(v) => setMentorFilter(v === "" ? "all" : v)}
              placeholder="All Mentors"
            />
          </div>
        )}
        {isViewerMiltenyiHR && availableProjectManagers.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="user-pm-filter" className={FILTER_LABEL_CLS}>
              Project Manager
            </label>
            <StringCombobox
              id="user-pm-filter"
              options={availableProjectManagers}
              value={pmFilter === "all" ? "" : pmFilter}
              onChange={(v) => setPmFilter(v === "" ? "all" : v)}
              placeholder="All Project Managers"
            />
          </div>
        )}
        <div className="flex items-center gap-2">
          <label htmlFor="user-role-filter" className={FILTER_LABEL_CLS}>Role</label>
          <select
            id="user-role-filter"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
            className={`${FILTER_SELECT_CLS} min-w-[140px]`}
          >
            {visibleRoleOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="user-status-filter" className={FILTER_LABEL_CLS}>Status</label>
          <select
            id="user-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className={`${FILTER_SELECT_CLS} min-w-[120px]`}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ClearFiltersButton active={hasActiveFilters} onClear={clearFilters} />
          <ExportExcelButton kind="users" />
        </div>
      </div>

      {/* User list. Header sits ABOVE the body div; CSS Grid template
          is shared so columns align without <table> magic. */}
      {isPaginatedLoading ? (
        <div className="flex items-center justify-center py-16 text-sm text-text-muted">
          Loading users…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <div
            role="table"
            aria-label="Users"
            aria-rowcount={visibleUsers.length}
            className="text-sm"
            style={{ minWidth: USERS_TABLE_MIN_WIDTH_PX }}
          >
            {/* Header */}
            <div role="rowgroup" className="bg-slate-50 border-b border-border">
              <div
                role="row"
                className="grid items-center text-left"
                style={{ gridTemplateColumns: USERS_GRID_TEMPLATE_COLUMNS }}
              >
                {/* Running row number ("#") — cumulative across pages,
                    matches the "Showing N–M of T" counter below. */}
                <div
                  role="columnheader"
                  className="text-center px-2 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted"
                >
                  #
                </div>
                <div role="columnheader" className="px-5 py-3">
                  <SortableHeader label="Employee" columnKey="full_name" sort={sort} onSort={setSort} />
                </div>
                <div role="columnheader" className="px-5 py-3">
                  <SortableHeader label="Email" columnKey="email" sort={sort} onSort={setSort} />
                </div>
                <div role="columnheader" className="px-5 py-3">
                  <SortableHeader label="Role" columnKey="role" sort={sort} onSort={setSort} />
                </div>
                <div role="columnheader" className="px-5 py-3">
                  <SortableHeader label="Function" columnKey="function_name" sort={sort} onSort={setSort} />
                </div>
                <div role="columnheader" className="px-5 py-3">
                  <SortableHeader label="Designation" columnKey="designation_name" sort={sort} onSort={setSort} />
                </div>
                {/* Mentor / Project Manager — not sortable in this PR
                    (PR #74 plan: derived columns deferred; would need
                    correlated subqueries). Rendered as plain headers
                    so the visual style matches the others without the
                    chevron affordance. */}
                <div
                  role="columnheader"
                  className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted"
                >
                  {isViewerMiltenyiHR ? "Project Manager" : "Mentor"}
                </div>
                <div
                  role="columnheader"
                  className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted"
                >
                  Phone
                </div>
                {/* Status — non-sortable; HR can use the Status filter
                    above. The backend doesn't expose a `status` sort
                    column (is_deleted is a bool, lifecycle ordering
                    is computed client-side and would need a CASE-WHEN
                    on the server to match). */}
                <div
                  role="columnheader"
                  className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted"
                >
                  Status
                </div>
                <div
                  role="columnheader"
                  className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted"
                >
                  Actions
                </div>
              </div>
            </div>

            {/* Body — plain .map() over the page slice. */}
            {visibleUsers.length === 0 ? (
              <div className="px-5 py-10 text-center text-text-muted">
                No users match your filters.
              </div>
            ) : (
              <div role="rowgroup">
                  {visibleUsers.map((user, idx) => {
                    const mutable = canMutateRow(user);
                    return (
                      <div
                        key={user.id}
                        role="row"
                        aria-rowindex={idx + 1}
                        className={`grid items-center border-b border-border/70 transition-colors hover:bg-slate-50 ${
                          user.is_deleted ? "opacity-60" : ""
                        }`}
                        style={{
                          height: USERS_ROW_HEIGHT_PX,
                          gridTemplateColumns: USERS_GRID_TEMPLATE_COLUMNS,
                        }}
                      >
                        {/* # — cumulative across pages */}
                        <div
                          role="cell"
                          className="px-2 text-center text-text-muted tabular-nums text-xs"
                        >
                          {((page - 1) * pageSize + idx + 1).toLocaleString()}
                        </div>
                        <div role="cell" className="px-5">
                          <div className="font-medium text-text-main truncate">
                            {user.full_name}
                          </div>
                          <div className="text-xs text-text-muted truncate">
                            {user.employee_code}
                          </div>
                        </div>
                        <div role="cell" className="px-5 text-text-muted truncate">
                          {user.email}
                        </div>
                        <div role="cell" className="px-5">
                          <RoleBadge role={user.role} />
                        </div>
                        <div role="cell" className="px-5 text-text-muted truncate">
                          {user.function?.name ?? "—"}
                        </div>
                        <div role="cell" className="px-5 text-text-muted truncate">
                          {user.designation?.name ?? "—"}
                        </div>
                        <div role="cell" className="px-5 text-text-muted truncate">
                          {isViewerMiltenyiHR
                            ? user.project_manager_names.length > 0
                              ? user.project_manager_names.join(", ")
                              : "—"
                            : users.find((u) => u.id === user.mentor_id)
                                ?.full_name ?? "—"}
                        </div>
                        <div role="cell" className="px-5 text-text-muted truncate">
                          {user.phone ?? "—"}
                        </div>
                        <div role="cell" className="px-5">
                          <StatusBadge isDeleted={user.is_deleted} />
                        </div>
                        <div role="cell" className="px-5">
                          <div className="flex items-center gap-2">
                            {mutable ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => onEdit(user)}
                                  title="Edit user"
                                  className="rounded-md p-1.5 text-text-muted hover:bg-brand-light hover:text-brand transition-colors"
                                >
                                  <Pencil className="h-4 w-4" aria-hidden="true" />
                                </button>
                                {!user.is_deleted && (
                                  <button
                                    type="button"
                                    onClick={() => onDeactivate(user)}
                                    title="Deactivate user"
                                    className="rounded-md p-1.5 text-text-muted hover:bg-red-50 hover:text-red-600 transition-colors"
                                  >
                                    <UserX className="h-4 w-4" aria-hidden="true" />
                                  </button>
                                )}
                                {user.is_deleted && (
                                  <button
                                    type="button"
                                    onClick={() => onReactivate(user)}
                                    title="Reactivate user"
                                    className="rounded-md p-1.5 text-text-muted hover:bg-green-50 hover:text-green-600 transition-colors"
                                  >
                                    <UserCheck className="h-4 w-4" aria-hidden="true" />
                                  </button>
                                )}
                              </>
                            ) : (
                              <span
                                title="Only Healthark HR can edit Mentor or Healthark HR users."
                                className="text-xs italic text-text-muted"
                              >
                                View-only
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Pagination toolbar — sits below the table. The component
          handles its own zero-total state; we still hide it during
          the very first load so we don't flash controls on a
          skeleton table. */}
      {!isPaginatedLoading && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={totalCount}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
          entityLabel="users"
        />
      )}
    </div>
  );
}
