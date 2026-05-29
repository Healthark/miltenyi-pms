import { ListChecks, AlertTriangle, ClipboardCheck, FileEdit, ArrowRight, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import type { DashboardSummary } from "@/services/dashboard.service";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { daysUntilFyEnd } from "@/utils/fy";

/** How many days before the FY ends we start surfacing the annual-self-
 *  review nudge. Earlier than this the row stays hidden so the action
 *  list doesn't carry a year-long "Start annual self-review" pin that
 *  the user can't act on yet. 30 ≈ "the last month of the FY". */
const ANNUAL_REVIEW_NUDGE_WINDOW_DAYS = 30;

interface ActionItemsWidgetProps {
  readonly summary: DashboardSummary;
}

interface ActionRow {
  readonly key: string;
  readonly label: string;
  readonly count: number;
  readonly to: string;
  readonly icon: LucideIcon;
  /** Tone hint — "blocking" pulls the icon forward in a red box; "info" stays neutral. */
  readonly tone: "blocking" | "warning" | "info";
}

const TONE_CLASSES: Record<ActionRow["tone"], string> = {
  blocking: "bg-red-50 text-red-600",
  warning: "bg-amber-50 text-amber-600",
  info: "bg-slate-100 text-text-muted",
};

/**
 * Personal action items — what does the caller owe, right now?
 *
 * The widget collapses several state queries into one ranked list so the
 * landing page can answer "what should I do today" without scrolling.
 * Items are ordered by urgency: blocking (someone is waiting on you) →
 * warning (action expected this cycle) → info (housekeeping).
 *
 * If every count is zero we render a positive empty state instead of a
 * dead card — the dashboard is meant to feel "actionable when there's
 * action," not a permanent task list.
 */
export function ActionItemsWidget({ summary }: ActionItemsWidgetProps) {
  const {
    changes_requested_goals,
    draft_goals,
    project_reviews_pending_primary,
    project_reviews_pending_secondary,
    annual_review_status,
    annual_review_cycle,
  } = summary;
  const { settings } = useSystemSettings();

  // Project reviews collapse into a single line — the user doesn't care
  // whether they're owed as PM or as Secondary, the page handles that.
  const project_reviews_pending =
    project_reviews_pending_primary + project_reviews_pending_secondary;

  // Time-gate the annual-review nudge to the last ~30 days of the FY.
  // Earlier in the cycle there's no urgency, so pinning "Start annual
  // self-review" on the action list 11 months early is just noise. We
  // honour `simulated_today` when set so date-simulation demos can
  // preview the late-FY behaviour without waiting for the calendar.
  const isAnnualReviewWindowOpen = (() => {
    if (!settings?.active_cycle_name) return false;
    const today = settings.simulated_today
      ? new Date(settings.simulated_today)
      : new Date();
    const daysLeft = daysUntilFyEnd(
      settings.active_cycle_name,
      settings.fiscal_start_month ?? 4,
      today,
    );
    return (
      daysLeft !== null &&
      daysLeft >= 0 &&
      daysLeft <= ANNUAL_REVIEW_NUDGE_WINDOW_DAYS
    );
  })();

  // Annual self-review nudge: surface it iff (a) a row hasn't been
  // submitted yet (no row at all OR still in DRAFT) AND (b) we're
  // inside the FY-end window above. Once submitted (status flips past
  // draft) the action is off the user's plate — it's the mentor's turn.
  const annual_review_pending: 0 | 1 =
    annual_review_cycle != null &&
    (annual_review_status === null || annual_review_status === "draft") &&
    isAnnualReviewWindowOpen
      ? 1
      : 0;

  const rows: ActionRow[] = [];

  if (changes_requested_goals > 0) {
    rows.push({
      key: "changes_requested",
      label: `Goal${changes_requested_goals === 1 ? "" : "s"} need revision`,
      count: changes_requested_goals,
      // Deep-link to the exact subset the count refers to. AnnualGoals
      // My Goals tab reads ?status= on mount and seeds approvalFilter.
      to: "/annual-goals?status=changes_requested",
      icon: AlertTriangle,
      tone: "blocking",
    });
  }

  if (project_reviews_pending > 0) {
    rows.push({
      key: "project_reviews",
      label: `Project review${project_reviews_pending === 1 ? "" : "s"} to write`,
      count: project_reviews_pending,
      // Deep-link with the matching status filter so the count the
      // user clicked on the dashboard ("3 to write") maps to exactly
      // those 3 rows on the destination, not the full cycle queue.
      // PM Primary tab + Secondary tab both read `?status=` on mount.
      to: "/project-reviews?status=pending",
      icon: ClipboardCheck,
      tone: "warning",
    });
  }

  if (annual_review_pending) {
    rows.push({
      key: "annual_review",
      label:
        annual_review_status === "draft"
          ? `Continue annual self-review`
          : `Start annual self-review`,
      count: 1,
      to: "/annual-reviews",
      icon: FileEdit,
      tone: "warning",
    });
  }

  if (draft_goals > 0) {
    rows.push({
      key: "draft_goals",
      label: `Goal draft${draft_goals === 1 ? "" : "s"} to submit`,
      count: draft_goals,
      // Same pattern as changes_requested above — narrow the
      // destination by ?status= so the count maps to exact rows.
      to: "/annual-goals?status=draft",
      icon: FileEdit,
      tone: "info",
    });
  }

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light">
          <ListChecks className="h-5 w-5 text-brand" aria-hidden="true" />
        </div>
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
          Action Items
        </p>
      </div>

      {rows.length === 0 ? (
        // Empty state — positive, not a dead card.
        <div className="flex flex-col items-center justify-center gap-1.5 py-4 text-center">
          <CheckCircle2 className="h-7 w-7 text-green-500" aria-hidden="true" />
          <p className="text-sm font-medium text-text-main">You're all caught up</p>
          <p className="text-xs text-text-muted">Nothing on your plate right now.</p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border -mx-1">
          {rows.map((row) => {
            const Icon = row.icon;
            return (
              <li key={row.key}>
                <Link
                  to={row.to}
                  className="flex items-center gap-3 rounded-md px-1 py-2.5 hover:bg-slate-50 transition-colors"
                >
                  <span
                    className={`flex h-7 w-7 items-center justify-center rounded-md ${TONE_CLASSES[row.tone]}`}
                    aria-hidden="true"
                  >
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="flex-1 text-sm text-text-main">{row.label}</span>
                  {row.count > 1 && (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-text-main">
                      {row.count}
                    </span>
                  )}
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
