/**
 * MentorCoverageCard — mentor pairing health snapshot.
 *
 * Two stacked sections answer one question ("are we paired up well?"):
 *   1. Unmentored Employees — operationally blocked from goals/reviews
 *      until they're assigned a mentor. All-clear state with a green
 *      check when zero, scrollable list when non-empty.
 *   2. Top mentors by load — the most-loaded mentors so HR can spot
 *      overload before assigning new Employees.
 *
 * Not FY-scoped. This is a "right now" snapshot of the org, like the
 * Headcount card.
 *
 * Renders as a full-width row beneath the summary grid — brand-themed
 * header tile with a "View all" affordance.
 */

import { CheckCircle2, UserCog, UserMinus, Users } from "lucide-react";
import { Link } from "react-router-dom";
import type { MentorCoverage } from "@/services/dashboard.service";

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
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <UnmentoredSection unmentored={data.unmentored_employees} />
          <TopMentorsSection mentors={data.top_mentors} />
        </div>
      )}
    </article>
  );
}

// ── Sections ──────────────────────────────────────────────────────────

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
