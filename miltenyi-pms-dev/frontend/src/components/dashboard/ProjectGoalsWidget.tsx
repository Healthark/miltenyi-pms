/**
 * ProjectGoalsWidget — the staff member's Project Goals at a glance.
 *
 * Two sub-sections, fed by the same GET /project-goals/me the Project
 * Goals page uses (shared cache entry):
 *   1. Goals · <year>   — where the yearly goal set stands
 *                          (not started → draft → submitted → approved)
 *   2. This quarter     — the current quarter's self-review and Miltenyi
 *                          review, with the one thing to do next.
 *
 * Every state carries a single call to action that deep-links into the
 * Project Goals page with the quarter pre-selected.
 */

import { ArrowRight, ClipboardList, Lock } from "lucide-react";
import { Link } from "react-router-dom";
import {
  isQuarterWritable,
  quarterDisplay,
  reviewFor,
  type GoalReview,
  type MyProjectGoals,
} from "@/services/project-goals.service";
import { SetStatusBadge, StepBadge, fmtDate } from "@/components/project-goals/ui";

interface ProjectGoalsWidgetProps {
  /** Null while the fetch is in flight. */
  readonly data: MyProjectGoals | null;
}

interface Copy {
  readonly text: string;
  readonly cta: string | null;
  readonly href: string;
  readonly tone?: "amber";
}

const PAGE = "/project-goals";

function quarterHref(cycleLabel: string): string {
  return `${PAGE}?cycle=${encodeURIComponent(cycleLabel)}`;
}

function goalsCopy(data: MyProjectGoals): Copy {
  const period = data.period!;
  const year = period.period_label;
  const set = data.goal_set;
  const reviewer = data.miltenyi_reviewer_name ?? "your Miltenyi reviewer";
  const mentor = data.mentor_name ?? "your mentor";

  if (!set) {
    if (data.framework_missing_reason) {
      return { text: `${data.framework_missing_reason} Ask the Admin to add the framework row before you start.`, cta: null, href: PAGE, tone: "amber" };
    }
    if (!period.entry_open) {
      return { text: `Goal entry for ${year} is closed. Ask the Admin if you still need to enter goals.`, cta: null, href: PAGE, tone: "amber" };
    }
    return { text: `One goal per KPI, set once for ${year}. Agree the wording with ${reviewer} first.`, cta: `Start your ${year} goals`, href: PAGE };
  }
  switch (set.status) {
    case "draft":
      return { text: "Draft saved. Fill every KPI row, then submit; the additional-goals row is optional.", cta: "Continue your goals", href: PAGE };
    case "submitted":
      return { text: `Submitted on ${fmtDate(set.submitted_at)}. Read-only while ${mentor} records the approval agreed with ${reviewer}.`, cta: "View goals", href: PAGE };
    default:
      return { text: `Approved (agreed offline) on ${fmtDate(set.approved_at)}. Locked for ${year}; each quarter you review against them.`, cta: "View goals", href: PAGE };
  }
}

function quarterCopy(data: MyProjectGoals, review: GoalReview | null): Copy {
  const period = data.period!;
  const label = period.current_quarter_label!;
  const q = quarterDisplay(label);
  const set = data.goal_set;
  const reviewer = data.miltenyi_reviewer_name ?? "your Miltenyi reviewer";
  const mentor = data.mentor_name ?? "your mentor";
  const href = quarterHref(label);

  if (!set || set.status !== "approved") {
    return { text: "Quarterly reviews start once your goals are approved.", cta: null, href };
  }
  const selfDone = !!review && !review.self_is_draft;
  const reviewDone = !!review && !review.review_is_draft;
  if (!selfDone) {
    if (!isQuarterWritable(period, label)) {
      return { text: `${q} is closed. Nothing was submitted for it.`, cta: null, href, tone: "amber" };
    }
    const started = review?.self_status === "draft";
    return {
      text: started
        ? `Your ${q} self-review is saved as a draft.`
        : `Your ${q} self-review is open: what you delivered against each goal, and one overall rating.`,
      cta: started ? `Continue your ${q} self-review` : `Write your ${q} self-review`,
      href,
    };
  }
  if (!reviewDone) {
    return {
      text: `Self-review submitted on ${fmtDate(review!.self_submitted_at)}. ${reviewer}'s comments appear here once ${mentor} has entered them.`,
      cta: `View ${q}`,
      href,
    };
  }
  if (!review!.acknowledged_at) {
    return {
      text: `${review!.miltenyi_reviewer_name ?? reviewer}'s ${q} comments are in, entered by ${review!.entered_by_name ?? mentor} on ${fmtDate(review!.review_submitted_at)}.`,
      cta: `Read and acknowledge ${q}`,
      href,
    };
  }
  return { text: `${q} reviewed and acknowledged on ${fmtDate(review!.acknowledged_at)}.`, cta: `View ${q}`, href };
}

export function ProjectGoalsWidget({ data }: ProjectGoalsWidgetProps) {
  return (
    <article className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <ClipboardList className="h-4 w-4 text-brand" aria-hidden="true" />
          </div>
          <div>
            <h3 className="font-display text-sm font-semibold text-text-main">Project Goals</h3>
            {data?.period && <p className="mt-0.5 text-[11px] text-text-muted">{data.period.period_label}</p>}
          </div>
        </div>
        <Link to={PAGE} className="text-[12px] font-medium text-brand hover:underline whitespace-nowrap">
          Open →
        </Link>
      </div>

      {data === null ? (
        <SkeletonBody />
      ) : !data.period ? (
        <EmptyBody text="No goal year is active yet. The Admin starts one in System Settings → Project Goals." />
      ) : (
        <Body data={data} />
      )}
    </article>
  );
}

function Body({ data }: { readonly data: MyProjectGoals }) {
  const period = data.period!;
  const set = data.goal_set;
  const goals = goalsCopy(data);
  const label = period.current_quarter_label;
  const review = label ? reviewFor(set, label) : null;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 md:divide-x md:divide-border">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">Goals · {period.period_label}</p>
          <SetStatusBadge status={set?.status ?? "not_started"} />
        </div>
        <CopyBlock copy={goals} />
      </section>

      <section className="space-y-2 md:pl-4">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            {label ? `This quarter · ${quarterDisplay(label)}` : "This quarter"}
          </p>
          {label && set?.status === "approved" && (
            <div className="flex items-center gap-1.5">
              <StepBadge status={review?.self_status ?? "not_started"} label={`Self-review · ${stepWord(review?.self_status)}`} />
              <StepBadge status={review?.review_status ?? "not_started"} label={`Review · ${stepWord(review?.review_status)}`} />
            </div>
          )}
        </div>
        {label ? (
          <>
            <CopyBlock copy={quarterCopy(data, review)} />
            {review && !review.review_is_draft && review.final_rating_hidden && (
              <p className="flex items-center gap-1.5 text-[11px] text-text-muted">
                <Lock className="h-3 w-3" aria-hidden="true" /> Final rating is hidden until the Admin releases the {quarterDisplay(label)} ratings.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-text-muted">Quarterly reviews start when the Admin rolls out Q1.</p>
        )}
      </section>
    </div>
  );
}

function stepWord(status: GoalReview["self_status"] | undefined): string {
  if (status === "submitted") return "submitted";
  if (status === "draft") return "draft";
  return "not started";
}

function CopyBlock({ copy }: { readonly copy: Copy }) {
  return (
    <>
      <p className={`text-sm ${copy.tone === "amber" ? "text-amber-800" : "text-text-muted"}`}>{copy.text}</p>
      {copy.cta && (
        <Link to={copy.href} className="inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline">
          {copy.cta} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      )}
    </>
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
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 animate-pulse">
      {[0, 1].map((i) => (
        <div key={i} className="space-y-2">
          <div className="h-3 w-32 rounded bg-slate-100" />
          <div className="h-4 w-full rounded bg-slate-100" />
          <div className="h-4 w-3/4 rounded bg-slate-100" />
          <div className="h-3 w-28 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}
