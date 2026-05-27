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
 * Layout matches the other progress cards in row 1 of HrDashboard:
 * vertical legend on the left, donut on the right, header link to the
 * full page in the top-right corner.
 */

import { Briefcase } from "lucide-react";
import { Link } from "react-router-dom";
import type { ProjectReviewCompletion } from "@/services/dashboard.service";
import { formatFyYearSpan } from "@/utils/fy";
import { DonutChart } from "./DonutChart";

// Local chart palette (slate-400 / amber-400 / emerald-400). Kept off
// the theme tokens so the donut reads subtler than chip/badge accents.
const SEGMENT_COLORS = {
  pending: "#94a3b8",
  draft: "#fbbf24",
  reviewed: "#34d399",
} as const;

interface ProjectReviewCompletionCardProps {
  /** Null while the parent's fetch is in flight. */
  readonly data: ProjectReviewCompletion | null;
  readonly viewAllHref?: string;
  /**
   * Optional full cycle_name (e.g. "H1 FY26-27") to deep-link the
   * "View all" target to. Project reviews are cycle-scoped on the
   * destination page (one row per (employee, project, cycle)) while
   * this card is FY-scoped — aggregating across all cycles in the FY.
   * Passing the active cycle name resolves the mismatch by landing
   * HR on a coherent single-cycle view. HrDashboard provides this
   * from `settings.active_cycle_name`; omitting it falls back to the
   * destination's own active-cycle default.
   */
  readonly cycleHint?: string | null;
}

export function ProjectReviewCompletionCard({
  data,
  viewAllHref = "/project-reviews",
  cycleHint,
}: ProjectReviewCompletionCardProps) {
  const isLoading = data === null;
  const fyLabel =
    data?.fy_year != null ? formatFyYearSpan(data.fy_year) : null;
  // Deep-link to the matching cycle on /project-reviews when the
  // parent supplied one. Without the hint we'd either pass an FY
  // token (which doesn't match any actual cycle_name and would zero
  // out the destination's list) or pass nothing (destination falls
  // back to the active cycle silently). Either way is currently
  // identical when HR is on the active FY — explicit is better
  // because it survives if the destination's default ever changes.
  const finalViewAllHref = cycleHint
    ? `${viewAllHref}?cycle=${encodeURIComponent(cycleHint)}`
    : viewAllHref;
  const completionPercent =
    data && data.total > 0 ? Math.round((data.reviewed / data.total) * 100) : 0;
  const hasData = !isLoading && data != null && data.total > 0;

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <Briefcase className="h-4 w-4 text-brand" aria-hidden="true" />
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
        <Link
          to={finalViewAllHref}
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
                dotColor={SEGMENT_COLORS.pending}
                count={data.pending}
                label="Pending"
              />
              <LegendItem
                dotColor={SEGMENT_COLORS.draft}
                count={data.draft}
                label="Draft"
              />
              <LegendItem
                dotColor={SEGMENT_COLORS.reviewed}
                count={data.reviewed}
                label="Reviewed"
              />
            </ul>
            <DonutChart
              segments={[
                {
                  label: "Pending",
                  value: data.pending,
                  color: SEGMENT_COLORS.pending,
                },
                { label: "Draft", value: data.draft, color: SEGMENT_COLORS.draft },
                {
                  label: "Reviewed",
                  value: data.reviewed,
                  color: SEGMENT_COLORS.reviewed,
                },
              ]}
              centerPrimary={String(data.reviewed)}
              centerSecondary={`/${data.total}`}
              ariaLabel={`${data.reviewed} of ${data.total} project reviews complete (${completionPercent}%)`}
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
        <li className="h-4 w-28 rounded bg-slate-100" />
        <li className="h-4 w-24 rounded bg-slate-100" />
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
          ? `No project reviews in ${fyLabel} yet.`
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
