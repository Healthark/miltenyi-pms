import { Inbox, CheckCircle2, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { DashboardSummary } from "../../services/dashboard.service";

interface PendingMentorWorkWidgetProps {
  readonly summary: DashboardSummary;
}

interface MentorRow {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly to: string;
}

/**
 * Mentor-facing companion to the personal Action Items widget.
 *
 * Lists the three buckets a mentor owes work on:
 *   1. Mentee goals submitted, awaiting your approve / changes-requested.
 *   2. Mentee half-cycle goal reviews (H1 or H2) waiting on your write-up.
 *   3. Mentee annual reviews in PENDING_MENTOR for the active FY.
 *
 * Gating is the parent's responsibility — render this only when
 * `user.has_mentees` is true. We keep the widget pure so it can be
 * reused for an admin-impersonating-mentor view later.
 */
export function PendingMentorWorkWidget({
  summary,
}: PendingMentorWorkWidgetProps) {
  const {
    mentor_goals_pending_approval,
    mentor_goal_reviews_pending,
    mentor_annual_reviews_pending,
    mentee_count,
  } = summary;

  const rows: MentorRow[] = [];

  if (mentor_goals_pending_approval > 0) {
    rows.push({
      key: "goals_approval",
      label: `Goal${mentor_goals_pending_approval === 1 ? "" : "s"} awaiting your approval`,
      count: mentor_goals_pending_approval,
      to: "/my-mentees",
    });
  }

  if (mentor_goal_reviews_pending > 0) {
    rows.push({
      key: "goal_reviews",
      label: `Half-cycle review${mentor_goal_reviews_pending === 1 ? "" : "s"} to write`,
      count: mentor_goal_reviews_pending,
      to: "/my-mentees",
    });
  }

  if (mentor_annual_reviews_pending > 0) {
    rows.push({
      key: "annual_reviews",
      label: `Annual review${mentor_annual_reviews_pending === 1 ? "" : "s"} to evaluate`,
      count: mentor_annual_reviews_pending,
      to: "/my-mentees",
    });
  }

  // Cumulative count for the headline metric — gives the mentor a single
  // number to mentally bank.
  const total =
    mentor_goals_pending_approval +
    mentor_goal_reviews_pending +
    mentor_annual_reviews_pending;

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light">
            <Inbox className="h-5 w-5 text-brand" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
              Pending Mentor Work
            </p>
            <p className="font-display text-2xl font-semibold text-text-main leading-tight">
              {total}
            </p>
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-1.5 py-2 text-center">
          <CheckCircle2 className="h-7 w-7 text-green-500" aria-hidden="true" />
          <p className="text-sm font-medium text-text-main">
            No mentor work pending
          </p>
          <p className="text-xs text-text-muted">
            {mentee_count === 0
              ? "No mentees assigned."
              : `Your ${mentee_count} ${mentee_count === 1 ? "mentee is" : "mentees are"} all caught up.`}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border -mx-1">
          {rows.map((row) => (
            <li key={row.key}>
              <Link
                to={row.to}
                className="flex items-center gap-3 rounded-md px-1 py-2.5 hover:bg-slate-50 transition-colors"
              >
                <span className="flex h-7 w-9 items-center justify-center rounded-md bg-amber-50 text-amber-700 text-xs font-semibold">
                  {row.count}
                </span>
                <span className="flex-1 text-sm text-text-main">{row.label}</span>
                <ArrowRight
                  className="h-3.5 w-3.5 shrink-0 text-text-muted"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
