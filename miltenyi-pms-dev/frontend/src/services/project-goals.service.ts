/**
 * project-goals.service.ts — one goal set per staff member per period
 * (calendar year) against the Miltenyi "Indicative Goal Themes" framework;
 * one review per QUARTER against those same goals.
 *
 * Mirrors backend/app/schemas/project_goal_schemas.py. The staff page reads
 * everything through `getMine()`; the mentor / Admin surfaces read the team
 * queue (for one quarter) and individual sets (every quarter's review).
 *
 * The review window is the Admin-advanced current quarter: quarters at or
 * before it are writable, later ones are closed. Quarter labels are stored
 * as "Q3 CY 26-27" and shown as "Q3 · CY 26-27".
 */

import apiClient from "@/services/api.client";

// ── Enums ───────────────────────────────────────────────────────────

/** Mirrors `ProjectGoalSetStatus` — the GOALS lifecycle (once a year).
 *  Linear: draft → submitted → approved. The Admin unlocks step backwards. */
export type ProjectGoalSetStatus = "draft" | "submitted" | "approved";

export const SET_STATUS_ORDER: readonly ProjectGoalSetStatus[] = ["draft", "submitted", "approved"] as const;

export function statusAtLeast(status: ProjectGoalSetStatus, floor: ProjectGoalSetStatus): boolean {
  return SET_STATUS_ORDER.indexOf(status) >= SET_STATUS_ORDER.indexOf(floor);
}

/** State of one step (self-review or Miltenyi review) of one quarter. */
export type StepStatus = "not_started" | "draft" | "submitted";

export type FinalRatingBy = "miltenyi" | "healthark";

/** "Q3 CY 26-27" → "Q3 · CY 26-27". Anything else is returned as is. */
export function quarterDisplay(label: string | null | undefined): string {
  if (!label) return "";
  const m = /^Q([1-4]) (.+)$/.exec(label);
  return m ? `Q${m[1]} · ${m[2]}` : label;
}

/** "Q3 CY 26-27" → 3; 0 when the label is not a quarter label. */
export function quarterSeq(label: string | null | undefined): number {
  const m = /^Q([1-4]) /.exec(label ?? "");
  return m ? Number(m[1]) : 0;
}

export function quarterLabel(periodLabel: string, seq: number): string {
  return `Q${seq} ${periodLabel}`;
}

// ── Framework ───────────────────────────────────────────────────────

export interface FrameworkKpi {
  id: number;
  seq: number;
  text: string;
  /** null when weightages are hidden from staff for the period. */
  weightage: number | null;
}

export interface FrameworkRow {
  id: number;
  function_id: number;
  function_name: string;
  level: number;
  period_label: string;
  title: string;
  business_outcomes: string;
  functional_goals: string;
  kpis: FrameworkKpi[];
}

// ── Period & quarters ───────────────────────────────────────────────

export interface Quarter {
  seq: number;
  cycle_label: string;
  ratings_visible: boolean;
  /** Earlier quarter still writable; the current quarter is always open. */
  backfill_open: boolean;
  is_current: boolean;
  opened_at: string | null;
}

export interface PeriodSettings {
  /** Goal-year label, e.g. "CY 26-27" (the year ends around April). */
  period_label: string;
  /** The review year: the quarter roll-out runs here. */
  is_active: boolean;
  entry_open: boolean;
  weightages_visible: boolean;
  /** Past year: its started quarters stay writable while this is on. */
  backfill_open: boolean;
  /** The optional "Additional goals" row and the weightage the Admin gives it. */
  extra_goal_enabled: boolean;
  extra_goal_weightage: number;
  current_quarter_seq: number | null;
  current_quarter_label: string | null;
  /** Started quarters only (seq ≤ current), ordered by seq. */
  quarters: Quarter[];
}

/** One goal year in a year selector. */
export interface PeriodBrief {
  period_label: string;
  is_active: boolean;
  entry_open: boolean;
  backfill_open: boolean;
  current_quarter_seq: number | null;
  current_quarter_label: string | null;
  /** Staff only: do I have a goal set for this year? */
  has_set: boolean | null;
}

/** Has this quarter been rolled out (seq ≤ the year's current quarter)? */
export function quarterStarted(period: PeriodSettings | null | undefined, seq: number): boolean {
  return !!period && period.current_quarter_seq != null && seq >= 1 && seq <= period.current_quarter_seq;
}

/** Is this quarter open for writing? In the review year the current quarter
 *  is always open and an earlier quarter stays open while its own backfill
 *  switch is on; in a past year a started quarter is open while both the
 *  year's and the quarter's backfill switches are on. */
export function isQuarterWritable(period: PeriodSettings | null | undefined, cycleLabel: string | null | undefined): boolean {
  if (!period || !cycleLabel) return false;
  const seq = quarterSeq(cycleLabel);
  if (!quarterStarted(period, seq) || cycleLabel !== quarterLabel(period.period_label, seq)) return false;
  const quarterOpen = period.quarters.find((q) => q.seq === seq)?.backfill_open ?? true;
  if (period.is_active) return seq === period.current_quarter_seq || quarterOpen;
  return period.backfill_open && quarterOpen;
}

// ── Goal set ────────────────────────────────────────────────────────

export interface GoalItem {
  id: number;
  seq: number;
  kpi_text: string;
  weightage: number | null;
  goal_text: string | null;
  /** The optional "Additional goals" row at the end of the sheet. */
  is_extra: boolean;
}

export interface ReviewItem {
  item_id: number;
  /** The staff member's own draft is theirs; others see it once submitted. */
  self_text: string | null;
  /** The Miltenyi reviewer's words, transcribed by the mentor. Hidden from
   *  the staff member until the review is submitted. */
  primary_comment: string | null;
  healthark_note: string | null;
}

/** One quarter's review of a set. */
export interface GoalReview {
  id: number;
  cycle_label: string;
  seq: number;
  writable: boolean;
  self_status: StepStatus;
  review_status: StepStatus;
  self_rating: number | null;
  self_is_draft: boolean;
  self_submitted_at: string | null;
  reviewer_id: number | null;
  reviewer_name: string | null;
  entered_by_id: number | null;
  entered_by_name: string | null;
  miltenyi_reviewer_name: string | null;
  source_received_on: string | null;
  /** null for staff until the Admin releases this quarter's ratings. */
  final_rating: number | null;
  final_rating_hidden: boolean;
  final_rating_by: FinalRatingBy;
  review_is_draft: boolean;
  review_submitted_at: string | null;
  acknowledged_at: string | null;
  items: ReviewItem[];
}

export interface GoalSet {
  id: number;
  user_id: number;
  owner_name: string;
  owner_email: string;
  period_label: string;
  status: ProjectGoalSetStatus;
  framework: FrameworkRow | null;
  items: GoalItem[];
  /** One per quarter that has a row, ordered by seq. */
  reviews: GoalReview[];
  period: PeriodSettings;
  submitted_at: string | null;
  approved_at: string | null;
  approved_by_name: string | null;
  approved_agreed_with: string | null;
  approved_agreed_on: string | null;
  /** Mentor / Admin only. */
  approval_note: string | null;
  mentor_id: number | null;
  mentor_name: string | null;
  miltenyi_reviewer_name: string | null;
}

export function reviewFor(set: GoalSet | null | undefined, cycleLabel: string | null | undefined): GoalReview | null {
  if (!set || !cycleLabel) return null;
  return set.reviews.find((r) => r.cycle_label === cycleLabel) ?? null;
}

export interface MyProjectGoals {
  period: PeriodSettings | null;
  /** Every goal year, newest first — the year selector. */
  periods: PeriodBrief[];
  framework: FrameworkRow | null;
  framework_missing_reason: string | null;
  goal_set: GoalSet | null;
  mentor_name: string | null;
  miltenyi_reviewer_name: string | null;
}

export type GoalsStatus = ProjectGoalSetStatus | "not_started";

/** One line of the mentor / Admin queue, for the selected quarter. */
export interface TeamRow {
  set_id: number | null;
  user_id: number;
  full_name: string;
  email: string;
  function_name: string | null;
  designation_name: string | null;
  level: number | null;
  framework_title: string | null;
  has_framework: boolean;
  goals_status: GoalsStatus;
  cycle_label: string | null;
  self_status: StepStatus;
  review_status: StepStatus;
  self_rating: number | null;
  final_rating: number | null;
  self_submitted_at: string | null;
  review_submitted_at: string | null;
  acknowledged_at: string | null;
  mentor_id: number | null;
  mentor_name: string | null;
  miltenyi_reviewer_name: string | null;
}

// ── Payloads ────────────────────────────────────────────────────────

export interface GoalItemsPayload {
  items: { item_id: number; goal_text: string }[];
}

export interface SelfReviewPayload {
  cycle_label: string;
  items: { item_id: number; self_text: string }[];
  self_rating: number | null;
}

export interface ApprovePayload {
  agreed_with: string;
  agreed_on: string; // YYYY-MM-DD
  note?: string;
}

export interface ReviewPayload {
  cycle_label: string;
  items: { item_id: number; primary_comment: string; healthark_note: string }[];
  miltenyi_reviewer_name?: string | null;
  source_received_on?: string | null;
  final_rating: number | null;
  final_rating_by: FinalRatingBy;
}

export interface UnlockPayload {
  target: "goals" | "review";
  /** Required for target "review": which quarter. */
  cycle_label?: string | null;
  reason: string;
}

// ── Service ─────────────────────────────────────────────────────────

export const projectGoalsService = {
  // Everyone
  getPeriod: async (period?: string | null): Promise<PeriodSettings | null> =>
    (await apiClient.get<PeriodSettings | null>("/project-goals/period", { params: period ? { period } : undefined })).data,
  getPeriods: async (): Promise<PeriodBrief[]> =>
    (await apiClient.get<PeriodBrief[]>("/project-goals/periods")).data,

  // Staff (`period` = goal year; the active one when omitted)
  getMine: async (period?: string | null): Promise<MyProjectGoals> =>
    (await apiClient.get<MyProjectGoals>("/project-goals/me", { params: period ? { period } : undefined })).data,
  createMine: async (period?: string | null): Promise<GoalSet> =>
    (await apiClient.post<GoalSet>("/project-goals/me", null, { params: period ? { period } : undefined })).data,
  saveMyGoals: async (payload: GoalItemsPayload, period?: string | null): Promise<GoalSet> =>
    (await apiClient.put<GoalSet>("/project-goals/me/items", payload, { params: period ? { period } : undefined })).data,
  submitMyGoals: async (period?: string | null): Promise<GoalSet> =>
    (await apiClient.post<GoalSet>("/project-goals/me/submit", null, { params: period ? { period } : undefined })).data,
  saveMySelfReview: async (payload: SelfReviewPayload): Promise<GoalSet> =>
    (await apiClient.put<GoalSet>("/project-goals/me/self-review", payload)).data,
  submitMySelfReview: async (cycleLabel: string): Promise<GoalSet> =>
    (await apiClient.post<GoalSet>("/project-goals/me/self-review/submit", { cycle_label: cycleLabel })).data,
  acknowledge: async (cycleLabel: string): Promise<GoalSet> =>
    (await apiClient.post<GoalSet>("/project-goals/me/acknowledge", { cycle_label: cycleLabel })).data,

  // Mentor / Admin
  getTeam: async (period?: string | null, cycle?: string | null): Promise<TeamRow[]> =>
    (await apiClient.get<TeamRow[]>("/project-goals/team", { params: { ...(period ? { period } : {}), ...(cycle ? { cycle } : {}) } })).data,
  getSet: async (setId: number): Promise<GoalSet> =>
    (await apiClient.get<GoalSet>(`/project-goals/sets/${setId}`)).data,
  approve: async (setId: number, payload: ApprovePayload): Promise<GoalSet> =>
    (await apiClient.post<GoalSet>(`/project-goals/sets/${setId}/approve`, payload)).data,
  saveReview: async (setId: number, payload: ReviewPayload): Promise<GoalSet> =>
    (await apiClient.put<GoalSet>(`/project-goals/sets/${setId}/review`, payload)).data,
  submitReview: async (setId: number, cycleLabel: string, force = false): Promise<GoalSet> =>
    (
      await apiClient.post<GoalSet>(
        `/project-goals/sets/${setId}/review/submit`,
        { cycle_label: cycleLabel },
        { params: force ? { force: true } : undefined },
      )
    ).data,
  unlock: async (setId: number, payload: UnlockPayload): Promise<GoalSet> =>
    (await apiClient.post<GoalSet>(`/project-goals/sets/${setId}/unlock`, payload)).data,
};
