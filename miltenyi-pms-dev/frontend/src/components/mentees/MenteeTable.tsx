import { ArrowRight, AlertTriangle } from "lucide-react";
import { Link } from "react-router-dom";
import type { MenteeSummary } from "../../services/mentee.service";
import { SortableHeader } from "../SortableHeader";
import type { SortState } from "../../utils/sort";

export type MenteeTableSortKey =
  | "full_name"
  | "employee_code"
  | "email"
  | "department_name"
  | "designation_name"
  | "pending_actions_count";

interface MenteeTableProps {
  readonly mentees: readonly MenteeSummary[];
  readonly sort: SortState<MenteeTableSortKey> | null;
  readonly onSort: (next: SortState<MenteeTableSortKey>) => void;
}

function initialsFor(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function MenteeTable({ mentees, sort, onSort }: MenteeTableProps) {
  const thCls = "px-4 py-2.5 text-left";
  const plainThCls =
    "px-4 py-2.5 text-left text-[11px] font-bold uppercase tracking-wider text-text-muted";

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-border bg-slate-50/80">
            <th className={thCls}>
              <SortableHeader label="Mentee" columnKey="full_name" sort={sort} onSort={onSort} />
            </th>
            <th className={thCls}>
              <SortableHeader label="Emp Code" columnKey="employee_code" sort={sort} onSort={onSort} />
            </th>
            <th className={thCls}>
              <SortableHeader label="Email" columnKey="email" sort={sort} onSort={onSort} />
            </th>
            <th className={plainThCls}>Phone</th>
            <th className={thCls}>
              <SortableHeader label="Department" columnKey="department_name" sort={sort} onSort={onSort} />
            </th>
            <th className={thCls}>
              <SortableHeader label="Designation" columnKey="designation_name" sort={sort} onSort={onSort} />
            </th>
            <th className={thCls}>
              <SortableHeader label="Pending" columnKey="pending_actions_count" sort={sort} onSort={onSort} />
            </th>
            <th className={`${plainThCls} text-right`}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {mentees.map((m) => {
            const hasPending = m.pending_actions_count > 0;
            const initials = initialsFor(m.full_name);
            return (
              <tr
                key={m.user_id}
                className="border-b border-border last:border-b-0 hover:bg-slate-50/60"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-full bg-brand text-[11px] font-bold text-white shrink-0"
                      aria-hidden="true"
                    >
                      {initials}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-medium text-text-main">
                        {m.full_name}
                      </p>
                      <p className="truncate text-[11px] text-text-muted">
                        {m.role}
                      </p>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-text-main">{m.employee_code}</td>
                <td className="px-4 py-3 text-text-main">{m.email}</td>
                <td className="px-4 py-3 text-text-main">{m.phone ?? "—"}</td>
                <td className="px-4 py-3 text-text-main">
                  {m.department_name ?? "—"}
                </td>
                <td className="px-4 py-3 text-text-main">
                  {m.designation_name ?? "—"}
                </td>
                <td className="px-4 py-3">
                  {hasPending ? (
                    <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                      <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                      {m.pending_actions_count}
                    </span>
                  ) : (
                    <span className="text-text-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    to={`/my-mentees/${m.user_id}`}
                    className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
                  >
                    View details
                    <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
