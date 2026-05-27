import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Search, Pencil, UserX, UserCheck } from "lucide-react";
import { setOrDeleteParam, searchParamsChanged } from "@/utils/searchParams";
import type { UserResponse } from "@/services/admin.service";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { RoleBadge } from "@/components/admin/RoleBadge";
import { ExportExcelButton } from "@/components/admin/ExportExcelButton";
import { SortableHeader } from "@/components/SortableHeader";
import { StringCombobox } from "@/components/common/StringCombobox";
import { ClearFiltersButton } from "@/components/common/ClearFiltersButton";
import { useAuth } from "@/hooks/useAuth";
import {
  compareValues,
  type SortKind,
  type SortState,
  type SortValue,
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

type UsersSortKey =
  | "full_name"
  | "email"
  | "role"
  | "mentor_name"
  | "project_manager_names"
  | "function_name"
  | "designation_name"
  | "status";

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
const USERS_TABLE_MIN_WIDTH_PX = 1290;

// Rows are uniform height (text-sm + py-3.5 padding + two stacked
// lines in the Employee cell). No measureElement needed because no
// expansion / variable content. ~58px observed in dev.
const USERS_ROW_HEIGHT_PX = 58;

// Body scroll viewport. Picked so ~10 rows are visible without
// scrolling on a typical desktop — same heuristic as AnnualGoals.
const USERS_SCROLL_HEIGHT_PX = 600;

// Standard overscan for uniform-height rows. Higher than AnnualGoals
// (which uses 4 because expanded rows are tall and re-render cost is
// real) — here every row is small and cheap, so a larger window keeps
// scroll smooth on slower devices.
const USERS_OVERSCAN = 8;

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

const USERS_SORT_CONFIG: Record<
  UsersSortKey,
  { kind: SortKind; get: (u: UserResponse, all: readonly UserResponse[]) => SortValue }
> = {
  full_name:        { kind: "alpha", get: (u) => u.full_name },
  email:            { kind: "alpha", get: (u) => u.email },
  role:             { kind: "alpha", get: (u) => u.role },
  mentor_name:      {
    kind: "alpha",
    get: (u, all) =>
      u.mentor_id ? all.find((x) => x.id === u.mentor_id)?.full_name ?? null : null,
  },
  project_manager_names: {
    kind: "alpha",
    get: (u) =>
      u.project_manager_names.length > 0
        ? u.project_manager_names.join(", ")
        : null,
  },
  function_name:    { kind: "alpha", get: (u) => u.function?.name ?? null },
  designation_name: { kind: "alpha", get: (u) => u.designation?.name ?? null },
  status:           { kind: "alpha", get: (u) => (u.is_deleted ? "Inactive" : "Active") },
};

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

  const visibleUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = users.filter((u) => {
      // Viewer-role scope: HR_Miltenyi never sees Healthark's Mentor or
      // HR_MyOrg rows in the table. The full `users` array stays intact
      // so the Mentor column's name lookup (and the sort comparator)
      // still resolves names of those hidden mentors.
      if (isViewerMiltenyiHR && PROTECTED_ROLES.has(u.role)) return false;
      if (q) {
        const matchesSearch =
          u.full_name.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.employee_code.toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (statusFilter === "active" && u.is_deleted) return false;
      if (statusFilter === "inactive" && !u.is_deleted) return false;
      if (functionFilter !== "all" && u.function?.name !== functionFilter) return false;
      if (designationFilter !== "all" && u.designation?.name !== designationFilter) return false;
      if (mentorFilter !== "all") {
        // "(No mentor)" sentinel: pass only rows whose mentor_id is
        // NULL. Other values match against the resolved mentor name.
        if (mentorFilter === NO_MENTOR_SENTINEL) {
          if (u.mentor_id !== null) return false;
        } else {
          const mentorName = u.mentor_id
            ? users.find((m) => m.id === u.mentor_id)?.full_name
            : null;
          if (mentorName !== mentorFilter) return false;
        }
      }
      if (pmFilter !== "all") {
        // Row passes when its PM set contains the selected name.
        if (!u.project_manager_names.includes(pmFilter)) return false;
      }
      return true;
    });
    if (!sort) return filtered;
    const { kind, get } = USERS_SORT_CONFIG[sort.key];
    return filtered.slice().sort((a, b) =>
      compareValues(get(a, users), get(b, users), kind, sort.direction),
    );
  }, [users, searchQuery, roleFilter, statusFilter, functionFilter, designationFilter, mentorFilter, pmFilter, sort, isViewerMiltenyiHR]);

  // Role-filter dropdown: HR_Miltenyi never sees Mentor or HR_MyOrg
  // options (those buckets would always read zero for them).
  const visibleRoleOptions = useMemo(
    () =>
      isViewerMiltenyiHR
        ? ROLE_OPTIONS.filter((o) => !PROTECTED_ROLES.has(o.value))
        : ROLE_OPTIONS,
    [isViewerMiltenyiHR],
  );

  // ── Virtualisation ───────────────────────────────────────────────────
  // Uniform-height rows (no expansion / variable content) so we can
  // use a constant estimateSize and skip measureElement entirely.
  // Stable item key by user.id keeps any future re-render cycles from
  // re-mounting rows that didn't actually move.
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual's useVirtualizer returns non-memoisable functions; React Compiler logs a benign skip here.
  const rowVirtualizer = useVirtualizer({
    count: visibleUsers.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => USERS_ROW_HEIGHT_PX,
    overscan: USERS_OVERSCAN,
    getItemKey: (index) => visibleUsers[index].id,
  });

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
              // Function/Designation pattern below).
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

      {/* Virtualised user list. Replaces a vanilla <table> so we can
          render only the rows in the current scroll window — cheap
          today (<200 users) but prevents O(n) DOM growth as the org
          grows. The outer wrapper handles horizontal scroll on narrow
          viewports; the inner ref'd div handles vertical scroll +
          virtualisation. Header sits OUTSIDE the scroll container so
          it remains visible as the body scrolls. CSS Grid template is
          shared between header + body rows so columns align without
          <table> magic. */}
      {isLoading ? (
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
            {/* Header — non-virtualised, sits above the scroll viewport. */}
            <div role="rowgroup" className="bg-slate-50 border-b border-border">
              <div
                role="row"
                className="grid items-center text-left"
                style={{ gridTemplateColumns: USERS_GRID_TEMPLATE_COLUMNS }}
              >
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
                <div role="columnheader" className="px-5 py-3">
                  {isViewerMiltenyiHR ? (
                    <SortableHeader
                      label="Project Manager"
                      columnKey="project_manager_names"
                      sort={sort}
                      onSort={setSort}
                    />
                  ) : (
                    <SortableHeader
                      label="Mentor"
                      columnKey="mentor_name"
                      sort={sort}
                      onSort={setSort}
                    />
                  )}
                </div>
                <div
                  role="columnheader"
                  className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted"
                >
                  Phone
                </div>
                <div role="columnheader" className="px-5 py-3">
                  <SortableHeader label="Status" columnKey="status" sort={sort} onSort={setSort} />
                </div>
                <div
                  role="columnheader"
                  className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted"
                >
                  Actions
                </div>
              </div>
            </div>

            {/* Body — virtualised. Empty-state replaces the entire
                scroll container (no rows = nothing to virtualise). */}
            {visibleUsers.length === 0 ? (
              <div className="px-5 py-10 text-center text-text-muted">
                No users match your filters.
              </div>
            ) : (
              <div
                ref={scrollContainerRef}
                role="rowgroup"
                style={{ height: USERS_SCROLL_HEIGHT_PX }}
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
                    const user = visibleUsers[virtualRow.index];
                    const mutable = canMutateRow(user);
                    return (
                      <div
                        key={user.id}
                        role="row"
                        aria-rowindex={virtualRow.index + 1}
                        data-index={virtualRow.index}
                        className={`grid items-center border-b border-border/70 transition-colors hover:bg-slate-50 ${
                          user.is_deleted ? "opacity-60" : ""
                        }`}
                        style={{
                          position: "absolute",
                          top: 0,
                          left: 0,
                          width: "100%",
                          height: USERS_ROW_HEIGHT_PX,
                          transform: `translateY(${virtualRow.start}px)`,
                          gridTemplateColumns: USERS_GRID_TEMPLATE_COLUMNS,
                        }}
                      >
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
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
