/**
 * MenteeGoalFunnelCard — mentor-facing analog of HR's
 * GoalApprovalFunnelCard, aggregated across every mentee reporting to
 * the current user.
 *
 * as the HR card so the visual language carries across the app. The
 * four buckets mirror what the mentee sees on their own dashboard:
 *
 *   Draft              — mentee hasn't submitted yet (waiting on mentee)
 *   Awaiting Approval  — submitted, waiting on the mentor
 *   Changes Requested  — mentor pushed back, waiting on mentee revision
 *   Approved           — locked + progressing through review cycles
 *
 * Numbers are derived in-place from MenteeSummary[] so this card
 * shares the same /mentees/summary fetch the rest of the mentor
 * dashboard already does — no new endpoint, no second round-trip.
 *
 * Insight stripe surfaces what the mentor needs to act on next, in
 * action-first order: their own approval queue, then mentee revisions
 * they're waiting on, then the all-clear state.
 */

import { Target } from "lucide-react";
import { Link } from "react-router-dom";
import type { MenteeSummary } from "@/services/mentee.service";
import { DonutChart } from "./DonutChart";

// Palette matches GoalApprovalFunnelCard / GoalsWidget so a viewer
// flipping between HR / Mentor / Mentee dashboards reads the same
// color = state mapping. Draft (slate) is included here because for
// the mentor it's signal — "this mentee hasn't even submitted yet".
const SEGMENT_COLORS = {
  draft: "#94a3b8",
  submitted: "#fbbf24",
  changes_requested: "#60a5fa",
  approved: "#34d399",
} as const;

interface MenteeGoalFunnelCardProps {
  /** Null while the parent's fetch is in flight. */
  readonly mentees: MenteeSummary[] | null;
}

interface Funnel {
  draft: number;
  submitted: number;
  changes_requested: number;
  approved: number;
  total: number;
}

function aggregate(mentees: MenteeSummary[]): Funnel {
  return mentees.reduce<Funnel>(
    (acc, m) => {
      acc.draft += m.goals.draft;
      acc.submitted += m.goals.submitted;
      acc.changes_requested += m.goals.changes_requested;
      acc.approved += m.goals.approved;
      acc.total += m.goals.total;
      return acc;
    },
    { draft: 0, submitted: 0, changes_requested: 0, approved: 0, total: 0 },
  );
}

export function MenteeGoalFunnelCard({ mentees }: MenteeGoalFunnelCardProps) {
  const isLoading = mentees === null;
  const funnel = mentees ? aggregate(mentees) : null;
  const hasMentees = (mentees?.length ?? 0) > 0;
  const hasData = funnel !== null && funnel.total > 0;
  const approvalPercent =
    funnel && funnel.total > 0
      ? Math.round((funnel.approved / funnel.total) * 100)
      : 0;

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <Target className="h-4 w-4 text-brand" aria-hidden="true" />
          </div>
          <h3 className="font-display text-sm font-semibold text-text-main">
            Mentee Goal Approvals
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
      {isLoading ? (
        <SkeletonBody />
      ) : !hasMentees ? (
        <EmptyBody message="No mentees assigned yet." />
      ) : !hasData ? (
        <EmptyBody message="Your mentees haven't created goals yet." />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <ul className="flex-1 space-y-2 text-[13px]">
              <LegendItem
                dotColor={SEGMENT_COLORS.draft}
                count={funnel.draft}
                label="Draft"
              />
              <LegendItem
                dotColor={SEGMENT_COLORS.submitted}
                count={funnel.submitted}
                label="Awaiting Approval"
              />
              <LegendItem
                dotColor={SEGMENT_COLORS.changes_requested}
                count={funnel.changes_requested}
                label="Changes Requested"
              />
              <LegendItem
                dotColor={SEGMENT_COLORS.approved}
                count={funnel.approved}
                label="Approved"
              />
            </ul>
            <DonutChart
              segments={[
                {
                  label: "Draft",
                  value: funnel.draft,
                  color: SEGMENT_COLORS.draft,
                },
                {
                  label: "Awaiting Approval",
                  value: funnel.submitted,
                  color: SEGMENT_COLORS.submitted,
                },
                {
                  label: "Changes Requested",
                  value: funnel.changes_requested,
                  color: SEGMENT_COLORS.changes_requested,
                },
                {
                  label: "Approved",
                  value: funnel.approved,
                  color: SEGMENT_COLORS.approved,
                },
              ]}
              centerPrimary={String(funnel.approved)}
              centerSecondary={`/${funnel.total}`}
              ariaLabel={`${funnel.approved} of ${funnel.total} mentee goals approved (${approvalPercent}%)`}
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
        <li className="h-4 w-40 rounded bg-slate-100" />
        <li className="h-4 w-36 rounded bg-slate-100" />
        <li className="h-4 w-28 rounded bg-slate-100" />
      </ul>
      <div className="h-32 w-32 rounded-full bg-slate-100" />
    </div>
  );
}

function EmptyBody({ message }: { readonly message: string }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-dashed border-border px-4 py-5 text-center">
      <p className="text-sm text-text-muted">{message}</p>
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
