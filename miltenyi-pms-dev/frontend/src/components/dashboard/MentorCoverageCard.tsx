/**
 * MentorCoverageCard — mentor pairing health snapshot.
 *
 * Sections answer one question ("are we paired up well?"):
 *   0. (Conditional, top of card) Orphaned by Deactivation — mentees
 *      who lost their mentor via deactivation or role-change cascade
 *      and still need reassignment. Rendered ONLY when count > 0,
 *      with amber styling — this is an "act on me" alert with
 *      in-flight goal/review work behind it. See
 *      docs/policies/mentor-transition-policy.md.
 *   1. Unmentored Employees — never had a mentor (process gap).
 *      All-clear green when zero, scrollable list when non-empty.
 *   2. Top mentors by load — the most-loaded mentors so HR can spot
 *      overload before assigning new Employees.
 *
 * Not FY-scoped. This is a "right now" snapshot of the org, like the
 * Headcount card.
 *
 * Renders as a full-width row beneath the summary grid — brand-themed
 * header tile with a "View all" affordance.
 */

import { AlertTriangle, CheckCircle2, UserCog, UserMinus, Users } from "lucide-react";
import { Link } from "react-router-dom";
import type { MentorCoverage, OrphanedEmployee } from "@/services/dashboard.service";

interface MentorCoverageCardProps {
  /** Null while the parent's fetch is in flight. */
  readonly data: MentorCoverage | null;
  /** Where View all takes the user. Defaults to the admin Users tab
   *  where mentor assignments live. */
  readonly viewAllHref?: string;
}

export function MentorCoverageCard({
  data,
  // Default deep-links to the Users tab pre-filtered to role=Employee
  // — the universe the Mentor Coverage card is talking about. HR lands
  // on the full Employee roster (active by default via UsersTab's
  // `status=active` default) and can narrow further from there using
  // the page's own filters. Earlier this link also pinned the
  // "(No mentor)" mentor sentinel, but that pre-narrowed the
  // destination to only unmentored rows — confusing for the common
  // case where HR clicks "View all" expecting the broader population
  // the card was summarising, not just the chase list.
  viewAllHref = "/admin?tab=users&role=Employee",
}: MentorCoverageCardProps) {
  const isLoading = data === null;

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <Users className="h-4 w-4 text-brand" aria-hidden="true" />
          </div>
          <h3 className="font-display text-sm font-semibold text-text-main">
            Mentor Coverage
          </h3>
        </div>
        <Link
          to={viewAllHref}
          className="text-[12px] font-medium text-brand hover:underline whitespace-nowrap"
        >
          View all →
        </Link>
      </div>

      {/* Body */}
      {isLoading ? (
        <SkeletonBody />
      ) : (
        <>
          {/* Orphaned section renders above the regular grid — it's
              an "act on me" alert (in-flight work froze on these
              users), not a passive metric. Only shows when there's
              something to act on. */}
          {data.orphaned_employees.length > 0 && (
            <OrphanedSection orphaned={data.orphaned_employees} />
          )}
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <UnmentoredSection unmentored={data.unmentored_employees} />
            <TopMentorsSection mentors={data.top_mentors} />
          </div>
        </>
      )}
    </article>
  );
}

// ── Sections ──────────────────────────────────────────────────────────

/** Render "Orphaned X days ago" from an ISO timestamp. Returns a
 *  compact human phrasing — "today", "1 day ago", "N days ago". */
function formatOrphanAge(isoTimestamp: string): string {
  const orphanedAt = new Date(isoTimestamp);
  const ms = Date.now() - orphanedAt.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function OrphanedSection({
  orphaned,
}: {
  readonly orphaned: OrphanedEmployee[];
}) {
  const count = orphaned.length;
  const word = count === 1 ? "employee" : "employees";
  return (
    <section className="space-y-2">
      {/* Amber callout: this section IS the alert — coloured wrapper
          + warning icon + count. Distinct from the Unmentored section
          (which is grey/neutral, a passive list). HR is meant to
          notice this and act. */}
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
          Their previous mentor was deactivated or role-changed. Assign
          a new mentor to unfreeze pending goals + reviews.
        </p>
        <div className="rounded-md border border-amber-200 bg-white/70 max-h-32 overflow-y-auto divide-y divide-amber-200/70">
          {orphaned.map((o) => (
            <div
              key={o.user_id}
              className="flex items-center justify-between gap-3 px-3 py-1.5"
            >
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-text-main truncate">
                  {o.full_name}
                </p>
                <p className="text-[11px] text-text-muted truncate">
                  {[o.function_name, o.designation_name]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
              <p className="text-[11px] text-amber-700 whitespace-nowrap shrink-0">
                Orphaned {formatOrphanAge(o.orphaned_at)}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function UnmentoredSection({
  unmentored,
}: {
  readonly unmentored: MentorCoverage["unmentored_employees"];
}) {
  const count = unmentored.length;
  return (
    <section className="space-y-2">
      <SectionLabel icon={<UserMinus className="h-3 w-3" />}>
        Unmentored Employees
      </SectionLabel>

      {count === 0 ? (
        <div className="rounded-lg bg-emerald-50/40 dark:bg-emerald-900/20 border border-dashed border-emerald-200 dark:border-emerald-500/40 px-3 py-2.5 text-center">
          <p className="text-[12px] text-emerald-700 inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Every active Employee has a mentor.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-border bg-slate-50/40 max-h-32 overflow-y-auto divide-y divide-border/60">
            {unmentored.map((s) => (
              <div key={s.user_id} className="px-3 py-1.5">
                <p className="text-[13px] font-medium text-text-main truncate">
                  {s.full_name}
                </p>
                <p className="text-[11px] text-text-muted truncate">
                  {[s.function_name, s.designation_name]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function TopMentorsSection({
  mentors,
}: {
  readonly mentors: MentorCoverage["top_mentors"];
}) {
  return (
    <section className="space-y-2">
      <SectionLabel icon={<UserCog className="h-3 w-3" />}>
        Top mentors by load
      </SectionLabel>

      {mentors.length === 0 ? (
        <p className="text-[12px] text-text-muted italic px-1">
          No mentors with active mentees.
        </p>
      ) : (
        <div className="rounded-lg border border-border bg-slate-50/40 divide-y divide-border/60">
          {mentors.map((m) => (
            <div
              key={m.mentor_id}
              className="flex items-center justify-between gap-3 px-3 py-1.5"
            >
              <p className="text-[13px] text-text-main truncate">
                {m.full_name}
              </p>
              <span className="inline-flex items-center rounded-full bg-brand-light px-2 py-0.5 text-[11px] font-semibold text-brand shrink-0 tabular-nums">
                {m.mentee_count}{" "}
                {m.mentee_count === 1 ? "mentee" : "mentees"}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Shared building blocks ────────────────────────────────────────────

function SectionLabel({
  icon,
  children,
}: {
  readonly icon: React.ReactNode;
  readonly children: React.ReactNode;
}) {
  return (
    <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
      <span className="text-text-muted" aria-hidden="true">
        {icon}
      </span>
      {children}
    </p>
  );
}

function SkeletonBody() {
  return (
    <div className="grid grid-cols-1 gap-4 animate-pulse md:grid-cols-2">
      {[0, 1].map((section) => (
        <div key={section} className="space-y-2">
          <div className="h-3 w-32 rounded bg-slate-100" />
          <div className="rounded-lg border border-border bg-slate-50/40 divide-y divide-border/60">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="h-3 w-32 rounded bg-slate-100" />
                <div className="h-4 w-16 rounded-full bg-slate-100" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
