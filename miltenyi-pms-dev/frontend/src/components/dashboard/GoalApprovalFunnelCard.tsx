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
 * Review funnel widget sized its denominator (rows in the system; the
 * "missing goals" widget in Theme D will eventually cover the
 * never-submitted population).
 *
 * Loading + empty states mirror AnnualReviewFunnelCard so the two
 * cards read as a visually symmetric pair on the page.
 */

import { Target } from "lucide-react";
import { Link } from "react-router-dom";
import type { GoalApprovalFunnel } from "@/services/dashboard.service";
import { formatFyYearSpan } from "@/utils/fy";

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
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-teal-50">
          <Target className="h-4 w-4 text-teal-600" aria-hidden="true" />
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

      {/* Body */}
      {isLoading ? (
        <SkeletonBody />
      ) : !hasData ? (
        <EmptyBody fyLabel={fyLabel} />
      ) : (
        <div className="space-y-3">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl font-semibold text-text-main leading-none">
              {data.approved}
            </span>
            <span className="text-sm text-text-muted">
              / {data.total} goals approved
            </span>
            <span className="ml-auto text-[12px] font-semibold text-text-muted">
              {approvalPercent}%
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-teal-500 transition-all duration-300"
              style={{ width: `${approvalPercent}%` }}
            />
          </div>

          {/* Per-stage chips */}
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[12px]">
            <StatusChip
              label="Pending Approval"
              count={data.pending_approval}
              color="amber"
            />
            <StatusChip
              label="Changes Requested"
              count={data.changes_requested}
              color="rose"
            />
            <StatusChip
              label="Approved"
              count={data.approved}
              color="emerald"
            />
          </div>
        </div>
      )}

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

// ── Internal pieces ───────────────────────────────────────────────────

function SkeletonBody() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="flex items-baseline gap-2">
        <div className="h-8 w-12 rounded bg-slate-100" />
        <div className="h-4 w-32 rounded bg-slate-100" />
        <div className="ml-auto h-4 w-10 rounded bg-slate-100" />
      </div>
      <div className="h-2 w-full rounded-full bg-slate-100" />
      <div className="flex flex-wrap gap-2">
        <div className="h-5 w-28 rounded bg-slate-100" />
        <div className="h-5 w-32 rounded bg-slate-100" />
        <div className="h-5 w-20 rounded bg-slate-100" />
      </div>
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

type ChipColor = "amber" | "rose" | "emerald";

const CHIP_DOT: Record<ChipColor, string> = {
  amber: "bg-amber-500",
  rose: "bg-rose-500",
  emerald: "bg-emerald-500",
};

function StatusChip({
  label,
  count,
  color,
}: {
  readonly label: string;
  readonly count: number;
  readonly color: ChipColor;
}) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={`h-1.5 w-1.5 rounded-full ${CHIP_DOT[color]}`}
        aria-hidden="true"
      />
      <span className="text-text-muted">{label}</span>
      <span className="font-semibold text-text-main">{count}</span>
    </span>
  );
}
