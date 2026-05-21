/**
 * GoalApprovalFunnelCard — annual-goal approval progress for the
 * selected FY.
 *
 * Three buckets:
 *   - Pending Approval     (mentee submitted; mentor needs to act)
 *   - Changes Requested    (mentor pushed back; employee needs to revise)
 *   - Approved             (locked + progressing through the review cycle)
 *
 * Drafts are not surfaced — private mentee work. The headline reads
 * "<approved> / <total> goals approved", matching how the Annual
 * Review funnel widget sized its denominator.
 *
 * Layout matches the other progress cards in row 1 of HrDashboard:
 * vertical legend on the left, donut on the right, header link to the
 * full page in the top-right corner.
 */

import { Target } from "lucide-react";
import { Link } from "react-router-dom";
import type { GoalApprovalFunnel } from "@/services/dashboard.service";
import { formatFyYearSpan } from "@/utils/fy";
import { DonutChart } from "./DonutChart";

// Local chart palette (amber-400 / blue-400 / emerald-400). Kept off
// the theme tokens so the donut reads subtler than chip/badge accents.
// Blue replaces the saturated red for "changes requested" — the
// callout is still distinguishable from "pending" amber but no longer
// fights the rest of the dashboard for attention.
const SEGMENT_COLORS = {
  pending_approval: "#fbbf24",
  changes_requested: "#60a5fa",
  approved: "#34d399",
} as const;

interface GoalApprovalFunnelCardProps {
  /** Null while the parent's fetch is in flight. */
  readonly data: GoalApprovalFunnel | null;
  readonly viewAllHref?: string;
}

export function GoalApprovalFunnelCard({
  data,
  viewAllHref = "/annual-goals",
}: GoalApprovalFunnelCardProps) {
  const isLoading = data === null;
  const fyLabel =
    data?.fy_year != null ? formatFyYearSpan(data.fy_year) : null;
  const approvalPercent =
    data && data.total > 0 ? Math.round((data.approved / data.total) * 100) : 0;
  const hasData = !isLoading && data != null && data.total > 0;

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <Target className="h-4 w-4 text-brand" aria-hidden="true" />
          </div>
          <div>
            <h3 className="font-display text-sm font-semibold text-text-main">
              Goal Approval Progress
            </h3>
            {fyLabel && (
              <p className="mt-0.5 text-[11px] text-text-muted">{fyLabel}</p>
            )}
          </div>
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
      ) : !hasData ? (
        <EmptyBody fyLabel={fyLabel} />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <ul className="flex-1 space-y-2 text-[13px]">
              <LegendItem
                dotColor={SEGMENT_COLORS.pending_approval}
                count={data.pending_approval}
                label="Pending Approval"
              />
              <LegendItem
                dotColor={SEGMENT_COLORS.changes_requested}
                count={data.changes_requested}
                label="Changes Requested"
              />
              <LegendItem
                dotColor={SEGMENT_COLORS.approved}
                count={data.approved}
                label="Approved"
              />
            </ul>
            <DonutChart
              segments={[
                {
                  label: "Pending Approval",
                  value: data.pending_approval,
                  color: SEGMENT_COLORS.pending_approval,
                },
                {
                  label: "Changes Requested",
                  value: data.changes_requested,
                  color: SEGMENT_COLORS.changes_requested,
                },
                {
                  label: "Approved",
                  value: data.approved,
                  color: SEGMENT_COLORS.approved,
                },
              ]}
              centerPrimary={String(data.approved)}
              centerSecondary={`/${data.total}`}
              ariaLabel={`${data.approved} of ${data.total} annual goals approved (${approvalPercent}%)`}
            />
          </div>
        </>
      )}
    </article>
  );
}

// ── Internal pieces ───────────────────────────────────────────────────

function SkeletonBody() {
  return (
    <div className="flex items-center gap-2 animate-pulse">
      <ul className="flex-1 space-y-2">
        <li className="h-4 w-36 rounded bg-slate-100" />
        <li className="h-4 w-40 rounded bg-slate-100" />
        <li className="h-4 w-28 rounded bg-slate-100" />
      </ul>
      <div className="h-32 w-32 rounded-full bg-slate-100" />
    </div>
  );
}

function EmptyBody({ fyLabel }: { readonly fyLabel: string | null }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-dashed border-border px-4 py-5 text-center">
      <p className="text-sm text-text-muted">
        {fyLabel
          ? `No annual goals in ${fyLabel} yet.`
          : "No active fiscal year configured."}
      </p>
    </div>
  );
}

function LegendItem({
  dotColor,
  count,
  label,
}: {
  readonly dotColor: string;
  readonly count: number;
  readonly label: string;
}) {
  return (
    <li className="flex items-center gap-2">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: dotColor }}
        aria-hidden="true"
      />
      <span className="font-semibold text-text-main tabular-nums">
        {count}
      </span>
      <span className="text-text-muted">{label}</span>
    </li>
  );
}
