/**
 * PendingActionsCard — combined "needs attention" surface for HR.
 *
 * Merges the two follow-up widgets that used to live as separate cards
 * (Missing Annual Reviews + Stalled Goal Approvals) into a single tall
 * card. Both lists share the same HR mental model — "who do I chase
 * next?" — so they sit better in one frame, freeing the right column
 * of the dashboard for a 2×2 of summary cards on the left.
 *
 * Each section keeps the same shape it had as a standalone card:
 *   - red count badge in the subheader,
 *   - top INLINE_LIMIT rows inline,
 *   - per-section "View all" CTA leading to its respective page.
 */

import {
  CheckCircle2,
  ClipboardX,
  Clock,
  Hourglass,
  UserX,
} from "lucide-react";
import { Link } from "react-router-dom";
import type {
  MissingAnnualReviewsSummary,
  StalledGoalsSummary,
} from "@/services/dashboard.service";

const INLINE_LIMIT = 3;
const CRITICAL_DAYS = 14;

interface PendingActionsCardProps {
  readonly missingReviews: MissingAnnualReviewsSummary | null;
  readonly stalledGoals: StalledGoalsSummary | null;
  readonly missingReviewsHref?: string;
  readonly stalledGoalsHref?: string;
}

export function PendingActionsCard({
  missingReviews,
  stalledGoals,
  missingReviewsHref = "/annual-reviews",
  stalledGoalsHref = "/annual-goals",
}: PendingActionsCardProps) {
  return (
    <article className="flex h-full flex-col gap-5 rounded-xl border border-border bg-surface p-5 shadow-sm">
      <MissingReviewsSection
        data={missingReviews}
        viewAllHref={missingReviewsHref}
      />
      <StalledGoalsSection
        data={stalledGoals}
        viewAllHref={stalledGoalsHref}
      />
    </article>
  );
}

/** Shared wrapper class for each subsection. The tinted slate background
 *  + rounded corners give the two halves of the merged card their own
 *  visual frame so they read as distinct subcards rather than two lists
 *  stacked together. No divider line — the panel boundary does the
 *  separation. */
const SECTION_PANEL =
  "flex flex-col gap-3 rounded-lg border border-border/60 bg-slate-50/50 p-4";

// ── Section: Missing Annual Reviews ───────────────────────────────────

function MissingReviewsSection({
  data,
  viewAllHref,
}: {
  readonly data: MissingAnnualReviewsSummary | null;
  readonly viewAllHref: string;
}) {
  const isLoading = data === null;
  const count = data?.count ?? 0;
  const isAllClear = !isLoading && count === 0;

  return (
    <section className={SECTION_PANEL}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <ClipboardX
              className="h-4 w-4 text-brand"
              aria-hidden="true"
            />
          </div>
          <h4 className="font-display text-sm font-semibold text-text-main">
            Missing Annual Reviews
          </h4>
        </div>
        <CountBadge count={count} isAllClear={isAllClear} label="Missing" />
      </div>

      {isLoading ? (
        <SkeletonList />
      ) : isAllClear ? (
        <AllClearBlock
          icon={<CheckCircle2 className="h-5 w-5 text-green" />}
          title="Every Staff member has started."
          subtitle="Full coverage across the selected FY."
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {data.users.slice(0, INLINE_LIMIT).map((u) => (
            <li
              key={u.user_id}
              className="flex items-center gap-3 rounded-lg px-2 py-2"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-rose-50">
                <UserX className="h-4 w-4 text-red" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-text-main">
                  {u.full_name}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-text-muted">
                  {[u.function_name, u.designation_name]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
              <p
                className="max-w-[110px] shrink-0 truncate text-right text-[12px] text-text-muted"
                title={u.mentor_name ?? "no mentor"}
              >
                {u.mentor_name ?? <span className="italic">no mentor</span>}
              </p>
            </li>
          ))}
        </ul>
      )}

      <Link
        to={viewAllHref}
        className="block w-full rounded-lg bg-brand-light py-2 text-center text-[12px] font-semibold text-brand transition-colors hover:bg-brand hover:text-white"
      >
        View All Reviews
      </Link>
    </section>
  );
}

// ── Section: Stalled Goal Approvals ───────────────────────────────────

function StalledGoalsSection({
  data,
  viewAllHref,
}: {
  readonly data: StalledGoalsSummary | null;
  readonly viewAllHref: string;
}) {
  const isLoading = data === null;
  const count = data?.count ?? 0;
  const isAllClear = !isLoading && count === 0;
  const thresholdSuffix =
    data && !isAllClear ? ` · waiting > ${data.threshold_days}d` : "";

  return (
    <section className={SECTION_PANEL}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <Hourglass
              className="h-4 w-4 text-brand"
              aria-hidden="true"
            />
          </div>
          <h4 className="font-display text-sm font-semibold text-text-main">
            Stalled Goal Approvals
            {thresholdSuffix && (
              <span className="ml-1 text-[11px] font-normal text-text-muted">
                {thresholdSuffix}
              </span>
            )}
          </h4>
        </div>
        <CountBadge count={count} isAllClear={isAllClear} label="Stalled" />
      </div>

      {isLoading ? (
        <SkeletonList />
      ) : isAllClear ? (
        <AllClearBlock
          icon={<CheckCircle2 className="h-5 w-5 text-green" />}
          title="No goals stalled in approval."
          subtitle={
            data
              ? `Nothing waiting > ${data.threshold_days}d.`
              : "Nothing waiting past threshold."
          }
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {data.goals.slice(0, INLINE_LIMIT).map((g) => {
            const isCritical = g.days_waiting >= CRITICAL_DAYS;
            return (
              <li
                key={g.goal_id}
                className="flex items-center gap-3 rounded-lg px-2 py-2"
              >
                <div
                  className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    isCritical ? "bg-rose-50" : "bg-amber-50"
                  }`}
                >
                  <Clock
                    className={`h-4 w-4 ${
                      isCritical ? "text-red" : "text-amber"
                    }`}
                    aria-hidden="true"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className="truncate text-[13px] font-semibold text-text-main"
                    title={g.title}
                  >
                    {g.title}
                  </p>
                  <p
                    className="mt-0.5 truncate text-[11px] text-text-muted"
                    title={g.mentor_name ?? "no mentor"}
                  >
                    {g.owner_name}
                    {g.mentor_name && (
                      <>
                        {" · "}
                        <span>mentor: {g.mentor_name}</span>
                      </>
                    )}
                  </p>
                </div>
                <p
                  className={`shrink-0 text-right font-display text-[13px] font-semibold tabular-nums ${
                    isCritical ? "text-red" : "text-amber"
                  }`}
                >
                  {g.days_waiting}d
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <Link
        to={viewAllHref}
        className="block w-full rounded-lg bg-brand-light py-2 text-center text-[12px] font-semibold text-brand transition-colors hover:bg-brand hover:text-white"
      >
        View All Goals
      </Link>
    </section>
  );
}

// ── Shared building blocks ────────────────────────────────────────────

function CountBadge({
  count,
  isAllClear,
  label,
}: {
  readonly count: number;
  readonly isAllClear: boolean;
  readonly label: string;
}) {
  if (isAllClear) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-green">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        All clear
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md bg-red px-2.5 py-1 text-[11px] font-semibold text-white tabular-nums">
      {count} {label}
    </span>
  );
}

function SkeletonList() {
  return (
    <ul className="flex animate-pulse flex-col gap-1">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 px-2 py-2">
          <div className="h-9 w-9 shrink-0 rounded-full bg-slate-100" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 w-32 rounded bg-slate-100" />
            <div className="h-2 w-24 rounded bg-slate-100" />
          </div>
          <div className="h-3 w-16 rounded bg-slate-100" />
        </li>
      ))}
    </ul>
  );
}

function AllClearBlock({
  icon,
  title,
  subtitle,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly subtitle: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-emerald-200 dark:border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-900/20 px-4 py-4 text-center">
      <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-900/50">
        {icon}
      </div>
      <p className="mt-2 text-[13px] font-medium text-text-main">{title}</p>
      <p className="mt-0.5 text-[11px] text-text-muted">{subtitle}</p>
    </div>
  );
}
