import { useMemo, useState } from "react";
import { Search, Pencil, UserX, UserCheck } from "lucide-react";
import type { UserResponse } from "../../services/admin.service";
import { StatusBadge } from "./StatusBadge";
import { SortableHeader } from "../SortableHeader";
import {
  compareValues,
  type SortKind,
  type SortState,
} from "../../utils/sort";

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
  | "mentor_name"
  | "department_name"
  | "designation_name"
  | "status";

type RoleFilter = "all" | "Admin" | "Staff";
type StatusFilter = "all" | "active" | "inactive";

const ROLE_OPTIONS: { value: RoleFilter; label: string }[] = [
  { value: "all", label: "All Roles" },
  { value: "Admin", label: "Admin" },
  { value: "Staff", label: "Staff" },
];

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All Statuses" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
];

const USERS_SORT_CONFIG: Record<
  UsersSortKey,
  { kind: SortKind; get: (u: UserResponse, all: readonly UserResponse[]) => unknown }
> = {
  full_name:        { kind: "alpha", get: (u) => u.full_name },
  email:            { kind: "alpha", get: (u) => u.email },
  mentor_name:      {
    kind: "alpha",
    get: (u, all) =>
      u.mentor_id ? all.find((x) => x.id === u.mentor_id)?.full_name ?? null : null,
  },
  department_name:  { kind: "alpha", get: (u) => u.department?.name ?? null },
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

  const visibleUsers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const filtered = users.filter((u) => {
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
      return true;
    });
    if (!sort) return filtered;
    const { kind, get } = USERS_SORT_CONFIG[sort.key];
    return filtered.slice().sort((a, b) =>
      compareValues(get(a, users), get(b, users), kind, sort.direction),
    );
  }, [users, searchQuery, roleFilter, statusFilter, sort]);

  return (
    <div>
      {/* Toolbar — search + filters */}
      <div className="border-b border-border px-5 py-4 flex items-center gap-4 flex-wrap">
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
            className={`${FILTER_SELECT_CLS} min-w-[120px]`}
          >
            {ROLE_OPTIONS.map((o) => (
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
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-sm text-text-muted">
          Loading users…
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-slate-50 text-left">
                <th className="px-5 py-3">
                  <SortableHeader label="Employee" columnKey="full_name" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Email" columnKey="email" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Phone
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Mentor" columnKey="mentor_name" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Department" columnKey="department_name" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Designation" columnKey="designation_name" sort={sort} onSort={setSort} />
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
                    colSpan={8}
                    className="px-5 py-10 text-center text-text-muted"
                  >
                    No users match your filters.
                  </td>
                </tr>
              ) : (
                visibleUsers.map((user) => (
                  <tr
                    key={user.id}
                    className={`transition-colors hover:bg-slate-50 ${user.is_deleted ? "opacity-60" : ""}`}
                  >
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-text-main">
                          {user.full_name}
                        </span>
                        {user.role === "Admin" && (
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                            Admin
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-text-muted">
                        {user.employee_code}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-text-muted">
                      {user.email}
                    </td>
                    <td className="px-5 py-3.5 text-text-muted">
                      {user.phone ?? "—"}
                    </td>
                    <td className="px-5 py-3.5 text-text-muted">
                      {users.find((u) => u.id === user.mentor_id)?.full_name ?? "—"}
                    </td>
                    <td className="px-5 py-3.5 text-text-muted">
                      {user.department?.name ?? "—"}
                    </td>
                    <td className="px-5 py-3.5 text-text-muted">
                      {user.designation?.name ?? "—"}
                    </td>
                    <td className="px-5 py-3.5">
                      <StatusBadge isDeleted={user.is_deleted} />
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
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
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
