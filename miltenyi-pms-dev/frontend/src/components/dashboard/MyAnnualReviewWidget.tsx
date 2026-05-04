import { ClipboardCheck, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type {
  AnnualReviewStatus,
  DashboardSummary,
} from "../../services/dashboard.service";

interface MyAnnualReviewWidgetProps {
  readonly summary: DashboardSummary;
}

/**
 * One-line copy describing where the caller's review currently sits, plus a
 * matching CTA verb. Centralised here (not inline) because the same wording
 * may need to appear on the AnnualReviews page header later — easy to lift.
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
  const { annual_review_status, annual_review_cycle } = summary;
  const copy = copyForStatus(annual_review_status, annual_review_cycle);

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light">
            <ClipboardCheck className="h-5 w-5 text-brand" aria-hidden="true" />
          </div>
          <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
            My Annual Review
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${copy.pillClass}`}
        >
          {copy.pillLabel}
        </span>
      </div>

      {/* Cycle label as the headline metric, mirrors ActiveCycleWidget. */}
      {annual_review_cycle !== null && (
        <p className="font-display text-2xl font-semibold text-text-main">
          {annual_review_cycle}
        </p>
      )}

      <p className="text-sm text-text-muted -mt-2">{copy.description}</p>

      {/* CTA — omitted entirely when the action is on someone else's plate. */}
      {copy.ctaLabel !== null && (
        <Link
          to="/annual-reviews"
          className="flex items-center gap-1 text-xs font-medium text-brand hover:underline mt-auto"
        >
          {copy.ctaLabel} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
