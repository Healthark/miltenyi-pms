/**
 * AnnualReviewFunnelCard — annual review progress for the selected FY.
 *
 * Renders the four-stage funnel (Draft → Pending Mentor → Pending Management
 * → Completed) for the FY currently selected on the dashboard's FY
 * picker. The "X of Y complete" headline counts the rows that exist in
 * the system — employees with no AnnualReview row yet for this FY are
 * not in the denominator (they'll show up in the "Missing reviews"
 * widget in Theme D when we add it).
 *
 * Layout follows the system-theme reference: title + "View all" header
 * on top, donut chart on the right, vertical legend on the left. Colors
 * are pulled from the theme tokens declared in `index.css`.
 */

import { ClipboardCheck } from "lucide-react";
import { Link } from "react-router-dom";
import type { AnnualReviewFunnel } from "@/services/dashboard.service";
import { formatFyYearSpan, fyStartYearToToken } from "@/utils/fy";
import { DonutChart } from "./DonutChart";

// Local chart palette. Intentionally separate from theme tokens
// (--color-brand / --color-amber / --color-green) so the dashboard
// donuts stay subtle even though the rest of the app still leans on
// the saturated brand purple for accents. Slate-400 / amber-400 /
// blue-400 / emerald-400 read as a calm "blue/green/yellow" set.
const SEGMENT_COLORS = {
  draft: "#94a3b8",
  pending_mentor: "#fbbf24",
  pending_management: "#60a5fa",
  completed: "#34d399",
} as const;

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
  // Append the FY token as a cycle filter to the View-all link so the
  // destination opens pre-filtered to the same FY HR is currently
  // looking at on the dashboard. Without this, HR has to re-pick the
  // year on /annual-reviews — defeating the funnel's call-to-action.
  const finalViewAllHref =
    data?.fy_year != null
      ? `${viewAllHref}?cycle=${encodeURIComponent(fyStartYearToToken(data.fy_year))}`
      : viewAllHref;
  const completionPercent =
    data && data.total > 0 ? Math.round((data.completed / data.total) * 100) : 0;
  const hasData = !isLoading && data != null && data.total > 0;

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header — icon + title on the left, "View all" link on the right */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <ClipboardCheck
              className="h-4 w-4 text-brand"
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
            {/* Left: vertical legend (dot + count + label). Matches the
                reference card's "● 1,031 on time" style. */}
            <ul className="flex-1 space-y-2 text-[13px]">
              <LegendItem
                dotColor={SEGMENT_COLORS.draft}
                count={data.draft}
                label="Draft"
              />
              <LegendItem
                dotColor={SEGMENT_COLORS.pending_mentor}
                count={data.pending_mentor}
                label="Pending Mentor"
              />
              <LegendItem
                dotColor={SEGMENT_COLORS.pending_management}
                count={data.pending_management}
                label="Pending Management"
              />
              <LegendItem
                dotColor={SEGMENT_COLORS.completed}
                count={data.completed}
                label="Completed"
              />
            </ul>
            {/* Right: donut */}
            <DonutChart
              segments={[
                { label: "Draft", value: data.draft, color: SEGMENT_COLORS.draft },
                {
                  label: "Pending Mentor",
                  value: data.pending_mentor,
                  color: SEGMENT_COLORS.pending_mentor,
                },
                {
                  label: "Pending Management",
                  value: data.pending_management,
                  color: SEGMENT_COLORS.pending_management,
                },
                {
                  label: "Completed",
                  value: data.completed,
                  color: SEGMENT_COLORS.completed,
                },
              ]}
              centerPrimary={String(data.completed)}
              centerSecondary={`/${data.total}`}
              ariaLabel={`${data.completed} of ${data.total} annual reviews complete (${completionPercent}%)`}
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
        <li className="h-4 w-32 rounded bg-slate-100" />
        <li className="h-4 w-36 rounded bg-slate-100" />
        <li className="h-4 w-28 rounded bg-slate-100" />
        <li className="h-4 w-32 rounded bg-slate-100" />
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
          ? `No annual reviews in ${fyLabel} yet.`
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
