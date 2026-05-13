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
 * Card layout follows the checklist reference: title + red count
 * badge in the header, a short list of the most-relevant items (top
 * INLINE_LIMIT rows), and a full-width brand CTA at the bottom that
 * leads to the page with the rest.
 */

import { CheckCircle2, UserX } from "lucide-react";
import { Link } from "react-router-dom";
import type { MissingAnnualReviewsSummary } from "@/services/dashboard.service";
import { formatFyYearSpan } from "@/utils/fy";

/** Max rows shown inline. Anything beyond this is reachable via the
 *  "View All Reviews" CTA — matches the checklist reference's "3
 *  visible + View All" cadence. */
const INLINE_LIMIT = 3;

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
    <article className="flex flex-col rounded-xl border border-border bg-surface shadow-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
        <div>
          <h3 className="font-display text-base font-semibold text-text-main">
            Missing Annual Reviews
          </h3>
          {fyLabel && (
            <p className="mt-0.5 text-[11px] text-text-muted">{fyLabel}</p>
          )}
        </div>
        <CountBadge count={count} isAllClear={isAllClear} />
      </div>

      <hr className="border-border/60" />

      {/* Body */}
      {isLoading ? (
        <SkeletonBody />
      ) : isAllClear ? (
        <AllClearBody fyLabel={fyLabel} />
      ) : (
        <ul className="divide-y divide-border/60">
          {data.users.slice(0, INLINE_LIMIT).map((u) => (
            <li
              key={u.user_id}
              className="flex items-center gap-3 px-5 py-3"
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-rose-50">
                <UserX className="h-4 w-4 text-red" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold text-text-main truncate">
                  {u.full_name}
                </p>
                <p className="mt-0.5 text-[11px] text-text-muted truncate">
                  {[u.function_name, u.designation_name]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
              <p
                className="shrink-0 text-[12px] text-text-muted truncate max-w-[110px] text-right"
                title={u.mentor_name ?? "no mentor"}
              >
                {u.mentor_name ?? (
                  <span className="italic">no mentor</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}

      {/* Footer CTA */}
      <div className="px-5 pb-5 pt-3">
        <Link
          to={viewAllHref}
          className="block w-full rounded-lg bg-brand-light py-2.5 text-center text-[13px] font-semibold text-brand transition-colors hover:bg-brand hover:text-white"
        >
          View All Reviews
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
      {count} Missing
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
            <div className="h-3 w-32 rounded bg-slate-100" />
            <div className="h-2 w-24 rounded bg-slate-100" />
          </div>
          <div className="h-3 w-20 rounded bg-slate-100" />
        </li>
      ))}
    </ul>
  );
}

function AllClearBody({ fyLabel }: { readonly fyLabel: string | null }) {
  return (
    <div className="px-5 py-6 text-center">
      <div className="mx-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50">
        <CheckCircle2 className="h-5 w-5 text-green" aria-hidden="true" />
      </div>
      <p className="mt-2 text-[13px] font-medium text-text-main">
        Every Staff member has started.
      </p>
      <p className="mt-0.5 text-[11px] text-text-muted">
        {fyLabel
          ? `Full coverage across ${fyLabel}.`
          : "Full coverage for the current cycle."}
      </p>
    </div>
  );
}
