import { Link as LinkIcon, Lock, Quote } from "lucide-react";
import type { Goal } from "@/services/goal.service";
import { RichText } from "@/components/common/RichText";
import { RichTextEditor } from "@/components/common/RichTextEditor";
import { CharCounter, INPUT_CLS, TEXTAREA_CLS, TH_CLS } from "@/components/project-goals/ui";
import { isPostApproved } from "@/utils/goalStatus";
import {
  GOAL_DESC_MAX,
  GOAL_TITLE_MAX,
  REVIEW_MAX,
  linkProblem,
  selfStep,
  type AnnualViewer,
  type GoalDraft,
  type Half,
} from "@/components/annual-goals/helpers";

export interface AnnualGoalTableProps {
  /** Null while a staff member writes a goal that is not saved yet. */
  readonly goal: Goal | null;
  readonly viewer: AnnualViewer;
  /** The half whose reviews the two right-hand columns show. */
  readonly half: Half;
  readonly halfStarted: boolean;
  readonly halfOpen: boolean;
  readonly mentorName: string | null;

  // Goal column (staff, draft or changes requested, entry open)
  readonly editGoal?: boolean;
  readonly goalDraft?: GoalDraft;
  readonly onGoalChange?: (field: keyof GoalDraft, value: string) => void;

  // Self review column (staff, approved, half open)
  readonly editSelf?: boolean;
  readonly selfDraft?: string;
  readonly onSelfChange?: (value: string) => void;

  // Mentor review column (the staff member's mentor, approved, half open)
  readonly editMentor?: boolean;
  readonly mentorDraft?: string;
  readonly onMentorChange?: (value: string) => void;
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

const FIELD_LABEL = "mb-1 block text-[11px] font-semibold text-text-muted";

/**
 * The annual goal table (7 Oct 2026). ONE row per person per year: the Goal
 * column holds every goal for the year (a title and a rich-text list), and
 * the two right-hand columns show the SELECTED half's self review and
 * mentor review. Which column is editable is decided by the caller
 * (`editGoal` / `editSelf` / `editMentor`), so the same table serves the
 * staff member, the mentor and the Admin. Ratings stay on the Annual
 * Reviews page.
 */
export function AnnualGoalTable(props: AnnualGoalTableProps) {
  const {
    goal, viewer, half, halfStarted, halfOpen, mentorName,
    editGoal = false, goalDraft, onGoalChange,
    editSelf = false, selfDraft = "", onSelfChange,
    editMentor = false, mentorDraft = "", onMentorChange,
  } = props;

  const isEmployee = viewer === "employee";
  const approved = !!goal && isPostApproved(goal.approval_status);
  const selfIn = selfStep(goal, half) === "submitted";
  const mentorLabel = mentorName ?? "Mentor";

  const goalCell = () => {
    if (editGoal) {
      const d = goalDraft ?? { title: "", description: "", attachment_url: "" };
      const problem = linkProblem(d.attachment_url);
      return (
        <div className="space-y-3">
          <div>
            <label htmlFor="annual-goal-title" className={FIELD_LABEL}>Title *</label>
            <input
              id="annual-goal-title"
              className={INPUT_CLS}
              value={d.title}
              maxLength={GOAL_TITLE_MAX}
              onChange={(e) => onGoalChange?.("title", e.target.value)}
              placeholder="A short name for your goals this year"
            />
          </div>
          <div>
            <label htmlFor="annual-goal-desc" className={FIELD_LABEL}>Your goals for the year *</label>
            <RichTextEditor
              id="annual-goal-desc"
              rows={8}
              value={d.description}
              onChange={(next) => onGoalChange?.("description", next)}
              maxLength={GOAL_DESC_MAX}
              placeholder="Write every goal for the year here, one per line. Start a line with - for a bullet; select text for bold or italic."
            />
          </div>
          <div>
            <label htmlFor="annual-goal-link" className={FIELD_LABEL}>Link · optional</label>
            <input
              id="annual-goal-link"
              type="url"
              className={INPUT_CLS}
              value={d.attachment_url}
              onChange={(e) => onGoalChange?.("attachment_url", e.target.value)}
              placeholder="https://drive.google.com/drive/folders/..."
            />
            {problem && <p className="mt-1 text-xs text-red-600">{problem}</p>}
          </div>
        </div>
      );
    }
    if (!goal) return <Placeholder text="Not started" />;
    if (goal.approval_status === "draft" && !isEmployee) return <Placeholder text="Staff member drafting" />;
    return (
      <div>
        <p className="text-sm font-semibold leading-snug text-text-main">{goal.title}</p>
        {goal.description && (
          <RichText value={goal.description} variant="cell" className="mt-1.5 text-[13px] text-text-main" />
        )}
        {goal.attachment_url && (
          <a
            href={goal.attachment_url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1.5 text-xs text-brand hover:underline"
          >
            <LinkIcon className="h-3 w-3 shrink-0" aria-hidden="true" /> Attachment
          </a>
        )}
      </div>
    );
  };

  const selfCell = () => {
    const sr = goal?.self_reviews.find((r) => r.cycle_half === half) ?? null;
    if (editSelf) {
      return (
        <>
          <textarea
            id={`self-${half}`}
            rows={8}
            maxLength={REVIEW_MAX}
            className={TEXTAREA_CLS}
            value={selfDraft}
            onChange={(e) => onSelfChange?.(e.target.value)}
            placeholder={`What you delivered against your goals in ${half}, the evidence, and what you would do differently.`}
          />
          <CharCounter value={selfDraft} max={REVIEW_MAX} />
        </>
      );
    }
    // The staff member sees their own text (draft included); others only once submitted.
    if (sr && (isEmployee || !sr.is_draft)) return <ReadText text={sr.self_overall_review} />;
    if (!approved) return <Placeholder text="Opens once the goal is approved" />;
    if (!halfStarted) return <Placeholder text={`${half} has not started`} />;
    if (isEmployee) return <Placeholder text={halfOpen ? "Open for you to fill" : `${half} is closed`} />;
    return <Placeholder text={halfOpen ? "Awaiting self-review" : "Not submitted"} />;
  };

  const mentorCell = () => {
    const mr = goal?.mentor_reviews.find((r) => r.cycle_half === half && !r.is_draft) ?? null;
    if (editMentor) {
      return (
        <>
          <textarea
            id={`mentor-${half}`}
            rows={8}
            maxLength={REVIEW_MAX}
            className={TEXTAREA_CLS}
            value={mentorDraft}
            onChange={(e) => onMentorChange?.(e.target.value)}
            placeholder={`Your assessment of the ${half} delivery: what was strong, where to grow, and how it ties into the role expectations.`}
          />
          <CharCounter value={mentorDraft} max={REVIEW_MAX} />
        </>
      );
    }
    if (mr) {
      if (mr.hidden) {
        return (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-white px-3 py-2 text-xs text-text-muted">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Your mentor's {half} review is in. It shows here once the Admin releases {half} reviews.
          </div>
        );
      }
      return (
        <>
          <ReadText text={mr.mentor_overall_review} />
          <p className="mt-1 flex items-center gap-1 text-[11px] text-text-muted">
            <Quote className="h-3 w-3 text-accent" aria-hidden="true" />
            {mr.mentor_name ?? mentorLabel}
          </p>
        </>
      );
    }
    if (!approved) return <Placeholder text="After approval" />;
    if (!halfStarted) return <Placeholder text={`${half} has not started`} />;
    if (selfIn) {
      if (isEmployee) return <Placeholder text="Awaiting your mentor's review" />;
      return <Placeholder text={viewer === "mentor" ? "Write your review" : "Awaiting the mentor's review"} />;
    }
    if (isEmployee) return <Placeholder text={halfOpen ? "After your self-review" : `${half} is closed`} />;
    if (!halfOpen) return <Placeholder text="Not submitted" />;
    return <Placeholder text={viewer === "mentor" ? "Draft now; submit after the self-review" : "After the self-review"} />;
  };

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[900px] table-fixed border-collapse text-sm">
        <colgroup>
          <col className="w-[38%]" />
          <col className="w-[31%]" />
          <col className="w-[31%]" />
        </colgroup>
        <thead className="bg-slate-50">
          <tr>
            <ColHead label="Goal" sub="Every goal for the year in one row · approved by the mentor" editing={editGoal} />
            <ColHead label="Self review" sub={`${half} · ${isEmployee ? "you" : "staff member"}`} editing={editSelf} />
            <ColHead label="Mentor review" sub={`${half} · ${mentorLabel}`} editing={editMentor} />
          </tr>
        </thead>
        <tbody>
          <tr className="align-top">
            <td className={`border-b border-border px-4 py-3 ${editGoal ? "bg-brand-light/40" : ""}`}>{goalCell()}</td>
            <td className={`border-b border-border px-4 py-3 ${editSelf ? "bg-brand-light/40" : ""}`}>{selfCell()}</td>
            <td className={`border-b border-border px-4 py-3 ${editMentor ? "bg-brand-light/40" : ""}`}>{mentorCell()}</td>
          </tr>
        </tbody>
        <tfoot className="bg-slate-50">
          <tr>
            <td colSpan={3} className="px-4 py-2.5 text-xs text-text-muted">
              One goal per person per year. The year's rating is given on the Annual Reviews page.
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
