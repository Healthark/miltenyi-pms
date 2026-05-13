/**
 * StalledGoalsCard — annual goals stuck in `pending_approval` longer
 * than the backend's stall threshold.
 *
 * The natural escalation target is the **mentor** (who owns
 * approve/changes-requested on submission), so each row foregrounds
 * the mentor name underneath the goal title. HR opens this card to
 * know which mentors to nudge.
 *
 * Card layout follows the checklist reference: title + red count
 * badge in the header, a short list of the most-stalled items (top
 * INLINE_LIMIT rows), and a full-width brand CTA at the bottom that
 * leads to the page with the rest. The right column shows the wait
 * time prominently — it's the field that actually drives HR
 * prioritisation.
 */

import { CheckCircle2, Clock } from "lucide-react";
import { Link } from "react-router-dom";
import type { StalledGoalsSummary } from "@/services/dashboard.service";
import { formatFyYearSpan } from "@/utils/fy";

/** Max rows shown inline. Mirrors the checklist reference's cadence
 *  and keeps card heights even with MissingAnnualReviewsCard. */
const INLINE_LIMIT = 3;
/** Wait days at which a stall is treated as critical (badge + per-row
 *  icon escalate from amber to red). 14d = two business weeks, the
 *  point where "people forgot" becomes "process is broken". */
const CRITICAL_DAYS = 14;

interface StalledGoalsCardProps {
  /** Null while the parent's fetch is in flight. */
  readonly data: StalledGoalsSummary | null;
  readonly viewAllHref?: string;
}

export function StalledGoalsCard({
  data,
  viewAllHref = "/annual-goals",
}: StalledGoalsCardProps) {
  const isLoading = data === null;
  const fyLabel =
    data?.fy_year != null ? formatFyYearSpan(data.fy_year) : null;
  const count = data?.count ?? 0;
  const isAllClear = !isLoading && count === 0;
  const subtitle =
    fyLabel && data
      ? `${fyLabel} · waiting > ${data.threshold_days}d`
      : fyLabel;

  return (
    <article className="flex flex-col rounded-xl border border-border bg-surface shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div>
          <h3 className="font-display text-base font-semibold text-text-main">
            Stalled Goal Approvals
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-[11px] text-text-muted">{subtitle}</p>
          )}
        </div>
        <CountBadge count={count} isAllClear={isAllClear} />
      </div>

      <hr className="border-border/60" />

      {/* Body */}
      {isLoading ? (
        <SkeletonBody />
      ) : isAllClear ? (
        <AllClearBody fyLabel={fyLabel} thresholdDays={data.threshold_days} />
      ) : (
        <ul className="divide-y divide-border/60">
          {data.goals.slice(0, INLINE_LIMIT).map((g) => {
            const isCritical = g.days_waiting >= CRITICAL_DAYS;
            return (
              <li
                key={g.goal_id}
                className="flex items-center gap-3 px-5 py-3"
              >
                <div
                  className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
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
                    className="text-[13px] font-semibold text-text-main truncate"
                    title={g.title}
                  >
                    {g.title}
                  </p>
                  <p
                    className="mt-0.5 text-[11px] text-text-muted truncate"
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

      {/* Footer CTA */}
      <div className="px-5 pb-5 pt-3">
        <Link
          to={viewAllHref}
          className="block w-full rounded-lg bg-brand-light py-2.5 text-center text-[13px] font-semibold text-brand transition-colors hover:bg-brand hover:text-white"
        >
          View All Goals
        </Link>
      </div>
    </article>
  );
}

// ── Internal pieces ───────────────────────────────────────────────────

function CountBadge({
  count,
  isAllClear,
}: {
  readonly count: number;
  readonly isAllClear: boolean;
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
      {count} Stalled
    </span>
  );
}

function SkeletonBody() {
  return (
    <ul className="divide-y divide-border/60 animate-pulse">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 px-5 py-3">
          <div className="h-10 w-10 shrink-0 rounded-full bg-slate-100" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 w-40 rounded bg-slate-100" />
            <div className="h-2 w-28 rounded bg-slate-100" />
          </div>
          <div className="h-4 w-10 rounded bg-slate-100" />
        </li>
      ))}
    </ul>
  );
}

function AllClearBody({
  fyLabel,
  thresholdDays,
}: {
  readonly fyLabel: string | null;
  readonly thresholdDays: number;
}) {
  return (
    <div className="px-5 py-6 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
        <CheckCircle2 className="h-5 w-5 text-green" aria-hidden="true" />
      </div>
      <p className="mt-2 text-[13px] font-medium text-text-main">
        No goals stalled in approval.
      </p>
      <p className="mt-0.5 text-[11px] text-text-muted">
        {fyLabel
          ? `Nothing waiting > ${thresholdDays}d in ${fyLabel}.`
          : `Nothing waiting > ${thresholdDays}d.`}
      </p>
    </div>
  );
}
