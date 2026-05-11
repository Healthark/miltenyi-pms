/**
 * ProjectReviewCompletionCard — project-review completion aggregated
 * across every cycle within the selected FY.
 *
 * Half-yearly orgs see H1+H2 combined; quarterly orgs see Q1..Q4
 * combined. HR cares about the org-wide picture for the year, so we
 * intentionally don't break this out per-cycle — that level of detail
 * already lives on the Project Reviews page itself.
 *
 * Three buckets:
 *   - Pending  (row exists, PM hasn't started)
 *   - Draft    (PM saved partial work)
 *   - Reviewed (final, locked)
 *
 * Skeleton + empty states mirror the other funnel cards so the row of
 * three reads as a visually consistent triplet on the page.
 */

import { Briefcase } from "lucide-react";
import { Link } from "react-router-dom";
import type { ProjectReviewCompletion } from "@/services/dashboard.service";
import { formatFyYearSpan } from "@/utils/fy";

interface ProjectReviewCompletionCardProps {
  /** Null while the parent's fetch is in flight. */
  readonly data: ProjectReviewCompletion | null;
  readonly viewAllHref?: string;
}

export function ProjectReviewCompletionCard({
  data,
  viewAllHref = "/project-reviews",
}: ProjectReviewCompletionCardProps) {
  const isLoading = data === null;
  const fyLabel =
    data?.fy_year != null ? formatFyYearSpan(data.fy_year) : null;
  const completionPercent =
    data && data.total > 0 ? Math.round((data.reviewed / data.total) * 100) : 0;
  const hasData = !isLoading && data != null && data.total > 0;

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50">
          <Briefcase className="h-4 w-4 text-indigo-600" aria-hidden="true" />
        </div>
        <div>
          <h3 className="font-display text-sm font-semibold text-text-main">
            Project Review Completion
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
              {data.reviewed}
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
              className="h-full rounded-full bg-indigo-500 transition-all duration-300"
              style={{ width: `${completionPercent}%` }}
            />
          </div>

          {/* Per-status chips */}
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 text-[12px]">
            <StatusChip label="Pending" count={data.pending} color="slate" />
            <StatusChip label="Draft" count={data.draft} color="amber" />
            <StatusChip
              label="Reviewed"
              count={data.reviewed}
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
        <div className="h-5 w-16 rounded bg-slate-100" />
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
          ? `No project reviews in ${fyLabel} yet.`
          : "No active fiscal year configured."}
      </p>
    </div>
  );
}

type ChipColor = "slate" | "amber" | "emerald";

const CHIP_DOT: Record<ChipColor, string> = {
  slate: "bg-slate-400",
  amber: "bg-amber-500",
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
