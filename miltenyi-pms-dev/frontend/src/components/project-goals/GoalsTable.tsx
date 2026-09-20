import { Lock, MessageSquare, Quote } from "lucide-react";
import { PerformanceRatingBadge } from "@/components/reviews/PerformanceRatingBadge";
import { PerformanceRatingSelect } from "@/components/reviews/PerformanceRatingSelect";
import {
  quarterDisplay,
  type FinalRatingBy,
  type GoalItem,
  type GoalReview,
  type ProjectGoalSetStatus,
  type ReviewItem,
} from "@/services/project-goals.service";
import {
  CharCounter,
  KpiNumber,
  NOTE_MAX,
  TEXTAREA_CLS,
  TEXT_MAX,
  TH_CLS,
  WeightChip,
  fmtDate,
} from "@/components/project-goals/ui";

export type Viewer = "employee" | "mentor" | "hr";

export interface ReviewDraft {
  primary: string;
  note: string;
}

export interface GoalsTableProps {
  readonly items: GoalItem[];
  /** The GOALS lifecycle (once a year). */
  readonly status: ProjectGoalSetStatus;
  readonly viewer: Viewer;
  /** The selected quarter's review, or null when that quarter has no row yet. */
  readonly review: GoalReview | null;
  /** Stored label of the selected quarter ("Q3 CY 2026"); null when no quarter has started. */
  readonly cycleLabel: string | null;
  /** Is the selected quarter open for writing (at or before the current quarter)? */
  readonly quarterWritable: boolean;
  readonly miltenyiReviewerName: string | null;
  readonly mentorName: string | null;

  // Goal column (staff, draft)
  readonly editGoal?: boolean;
  readonly goalDrafts?: Record<number, string>;
  readonly onGoalChange?: (itemId: number, value: string) => void;

  // Self review column (staff, approved + quarter open)
  readonly editSelf?: boolean;
  readonly selfDrafts?: Record<number, string>;
  readonly onSelfChange?: (itemId: number, value: string) => void;
  readonly selfRating?: number | "";
  readonly onSelfRatingChange?: (value: number | "") => void;

  // Miltenyi review column (mentor / Admin)
  readonly editReview?: boolean;
  readonly reviewDrafts?: Record<number, ReviewDraft>;
  readonly onReviewChange?: (itemId: number, field: keyof ReviewDraft, value: string) => void;
  readonly finalRating?: number | "";
  readonly onFinalRatingChange?: (value: number | "") => void;
  readonly finalBy?: FinalRatingBy;
  readonly onFinalByChange?: (value: FinalRatingBy) => void;
}

function Placeholder({ text }: Readonly<{ text: string }>) {
  return <span className="text-xs italic text-text-muted">{text}</span>;
}

function ReadText({ text }: Readonly<{ text: string | null | undefined }>) {
  if (!text) return <Placeholder text="—" />;
  return <div className="whitespace-pre-wrap leading-relaxed text-text-main">{text}</div>;
}

function ColHead({ label, sub, editing }: Readonly<{ label: string; sub: string; editing?: boolean }>) {
  return (
    <th scope="col" className={`border-b border-border px-4 py-2.5 text-left align-bottom ${editing ? "bg-brand-light" : ""}`}>
      <div className="flex items-center gap-2">
        <span className={`${TH_CLS} ${editing ? "text-brand-accent" : ""}`}>{label}</span>
        {editing && (
          <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
            editing
          </span>
        )}
      </div>
      <div className="mt-0.5 text-[11px] font-normal normal-case tracking-normal text-text-muted">{sub}</div>
    </th>
  );
}

/**
 * The single Project Goals table. Rows are the framework KPIs; columns are
 * KPI · Goal (set once a year) · Self review · Miltenyi review (both for the
 * SELECTED quarter); the footer carries that quarter's self rating and final
 * rating. Which column is editable is decided by the caller (`editGoal` /
 * `editSelf` / `editReview`), so the same component serves the staff member,
 * the mentor and the Admin.
 */
export function GoalsTable(props: GoalsTableProps) {
  const {
    items, status, viewer, review, cycleLabel, quarterWritable, miltenyiReviewerName, mentorName,
    editGoal = false, goalDrafts = {}, onGoalChange,
    editSelf = false, selfDrafts = {}, onSelfChange, selfRating = "", onSelfRatingChange,
    editReview = false, reviewDrafts = {}, onReviewChange, finalRating = "", onFinalRatingChange, finalBy = "miltenyi", onFinalByChange,
  } = props;

  const isEmployee = viewer === "employee";
  const approved = status === "approved";
  const selfSubmitted = !!review && !review.self_is_draft;
  const reviewPublished = !!review && !review.review_is_draft;
  const reviewerLabel = miltenyiReviewerName ?? "Miltenyi reviewer";
  const quarterShown = cycleLabel ? quarterDisplay(cycleLabel) : null;
  const rItems = new Map<number, ReviewItem>((review?.items ?? []).map((ri) => [ri.item_id, ri]));

  const goalCell = (it: GoalItem) => {
    if (editGoal) {
      const v = goalDrafts[it.id] ?? it.goal_text ?? "";
      return (
        <>
          <textarea
            id={`goal-${it.id}`}
            rows={5}
            maxLength={TEXT_MAX}
            className={TEXTAREA_CLS}
            value={v}
            onChange={(e) => onGoalChange?.(it.id, e.target.value)}
            placeholder={it.is_extra ? "Any other goals you are working on this year (optional)." : "The deliverable, the measure and the timing for the year."}
          />
          <CharCounter value={v} max={TEXT_MAX} />
        </>
      );
    }
    if (status === "draft" && !isEmployee) return <Placeholder text="Staff member drafting" />;
    if (it.is_extra && !it.goal_text) return <Placeholder text="No additional goals" />;
    return <ReadText text={it.goal_text} />;
  };

  const selfCell = (it: GoalItem) => {
    const ri = rItems.get(it.id);
    if (editSelf) {
      const v = selfDrafts[it.id] ?? ri?.self_text ?? "";
      return (
        <>
          <textarea
            id={`self-${it.id}`}
            rows={5}
            maxLength={TEXT_MAX}
            className={TEXTAREA_CLS}
            value={v}
            onChange={(e) => onSelfChange?.(it.id, e.target.value)}
            placeholder={`What you delivered against this goal in ${quarterShown ?? "the quarter"}, the evidence, and what you would do differently.`}
          />
          <CharCounter value={v} max={TEXT_MAX} />
        </>
      );
    }
    // The staff member always sees their own text (draft included); others only once submitted.
    if (ri?.self_text && (isEmployee || selfSubmitted)) return <ReadText text={ri.self_text} />;
    if (!approved) return <Placeholder text="Opens once the goals are approved" />;
    if (!quarterShown) return <Placeholder text="Quarterly reviews have not started" />;
    if (isEmployee) return <Placeholder text={quarterWritable ? `Open for you to fill · ${quarterShown}` : `${quarterShown} is closed`} />;
    return <Placeholder text={selfSubmitted ? "—" : "Awaiting self-review"} />;
  };

  const pmCell = (it: GoalItem) => {
    const ri = rItems.get(it.id);
    if (editReview) {
      const d = reviewDrafts[it.id] ?? { primary: ri?.primary_comment ?? "", note: ri?.healthark_note ?? "" };
      return (
        <>
          <textarea
            id={`primary-${it.id}`}
            rows={5}
            maxLength={TEXT_MAX}
            className={TEXTAREA_CLS}
            value={d.primary}
            onChange={(e) => onReviewChange?.(it.id, "primary", e.target.value)}
            placeholder={`Type or paste ${reviewerLabel}'s ${quarterShown ?? ""} words for this KPI.`}
          />
          <CharCounter value={d.primary} max={TEXT_MAX} />
          <div className="mt-2 rounded-md border border-dashed border-border px-2.5 py-2">
            <label htmlFor={`note-${it.id}`} className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-brand-accent">
              <MessageSquare className="h-3 w-3" aria-hidden="true" />
              Secondary review · optional
            </label>
            <textarea
              id={`note-${it.id}`}
              rows={2}
              maxLength={NOTE_MAX}
              className={`${TEXTAREA_CLS} text-xs`}
              value={d.note}
              onChange={(e) => onReviewChange?.(it.id, "note", e.target.value)}
              placeholder="Your own observation as the mentor, shown to the staff member as the secondary review."
            />
          </div>
        </>
      );
    }
    if (ri?.primary_comment) {
      return (
        <>
          <div className="whitespace-pre-wrap leading-relaxed text-text-main">{ri.primary_comment}</div>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-text-muted">
            <Quote className="h-3 w-3 text-accent" aria-hidden="true" />
            {reviewerLabel} · Miltenyi
          </p>
          {ri.healthark_note && (
            <div className="mt-2 rounded-md bg-brand-light px-2.5 py-2">
              <p className="mb-0.5 flex items-center gap-1 text-[11px] font-semibold text-brand-accent">
                <MessageSquare className="h-3 w-3" aria-hidden="true" />
                Secondary review{mentorName ? ` · ${mentorName}` : ""}
              </p>
              <p className="text-xs text-text-main">{ri.healthark_note}</p>
            </div>
          )}
        </>
      );
    }
    if (!approved) return <Placeholder text="After approval" />;
    if (!quarterShown) return <Placeholder text="Quarterly reviews have not started" />;
    if (selfSubmitted) return <Placeholder text={isEmployee ? "Awaiting review" : "Enter the comment"} />;
    if (isEmployee) return <Placeholder text="After your self-review" />;
    return <Placeholder text={quarterWritable ? "Draft now; submit after the self-review" : `${quarterShown} is closed`} />;
  };

  const selfRatingCell = () => {
    if (editSelf) {
      return (
        <PerformanceRatingSelect
          id="self-rating"
          label={`Your ${quarterShown ?? ""} rating`}
          value={selfRating}
          onChange={(v) => onSelfRatingChange?.(v)}
        />
      );
    }
    if (review && review.self_rating != null && (isEmployee || selfSubmitted)) {
      return (
        <div className="flex items-center gap-2">
          <PerformanceRatingBadge value={review.self_rating} size="md" />
          <div className="text-xs text-text-muted">
            Self rating
            {review.self_submitted_at && (
              <>
                <br />given {fmtDate(review.self_submitted_at)}
              </>
            )}
          </div>
        </div>
      );
    }
    return <Placeholder text="—" />;
  };

  const finalRatingCell = () => {
    if (editReview) {
      return (
        <div className="space-y-2">
          <PerformanceRatingSelect
            id="final-rating"
            label="Final rating *"
            value={finalRating}
            onChange={(v) => onFinalRatingChange?.(v)}
          />
          <div className="flex items-center gap-2 text-[11px] text-text-muted">
            <span>Given by</span>
            <div className="flex gap-1 rounded-lg border border-border bg-white p-0.5">
              {(["miltenyi", "healthark"] as FinalRatingBy[]).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => onFinalByChange?.(opt)}
                  className={`rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors ${
                    finalBy === opt ? "bg-brand-light text-brand-accent" : "text-text-muted hover:bg-slate-100"
                  }`}
                >
                  {opt === "miltenyi" ? reviewerLabel : "Healthark"}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }
    if (review && reviewPublished) {
      if (isEmployee && review.final_rating_hidden) {
        return (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs text-text-muted">
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Final rating is hidden until the Admin releases {quarterShown ?? "this quarter"}'s ratings
          </div>
        );
      }
      if (review.final_rating != null) {
        return (
          <div className="flex items-center gap-2">
            <PerformanceRatingBadge value={review.final_rating} size="md" />
            <div className="text-xs text-text-muted">
              Final rating
              <br />given by {review.final_rating_by === "miltenyi" ? reviewerLabel : "Healthark"}
            </div>
          </div>
        );
      }
    }
    return <Placeholder text="—" />;
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[1040px] table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-[27%]" />
          <col className="w-[25%]" />
          <col className="w-[24%]" />
          <col className="w-[24%]" />
        </colgroup>
        <thead className="bg-slate-50">
          <tr>
            <ColHead label="KPI / success measure" sub="From the Miltenyi framework" />
            <ColHead label="Goal" sub="Set once a year · agreed offline" editing={editGoal} />
            <ColHead label="Self review" sub={quarterShown ? `${quarterShown} · staff member` : "Per quarter · staff member"} editing={editSelf} />
            <ColHead label="Miltenyi review" sub={`${quarterShown ? `${quarterShown} · ` : ""}${reviewerLabel} · entered by the mentor`} editing={editReview} />
          </tr>
        </thead>
        <tbody>
          {items.map((it) => (
            <tr key={it.id} className={`align-top hover:bg-slate-50/60 ${it.is_extra ? "bg-amber-50/30" : ""}`}>
              <td className="border-b border-border px-4 py-3">
                <div className="flex items-start gap-2.5">
                  {it.is_extra ? (
                    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-amber-100 text-[12px] font-bold text-amber-800" title="Additional goals">+</span>
                  ) : (
                    <KpiNumber n={it.seq} />
                  )}
                  <div>
                    <p className="text-sm font-semibold leading-snug text-text-main">{it.kpi_text}</p>
                    {it.is_extra && <p className="mt-0.5 text-[11px] text-text-muted">Anything else you are working on this year, agreed with your reviewer · optional</p>}
                    <div className="mt-1.5">
                      <WeightChip weight={it.weightage} />
                    </div>
                  </div>
                </div>
              </td>
              <td className={`border-b border-border px-4 py-3 ${editGoal ? "bg-brand-light/40" : ""}`}>{goalCell(it)}</td>
              <td className={`border-b border-border px-4 py-3 ${editSelf ? "bg-brand-light/40" : ""}`}>{selfCell(it)}</td>
              <td className={`border-b border-border px-4 py-3 ${editReview ? "bg-brand-light/40" : ""}`}>{pmCell(it)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-slate-50">
          <tr className="align-top">
            <td colSpan={2} className="px-4 py-3">
              <p className="text-sm font-semibold text-text-main">{quarterShown ? `${quarterShown} rating` : "Quarter rating"}</p>
              <p className="text-xs text-text-muted">One self rating and one final rating per quarter. No rating per KPI; weightages are informational.</p>
            </td>
            <td className={`px-4 py-3 ${editSelf ? "bg-brand-light/40" : ""}`}>{selfRatingCell()}</td>
            <td className={`px-4 py-3 ${editReview ? "bg-brand-light/40" : ""}`}>{finalRatingCell()}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
