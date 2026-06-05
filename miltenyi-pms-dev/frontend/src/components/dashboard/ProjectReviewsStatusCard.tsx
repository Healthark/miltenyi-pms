/**
 * ProjectReviewsStatusCard — PM dashboard's "queue at a glance" tile.
 *
 * Pairs with ActiveCyclesCard on the PM landing page (Employee
 * Dashboard's `isPM` branch). Surfaces "how much of my project
 * review queue did I clear this cycle?" via a donut + two legend
 * rows, mirroring the visual grammar of GoalsWidget so the PM
 * dashboard feels like a stripped-down sibling of the Employee one.
 *
 * Counts are pulled from the dashboard summary and combine the PM's
 * Primary work (their own project's PM evaluation) with any Secondary
 * work they happen to have (when a PM is named Secondary on a peer
 * project). The footnote surfaces the "includes Secondary" caveat
 * only when secondary counts are non-zero so the card stays clean
 * for the common case where the PM only wears the Primary hat.
 *
 * Empty state: when the active cycle has no reviews assigned to the
 * caller, the card renders an explanatory dashed box and a link to
 * /project-reviews so the PM has somewhere to go.
 */

import { ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";
import type { DashboardSummary } from "@/services/dashboard.service";
import { DonutChart } from "./DonutChart";

interface ProjectReviewsStatusCardProps {
  readonly summary: DashboardSummary;
}

// Match the GoalsWidget palette so a PM who also sees other surfaces
// reads the same color = state across the app. Green = submitted /
// done, amber = pending / awaiting action.
const SEGMENT_COLORS = {
  submitted: "#34d399",
  pending: "#fbbf24",
} as const;

export function ProjectReviewsStatusCard({
  summary,
}: ProjectReviewsStatusCardProps) {
  const submittedPrimary = summary.project_reviews_done_primary;
  const submittedSecondary = summary.project_reviews_done_secondary;
  const pendingPrimary = summary.project_reviews_pending_primary;
  const pendingSecondary = summary.project_reviews_pending_secondary;

  const submitted = submittedPrimary + submittedSecondary;
  const pending = pendingPrimary + pendingSecondary;
  const total = submitted + pending;

  const hasSecondary =
    submittedSecondary + pendingSecondary > 0 ? true : false;
  const cycleLabel = summary.active_cycle ?? null;
  const isComplete = total > 0 && pending === 0;

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4 h-full">
      {/* Header — icon tile + title + cycle subtitle. Mirrors the
          GoalsWidget header rhythm so the PM page reads as a sibling. */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <ClipboardList
              className="h-4 w-4 text-brand"
              aria-hidden="true"
            />
          </div>
          <div className="flex flex-col">
            <h3 className="font-display text-sm font-semibold text-text-main">
              Project Reviews
            </h3>
            {cycleLabel && (
              <span className="text-[11px] text-text-muted">
                {cycleLabel}
              </span>
            )}
          </div>
        </div>
        <Link
          to="/project-reviews"
          className="text-[12px] font-medium text-brand hover:underline whitespace-nowrap"
        >
          View all →
        </Link>
      </div>

      {/* Body */}
      {total === 0 ? (
        <EmptyBody />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <ul className="flex-1 space-y-2 text-[13px]">
              <LegendItem
                dotColor={SEGMENT_COLORS.submitted}
                count={submitted}
                label="Submitted"
              />
              <LegendItem
                dotColor={SEGMENT_COLORS.pending}
                count={pending}
                label="Pending"
              />
            </ul>
            <DonutChart
              segments={[
                {
                  label: "Submitted",
                  value: submitted,
                  color: SEGMENT_COLORS.submitted,
                },
                {
                  label: "Pending",
                  value: pending,
                  color: SEGMENT_COLORS.pending,
                },
              ]}
              centerPrimary={String(submitted)}
              centerSecondary={`of ${total}`}
              ariaLabel={`${submitted} of ${total} project reviews submitted this cycle`}
            />
          </div>

          {/* Footnote — only surfaces when the caller wears the
              Secondary hat in addition to Primary. Stays out of the
              way for the common PM-only-on-own-project case. */}
          {hasSecondary && (
            <p className="text-[11px] text-text-muted -mt-1">
              Includes Secondary evaluator assignments.
            </p>
          )}

          {/* CTA — flips between "View pending" while there's work
              still owed and a completion confirmation when the queue
              is empty. Both link to /project-reviews; the language
              just changes. */}
          <div className="mt-auto pt-1">
            {isComplete ? (
              <p className="text-[12px] font-medium text-emerald-600">
                All reviews submitted ✓
              </p>
            ) : (
              <Link
                to="/project-reviews"
                className="text-[12px] font-medium text-brand hover:underline"
              >
                View pending →
              </Link>
            )}
          </div>
        </>
      )}
    </article>
  );
}

function EmptyBody() {
  return (
    <div className="rounded-lg bg-slate-50 border border-dashed border-border px-4 py-5 text-center">
      <p className="text-sm text-text-muted">
        No project reviews assigned this cycle.
      </p>
      <Link
        to="/project-reviews"
        className="mt-2 inline-block text-[12px] font-medium text-brand hover:underline"
      >
        Open Project Reviews →
      </Link>
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
