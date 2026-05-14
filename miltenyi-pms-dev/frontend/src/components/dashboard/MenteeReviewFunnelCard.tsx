/**
 * MenteeReviewFunnelCard — mentor-facing analog of HR's
 * AnnualReviewFunnelCard, aggregated across every mentee reporting to
 * the current user.
 *
 * Visual treatment mirrors the HR card: donut + vertical legend +
 * InsightStripe. Where HR's four-stage funnel surfaces the org's
 * Draft / Pending Mentor / Pending Mgmt / Completed split, the mentor
 * view collapses anything pre-submission ("draft", "not_started",
 * missing rows) into a single "Not Started" bucket — for the mentor
 * the actionable distinction is "is this on my plate or not".
 *
 *   Not Started     — mentee hasn't submitted (waiting on mentee)
 *   Pending You     — submitted; mentor evaluation owed
 *   With Management — past the mentor, in calibration
 *   Completed       — final rating published
 *
 * Numbers are derived in-place from MenteeSummary[].review.status —
 * the same payload the rest of the mentor dashboard already fetches.
 */

import { ClipboardCheck } from "lucide-react";
import { Link } from "react-router-dom";
import type { MenteeSummary } from "@/services/mentee.service";
import { DonutChart } from "./DonutChart";
import { InsightStripe, type InsightTone } from "./InsightStripe";

// Palette matches AnnualReviewFunnelCard. "Pending You" is amber to
// signal "your action needed" — same convention HR uses for its
// "Pending Mentor" bucket.
const SEGMENT_COLORS = {
  not_started: "#94a3b8",
  pending_you: "#fbbf24",
  pending_management: "#60a5fa",
  completed: "#34d399",
} as const;

interface MenteeReviewFunnelCardProps {
  /** Null while the parent's fetch is in flight. */
  readonly mentees: MenteeSummary[] | null;
}

interface Funnel {
  not_started: number;
  pending_you: number;
  pending_management: number;
  completed: number;
  total: number;
}

function aggregate(mentees: MenteeSummary[]): Funnel {
  return mentees.reduce<Funnel>(
    (acc, m) => {
      const status = m.review.status;
      // Treat null / "not_started" / "draft" as a single pre-submission
      // bucket. For the mentor, all three mean "waiting on the mentee".
      if (status === null || status === "not_started" || status === "draft") {
        acc.not_started += 1;
      } else if (status === "pending_mentor") {
        acc.pending_you += 1;
      } else if (status === "pending_management") {
        acc.pending_management += 1;
      } else if (status === "completed") {
        acc.completed += 1;
      }
      acc.total += 1;
      return acc;
    },
    {
      not_started: 0,
      pending_you: 0,
      pending_management: 0,
      completed: 0,
      total: 0,
    },
  );
}

export function MenteeReviewFunnelCard({
  mentees,
}: MenteeReviewFunnelCardProps) {
  const isLoading = mentees === null;
  const funnel = mentees ? aggregate(mentees) : null;
  const hasMentees = (mentees?.length ?? 0) > 0;
  const completionPercent =
    funnel && funnel.total > 0
      ? Math.round((funnel.completed / funnel.total) * 100)
      : 0;

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <ClipboardCheck
              className="h-4 w-4 text-brand"
              aria-hidden="true"
            />
          </div>
          <h3 className="font-display text-sm font-semibold text-text-main">
            Mentee Annual Reviews
          </h3>
        </div>
        <Link
          to="/annual-reviews"
          className="text-[12px] font-medium text-brand hover:underline whitespace-nowrap"
        >
          View all →
        </Link>
      </div>

      {/* Body */}
      {isLoading || funnel === null ? (
        <SkeletonBody />
      ) : !hasMentees ? (
        <EmptyBody message="No mentees assigned yet." />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <ul className="flex-1 space-y-2 text-[13px]">
              <LegendItem
                dotColor={SEGMENT_COLORS.not_started}
                count={funnel.not_started}
                label="Not Started"
              />
              <LegendItem
                dotColor={SEGMENT_COLORS.pending_you}
                count={funnel.pending_you}
                label="Pending You"
              />
              <LegendItem
                dotColor={SEGMENT_COLORS.pending_management}
                count={funnel.pending_management}
                label="With Management"
              />
              <LegendItem
                dotColor={SEGMENT_COLORS.completed}
                count={funnel.completed}
                label="Completed"
              />
            </ul>
            <DonutChart
              segments={[
                {
                  label: "Not Started",
                  value: funnel.not_started,
                  color: SEGMENT_COLORS.not_started,
                },
                {
                  label: "Pending You",
                  value: funnel.pending_you,
                  color: SEGMENT_COLORS.pending_you,
                },
                {
                  label: "With Management",
                  value: funnel.pending_management,
                  color: SEGMENT_COLORS.pending_management,
                },
                {
                  label: "Completed",
                  value: funnel.completed,
                  color: SEGMENT_COLORS.completed,
                },
              ]}
              centerPrimary={String(funnel.completed)}
              centerSecondary={`/${funnel.total}`}
              ariaLabel={`${funnel.completed} of ${funnel.total} mentee annual reviews complete (${completionPercent}%)`}
            />
          </div>
          <InsightStripe {...buildInsight(funnel, completionPercent)} />
        </>
      )}
    </article>
  );
}

// Mentor-action-first ladder: pending_you sits at the top — that's the
// mentor's evaluation queue. Then pending_management (informational
// for the mentor), then not_started (gentle nudge candidate), then
// the all-clear state.
function buildInsight(
  funnel: Funnel,
  completionPercent: number,
): { text: string; tone: InsightTone } {
  if (funnel.pending_you > 0) {
    return {
      text: `${funnel.pending_you} ${pluralize(
        funnel.pending_you,
        "review",
      )} awaiting your evaluation`,
      tone: "red",
    };
  }
  if (funnel.pending_management > 0) {
    return {
      text: `${funnel.pending_management} ${pluralize(
        funnel.pending_management,
        "review",
      )} with management`,
      tone: "brand",
    };
  }
  if (funnel.not_started > 0) {
    return {
      text: `${funnel.not_started} ${pluralize(
        funnel.not_started,
        "mentee",
      )} not yet started`,
      tone: "amber",
    };
  }
  return {
    text: `${completionPercent}% complete · all reviews on track`,
    tone: "green",
  };
}

function pluralize(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

// ── Internal pieces ───────────────────────────────────────────────────

function SkeletonBody() {
  return (
    <div className="flex items-center gap-2 animate-pulse">
      <ul className="flex-1 space-y-2">
        <li className="h-4 w-28 rounded bg-slate-100" />
        <li className="h-4 w-32 rounded bg-slate-100" />
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
