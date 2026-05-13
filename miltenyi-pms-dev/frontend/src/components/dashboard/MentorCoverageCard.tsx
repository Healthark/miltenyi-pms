/**
 * MentorCoverageCard — mentor pairing health snapshot.
 *
 * Two stacked sections answer one question ("are we paired up well?"):
 *   1. Unmentored Staff — operationally blocked from goals/reviews
 *      until they're assigned a mentor. All-clear state with a green
 *      check when zero, scrollable list when non-empty.
 *   2. Top mentors by load — the most-loaded mentors so HR can spot
 *      overload before assigning new Staff.
 *
 * Not FY-scoped. This is a "right now" snapshot of the org, like the
 * Headcount card.
 *
 * Layout aligns with the row 1 progress cards: brand-themed header
 * tile, "View all" top-right, and an InsightStripe surfacing the
 * priority callout (unmentored count if any, otherwise the heaviest
 * mentor load).
 */

import { CheckCircle2, UserCog, UserMinus, Users } from "lucide-react";
import { Link } from "react-router-dom";
import type { MentorCoverage } from "@/services/dashboard.service";
import { InsightStripe } from "./InsightStripe";

interface MentorCoverageCardProps {
  /** Null while the parent's fetch is in flight. */
  readonly data: MentorCoverage | null;
  /** Where View all takes the user. Defaults to the admin Users tab
   *  where mentor assignments live. */
  readonly viewAllHref?: string;
}

export function MentorCoverageCard({
  data,
  viewAllHref = "/admin",
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
          <UnmentoredSection unmentored={data.unmentored_staff} />
          <TopMentorsSection mentors={data.top_mentors} />
          <InsightStripe {...buildInsight(data)} />
        </>
      )}
    </article>
  );
}

// Priority order: unmentored staff are an operational block (no goals,
// no reviews), so they outrank "someone is overloaded" as a callout.
// Overload only becomes the headline once the floor is covered.
function buildInsight(data: MentorCoverage) {
  const unmentored = data.unmentored_staff.length;
  if (unmentored > 0) {
    return {
      tone: "red" as const,
      text:
        unmentored === 1
          ? "1 staff blocked — needs a mentor assignment"
          : `${unmentored} staff blocked — need mentor assignments`,
    };
  }
  const heaviest = data.top_mentors.at(0);
  if (!heaviest) {
    return {
      tone: "amber" as const,
      text: "No mentors with active mentees yet",
    };
  }
  return {
    tone: "brand" as const,
    text: `${heaviest.full_name.split(" ")[0]} carries the heaviest load (${heaviest.mentee_count} ${
      heaviest.mentee_count === 1 ? "mentee" : "mentees"
    })`,
  };
}

// ── Sections ──────────────────────────────────────────────────────────

function UnmentoredSection({
  unmentored,
}: {
  readonly unmentored: MentorCoverage["unmentored_staff"];
}) {
  const count = unmentored.length;
  return (
    <section className="space-y-2">
      <SectionLabel icon={<UserMinus className="h-3 w-3" />}>
        Unmentored Staff
      </SectionLabel>

      {count === 0 ? (
        <div className="rounded-lg bg-emerald-50/40 border border-dashed border-emerald-200 px-3 py-2.5 text-center">
          <p className="text-[12px] text-emerald-700 inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Every active Staff member has a mentor.
          </p>
        </div>
      ) : (
        <>
          <p className="text-[12px] text-text-muted">
            <span className="font-semibold text-text-main tabular-nums">
              {count}
            </span>{" "}
            {count === 1 ? "Staff member is" : "Staff members are"} blocked
            from goals + reviews.
          </p>
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
    <div className="space-y-4 animate-pulse">
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
      <div className="h-8 w-full rounded-lg bg-slate-100" />
    </div>
  );
}
