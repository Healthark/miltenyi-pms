/**
 * goal.service.ts — Updated for Story 3.1 (Criteria) and 3.3 (Progress).
 *
 * Changes:
 *   - Added Criterion, CriterionCreatePayload, CriterionUpdatePayload types
 *   - Goal interface now includes criteria[] and progress_percent
 *   - GoalCreatePayload now accepts optional criteria[] array
 *   - New API calls: addCriterion, updateCriterion
 */

import apiClient from "@/services/api.client";
import type { Paginated } from "@/lib/pagination";

// ── Enums ───────────────────────────────────────────────────────────

/** Lifecycle states a goal moves through. Mirrors backend
 *  `app.models.goal_models.ApprovalStatus`. The post-approval segment
 *  splits by cadence: half-yearly orgs use the h1/h2 review states,
 *  quarterly orgs use the q1..q4 review states. A given goal stays
 *  within one family for life. */
export type ApprovalStatus =
  | "draft"
  | "pending_approval"
  | "changes_requested"
  | "approved"
  // Half-yearly cadence
  | "h1_self_reviewed"
  | "h1_mentor_reviewed"
  | "h2_self_reviewed"
  | "h2_mentor_reviewed"
  // Quarterly cadence
  | "q1_self_reviewed"
  | "q1_mentor_reviewed"
  | "q2_self_reviewed"
  | "q2_mentor_reviewed"
  | "q3_self_reviewed"
  | "q3_mentor_reviewed"
  | "q4_self_reviewed"
  | "q4_mentor_reviewed";
export type GoalType = "regular" | "annual";
/** Which review window a self-review covers. H1/H2 for half-yearly orgs,
 *  Q1..Q4 for quarterly orgs (the org's `cycle_type` in SystemSettings
 *  decides which family is in play). */
export type SelfReviewCycleHalf = "H1" | "H2" | "Q1" | "Q2" | "Q3" | "Q4";

// ── Criterion Types ─────────────────────────────────────────────────

export interface Criterion {
  id: number;
  goal_id: number;
  title: string;
  sort_order: number;
  is_completed: boolean;
  completed_at: string | null;
  proof_comments: string | null;
  proof_attachment_count: number;
  created_at: string;
  updated_at: string | null;
}

export interface CriterionCreatePayload {
  title: string;
  sort_order?: number;
}

export interface CriterionUpdatePayload {
  title?: string;
  sort_order?: number;
  is_completed?: boolean;
  proof_comments?: string | null;
}

// ── Goal Types ──────────────────────────────────────────────────────

/**
 * One fiscal-year-half self-review on a goal.
 *
 * A goal carries 0–2 of these: the employee submits one for H1 and
 * one for H2 of the goal's FY.  Presence of a row (matched by
 * cycle_half) means "Submitted".
 */
export interface GoalSelfReview {
  id: number;
  goal_id: number;
  cycle_half: SelfReviewCycleHalf;
  submitted_at: string;
  /** Single freeform paragraph, mirrors the Annual Review self-appraisal shape. */
  self_overall_review: string;
  /** True while the row is a saved-but-not-submitted draft. Mentors only
   *  see rows where this is false (drafts are owner-only). */
  is_draft: boolean;
}

/**
 * Mentor's review of a mentee's self-review for one fiscal-year half.
 * A goal carries 0–2 of these (one per half), each submitted after the
 * mentee has already submitted their corresponding self-review.
 */
export interface GoalMentorReview {
  id: number;
  goal_id: number;
  cycle_half: SelfReviewCycleHalf;
  submitted_at: string;
  /** Single freeform paragraph; the form surfaces Firm Growth and Competency
   *  & Skills role expectations as reference panels rather than separate fields. */
  mentor_overall_review: string;
  /** True while the row is a saved-but-not-submitted draft. Mentees only
   *  see rows where this is false. */
  is_draft: boolean;
}

export interface GoalMentorReviewPayload {
  mentor_overall_review: string;
}

export interface Goal {
  id: number;
  org_id: number;
  user_id: number;
  manager_id: number | null;
  /** Display name of the assigned mentor; null when the owner has no mentor. */
  manager_name: string | null;
  title: string;
  description: string | null;
  attachment_url: string | null;
  goal_type: GoalType;
  cycle_name: string | null;
  fy_year: number | null;
  approval_status: ApprovalStatus;
  manager_feedback: string | null;
  progress_notes: string | null;
  start_date: string | null;
  due_date: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string | null;
  criteria: Criterion[];
  progress_percent: number;
  /** 0–2 entries, one per FY half. Look up by `cycle_half`. */
  self_reviews: GoalSelfReview[];
  /** 0–2 mentor reviews, one per FY half. Look up by `cycle_half`. */
  mentor_reviews: GoalMentorReview[];
}

export interface GoalSelfReviewPayload {
  self_overall_review: string;
}

/** Extended type for the manager's Team Goals view */
export interface TeamGoal extends Goal {
  owner_name: string;
  /** Owner's function / designation — used by the mentor-review modal to
   *  match the right RoleExpectation row without an extra fetch. */
  owner_function_name: string | null;
  owner_designation_name: string | null;
}

export interface GoalCreatePayload {
  title: string;
  description?: string | null;
  attachment_url?: string | null;
  goal_type?: GoalType;
  start_date?: string | null;
  due_date?: string | null;
  // Ownership is server-determined from the JWT (or ?user_id= query param
  // for mentor-on-behalf-of-mentee creation, authorized server-side).
  // Intentionally not in the body to prevent client-side spoofing.
  criteria?: CriterionCreatePayload[];
}

export interface GoalUpdatePayload {
  title?: string;
  description?: string | null;
  attachment_url?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  progress_notes?: string | null;
}

export interface GoalApprovalPayload {
  approval_status: "approved" | "changes_requested";
  feedback?: string | null;
}

/** One goal that the bulk-approve endpoint refused to approve, with the
 *  human-readable reason. The UI surfaces these in a snackbar so the mentor
 *  knows which goals slipped state between modal-open and submit. */
export interface BulkApproveFailure {
  goal_id: number;
  reason: string;
}

export interface BulkApproveResult {
  approved_ids: number[];
  failures: BulkApproveFailure[];
}

// ── Service ─────────────────────────────────────────────────────────

export const goalService = {
  // ── Employee — Goals ────────────────────────────────────────────
  getMyGoals: async (goalType?: GoalType): Promise<Goal[]> => {
    const res = await apiClient.get<Goal[]>("/goals/", {
      params: goalType ? { goal_type: goalType } : undefined,
    });
    return res.data;
  },

  createGoal: async (payload: GoalCreatePayload): Promise<Goal> => {
    const res = await apiClient.post<Goal>("/goals/", payload);
    return res.data;
  },

  updateGoal: async (
    goalId: number,
    payload: GoalUpdatePayload,
  ): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(`/goals/${goalId}`, payload);
    return res.data;
  },

  submitGoal: async (goalId: number): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(`/goals/${goalId}/submit`, {});
    return res.data;
  },

  submitSelfReview: async (
    goalId: number,
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalSelfReviewPayload,
  ): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(
      `/goals/${goalId}/self-review/${cycleHalf}`,
      payload,
    );
    return res.data;
  },

  saveSelfReviewDraft: async (
    goalId: number,
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalSelfReviewPayload,
  ): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(
      `/goals/${goalId}/self-review/${cycleHalf}/draft`,
      payload,
    );
    return res.data;
  },

  submitMentorReview: async (
    goalId: number,
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalMentorReviewPayload,
  ): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(
      `/goals/${goalId}/mentor-review/${cycleHalf}`,
      payload,
    );
    return res.data;
  },

  saveMentorReviewDraft: async (
    goalId: number,
    cycleHalf: SelfReviewCycleHalf,
    payload: GoalMentorReviewPayload,
  ): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(
      `/goals/${goalId}/mentor-review/${cycleHalf}/draft`,
      payload,
    );
    return res.data;
  },

  // ── Employee — Criteria ─────────────────────────────────────────
  addCriterion: async (
    goalId: number,
    payload: CriterionCreatePayload,
  ): Promise<Criterion> => {
    const res = await apiClient.post<Criterion>(
      `/goals/${goalId}/criteria`,
      payload,
    );
    return res.data;
  },

  updateCriterion: async (
    criterionId: number,
    payload: CriterionUpdatePayload,
  ): Promise<Criterion> => {
    const res = await apiClient.patch<Criterion>(
      `/goals/criteria/${criterionId}`,
      payload,
    );
    return res.data;
  },

  // ── Manager ─────────────────────────────────────────────────────
  getTeamGoals: async (goalType?: GoalType): Promise<TeamGoal[]> => {
    const res = await apiClient.get<TeamGoal[]>("/goals/team", {
      params: goalType ? { goal_type: goalType } : undefined,
    });
    return res.data;
  },

  updateApproval: async (
    goalId: number,
    payload: GoalApprovalPayload,
  ): Promise<Goal> => {
    const res = await apiClient.patch<Goal>(
      `/goals/${goalId}/approve`,
      payload,
    );
    return res.data;
  },

  bulkApprove: async (goalIds: number[]): Promise<BulkApproveResult> => {
    const res = await apiClient.post<BulkApproveResult>("/goals/bulk-approve", {
      goal_ids: goalIds,
    });
    return res.data;
  },

  // ── HR_MyOrg view-only ─────────────────────────────────────────
  /** Every annual goal across the org, every cycle (DRAFT excluded).
   *  HR_MyOrg-only; backend 403s any other role. Powers the "All Goals" tab.
   *
   *  Paginated as of PR #37 (doc 20). Unusual semantics: the server
   *  paginates by EMPLOYEE (the parent), then ships every goal for the
   *  page's employees in `items`. This keeps the AllGoalsTab's
   *  per-user expandable groups whole — no employee straddles two
   *  pages. Consequently `total` is the EMPLOYEE count, not the goal
   *  count.
   *
   *  Server-side filters added in PR #44 (doc 27). Each filter narrows
   *  the universe BEFORE pagination, so `total` is the filtered
   *  employee count and Load More pages through what matches. Filters
   *  split into:
   *    - Goal-level (fy_year, mentor): applied INSIDE the EXISTS
   *      subquery that finds qualifying parents, AND on the goals
   *      fetch — so users with mixed-year history filtered to one
   *      year only show their matching goals.
   *    - User-level (employee, function, designation): applied on the
   *      parent pagination directly.
   *  All filters AND together. Server defaults: limit=50, max=200. */
  getAllGoals: async (
    params: AllGoalsRequestParams = {},
  ): Promise<PaginatedAllGoals> => {
    const res = await apiClient.get<PaginatedAllGoals>("/goals/all", {
      params,
    });
    return res.data;
  },
};

/** Paginated response from GET /goals/all. `items` is the goal rows on
 *  this page; `total` is the FILTERED EMPLOYEE count (the pagination
 *  unit) — see the service docstring above for why. */
export type PaginatedAllGoals = Paginated<TeamGoal>;

/** Filter set accepted by GET /goals/all (PR #44, doc 27). All fields
 *  optional; omitted fields don't narrow. Exact-match equality except
 *  `fy_year` which matches `Goal.cycle_name` against modern + legacy
 *  formats server-side (see backend `_apply_goal_level_filters`). */
export interface AllGoalsFilters {
  /** Fiscal-year integer (e.g. 2026). Matches both "FY26"-style and
   *  legacy "H1 2026"-style cycle_name values on the server. */
  fy_year?: number;
  /** Exact match on the goal's assigned manager (mentor) full_name. */
  mentor?: string;
  /** Exact match on the goal owner's full_name. */
  employee?: string;
  /** Exact match on the goal owner's Function name. */
  function?: string;
  /** Exact match on the goal owner's Designation name. */
  designation?: string;
}

/** Sort columns accepted by GET /goals/all (PR #48, doc 31).
 *  Direct user-attribute columns only — derived columns
 *  (`latest_fy_year`, `latest_manager_name`) are deferred since they'd
 *  need correlated MAX subqueries. See doc 31 Part 2. */
export type AllGoalsSortBy =
  | "owner_name"
  | "function_name"
  | "designation_name";

export interface AllGoalsSort {
  sort_by?: AllGoalsSortBy;
  sort_dir?: "asc" | "desc";
}

/** Full request shape: pagination + filters + sort. */
export type AllGoalsRequestParams = AllGoalsFilters &
  AllGoalsSort & {
    limit?: number;
    offset?: number;
  };
