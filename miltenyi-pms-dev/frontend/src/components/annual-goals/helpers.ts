/**
 * Shared rules for the annual goal table (7 Oct 2026).
 *
 * Annual goals read like Project Goals: ONE row per person per year (every
 * goal for the year is written in that row), an H1/H2 selector for the two
 * review columns, and for mentors and the Admin a roster that opens the
 * same table. The status rules below mirror goal_routes.py so a button is
 * only offered when the server will accept it.
 */
import { useState, type Dispatch, type SetStateAction } from "react";
import type {
  AnnualRosterRow,
  ApprovalStatus,
  Goal,
  ReviewStep,
} from "@/services/goal.service";
import type { StepStatus } from "@/services/project-goals.service";
import { activeHalfAndFy, isHalfWindowOpen, isPostApproved } from "@/utils/goalStatus";

export type Half = "H1" | "H2";
export const HALVES: readonly Half[] = ["H1", "H2"];

export type AnnualViewer = "employee" | "mentor" | "hr";

export const GOAL_TITLE_MAX = 500;
export const GOAL_DESC_MAX = 5000;
export const REVIEW_MAX = 5000;

export interface GoalDraft {
  title: string;
  description: string;
  attachment_url: string;
}

export function goalDraftOf(goal: Goal | null): GoalDraft {
  return {
    title: goal?.title ?? "",
    description: goal?.description ?? "",
    attachment_url: goal?.attachment_url ?? "",
  };
}

/** Why the link would be refused by the server, or null when it is fine. */
export function linkProblem(url: string): string | null {
  const t = url.trim();
  if (!t) return null;
  if (!/^https?:\/\//i.test(t) || /\s/.test(t)) {
    return "Enter a web link that starts with http:// or https://.";
  }
  return null;
}

// ── Review steps ────────────────────────────────────────────────────

function stepOf(rows: ReadonlyArray<{ cycle_half: string; is_draft: boolean }>, half: Half): ReviewStep {
  const found = rows.filter((r) => r.cycle_half === half);
  if (found.some((r) => !r.is_draft)) return "submitted";
  return found.length > 0 ? "draft" : "none";
}

export function selfStep(goal: Goal | null, half: Half): ReviewStep {
  return goal ? stepOf(goal.self_reviews, half) : "none";
}

export function mentorStep(goal: Goal | null, half: Half): ReviewStep {
  return goal ? stepOf(goal.mentor_reviews, half) : "none";
}

export function rowStep(row: AnnualRosterRow, half: Half, who: "self" | "mentor"): ReviewStep {
  if (half === "H1") return who === "self" ? row.h1_self : row.h1_mentor;
  return who === "self" ? row.h2_self : row.h2_mentor;
}

/** ReviewStep in the vocabulary of the shared StepBadge. */
export function stepStatus(step: ReviewStep): StepStatus {
  return step === "none" ? "not_started" : step;
}

// ── Halves ──────────────────────────────────────────────────────────

/** Has the half started for this year? H1 starts with the year, H2 once the
 *  Admin rolls the Project Goals quarter out to Q3. Past years have both. */
export function halfStarted(
  half: Half,
  fyYear: number | null,
  activeCycleName: string | null | undefined,
): boolean {
  const current = activeHalfAndFy(activeCycleName);
  if (fyYear == null || !current) return false;
  if (fyYear < current.fyYear) return true;
  if (fyYear > current.fyYear) return false;
  return HALVES.indexOf(half) <= HALVES.indexOf(current.half);
}

/** Can reviews for the half still be written? (The current half, and the
 *  earlier half of the same year for backfill.) */
export function halfOpen(
  half: Half,
  fyYear: number | null,
  activeCycleName: string | null | undefined,
): boolean {
  return isHalfWindowOpen(half, fyYear, activeCycleName);
}

/** The half to show first: the current one in the active year, else H2 for
 *  a finished year. */
export function defaultHalf(fyYear: number | null, activeCycleName: string | null | undefined): Half {
  const current = activeHalfAndFy(activeCycleName);
  if (current && fyYear === current.fyYear) return current.half;
  if (current && fyYear != null && fyYear > current.fyYear) return "H1";
  return "H2";
}

// ── What the server accepts (goal_routes.py) ────────────────────────

const SELF_FROM: Record<Half, readonly ApprovalStatus[]> = {
  H1: ["approved"],
  H2: ["approved", "h1_self_reviewed", "h1_mentor_reviewed"],
};

const MENTOR_DRAFT_FROM: Record<Half, readonly ApprovalStatus[]> = {
  H1: ["approved", "h1_self_reviewed"],
  H2: ["approved", "h1_self_reviewed", "h1_mentor_reviewed", "h2_self_reviewed"],
};

/** The staff member may draft or submit this half's self-review. */
export function selfReviewAllowed(goal: Goal, half: Half): boolean {
  return SELF_FROM[half].includes(goal.approval_status);
}

/** The mentor may draft this half's review. */
export function mentorDraftAllowed(goal: Goal, half: Half): boolean {
  return MENTOR_DRAFT_FROM[half].includes(goal.approval_status);
}

/** The mentor may submit this half's review: the self-review is in. */
export function mentorSubmitAllowed(goal: Goal, half: Half): boolean {
  return goal.approval_status === (half === "H1" ? "h1_self_reviewed" : "h2_self_reviewed");
}

/** Short state under each half pill. */
export function halfHints(goal: Goal | null, forStaff: boolean): Partial<Record<Half, string>> {
  const out: Partial<Record<Half, string>> = {};
  if (!goal || !isPostApproved(goal.approval_status)) return out;
  for (const h of HALVES) {
    const s = selfStep(goal, h);
    const m = mentorStep(goal, h);
    if (m === "submitted") out[h] = "Reviewed";
    else if (s === "submitted") out[h] = forStaff ? "Self-review in · awaiting review" : "Self-review in";
    else if (s === "draft" || m === "draft") out[h] = "In progress";
  }
  return out;
}

/** State that resets to `initial()` whenever `resetKey` changes: React's
 *  "adjust state when the data changes" pattern, without an effect. Used
 *  for the drafts in the table so a refetch never clobbers typing, while a
 *  new goal, half or saved review starts from the stored text. */
export function useResettableState<T>(resetKey: string, initial: () => T): [T, Dispatch<SetStateAction<T>>] {
  const [key, setKey] = useState(resetKey);
  const [value, setValue] = useState<T>(initial);
  if (key !== resetKey) {
    setKey(resetKey);
    setValue(initial());
  }
  return [value, setValue];
}

// ── Roster status filter ────────────────────────────────────────────

export type RosterStatusFilter =
  | "all"
  | "not_started"
  | "draft"
  | "pending_approval"
  | "changes_requested"
  | "approved"
  | "to_review";

export const ROSTER_STATUS_OPTIONS: ReadonlyArray<{ value: RosterStatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "not_started", label: "Not started" },
  { value: "draft", label: "Drafting" },
  { value: "pending_approval", label: "Pending approval" },
  { value: "changes_requested", label: "Changes requested" },
  { value: "approved", label: "Approved (any stage)" },
  { value: "to_review", label: "Self-review in, review pending" },
];

export function isRosterStatusFilter(v: string | null): v is RosterStatusFilter {
  return !!v && ROSTER_STATUS_OPTIONS.some((o) => o.value === v);
}

/** The goal shown for a year: the oldest one. Only data from before the
 *  one-goal rule can hold more than one. */
export function goalOfYear<T extends Goal>(goals: readonly T[], fyYear: number | null): { goal: T | null; extra: number } {
  const mine = goals
    .filter((g) => g.fy_year === fyYear)
    .slice()
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.id - b.id);
  return { goal: mine[0] ?? null, extra: Math.max(0, mine.length - 1) };
}
