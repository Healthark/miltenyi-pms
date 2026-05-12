/**
 * ProjectReviewDetailModal — read-only renderer for a single
 * ProjectReviewResponse, used by the Mentor's Team Reviews tab and
 * HR's All Reviews tab.
 *
 * The full review content (7 competency comments + impact statement +
 * secondary impact statements) already rides on the row payload, so
 * the modal doesn't fetch anything — it just renders.
 *
 * Rating visibility honours the org's `project_ratings_visible` flag
 * (settings-driven). When false, the rating row renders a "Hidden"
 * placeholder so the reader knows there is a rating they just can't
 * see.
 */

import { createPortal } from "react-dom";
import {
  Briefcase,
  Lock,
  MessageSquare,
  UserCircle,
  X,
} from "lucide-react";
import type { ProjectReviewResponse } from "@/services/project-review.service";
import { PerformanceRatingBadge } from "@/components/reviews/PerformanceRatingBadge";
import { useSystemSettings } from "@/hooks/useSystemSettings";

/** Each entry maps a backend field name → the display label shown in
 *  the modal. Order matters: it's the order PMs see in the eval form,
 *  so readers get the same reading flow. */
const COMPETENCIES: ReadonlyArray<{
  key: keyof Pick<
    ProjectReviewResponse,
    | "comment_task_execution"
    | "comment_ownership"
    | "comment_project_management"
    | "comment_client_deliverables"
    | "comment_communication"
    | "comment_mentoring"
    | "comment_competency_skills"
  >;
  label: string;
}> = [
  { key: "comment_task_execution",       label: "Task Execution & Problem Solving" },
  { key: "comment_ownership",            label: "Ownership & Accountability" },
  { key: "comment_project_management",   label: "Project Management & Risk Mitigation" },
  { key: "comment_client_deliverables",  label: "Client-Ready Deliverables" },
  { key: "comment_communication",        label: "Communication & Stakeholder Management" },
  { key: "comment_mentoring",            label: "Mentoring & Team Development" },
  { key: "comment_competency_skills",    label: "Competency & Skills" },
];

interface ProjectReviewDetailModalProps {
  readonly review: ProjectReviewResponse;
  readonly onClose: () => void;
}

export function ProjectReviewDetailModal({
  review,
  onClose,
}: ProjectReviewDetailModalProps) {
  const { settings } = useSystemSettings();
  const projectRatingsVisible = settings?.project_ratings_visible ?? false;

  // Filter the competency entries to only the ones with content; if the
  // PM left some blank we don't want eight empty headings in the modal.
  const filledComps = COMPETENCIES.filter((c) => {
    const v = review[c.key];
    return typeof v === "string" && v.trim().length > 0;
  });

  const submittedEvals = (review.secondary_evaluations ?? []).filter(
    (e) => e.status === "submitted",
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proj-review-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-5xl rounded-xl bg-surface shadow-xl flex flex-col max-h-[90vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4 shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-50 shrink-0">
                <Briefcase
                  className="h-4 w-4 text-indigo-600"
                  aria-hidden="true"
                />
              </div>
              <div className="min-w-0">
                <h2
                  id="proj-review-modal-title"
                  className="font-display text-base font-semibold text-text-main truncate"
                >
                  {review.project_name}
                  <span className="ml-1.5 text-[11px] font-mono text-text-muted">
                    {review.project_code}
                  </span>
                </h2>
                <p className="mt-0.5 text-xs text-text-muted">
                  {review.employee_name} · {review.cycle}
                  {(review.pm_name || review.reviewer_name) && (
                    <>
                      {" · PM: "}
                      {review.pm_name ?? review.reviewer_name}
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Project rating — compact inline label + badge. Lower is
              better (1 = best, 5 = worst); the badge colour handles
              the cue. */}
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-text-main">
              Project Rating:
            </span>
            {projectRatingsVisible ? (
              <PerformanceRatingBadge
                value={review.performance_group}
                size="md"
              />
            ) : (
              <span className="inline-flex items-center gap-1 text-[12px] text-text-muted/70">
                <Lock className="h-3 w-3" aria-hidden="true" />
                Hidden
              </span>
            )}
          </div>

          {/* Competency comments — two-column grid on md+ so the seven
              blocks fit on roughly four rows. Single column on small
              screens to keep paragraphs readable. */}
          <section className="space-y-2">
            <h3 className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
              PM&rsquo;s Competency Feedback
            </h3>
            {filledComps.length === 0 ? (
              <p className="text-sm italic text-text-muted">
                No competency comments recorded.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {filledComps.map((c) => (
                  <div
                    key={c.key}
                    className="rounded-lg border border-border bg-surface px-3 py-2.5"
                  >
                    <p className="text-[11px] font-semibold text-text-main mb-1">
                      {c.label}
                    </p>
                    <p className="text-[12px] text-text-muted whitespace-pre-wrap leading-snug">
                      {review[c.key]}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* PM impact statement */}
          {review.impact_statement && review.impact_statement.trim().length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                <MessageSquare className="h-3 w-3" aria-hidden="true" />
                PM&rsquo;s Impact Statement
              </h3>
              <div className="rounded-lg border border-border bg-blue-50/30 px-4 py-3">
                <p className="text-[13px] text-text-main whitespace-pre-wrap leading-relaxed">
                  {review.impact_statement}
                </p>
              </div>
            </section>
          )}

          {/* Secondary impact statements */}
          {submittedEvals.length > 0 && (
            <section className="space-y-2">
              <h3 className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                <UserCircle className="h-3 w-3" aria-hidden="true" />
                Secondary Impact Statements
              </h3>
              <div className="space-y-2">
                {submittedEvals.map((ev) => (
                  <div
                    key={ev.id}
                    className="rounded-lg border border-border bg-emerald-50/30 px-4 py-3"
                  >
                    <p className="text-[12px] font-semibold text-text-main mb-1">
                      {ev.evaluator_name}
                    </p>
                    <p className="text-[13px] text-text-muted whitespace-pre-wrap leading-relaxed">
                      {ev.impact_statement || (
                        <span className="italic">—</span>
                      )}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-border px-6 py-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
