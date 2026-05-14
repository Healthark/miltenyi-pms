/**
 * MenteeHealthListCard — full-width radar of every direct mentee.
 *
 * One row per mentee with the four signals a mentor scans for before
 * deciding who needs a 1:1 this week:
 *   1. Pending actions chip (amber pill) — mentee is waiting on the mentor.
 *   2. Avg goal progress bar (criteria-driven, across approved goals).
 *   3. Annual review status pill — where the mentee's review currently sits.
 *   4. Latest project performance group chip — last "P1..P5" if any.
 *
 * Rows are clickable and deep-link to /my-mentees/{id}. The card itself
 * is loading-aware via the same nullable-data pattern used by the HR
 * dashboard cards: pass `mentees={null}` for the skeleton.
 *
 * Sorted with mentees-needing-attention first (pending_actions_count
 * descending, then name) so the eye lands on actionable rows.
 */

import { AlertTriangle, ArrowRight, Users } from "lucide-react";
import { Link } from "react-router-dom";
import type {
  MenteeReviewStatus,
  MenteeSummary,
} from "@/services/mentee.service";

interface MenteeHealthListCardProps {
  /** Null while the parent's fetch is in flight. */
  readonly mentees: MenteeSummary[] | null;
}

// Review-status pill copy mirrors MyAnnualReviewWidget so a mentor seeing
// their own card and a mentee's card reads the same vocabulary. The
// `not_started` bucket is shown explicitly — knowing a mentee hasn't
// begun is itself actionable signal for the mentor.
const REVIEW_PILL: Record<
  NonNullable<MenteeReviewStatus["status"]>,
  { label: string; classes: string }
> = {
  not_started: {
    label: "Not started",
    classes: "bg-slate-100 text-text-muted",
  },
  draft: { label: "Draft", classes: "bg-amber-50 text-amber-700" },
  pending_mentor: {
    label: "With mentor",
    classes: "bg-blue-50 text-blue-700",
  },
  pending_management: {
    label: "With mgmt",
    classes: "bg-violet-50 text-violet-700",
  },
  completed: { label: "Completed", classes: "bg-green-50 text-green-700" },
};

// Color the performance group chip semantically — top buckets read as
// "doing well", bottom buckets as "needs attention". Mentors should be
// able to skim and find low ratings at a glance.
function perfChipClasses(group: number | null): string {
  if (group === null) return "bg-slate-100 text-text-muted";
  if (group <= 2) return "bg-emerald-50 text-emerald-700";
  if (group === 3) return "bg-brand-light text-brand";
  return "bg-amber-50 text-amber-700";
}

export function MenteeHealthListCard({ mentees }: MenteeHealthListCardProps) {
  const isLoading = mentees === null;

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <Users className="h-4 w-4 text-brand" aria-hidden="true" />
          </div>
          <h3 className="font-display text-sm font-semibold text-text-main">
            Mentee Health
          </h3>
        </div>
        <Link
          to="/my-mentees"
          className="text-[12px] font-medium text-brand hover:underline whitespace-nowrap"
        >
          View all →
        </Link>
      </div>

      {/* Body */}
      {isLoading ? <SkeletonBody /> : <LoadedBody mentees={mentees} />}
    </article>
  );
}

function LoadedBody({ mentees }: { readonly mentees: MenteeSummary[] }) {
  if (mentees.length === 0) {
    return (
      <p className="text-[13px] text-text-muted italic px-1 py-4 text-center">
        No mentees assigned yet.
      </p>
    );
  }

  // Pending-actions first, then name. Stable sort with a copy so we
  // don't mutate the parent's array.
  const sorted = [...mentees].sort((a, b) => {
    if (b.pending_actions_count !== a.pending_actions_count) {
      return b.pending_actions_count - a.pending_actions_count;
    }
    return a.full_name.localeCompare(b.full_name);
  });

  return (
    <div className="rounded-lg border border-border bg-slate-50/40 divide-y divide-border/60">
      {sorted.map((m) => (
        <MenteeRow key={m.user_id} mentee={m} />
      ))}
    </div>
  );
}

function MenteeRow({ mentee }: { readonly mentee: MenteeSummary }) {
  const pending = mentee.pending_actions_count;
  const progress = Math.max(0, Math.min(100, mentee.goals.avg_progress_percent));
  const pill = mentee.review.status ? REVIEW_PILL[mentee.review.status] : null;
  const perfGroup = mentee.projects.latest_performance_group;

  return (
    <Link
      to={`/my-mentees/${mentee.user_id}`}
      className="flex items-center gap-3 px-3 py-2.5 hover:bg-white transition-colors"
    >
      {/* Identity */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium text-text-main">
          {mentee.full_name}
        </p>
        <p className="truncate text-[11px] text-text-muted">
          {[mentee.function_name, mentee.designation_name]
            .filter(Boolean)
            .join(" · ") || "—"}
        </p>
      </div>

      {/* Goal progress — only meaningful when the mentee has approved goals
          (avg_progress_percent is computed across them). Show a thin bar
          with the numeric chip; suppress entirely when there's no data. */}
      {mentee.goals.approved > 0 && (
        <div className="hidden sm:flex items-center gap-2 w-32 shrink-0">
          <div
            className="h-1.5 flex-1 rounded-full bg-slate-200"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Goal progress ${progress}%`}
          >
            <div
              className="h-1.5 rounded-full bg-brand transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-[11px] font-medium text-text-muted tabular-nums w-8 text-right">
            {progress}%
          </span>
        </div>
      )}

      {/* Latest performance group — semantic color */}
      {perfGroup !== null && (
        <span
          className={`hidden md:inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0 ${perfChipClasses(perfGroup)}`}
          title="Latest project review performance group"
        >
          P{perfGroup}
        </span>
      )}

      {/* Annual review status */}
      {pill !== null && (
        <span
          className={`hidden md:inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0 ${pill.classes}`}
        >
          {pill.label}
        </span>
      )}

      {/* Pending actions — the most actionable chip, kept rightmost so
          the eye lands on it when scanning the column. */}
      {pending > 0 && (
        <span
          className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-700 shrink-0"
          title={`${pending} action${pending === 1 ? "" : "s"} waiting on you`}
        >
          <AlertTriangle className="h-3 w-3" aria-hidden="true" />
          {pending}
        </span>
      )}

      <ArrowRight
        className="h-3.5 w-3.5 shrink-0 text-text-muted"
        aria-hidden="true"
      />
    </Link>
  );
}

function SkeletonBody() {
  return (
    <div className="rounded-lg border border-border bg-slate-50/40 divide-y divide-border/60 animate-pulse">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex items-center gap-3 px-3 py-2.5">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 w-40 rounded bg-slate-100" />
            <div className="h-2.5 w-28 rounded bg-slate-100" />
          </div>
          <div className="hidden sm:block h-1.5 w-32 rounded-full bg-slate-100" />
          <div className="hidden md:block h-4 w-12 rounded-full bg-slate-100" />
          <div className="hidden md:block h-4 w-20 rounded-full bg-slate-100" />
        </div>
      ))}
    </div>
  );
}
