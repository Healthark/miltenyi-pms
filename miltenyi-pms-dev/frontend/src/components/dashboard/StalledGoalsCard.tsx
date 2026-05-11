/**
 * StalledGoalsCard — annual goals stuck in `pending_approval` longer
 * than the backend's stall threshold.
 *
 * The natural escalation target is the **mentor** (who owns
 * approve/changes-requested on submission), so each row foregrounds
 * the mentor name in its right column. HR opens this card to know
 * which mentors to nudge.
 *
 * All-clear state mirrors MissingAnnualReviewsCard — green check + a
 * positive message — so the dashboard reads "everything's fine here"
 * when the chase list is empty.
 */

import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { StalledGoalsSummary } from "@/services/dashboard.service";
import { formatFyYearSpan } from "@/utils/fy";

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
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            isAllClear ? "bg-emerald-50" : "bg-amber-50"
          }`}
        >
          {isAllClear ? (
            <CheckCircle2
              className="h-4 w-4 text-emerald-600"
              aria-hidden="true"
            />
          ) : (
            <AlertTriangle
              className="h-4 w-4 text-amber-600"
              aria-hidden="true"
            />
          )}
        </div>
        <div>
          <h3 className="font-display text-sm font-semibold text-text-main">
            Stalled Goal Approvals
          </h3>
          {subtitle && (
            <p className="mt-0.5 text-[11px] text-text-muted">{subtitle}</p>
          )}
        </div>
      </div>

      {/* Body */}
      {isLoading ? (
        <SkeletonBody />
      ) : isAllClear ? (
        <AllClearBody fyLabel={fyLabel} />
      ) : (
        <div className="space-y-2">
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl font-semibold text-text-main leading-none">
              {count}
            </span>
            <span className="text-sm text-text-muted">
              {count === 1
                ? "goal waiting on a mentor"
                : "goals waiting on a mentor"}
            </span>
          </div>

          {/* Scrollable list */}
          <div className="rounded-lg border border-border bg-slate-50/40 max-h-64 overflow-y-auto divide-y divide-border/60">
            {data!.goals.map((g) => (
              <div
                key={g.goal_id}
                className="flex items-start justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p
                    className="text-[13px] font-medium text-text-main truncate"
                    title={g.title}
                  >
                    {g.title}
                  </p>
                  <p className="mt-0.5 text-[11px] text-text-muted truncate">
                    {g.owner_name}
                  </p>
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1">
                  <span className="inline-flex items-center rounded-full bg-amber-50 text-amber-700 px-2 py-0.5 text-[11px] font-semibold">
                    {g.days_waiting}d
                  </span>
                  <span
                    className="text-[11px] text-text-muted truncate max-w-[120px]"
                    title={g.mentor_name ?? "no mentor"}
                  >
                    Mentor:{" "}
                    {g.mentor_name ?? (
                      <span className="italic">none</span>
                    )}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="pt-2 border-t border-border/60">
        <Link
          to={viewAllHref}
          className="text-[12px] font-medium text-brand hover:underline"
        >
          View all →
        </Link>
      </div>
    </article>
  );
}

// ── Internal pieces ───────────────────────────────────────────────────

function SkeletonBody() {
  return (
    <div className="space-y-2 animate-pulse">
      <div className="flex items-baseline gap-2">
        <div className="h-8 w-12 rounded bg-slate-100" />
        <div className="h-4 w-40 rounded bg-slate-100" />
      </div>
      <div className="rounded-lg border border-border bg-slate-50/40 divide-y divide-border/60">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-3 px-3 py-2"
          >
            <div className="min-w-0 flex-1 space-y-1">
              <div className="h-3 w-44 rounded bg-slate-100" />
              <div className="h-2 w-24 rounded bg-slate-100" />
            </div>
            <div className="space-y-1 items-end flex flex-col">
              <div className="h-4 w-10 rounded-full bg-slate-100" />
              <div className="h-2 w-20 rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AllClearBody({ fyLabel }: { readonly fyLabel: string | null }) {
  return (
    <div className="rounded-lg bg-emerald-50/40 border border-dashed border-emerald-200 px-4 py-5 text-center">
      <p className="text-sm text-emerald-700">
        {fyLabel
          ? `No ${fyLabel} goals stalled in approval.`
          : "No goals stalled in approval."}
      </p>
    </div>
  );
}
