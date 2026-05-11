/**
 * MissingAnnualReviewsCard — Staff who don't have an AnnualReview row
 * yet for the selected FY (drafts included; this widget surfaces the
 * silent population the funnel widget can't show).
 *
 * "Silent" because:
 *   - The funnel widget aggregates rows that exist; users with zero
 *     engagement aren't in any of its buckets.
 *   - Drafts are private to the mentee — HR can't see what's been
 *     written, but at least the row exists, so they aren't counted
 *     as "missing" here.
 *
 * Per-row drill-down isn't wired yet — the page doesn't have a clean
 * "open this user's profile" target for HR. The footer's View all
 * link goes to /annual-reviews so HR can pivot to the All Reviews
 * tab with the same FY context.
 */

import { AlertCircle, CheckCircle2 } from "lucide-react";
import { Link } from "react-router-dom";
import type { MissingAnnualReviewsSummary } from "@/services/dashboard.service";
import { formatFyYearSpan } from "@/utils/fy";

interface MissingAnnualReviewsCardProps {
  /** Null while the parent's fetch is in flight. */
  readonly data: MissingAnnualReviewsSummary | null;
  readonly viewAllHref?: string;
}

export function MissingAnnualReviewsCard({
  data,
  viewAllHref = "/annual-reviews",
}: MissingAnnualReviewsCardProps) {
  const isLoading = data === null;
  const fyLabel =
    data?.fy_year != null ? formatFyYearSpan(data.fy_year) : null;
  const count = data?.count ?? 0;
  const isAllClear = !isLoading && count === 0;

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2.5">
        <div
          className={`flex h-8 w-8 items-center justify-center rounded-lg ${
            isAllClear ? "bg-emerald-50" : "bg-rose-50"
          }`}
        >
          {isAllClear ? (
            <CheckCircle2
              className="h-4 w-4 text-emerald-600"
              aria-hidden="true"
            />
          ) : (
            <AlertCircle
              className="h-4 w-4 text-rose-600"
              aria-hidden="true"
            />
          )}
        </div>
        <div>
          <h3 className="font-display text-sm font-semibold text-text-main">
            Missing Annual Reviews
          </h3>
          {fyLabel && (
            <p className="mt-0.5 text-[11px] text-text-muted">{fyLabel}</p>
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
              {count === 1 ? "staff has not started" : "staff haven't started"}
            </span>
          </div>

          {/* Scrollable list */}
          <div className="rounded-lg border border-border bg-slate-50/40 max-h-64 overflow-y-auto divide-y divide-border/60">
            {data!.users.map((u) => (
              <div
                key={u.user_id}
                className="flex items-start justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-text-main truncate">
                    {u.full_name}
                  </p>
                  <p className="mt-0.5 text-[11px] text-text-muted truncate">
                    {[u.function_name, u.designation_name]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-[10px] uppercase tracking-wider text-text-muted">
                    Mentor
                  </p>
                  <p className="text-[12px] text-text-main">
                    {u.mentor_name ?? (
                      <span className="italic text-text-muted">none</span>
                    )}
                  </p>
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
              <div className="h-3 w-32 rounded bg-slate-100" />
              <div className="h-2 w-24 rounded bg-slate-100" />
            </div>
            <div className="space-y-1">
              <div className="h-2 w-12 rounded bg-slate-100 ml-auto" />
              <div className="h-3 w-20 rounded bg-slate-100" />
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
          ? `Every Staff member has started their ${fyLabel} review.`
          : "Every Staff member has started their annual review."}
      </p>
    </div>
  );
}
