/**
 * MentorCoverageCard — mentor pairing health snapshot.
 *
 * Two sections, side by side at md+ breakpoint:
 *   1. Unassigned Employees — every active Staff member who currently
 *      has no live mentor. Two sub-populations are surfaced via per-row
 *      chips so HR can triage:
 *        • Orphaned by deactivation/role-change (had a mentor, the
 *          cascade nulled it) — amber chip "Lost {N}d ago". Sorted to
 *          the top. In-flight goals + reviews on these employees are
 *          frozen until HR reassigns.
 *        • Never assigned (process gap, no live mentor on file from
 *          day one) — muted chip "Never assigned". Sorted last.
 *   2. Top mentors by load — the most-loaded mentors so HR can spot
 *      overload before assigning new Employees.
 *
 * Empty state when both sub-populations are zero: green all-clear
 * tile in the left column. Not FY-scoped — this is a "right now"
 * snapshot of the org, like the Headcount card.
 *
 * Renders as a full-width row beneath the summary grid; interior
 * splits 50/50 at md+. See docs/policies/mentor-transition-policy.md
 * for the orphan-vs-unassigned distinction.
 */

import { AlertTriangle, CheckCircle2, UserCog, Users } from "lucide-react";
import { Link } from "react-router-dom";
import type {
  MentorCoverage,
  OrphanedEmployee,
  UnmentoredEmployee,
} from "@/services/dashboard.service";

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
  // the page's own filters.
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

      {/* Body — two-column grid at md+ */}
      {isLoading ? (
        <SkeletonBody />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <UnassignedSection
            orphaned={data.orphaned_employees}
            unmentored={data.unmentored_employees}
          />
          <TopMentorsSection mentors={data.top_mentors} />
        </div>
      )}
    </article>
  );
}

// ── Sections ──────────────────────────────────────────────────────────

/** Compact age string for the orphan chip — "today" or "{N}d ago".
 *  Trades the verbose "1 day ago" / "N days ago" phrasing the old
 *  full-width callout used because we have less horizontal room as a
 *  per-row chip in the half-width column. */
function formatLostAge(isoTimestamp: string): string {
  const orphanedAt = new Date(isoTimestamp);
  const ms = Date.now() - orphanedAt.getTime();
  const days = Math.floor(ms / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  return `${days}d ago`;
}

type UnassignedRow =
  | { kind: "orphaned"; row: OrphanedEmployee }
  | { kind: "unmentored"; row: UnmentoredEmployee };

function UnassignedSection({
  orphaned,
  unmentored,
}: {
  readonly orphaned: OrphanedEmployee[];
  readonly unmentored: UnmentoredEmployee[];
}) {
  // Orphans first (urgent — in-flight work froze), then truly-unmentored
  // (process gap — no work to lose). Within each sub-bucket the API
  // already sorts by recency / name; we preserve that ordering here.
  const merged: UnassignedRow[] = [
    ...orphaned.map<UnassignedRow>((row) => ({ kind: "orphaned", row })),
    ...unmentored.map<UnassignedRow>((row) => ({ kind: "unmentored", row })),
  ];
  const count = merged.length;
  const word = count === 1 ? "employee" : "employees";

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <SectionLabel icon={<AlertTriangle className="h-3 w-3" />}>
          Unassigned Employees
        </SectionLabel>
        {count > 0 && (
          <span className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-300 tabular-nums">
            {count} {word}
          </span>
        )}
      </div>

      {count === 0 ? (
        <div className="rounded-lg bg-emerald-50/40 dark:bg-emerald-900/20 border border-dashed border-emerald-200 dark:border-emerald-500/40 px-3 py-2.5 text-center">
          <p className="text-[12px] text-emerald-700 dark:text-emerald-300 inline-flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Every active Employee has a mentor.
          </p>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-slate-50/40 dark:bg-slate-800/40 max-h-44 overflow-y-auto divide-y divide-border/60">
          {merged.map((item) => (
            <UnassignedRow key={`${item.kind}-${item.row.user_id}`} item={item} />
          ))}
        </div>
      )}
    </section>
  );
}

function UnassignedRow({ item }: { readonly item: UnassignedRow }) {
  const { row } = item;
  const subtitle =
    [row.function_name, row.designation_name].filter(Boolean).join(" · ") || "—";

  return (
    <div className="flex items-center justify-between gap-3 px-3 py-1.5">
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-text-main truncate">
          {row.full_name}
        </p>
        <p className="text-[11px] text-text-muted truncate">{subtitle}</p>
      </div>
      {item.kind === "orphaned" ? (
        <span
          className="inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300 whitespace-nowrap shrink-0"
          title="This employee lost their mentor via deactivation or role-change. In-flight goals + reviews are frozen until HR reassigns."
        >
          Lost · {formatLostAge(item.row.orphaned_at)}
        </span>
      ) : (
        <span
          className="inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-700/60 px-2 py-0.5 text-[11px] font-medium text-text-muted whitespace-nowrap shrink-0"
          title="This employee has never been assigned a mentor — a process gap that HR should close."
        >
          Never assigned
        </span>
      )}
    </div>
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
        <div className="rounded-lg border border-border bg-slate-50/40 dark:bg-slate-800/40 divide-y divide-border/60">
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
          <div className="h-3 w-32 rounded bg-slate-100 dark:bg-slate-700" />
          <div className="rounded-lg border border-border bg-slate-50/40 dark:bg-slate-800/40 divide-y divide-border/60">
            {[0, 1, 2].map((row) => (
              <div
                key={row}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="h-3 w-32 rounded bg-slate-100 dark:bg-slate-700" />
                <div className="h-4 w-16 rounded-full bg-slate-100 dark:bg-slate-700" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
