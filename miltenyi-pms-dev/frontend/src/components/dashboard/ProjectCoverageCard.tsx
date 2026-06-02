/**
 * ProjectCoverageCard — PM pairing health snapshot.
 *
 * One section today: "Orphaned by Deactivation" — projects whose PM
 * was deactivated or role-changed away from PM and the cascade
 * nulled `Project.pm_id`. Renders only when count > 0; amber styling
 * marks it as an "act on me" alert (in-flight ProjectReview work
 * froze on these projects until HR assigns a new PM).
 *
 * Not FY-scoped. This is a "right now" snapshot of the org, like the
 * Headcount + MentorCoverage cards. The empty state hides the whole
 * card entirely — silence is the success signal. See
 * docs/policies/mentor-transition-policy.md for the original
 * Option-C policy; this card surfaces the PM-side application of it.
 */

import { AlertTriangle, Briefcase } from "lucide-react";
import { Link } from "react-router-dom";
import type {
  OrphanedProject,
  ProjectCoverage,
} from "@/services/dashboard.service";

interface ProjectCoverageCardProps {
  /** Null while the parent's fetch is in flight. */
  readonly data: ProjectCoverage | null;
}

export function ProjectCoverageCard({ data }: ProjectCoverageCardProps) {
  const isLoading = data === null;

  // Hide the card entirely when there's nothing to act on. Avoids
  // adding a passive "All projects are mentored" tile to a dashboard
  // that's already dense with cards.
  if (!isLoading && data.orphaned_projects.length === 0) {
    return null;
  }

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <Briefcase className="h-4 w-4 text-brand" aria-hidden="true" />
          </div>
          <h3 className="font-display text-sm font-semibold text-text-main">
            Project Coverage
          </h3>
        </div>
        <Link
          to="/admin?tab=projects"
          className="text-[12px] font-medium text-brand hover:underline whitespace-nowrap"
        >
          View all →
        </Link>
      </div>

      {/* Body */}
      {isLoading ? (
        <SkeletonBody />
      ) : (
        <OrphanedProjectsSection orphaned={data.orphaned_projects} />
      )}
    </article>
  );
}

// ── Sections ──────────────────────────────────────────────────────────

/** Render "Orphaned X days ago" from an ISO timestamp. Mirrors
 *  MentorCoverageCard.formatOrphanAge — same compact phrasing. */
function formatOrphanAge(isoTimestamp: string): string {
  const orphanedAt = new Date(isoTimestamp);
  const ms = Date.now() - orphanedAt.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function OrphanedProjectsSection({
  orphaned,
}: {
  readonly orphaned: OrphanedProject[];
}) {
  const count = orphaned.length;
  const word = count === 1 ? "project" : "projects";
  return (
    <section className="space-y-2">
      {/* Amber callout — the section IS the alert. Same visual language
          as MentorCoverageCard's OrphanedSection so the user reads
          "orphan" the same way across cards. */}
      <div className="rounded-lg border border-amber-300 bg-amber-50/60 px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1.5">
          <AlertTriangle
            className="h-3.5 w-3.5 text-amber-700"
            aria-hidden="true"
          />
          <p className="text-[11px] font-bold uppercase tracking-wider text-amber-800">
            Orphaned by deactivation
          </p>
          <span className="ml-auto inline-flex items-center rounded-full bg-amber-200/80 px-2 py-0.5 text-[11px] font-semibold text-amber-900 tabular-nums">
            {count} {word}
          </span>
        </div>
        <p className="text-[11px] text-amber-800/90 mb-2">
          Their previous PM was deactivated or role-changed. Assign a
          new PM to unfreeze pending project reviews.
        </p>
        <div className="rounded-md border border-amber-200 bg-white/70 max-h-40 overflow-y-auto divide-y divide-amber-200/70">
          {orphaned.map((p) => (
            <Link
              key={p.project_id}
              to={`/admin?tab=projects&edit=${p.project_id}`}
              className="flex items-center justify-between gap-3 px-3 py-1.5 hover:bg-amber-50/50"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-text-main truncate">
                  <span className="font-mono text-[11px] text-text-muted mr-1.5">
                    {p.project_code}
                  </span>
                  {p.name}
                </p>
                {p.secondary_evaluator_name && (
                  <p className="text-[11px] text-text-muted truncate">
                    Secondary: {p.secondary_evaluator_name}
                  </p>
                )}
              </div>
              <p className="text-[11px] text-amber-700 whitespace-nowrap shrink-0">
                Orphaned {formatOrphanAge(p.orphaned_at)}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Shared building blocks ────────────────────────────────────────────

function SkeletonBody() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3 space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-3 w-32 rounded bg-amber-100" />
          <div className="ml-auto h-4 w-20 rounded-full bg-amber-100" />
        </div>
        <div className="rounded-md border border-amber-200 bg-white/60 divide-y divide-amber-100">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              className="flex items-center justify-between gap-3 px-3 py-2"
            >
              <div className="h-3 w-48 rounded bg-amber-100" />
              <div className="h-3 w-20 rounded bg-amber-100" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
