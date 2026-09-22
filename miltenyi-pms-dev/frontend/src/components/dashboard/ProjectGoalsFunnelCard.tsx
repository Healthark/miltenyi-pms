/**
 * ProjectGoalsFunnelCard — the Admin's org-wide Project Goals picture for
 * the year picked on the dashboard.
 *
 * Fed by the same preflight the System Settings Save confirmation uses
 * (GET /admin/goal-frameworks/settings/preflight?period=), so the
 * dashboard and the settings page quote the same counts:
 *   - goal sets: not started / draft / submitted / approved
 *   - per started quarter: self-reviews pending, reviews pending,
 *     reviews submitted, ratings released or hidden
 * plus the two yearly switches (goal entry, weightages).
 */

import { ArrowRight, ClipboardList } from "lucide-react";
import { Link } from "react-router-dom";
import type { PeriodPreflight } from "@/services/goal-framework.service";
import { quarterDisplay, quarterSeq, type PeriodSettings } from "@/services/project-goals.service";
import { DonutChart } from "./DonutChart";

interface ProjectGoalsFunnelCardProps {
  /** Undefined while loading; null when the picked year has no goal year. */
  readonly preflight: PeriodPreflight | null | undefined;
  /** Undefined while loading; null when the picked year has no goal year. */
  readonly period: PeriodSettings | null | undefined;
  /** The picked year in CY spelling, for the empty state. */
  readonly yearLabel: string;
}

const SEGMENT_COLORS = {
  not_started: "#cbd5e1",
  draft: "#94a3b8",
  submitted: "#fbbf24",
  approved: "#34d399",
} as const;

export function ProjectGoalsFunnelCard({ preflight, period, yearLabel }: ProjectGoalsFunnelCardProps) {
  const isLoading = preflight === undefined || period === undefined;
  const total = preflight?.staff_total ?? 0;

  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <ClipboardList className="h-4 w-4 text-brand" aria-hidden="true" />
          </div>
          <div>
            <h3 className="font-display text-sm font-semibold text-text-main">Project Goals</h3>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {yearLabel}
              {period?.current_quarter_label ? ` · Q${quarterSeq(period.current_quarter_label)} current` : ""}
            </p>
          </div>
        </div>
        <Link to="/project-goals" className="text-[12px] font-medium text-brand hover:underline whitespace-nowrap">
          View all →
        </Link>
      </div>

      {isLoading ? (
        <SkeletonBody />
      ) : !preflight || !period ? (
        <div className="rounded-lg bg-slate-50 border border-dashed border-border px-4 py-5 text-center">
          <p className="text-sm text-text-muted">No goal year {yearLabel}. Goal years start when the Admin rolls Q4 into Q1 in System Settings.</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <ul className="flex-1 space-y-2 text-[13px]">
              <LegendItem dotColor={SEGMENT_COLORS.not_started} count={preflight.staff_without_set} label="Not started" />
              <LegendItem dotColor={SEGMENT_COLORS.draft} count={preflight.sets_draft} label="Draft" />
              <LegendItem dotColor={SEGMENT_COLORS.submitted} count={preflight.sets_submitted} label="Submitted · awaiting approval" />
              <LegendItem dotColor={SEGMENT_COLORS.approved} count={preflight.sets_approved} label="Approved" />
            </ul>
            <DonutChart
              segments={[
                { label: "Not started", value: preflight.staff_without_set, color: SEGMENT_COLORS.not_started },
                { label: "Draft", value: preflight.sets_draft, color: SEGMENT_COLORS.draft },
                { label: "Submitted", value: preflight.sets_submitted, color: SEGMENT_COLORS.submitted },
                { label: "Approved", value: preflight.sets_approved, color: SEGMENT_COLORS.approved },
              ]}
              centerPrimary={String(preflight.sets_approved)}
              centerSecondary={`/${total}`}
              ariaLabel={`${preflight.sets_approved} of ${total} staff have approved project goals`}
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Chip on={period.entry_open} onText="Goal entry open" offText="Goal entry closed" />
            <Chip on={period.weightages_visible} onText="Weightages visible" offText="Weightages hidden" />
          </div>

          {preflight.quarters.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-[12px]">
                <thead className="bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  <tr>
                    <th className="px-3 py-1.5 text-left font-bold">Quarter</th>
                    <th className="px-2 py-1.5 text-right font-bold">Self-reviews pending</th>
                    <th className="px-2 py-1.5 text-right font-bold">Reviews pending</th>
                    <th className="px-2 py-1.5 text-right font-bold">Submitted</th>
                    <th className="px-3 py-1.5 text-right font-bold">Ratings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {preflight.quarters.map((qp) => {
                    const quarter = period.quarters.find((x) => x.seq === qp.seq);
                    const isCurrent = period.current_quarter_seq === qp.seq;
                    return (
                      <tr key={qp.seq} className={isCurrent ? "bg-brand-light/30" : ""}>
                        <td className="px-3 py-1.5 text-text-main">
                          {quarterDisplay(qp.cycle_label)}
                          {isCurrent && (
                            <span className="ml-1.5 rounded-full bg-brand-light px-1.5 py-0.5 text-[10px] font-semibold text-brand-accent">current</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{qp.self_pending}</td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${qp.review_pending > 0 ? "font-semibold text-amber-800" : ""}`}>{qp.review_pending}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{qp.reviews_submitted}</td>
                        <td className="px-3 py-1.5 text-right">
                          <span
                            className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                              quarter?.ratings_visible ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"
                            }`}
                          >
                            {quarter?.ratings_visible ? "Released" : "Hidden"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-text-muted">Quarterly reviews start when the Admin rolls out Q1.</p>
          )}

          <Link to="/admin?tab=settings" className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
            System Settings <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </>
      )}
    </article>
  );
}

function Chip({ on, onText, offText }: { readonly on: boolean; readonly onText: string; readonly offText: string }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${on ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-800"}`}>
      {on ? onText : offText}
    </span>
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

function SkeletonBody() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="flex items-center gap-2">
        <ul className="flex-1 space-y-2">
          <li className="h-4 w-28 rounded bg-slate-100" />
          <li className="h-4 w-24 rounded bg-slate-100" />
          <li className="h-4 w-40 rounded bg-slate-100" />
          <li className="h-4 w-28 rounded bg-slate-100" />
        </ul>
        <div className="h-32 w-32 rounded-full bg-slate-100" />
      </div>
      <div className="h-16 w-full rounded-lg bg-slate-100" />
    </div>
  );
}
