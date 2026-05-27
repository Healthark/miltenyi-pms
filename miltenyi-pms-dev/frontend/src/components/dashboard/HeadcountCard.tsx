/**
 * HeadcountCard — first HR-dashboard widget.
 *
 * Shows the org's current active-employee count plus a per-role
 * breakdown (Employee / Mentor / PM / HR). Pure snapshot — the dashboard's
 * FY filter doesn't affect this card (an FY picker scoping headcount
 * would conflate "live roster" with "joined-in-FY", which is a
 * separate analytic).
 *
 * Layout mirrors the row 2 progress cards (Goal Approval): legend on
 * the left, donut on the right.
 */

import { Users } from "lucide-react";
import { Link } from "react-router-dom";
import type { HeadcountSummary } from "@/services/dashboard.service";
import { DonutChart } from "./DonutChart";

// Stable role-segment palette. Donut walks clockwise in ROLE_ORDER so
// the legend (top → bottom) matches the chart's 12-o'clock-first
// reading order. Subtle blue/yellow/green/slate set, intentionally
// off the theme tokens so the chart doesn't fight the rest of the
// dashboard with the saturated brand purple.
const ROLE_COLORS = {
  employee: "#60a5fa",
  mentor: "#fbbf24",
  pm: "#34d399",
  hr: "#94a3b8",
} as const;

const ROLE_LABELS = {
  employee: "Employee",
  mentor: "Mentor",
  pm: "Project Manager",
  hr: "HR",
} as const;

// Mapping from donut-segment key to the UsersTab role-filter wire
// value. UsersTab's RoleFilter type accepts single literal roles
// ("Employee" / "Mentor" / "PM" / "HR_MyOrg" / "HR_Miltenyi") — the
// "hr" donut bucket aggregates two roles, so a single deep-link can't
// represent it. We leave that one as plain text rather than picking
// one HR flavor over the other; the bucket usually holds 1-2 rows so
// the cost of "View all → filter manually" is small.
const ROLE_FILTER_VALUE: Record<RoleKey, string | null> = {
  employee: "Employee",
  mentor: "Mentor",
  pm: "PM",
  hr: null,
};

type RoleKey = keyof typeof ROLE_COLORS;
const ROLE_ORDER: readonly RoleKey[] = ["employee", "mentor", "pm", "hr"];

interface HeadcountCardProps {
  /** Null while the parent's fetch is in flight. */
  readonly data: HeadcountSummary | null;
  /** Where "View all →" navigates. Defaults to /admin?tab=users so
   *  the destination opens on the Users tab specifically rather than
   *  whichever tab AdminPanel last fell through to. The legend rows
   *  build their own per-role URLs from this base. */
  readonly viewAllHref?: string;
}

export function HeadcountCard({
  data,
  viewAllHref = "/admin?tab=users",
}: HeadcountCardProps) {
  const isLoading = data === null;

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <Users className="h-4 w-4 text-brand" aria-hidden="true" />
          </div>
          <h3 className="font-display text-sm font-semibold text-text-main">
            Active Personnel
          </h3>
        </div>
        <Link
          to={viewAllHref}
          className="text-[12px] font-medium text-brand hover:underline whitespace-nowrap"
        >
          View all →
        </Link>
      </div>

      {/* Body */}
      {isLoading ? (
        <SkeletonBody />
      ) : (
        <LoadedBody data={data} viewAllHref={viewAllHref} />
      )}
    </article>
  );
}

// ── Internal pieces ───────────────────────────────────────────────────

function LoadedBody({
  data,
  viewAllHref,
}: {
  readonly data: HeadcountSummary;
  readonly viewAllHref: string;
}) {
  const total = data.total_active;

  // Only show buckets that have at least one user. Empty buckets
  // (e.g. `mentor: 0` for HR_Miltenyi viewers, where Healthark
  // mentors are filtered out by the backend) would otherwise render
  // as zero-width donut slices and "0 Mentor" legend rows.
  const visibleRoles = ROLE_ORDER.filter((key) => data.by_role[key] > 0);

  const segments = visibleRoles.map((key) => ({
    label: ROLE_LABELS[key],
    value: data.by_role[key],
    color: ROLE_COLORS[key],
  }));

  // Per-legend href: if the bucket corresponds to a single role-filter
  // value, append &role=<Role> to the base /admin?tab=users URL so the
  // destination opens with that role pre-selected. HR is two roles in
  // one bucket, so we skip it (renders as plain text). Built once per
  // render rather than inline so legend JSX stays readable.
  const hrefForRole = (key: RoleKey): string | undefined => {
    const filterValue = ROLE_FILTER_VALUE[key];
    if (!filterValue) return undefined;
    return `${viewAllHref}${viewAllHref.includes("?") ? "&" : "?"}role=${filterValue}`;
  };

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Left: vertical legend matching the row's donut cards. */}
        <ul className="flex-1 space-y-2 text-[13px]">
          {visibleRoles.map((key) => {
            const href = hrefForRole(key);
            const dot = (
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: ROLE_COLORS[key] }}
                aria-hidden="true"
              />
            );
            const count = (
              <span className="font-semibold text-text-main tabular-nums">
                {data.by_role[key]}
              </span>
            );
            const label = (
              <span className="text-text-muted">{ROLE_LABELS[key]}</span>
            );
            return (
              <li key={key}>
                {href ? (
                  <Link
                    to={href}
                    className="flex items-center gap-2 rounded -mx-1 px-1 py-0.5 hover:bg-brand-light/40 transition-colors"
                  >
                    {dot}
                    {count}
                    {label}
                  </Link>
                ) : (
                  <div className="flex items-center gap-2 px-1 py-0.5">
                    {dot}
                    {count}
                    {label}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {/* Right: donut showing role distribution. Center reads as a
            raw total so it complements the legend rather than
            duplicating any single bucket. */}
        <DonutChart
          segments={segments}
          centerPrimary={String(total)}
          centerSecondary="total"
          ariaLabel={`${total} active employees across ${visibleRoles.length} roles`}
        />
      </div>
    </>
  );
}

function SkeletonBody() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="flex items-center gap-2">
        <ul className="flex-1 space-y-2">
          <li className="h-4 w-24 rounded bg-slate-100" />
          <li className="h-4 w-28 rounded bg-slate-100" />
          <li className="h-4 w-20 rounded bg-slate-100" />
          <li className="h-4 w-20 rounded bg-slate-100" />
        </ul>
        <div className="h-32 w-32 rounded-full bg-slate-100" />
      </div>
      <div className="h-8 w-full rounded-lg bg-slate-100" />
    </div>
  );
}
