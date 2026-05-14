/**
 * GoalsWidget — mentee-facing companion to HR's GoalApprovalFunnelCard.
 *
 * Visual treatment mirrors the HR card: legend on the left, donut on
 * the right, an InsightStripe surfacing the single most-actionable
 * callout. Where HR sees a 3-bucket public view, the mentee sees their
 * own work including drafts — four buckets total.
 *
 * Two signals coexist:
 *   1. Approval funnel (donut + legend + insight) — where each goal
 *      currently sits in the submit→approve flow.
 *   2. Criteria-driven completion bar across approved goals — how far
 *      into the actual work the mentee is, after their goals were
 *      locked in. This is the one signal HR doesn't see.
 *
 * Insight tiers (most-actionable first): revise (red) → submit drafts
 * (amber) → wait on mentor (brand) → all-clear with completion (green)
 * → empty state (neutral) when the mentee has no goals yet.
 */

import { Target } from "lucide-react";
import { Link } from "react-router-dom";
import type { DashboardSummary } from "@/services/dashboard.service";
import { DonutChart } from "./DonutChart";
import { InsightStripe, type InsightTone } from "./InsightStripe";

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

export function GoalsWidget({ summary }: GoalsWidgetProps) {
  const {
    total_goals,
    draft_goals,
    submitted_goals,
    approved_goals,
    changes_requested_goals,
    completion_percent,
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
        <>
          {/* Funnel: legend (left) + donut (right) */}
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
                label="Approved"
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
                  label: "Approved",
                  value: approved_goals,
                  color: SEGMENT_COLORS.approved,
                },
              ]}
              centerPrimary={String(approved_goals)}
              centerSecondary={`/${total_goals}`}
              ariaLabel={`${approved_goals} of ${total_goals} annual goals approved`}
            />
          </div>

          {/* Criteria-driven completion bar — only meaningful with
              approved goals to measure progress against. */}
          {approved_goals > 0 && (
            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[12px] text-text-muted">
                  Progress on approved goals
                </span>
                <span className="text-[12px] font-medium text-text-main tabular-nums">
                  {completion_percent}%
                </span>
              </div>
              <div
                className="h-1.5 w-full rounded-full bg-slate-100"
                role="progressbar"
                aria-valuenow={completion_percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-1.5 rounded-full bg-brand transition-all duration-500"
                  style={{ width: `${completion_percent}%` }}
                />
              </div>
            </div>
          )}

          <InsightStripe
            {...buildInsight({
              draft_goals,
              submitted_goals,
              changes_requested_goals,
              approved_goals,
              completion_percent,
            })}
          />
        </>
      )}
    </article>
  );
}

// Mentee-specific actionability ladder: revisions sit at the top
// because the mentor has already pushed back and the cycle stalls
// until the employee re-submits.
function buildInsight(stats: {
  draft_goals: number;
  submitted_goals: number;
  changes_requested_goals: number;
  approved_goals: number;
  completion_percent: number;
}): { text: string; tone: InsightTone } {
  if (stats.changes_requested_goals > 0) {
    return {
      text: `${stats.changes_requested_goals} ${pluralize(
        stats.changes_requested_goals,
        "goal",
      )} need your revision`,
      tone: "red",
    };
  }
  if (stats.draft_goals > 0) {
    return {
      text: `${stats.draft_goals} ${pluralize(
        stats.draft_goals,
        "draft",
      )} ready to submit`,
      tone: "amber",
    };
  }
  if (stats.submitted_goals > 0) {
    return {
      text: `${stats.submitted_goals} ${pluralize(
        stats.submitted_goals,
        "goal",
      )} awaiting mentor approval`,
      tone: "brand",
    };
  }
  if (stats.approved_goals > 0) {
    return {
      text: `${stats.completion_percent}% complete across approved goals`,
      tone: "green",
    };
  }
  // hasData=true with all four buckets at zero shouldn't happen — fall
  // through to a neutral copy so we never render an empty stripe.
  return { text: "All submissions cleared", tone: "green" };
}

function pluralize(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
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
