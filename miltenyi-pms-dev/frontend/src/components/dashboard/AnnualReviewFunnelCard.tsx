/**
 * AnnualReviewFunnelCard — annual review progress for the selected FY.
 *
 * Renders the four-stage funnel (Draft → Pending Mentor → Pending Mgmt
 * → Completed) for the FY currently selected on the dashboard's FY
 * picker. The "X of Y complete" headline counts the rows that exist in
 * the system — employees with no AnnualReview row yet for this FY are
 * not in the denominator (they'll show up in the "Missing reviews"
 * widget in Theme D when we add it).
 *
 * Loading state renders a shimmer skeleton in the same outer shell so
 * the page doesn't reflow when data arrives.
 */

import { ClipboardCheck } from "lucide-react";
import { Link } from "react-router-dom";
import type { AnnualReviewFunnel } from "@/services/dashboard.service";
import { formatFyYearSpan } from "@/utils/fy";

interface AnnualReviewFunnelCardProps {
  /** Null while the parent's fetch is in flight. */
  readonly data: AnnualReviewFunnel | null;
  readonly viewAllHref?: string;
}

export function AnnualReviewFunnelCard({
  data,
  viewAllHref = "/annual-reviews",
}: AnnualReviewFunnelCardProps) {
  const isLoading = data === null;
  const fyLabel =
    data?.fy_year != null ? formatFyYearSpan(data.fy_year) : null;
  const completionPercent =
    data && data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
  const hasData = !isLoading && data != null && data.total > 0;

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-50">
          <ClipboardCheck
            className="h-4 w-4 text-violet-600"
            aria-hidden="true"
          />
        </div>
        <div>
          <h3 className="font-display text-sm font-semibold text-text-main">
            Annual Review Progress
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
              {data.completed}
            </span>
            <span className="text-sm text-text-muted">
              / {data.total} reviews complete
            </span>
            <span className="ml-auto text-[12px] font-semibold text-text-muted">
              {completionPercent}%
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full rounded-full bg-violet-500 transition-all duration-300"
              style={{ width: `${completionPercent}%` }}
            />
          </div>

          {/* Per-status chips */}
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[12px]">
            <StatusChip label="Draft" count={data.draft} color="slate" />
            <StatusChip
              label="Pending Mentor"
              count={data.pending_mentor}
              color="amber"
            />
            <StatusChip
              label="Pending Mgmt"
              count={data.pending_management}
              color="blue"
            />
            <StatusChip
              label="Completed"
              count={data.completed}
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
        <div className="h-5 w-20 rounded bg-slate-100" />
        <div className="h-5 w-28 rounded bg-slate-100" />
        <div className="h-5 w-24 rounded bg-slate-100" />
        <div className="h-5 w-24 rounded bg-slate-100" />
      </div>
    </div>
  );
}

function EmptyBody({ fyLabel }: { readonly fyLabel: string | null }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-dashed border-border px-4 py-5 text-center">
      <p className="text-sm text-text-muted">
        {fyLabel
          ? `No annual reviews in ${fyLabel} yet.`
          : "No active fiscal year configured."}
      </p>
    </div>
  );
}

type ChipColor = "slate" | "amber" | "blue" | "emerald";

const CHIP_DOT: Record<ChipColor, string> = {
  slate: "bg-slate-400",
  amber: "bg-amber-500",
  blue: "bg-blue-500",
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
