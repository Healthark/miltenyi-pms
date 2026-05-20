import { useMemo, useState } from "react";
import { Search, Pencil, UserX, UserCheck } from "lucide-react";
import type { UserResponse } from "@/services/admin.service";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { RoleBadge } from "@/components/admin/RoleBadge";
import { ExportExcelButton } from "@/components/admin/ExportExcelButton";
import { SortableHeader } from "@/components/SortableHeader";
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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [functionFilter, setFunctionFilter] = useState<string>("all");
  const [designationFilter, setDesignationFilter] = useState<string>("all");
  const [mentorFilter, setMentorFilter] = useState<string>("all");
  // Parallel filter for HR_Miltenyi viewers — the Mentor column is
  // replaced with Project Manager for them, so the relation filter
  // beside it tracks PM names instead.
  const [pmFilter, setPmFilter] = useState<string>("all");

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
        const mentorName = u.mentor_id
          ? users.find((m) => m.id === u.mentor_id)?.full_name
          : null;
        if (mentorName !== mentorFilter) return false;
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
            <select
              id="user-mentor-filter"
              value={mentorFilter}
              onChange={(e) => setMentorFilter(e.target.value)}
              className={`${FILTER_SELECT_CLS} min-w-[150px]`}
            >
              <option value="all">All Mentors</option>
              {availableMentors.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}
        {isViewerMiltenyiHR && availableProjectManagers.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="user-pm-filter" className={FILTER_LABEL_CLS}>
              Project Manager
            </label>
            <select
              id="user-pm-filter"
              value={pmFilter}
              onChange={(e) => setPmFilter(e.target.value)}
              className={`${FILTER_SELECT_CLS} min-w-[150px]`}
            >
              <option value="all">All Project Managers</option>
              {availableProjectManagers.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}
        {availableFunctions.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="user-function-filter" className={FILTER_LABEL_CLS}>
              Function
            </label>
            <select
              id="user-function-filter"
              value={functionFilter}
              onChange={(e) => setFunctionFilter(e.target.value)}
              className={`${FILTER_SELECT_CLS} min-w-[140px]`}
            >
              <option value="all">All</option>
              {availableFunctions.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        )}
        {availableDesignations.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="user-designation-filter" className={FILTER_LABEL_CLS}>
              Designation
            </label>
            <select
              id="user-designation-filter"
              value={designationFilter}
              onChange={(e) => setDesignationFilter(e.target.value)}
              className={`${FILTER_SELECT_CLS} min-w-[150px]`}
            >
              <option value="all">All</option>
              {availableDesignations.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
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
        <div className="ml-auto">
          <ExportExcelButton kind="users" />
        </div>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-sm text-text-muted">
          Loading users…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-slate-50 text-left">
                <th className="px-5 py-3">
                  <SortableHeader label="Employee" columnKey="full_name" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Email" columnKey="email" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Role" columnKey="role" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Function" columnKey="function_name" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Designation" columnKey="designation_name" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
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
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Phone
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Status" columnKey="status" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleUsers.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-5 py-10 text-center text-text-muted"
                  >
                    No users match your filters.
                  </td>
                </tr>
              ) : (
                visibleUsers.map((user) => {
                  const mutable = canMutateRow(user);
                  return (
                    <tr
                      key={user.id}
                      className={`transition-colors hover:bg-slate-50 ${user.is_deleted ? "opacity-60" : ""}`}
                    >
                      <td className="px-5 py-3.5">
                        <div className="font-medium text-text-main">
                          {user.full_name}
                        </div>
                        <div className="text-xs text-text-muted">
                          {user.employee_code}
                        </div>
                      </td>
                      <td className="px-5 py-3.5 text-text-muted">
                        {user.email}
                      </td>
                      <td className="px-5 py-3.5">
                        <RoleBadge role={user.role} />
                      </td>
                      <td className="px-5 py-3.5 text-text-muted">
                        {user.function?.name ?? "—"}
                      </td>
                      <td className="px-5 py-3.5 text-text-muted">
                        {user.designation?.name ?? "—"}
                      </td>
                      <td className="px-5 py-3.5 text-text-muted">
                        {isViewerMiltenyiHR
                          ? user.project_manager_names.length > 0
                            ? user.project_manager_names.join(", ")
                            : "—"
                          : users.find((u) => u.id === user.mentor_id)
                              ?.full_name ?? "—"}
                      </td>
                      <td className="px-5 py-3.5 text-text-muted">
                        {user.phone ?? "—"}
                      </td>
                      <td className="px-5 py-3.5">
                        <StatusBadge isDeleted={user.is_deleted} />
                      </td>
                      <td className="px-5 py-3.5">
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
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
