/**
 * HeadcountCard — first HR-dashboard widget.
 *
 * Shows the org's current active-employee count plus a per-role
 * breakdown (Staff / Mentor / PM / HR). Pure snapshot — the dashboard's
 * FY filter doesn't affect this card (an FY picker scoping headcount
 * would conflate "live roster" with "joined-in-FY", which is a
 * separate analytic).
 *
 * Loading state renders a shimmer skeleton in the exact same outer
 * shell as the loaded card so the page doesn't reflow when the data
 * arrives.
 */

import { Users } from "lucide-react";
import { Link } from "react-router-dom";
import type { HeadcountSummary } from "@/services/dashboard.service";

interface HeadcountCardProps {
  /** Null while the parent's fetch is in flight. */
  readonly data: HeadcountSummary | null;
  /** Where "View all →" navigates. Defaults to /admin (Users tab). */
  readonly viewAllHref?: string;
}

export function HeadcountCard({
  data,
  viewAllHref = "/admin",
}: HeadcountCardProps) {
  const isLoading = data === null;

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
          <Users className="h-4 w-4 text-blue-600" aria-hidden="true" />
        </div>
        <h3 className="font-display text-sm font-semibold text-text-main">
          Active Employees
        </h3>
      </div>

      {/* Body */}
      {isLoading ? (
        <div className="space-y-3 animate-pulse">
          {/* Big-number placeholder */}
          <div className="h-10 w-24 rounded bg-slate-100" />
          {/* Role-chip placeholders */}
          <div className="flex flex-wrap gap-2">
            <div className="h-5 w-16 rounded-full bg-slate-100" />
            <div className="h-5 w-20 rounded-full bg-slate-100" />
            <div className="h-5 w-14 rounded-full bg-slate-100" />
            <div className="h-5 w-14 rounded-full bg-slate-100" />
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="font-display text-4xl font-semibold text-text-main leading-none">
            {data.total_active}
          </p>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[12px]">
            <RoleChip label="Staff" count={data.by_role.staff} />
            <RoleChip label="Mentor" count={data.by_role.mentor} />
            <RoleChip label="PM" count={data.by_role.pm} />
            <RoleChip label="HR" count={data.by_role.hr} />
          </div>
        </div>
      )}

      {/* Footer link — always rendered so the card's height is stable
          across the loading→loaded transition. */}
      <div className="pt-2 border-t border-border/60">
        <Link
          to={viewAllHref}
          className="text-[12px] font-medium text-brand hover:underline"
        >
          View all →
        </Link>
      </div>
    </article>
  );
}

function RoleChip({ label, count }: { readonly label: string; readonly count: number }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-text-muted">{label}</span>
      <span className="font-semibold text-text-main">{count}</span>
    </span>
  );
}
