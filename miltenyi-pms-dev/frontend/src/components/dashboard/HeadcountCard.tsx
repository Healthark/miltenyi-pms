/**
 * HeadcountCard — first HR-dashboard widget.
 *
 * Shows the org's current active-employee count plus a per-role
 * breakdown (Staff / Mentor / PM / HR). Pure snapshot — the dashboard's
 * FY filter doesn't affect this card (an FY picker scoping headcount
 * would conflate "live roster" with "joined-in-FY", which is a
 * separate analytic).
 *
 * Layout mirrors the row 2 progress cards (Goal Approval): legend on
 * the left, donut on the right, InsightStripe at the bottom surfacing
 * the largest cohort.
 */

import { Users } from "lucide-react";
import { Link } from "react-router-dom";
import type { HeadcountSummary } from "@/services/dashboard.service";
import { DonutChart } from "./DonutChart";
import { InsightStripe } from "./InsightStripe";

// Stable role-segment palette. Donut walks clockwise in ROLE_ORDER so
// the legend (top → bottom) matches the chart's 12-o'clock-first
// reading order. Subtle blue/yellow/green/slate set, intentionally
// off the theme tokens so the chart doesn't fight the rest of the
// dashboard with the saturated brand purple.
const ROLE_COLORS = {
  staff: "#60a5fa",
  mentor: "#fbbf24",
  pm: "#34d399",
  hr: "#94a3b8",
} as const;

const ROLE_LABELS = {
  staff: "Staff",
  mentor: "Mentor",
  pm: "Project Manager",
  hr: "HR",
} as const;

type RoleKey = keyof typeof ROLE_COLORS;
const ROLE_ORDER: readonly RoleKey[] = ["staff", "mentor", "pm", "hr"];

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
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <Users className="h-4 w-4 text-brand" aria-hidden="true" />
          </div>
          <h3 className="font-display text-sm font-semibold text-text-main">
            Active Employees
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
      {isLoading ? <SkeletonBody /> : <LoadedBody data={data} />}
    </article>
  );
}

// ── Internal pieces ───────────────────────────────────────────────────

function LoadedBody({ data }: { readonly data: HeadcountSummary }) {
  const total = data.total_active;
  const insight = buildInsight(data);

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

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Left: vertical legend matching the row's donut cards. */}
        <ul className="flex-1 space-y-2 text-[13px]">
          {visibleRoles.map((key) => (
            <li key={key} className="flex items-center gap-2">
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: ROLE_COLORS[key] }}
                aria-hidden="true"
              />
              <span className="font-semibold text-text-main tabular-nums">
                {data.by_role[key]}
              </span>
              <span className="text-text-muted">{ROLE_LABELS[key]}</span>
            </li>
          ))}
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
      <InsightStripe {...insight} />
    </>
  );
}

// Largest cohort = the natural "headline" insight for HR — drives
// staffing-mix conversations.
function buildInsight(data: HeadcountSummary) {
  const total = data.total_active;
  if (total === 0) {
    return { text: "No active employees yet", tone: "amber" as const };
  }
  let topKey: RoleKey = "staff";
  let topCount = 0;
  for (const key of ROLE_ORDER) {
    const count = data.by_role[key];
    if (count > topCount) {
      topKey = key;
      topCount = count;
    }
  }
  const pct = Math.round((topCount / total) * 100);
  return {
    text: `${ROLE_LABELS[topKey]} make up ${pct}% of headcount`,
    tone: "brand" as const,
  };
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
