/**
 * GoalsWidget — mentee-facing companion to HR's GoalApprovalFunnelCard.
 *
 * Visual treatment mirrors the HR card: legend on the left, donut on
 * the right. HR sees a 3-bucket public view; the mentee sees their
 * own work including drafts — four buckets total.
 *
 * The donut's centre + the "Approved" legend row both display
 * `approved_goals`, which rolls APPROVED + every post-approval cycle-
 * review state (h1/h2/q1..q4 self/mentor-reviewed) into one count.
 * The legend label reads "Active Goals" rather than "Approved" to
 * convey "approved AND progressing through cycle reviews" — see the
 * tooltip on the legend row.
 */

import { Target } from "lucide-react";
import { Link } from "react-router-dom";
import type { DashboardSummary } from "@/services/dashboard.service";
import { DonutChart } from "./DonutChart";

interface GoalsWidgetProps {
  readonly summary: DashboardSummary;
}

// Match the HR funnel card's palette so a mentor flipping between
// their own dashboard and an HR rollup reads the same color = state.
// Draft (slate) is mentee-only — HR's view hides drafts since they're
// private mentee work.
const SEGMENT_COLORS = {
  draft: "#94a3b8",
  submitted: "#fbbf24",
  changes_requested: "#60a5fa",
  approved: "#34d399",
} as const;

const ACTIVE_GOALS_TOOLTIP =
  "Goals past the approval gate, including those progressing through H1 / H2 reviews.";

export function GoalsWidget({ summary }: GoalsWidgetProps) {
  const {
    total_goals,
    draft_goals,
    submitted_goals,
    approved_goals,
    changes_requested_goals,
  } = summary;

  const hasData = total_goals > 0;

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header — matches HR card layout: icon tile + title + View all */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <Target className="h-4 w-4 text-brand" aria-hidden="true" />
          </div>
          <h3 className="font-display text-sm font-semibold text-text-main">
            Annual Goals
          </h3>
        </div>
        <Link
          to="/annual-goals"
          className="text-[12px] font-medium text-brand hover:underline whitespace-nowrap"
        >
          View all →
        </Link>
      </div>

      {/* Body */}
      {!hasData ? (
        <EmptyBody />
      ) : (
        /* Funnel: legend (left) + donut (right) */
        <div className="flex items-center gap-2">
          <ul className="flex-1 space-y-2 text-[13px]">
            <LegendItem
              dotColor={SEGMENT_COLORS.draft}
              count={draft_goals}
              label="Draft"
            />
            <LegendItem
              dotColor={SEGMENT_COLORS.submitted}
              count={submitted_goals}
              label="Awaiting Approval"
            />
            <LegendItem
              dotColor={SEGMENT_COLORS.changes_requested}
              count={changes_requested_goals}
              label="Changes Requested"
            />
            <LegendItem
              dotColor={SEGMENT_COLORS.approved}
              count={approved_goals}
              label="Active Goals"
              tooltip={ACTIVE_GOALS_TOOLTIP}
            />
          </ul>
          <DonutChart
            segments={[
              {
                label: "Draft",
                value: draft_goals,
                color: SEGMENT_COLORS.draft,
              },
              {
                label: "Awaiting Approval",
                value: submitted_goals,
                color: SEGMENT_COLORS.submitted,
              },
              {
                label: "Changes Requested",
                value: changes_requested_goals,
                color: SEGMENT_COLORS.changes_requested,
              },
              {
                label: "Active Goals",
                value: approved_goals,
                color: SEGMENT_COLORS.approved,
              },
            ]}
            centerPrimary={String(approved_goals)}
            centerSecondary={`/${total_goals}`}
            ariaLabel={`${approved_goals} of ${total_goals} annual goals active`}
          />
        </div>
      )}
    </article>
  );
}

function EmptyBody() {
  return (
    <div className="rounded-lg bg-slate-50 border border-dashed border-border px-4 py-5 text-center">
      <p className="text-sm text-text-muted">No annual goals set yet.</p>
      <Link
        to="/annual-goals"
        className="mt-2 inline-block text-[12px] font-medium text-brand hover:underline"
      >
        Add your first goal →
      </Link>
    </div>
  );
}

function LegendItem({
  dotColor,
  count,
  label,
  tooltip,
}: {
  readonly dotColor: string;
  readonly count: number;
  readonly label: string;
  readonly tooltip?: string;
}) {
  return (
    <li
      className="flex items-center gap-2"
      title={tooltip}
    >
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
