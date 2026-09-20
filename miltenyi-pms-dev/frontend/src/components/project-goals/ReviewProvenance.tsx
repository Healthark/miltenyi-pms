import type { GoalReview } from "@/services/project-goals.service";
import { INPUT_CLS, fmtDate } from "@/components/project-goals/ui";

export interface ProvenanceDraft {
  miltenyi_reviewer_name: string;
  source_received_on: string;
}

interface ReviewProvenanceProps {
  readonly review: GoalReview | null;
  readonly fallbackReviewerName: string | null;
  readonly enteredByName: string;
  readonly editable: boolean;
  readonly draft: ProvenanceDraft;
  readonly onChange: (next: ProvenanceDraft) => void;
}

/**
 * "Entered on behalf" block above the mentor's table: who the Miltenyi
 * reviewer is, when their input arrived, and who typed it. Stored on the
 * quarter's review and shown to the staff member once it is submitted.
 */
export function ReviewProvenance({ review, fallbackReviewerName, enteredByName, editable, draft, onChange }: ReviewProvenanceProps) {
  const disabled = !editable;
  return (
    <section className="rounded-lg border border-border bg-slate-50 p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-700">Entered on behalf</span>
        <p className="text-xs text-text-muted">Stored with this quarter's review and shown to the staff member once it is submitted.</p>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-text-main">Miltenyi reviewer</span>
          <input
            className={INPUT_CLS}
            disabled={disabled}
            value={draft.miltenyi_reviewer_name}
            onChange={(e) => onChange({ ...draft, miltenyi_reviewer_name: e.target.value })}
            placeholder={fallbackReviewerName ?? "Name"}
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-text-main">Input received on</span>
          <input
            type="date"
            className={INPUT_CLS}
            disabled={disabled}
            value={draft.source_received_on}
            onChange={(e) => onChange({ ...draft, source_received_on: e.target.value })}
          />
        </label>
        <div>
          <span className="mb-1 block text-xs font-semibold text-text-main">Entered by</span>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-text-main">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[10px] font-semibold text-white">
              {(review?.entered_by_name ?? enteredByName).split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()}
            </span>
            {review?.entered_by_name ?? enteredByName} · Healthark
          </div>
          <span className="mt-0.5 block text-[11px] text-text-muted">
            {review?.review_submitted_at ? `submitted ${fmtDate(review.review_submitted_at)}` : "not submitted yet"}
          </span>
        </div>
      </div>
    </section>
  );
}
