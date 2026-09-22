/**
 * TeamProjectGoalsCard — the mentor's Project Goals queue at a glance
 * (the Admin sees every staff member through the same card).
 *
 * Fed by GET /project-goals/team for the current quarter — the same rows
 * the Team Goals queue renders — so the numbers here and the queue's
 * summary line never disagree:
 *   - the yearly goal sets: not started / draft / awaiting approval / approved
 *   - the current quarter: waiting for the self-review, reviews to enter,
 *     reviewed, acknowledged
 * The insight line names what is waiting on the viewer right now.
 */

import { AlertTriangle, ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";
import { quarterDisplay, quarterSeq, type PeriodSettings, type TeamRow } from "@/services/project-goals.service";
import { nextAction, quarterBucket } from "@/components/project-goals/TeamQueue";
import { DonutChart } from "./DonutChart";

interface TeamProjectGoalsCardProps {
  /** Null while the fetch is in flight. */
  readonly rows: TeamRow[] | null;
  /** The Project Goals period: undefined while loading, null when none is active. */
  readonly period: PeriodSettings | null | undefined;
  readonly viewerIsHr?: boolean;
}

const SEGMENT_COLORS = {
  not_started: "#cbd5e1",
  draft: "#94a3b8",
  submitted: "#fbbf24",
  approved: "#34d399",
} as const;

interface Funnel {
  not_started: number;
  draft: number;
  submitted: number;
  approved: number;
  no_framework: number;
  total: number;
}

function aggregate(rows: TeamRow[]): Funnel {
  const f: Funnel = { not_started: 0, draft: 0, submitted: 0, approved: 0, no_framework: 0, total: 0 };
  for (const r of rows) {
    if (!r.has_framework) {
      f.no_framework += 1;
      continue;
    }
    f.total += 1;
    if (!r.set_id || r.goals_status === "not_started") f.not_started += 1;
    else if (r.goals_status === "draft") f.draft += 1;
    else if (r.goals_status === "submitted") f.submitted += 1;
    else f.approved += 1;
  }
  return f;
}

export function TeamProjectGoalsCard({ rows, period, viewerIsHr = false }: TeamProjectGoalsCardProps) {
  const loading = rows === null || period === undefined;
  const cycleLabel = period?.current_quarter_label ?? null;
  const q = cycleLabel ? quarterDisplay(cycleLabel) : null;
  const qShort = cycleLabel ? `Q${quarterSeq(cycleLabel)}` : null;

  const funnel = rows ? aggregate(rows) : null;
  const toApprove = rows?.filter((r) => nextAction(r, cycleLabel, viewerIsHr) === "approve").length ?? 0;
  const toReview = rows?.filter((r) => nextAction(r, cycleLabel, viewerIsHr) === "review").length ?? 0;
  const buckets = { self_pending: 0, review_pending: 0, reviewed: 0, acknowledged: 0 };
  for (const r of rows ?? []) {
    const b = quarterBucket(r);
    if (b && b !== "all") buckets[b] += 1;
  }

  const waiting = [
    toApprove > 0 ? `${toApprove} awaiting ${viewerIsHr ? "" : "your "}approval` : null,
    toReview > 0 && qShort ? `${toReview} ${qShort} review${toReview === 1 ? "" : "s"} to enter` : null,
  ].filter(Boolean);

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <ClipboardList className="h-4 w-4 text-brand" aria-hidden="true" />
          </div>
          <div>
            <h3 className="font-display text-sm font-semibold text-text-main">{viewerIsHr ? "All Project Goals" : "Team Project Goals"}</h3>
            {period && (
              <p className="mt-0.5 text-[11px] text-text-muted">{q ?? period.period_label}</p>
            )}
          </div>
        </div>
        <Link to="/project-goals" className="text-[12px] font-medium text-brand hover:underline whitespace-nowrap">
          Open queue →
        </Link>
      </div>

      {loading || !funnel || !rows ? (
        <SkeletonBody />
      ) : period === null ? (
        <EmptyBody text="No goal year is active yet. The Admin starts one in System Settings → Project Goals." />
      ) : rows.length === 0 ? (
        <EmptyBody text={viewerIsHr ? "No staff yet." : "No mentees assigned yet."} />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <ul className="flex-1 space-y-2 text-[13px]">
              <LegendItem dotColor={SEGMENT_COLORS.not_started} count={funnel.not_started} label="Not started" />
              <LegendItem dotColor={SEGMENT_COLORS.draft} count={funnel.draft} label="Draft" />
              <LegendItem dotColor={SEGMENT_COLORS.submitted} count={funnel.submitted} label={viewerIsHr ? "Awaiting approval" : "Awaiting your approval"} />
              <LegendItem dotColor={SEGMENT_COLORS.approved} count={funnel.approved} label="Approved" />
            </ul>
            <DonutChart
              size={112}
              thickness={12}
              segments={[
                { label: "Not started", value: funnel.not_started, color: SEGMENT_COLORS.not_started },
                { label: "Draft", value: funnel.draft, color: SEGMENT_COLORS.draft },
                { label: "Awaiting approval", value: funnel.submitted, color: SEGMENT_COLORS.submitted },
                { label: "Approved", value: funnel.approved, color: SEGMENT_COLORS.approved },
              ]}
              centerPrimary={String(funnel.approved)}
              centerSecondary={`of ${funnel.total}`}
              ariaLabel={`${funnel.approved} of ${funnel.total} goal sets approved`}
            />
          </div>

          {q && (
            <div>
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">{q}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat count={buckets.self_pending} label="Waiting for self-review" />
                <Stat count={buckets.review_pending} label="Reviews to enter" highlight={buckets.review_pending > 0} />
                <Stat count={buckets.reviewed} label="Reviewed" />
                <Stat count={buckets.acknowledged} label="Acknowledged" />
              </div>
            </div>
          )}

          <p className="text-[12px] font-medium text-text-main">
            {waiting.length === 0 ? (q ? `Nothing is waiting on you for ${q}.` : "Nothing is waiting on you.") : waiting.join(" · ")}
          </p>

          {funnel.no_framework > 0 && (
            <p className="flex items-center gap-1.5 text-[11px] text-red-700">
              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
              {funnel.no_framework} {funnel.no_framework === 1 ? "staff member has" : "staff members have"} no framework row for their level (Admin → Framework).
            </p>
          )}
        </>
      )}
    </article>
  );
}

function Stat({ count, label, highlight = false }: { readonly count: number; readonly label: string; readonly highlight?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${highlight ? "border-amber-200 bg-amber-50" : "border-border bg-slate-50/60"}`}>
      <p className={`font-display text-lg font-semibold tabular-nums ${highlight ? "text-amber-800" : "text-text-main"}`}>{count}</p>
      <p className="text-[11px] text-text-muted">{label}</p>
    </div>
  );
}

function LegendItem({ dotColor, count, label }: { readonly dotColor: string; readonly count: number; readonly label: string }) {
  return (
    <li className="flex items-center gap-2">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} aria-hidden="true" />
      <span className="font-semibold text-text-main tabular-nums">{count}</span>
      <span className="text-text-muted">{label}</span>
    </li>
  );
}

function EmptyBody({ text }: { readonly text: string }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-dashed border-border px-4 py-5 text-center">
      <p className="text-sm text-text-muted">{text}</p>
    </div>
  );
}

function SkeletonBody() {
  return (
    <div className="flex items-center gap-2 animate-pulse">
      <ul className="flex-1 space-y-2">
        <li className="h-4 w-28 rounded bg-slate-100" />
        <li className="h-4 w-24 rounded bg-slate-100" />
        <li className="h-4 w-36 rounded bg-slate-100" />
        <li className="h-4 w-28 rounded bg-slate-100" />
      </ul>
      <div className="h-28 w-28 rounded-full bg-slate-100" />
    </div>
  );
}
