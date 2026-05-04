/**
 * ReviewStatusBadge.tsx — Color-Coded Status Badge for Annual Reviews.
 *
 * Maps each ReviewStatus to a distinct color:
 *   draft              → slate    (neutral)
 *   pending_mentor     → amber    (waiting on mentor)
 *   pending_management → blue     (waiting on HR)
 *   completed          → green    (done)
 *
 * Placement: src/components/reviews/ReviewStatusBadge.tsx
 */

import type { ReviewStatus } from "../../services/annual-review.service";

interface ReviewStatusBadgeProps {
  readonly status: ReviewStatus;
}

const STATUS_CONFIG: Record<
  ReviewStatus,
  { label: string; bgClass: string; textClass: string }
> = {
  draft: {
    label: "Draft",
    bgClass: "bg-slate-100",
    textClass: "text-slate-600",
  },
  pending_mentor: {
    label: "Pending Mentor",
    bgClass: "bg-amber-50",
    textClass: "text-amber-700",
  },
  pending_management: {
    label: "Pending Management",
    bgClass: "bg-blue-50",
    textClass: "text-blue-700",
  },
  completed: {
    label: "Completed",
    bgClass: "bg-green-50",
    textClass: "text-green-700",
  },
};

export function ReviewStatusBadge({ status }: ReviewStatusBadgeProps) {
  const config = STATUS_CONFIG[status] ?? STATUS_CONFIG.draft;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${config.bgClass} ${config.textClass}`}
    >
      {config.label}
    </span>
  );
}
