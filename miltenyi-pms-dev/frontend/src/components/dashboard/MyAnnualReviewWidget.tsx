import { ClipboardCheck, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type {
  AnnualReviewStatus,
  DashboardSummary,
} from "@/services/dashboard.service";

interface MyAnnualReviewWidgetProps {
  readonly summary: DashboardSummary;
}

/**
 * MyAnnualReviewWidget — combined "My Reviews" card on the Employee
 * dashboard. Two stacked sub-sections of equal visual weight:
 *
 *   1. Annual Review — status pill + description + CTA. Where the
 *      caller's review currently sits in the formal annual review
 *      flow.
 *   2. Project Reviews — count of PM evaluations submitted against
 *      the caller in the active project cycle + "View all" link.
 *
 * The FY headline that used to anchor this card was removed because
 * the neighbouring Active Cycles card already surfaces every active
 * cycle including the FY — duplicating it as a 2xl display number
 * burned the most prominent slot on this card without adding signal.
 *
 * The card replaced an earlier "Annual Review with a tiny project-
 * reviews strip footer" layout that gave project reviews insufficient
 * weight for an Employee-side signal that changes throughout the
 * cycle.
 */
interface StatusCopy {
  readonly pillLabel: string;
  readonly pillClass: string;
  readonly description: string;
  readonly ctaLabel: string | null; // null → no CTA (waiting on someone else)
}

function copyForStatus(
  status: AnnualReviewStatus | null,
  cycle: string | null,
): StatusCopy {
  // No active cycle configured — admin needs to set one before any
  // review can be tagged. Show a neutral, instructive state.
  if (cycle === null) {
    return {
      pillLabel: "Not configured",
      pillClass: "bg-slate-100 text-text-muted",
      description: "Ask your admin to set the active performance cycle.",
      ctaLabel: null,
    };
  }

  // Active cycle exists, but no AnnualReview row yet — the caller hasn't
  // started. This is the "Start" CTA case.
  if (status === null) {
    return {
      pillLabel: "Not started",
      pillClass: "bg-slate-100 text-text-muted",
      description: `Begin your self-review for ${cycle}.`,
      ctaLabel: "Start self-review",
    };
  }

  switch (status) {
    case "draft":
      return {
        pillLabel: "Draft",
        pillClass: "bg-amber-50 text-amber-700",
        description: `Continue your self-review for ${cycle}.`,
        ctaLabel: "Continue draft",
      };
    case "pending_mentor":
      return {
        pillLabel: "With mentor",
        pillClass: "bg-blue-50 text-blue-700",
        description: "Submitted — waiting on your mentor's evaluation.",
        ctaLabel: "View submission",
      };
    case "pending_management":
      return {
        pillLabel: "With management",
        pillClass: "bg-violet-50 text-violet-700",
        description: "Mentor reviewed — pending management calibration.",
        ctaLabel: "View submission",
      };
    case "completed":
      return {
        pillLabel: "Completed",
        pillClass: "bg-green-50 text-green-700",
        description: "Final rating published.",
        ctaLabel: "View final review",
      };
  }
}

export function MyAnnualReviewWidget({ summary }: MyAnnualReviewWidgetProps) {
  const {
    annual_review_status,
    annual_review_cycle,
    active_cycle,
    project_reviews_received_count,
  } = summary;
  const copy = copyForStatus(annual_review_status, annual_review_cycle);

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Card Header — title only; no headline FY (the Active Cycles
          neighbour already surfaces every cycle). */}
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light">
          <ClipboardCheck className="h-5 w-5 text-brand" aria-hidden="true" />
        </div>
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
          My Reviews
        </p>
      </div>

      {/* Annual Review sub-section */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            Annual Review
          </p>
          <span
            className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${copy.pillClass}`}
          >
            {copy.pillLabel}
          </span>
        </div>
        <p className="text-sm text-text-muted">{copy.description}</p>
        {copy.ctaLabel !== null && (
          <Link
            to="/annual-reviews"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
          >
            {copy.ctaLabel}{" "}
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </section>

      {/* Divider between sub-sections. Same visual weight on both
          halves keeps the card readable as two parallel surfaces
          rather than a primary + footnote layout. */}
      <div className="border-t border-border" />

      {/* Project Reviews sub-section */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            Project Reviews
          </p>
          {active_cycle !== null && (
            <span className="text-[11px] text-text-muted">this cycle</span>
          )}
        </div>
        {active_cycle === null ? (
          <p className="text-sm text-text-muted">
            Ask your admin to set the active performance cycle.
          </p>
        ) : (
          <p className="text-sm text-text-muted">
            <span className="font-display text-xl font-semibold text-text-main tabular-nums">
              {project_reviews_received_count}
            </span>
            <span className="ml-1.5">
              {project_reviews_received_count === 1
                ? "PM evaluation received."
                : "PM evaluations received."}
            </span>
          </p>
        )}
        {active_cycle !== null && (
          <Link
            to="/project-reviews"
            className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
          >
            View all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </section>
    </div>
  );
}
