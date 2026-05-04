/**
 * project-review.service.ts — PM-Centric Evaluation API (Revised).
 *
 * No self-review. The PM evaluates team members directly.
 *
 * Covers:
 *   Employee:    getMyProjects, getReview
 *   PM:          getPMQueue, getRoleExpectations, submitPMEvaluation
 *   Secondary:   getSecondaryQueue, submitSecondaryEval
 *   Admin:       getAllReviews
 */

import apiClient from "./api.client";

// ── Enums ───────────────────────────────────────────────────────────

export type ProjectReviewStatus = "pending" | "reviewed";
export type EvaluatorType = "Primary" | "Secondary";
export type PerformanceGroup =
  | "Needs Improvement"
  | "Meeting Expectations"
  | "Exceeding Expectations"
  | "Meeting High Expectations"
  | "Exceeding High Expectations";

// ── Response Types ──────────────────────────────────────────────────

export interface SecondaryEvalResponse {
  id: number;
  evaluator_id: number;
  evaluator_name: string;
  impact_statement: string | null;
  /** "draft" while the evaluator has saved but not yet submitted;
   *  "submitted" once finalized. The frontend gates editability on this. */
  status: "draft" | "submitted";
  created_at: string;
}

export interface ProjectReviewResponse {
  id: number;
  org_id: number;
  user_id: number;
  project_id: number;
  reviewer_id: number | null;
  cycle: string;
  status: ProjectReviewStatus;
  employee_name: string;
  reviewer_name: string | null;
  project_name: string;
  project_code: string;
  comment_task_execution: string | null;
  comment_ownership: string | null;
  comment_project_management: string | null;
  comment_client_deliverables: string | null;
  comment_communication: string | null;
  comment_mentoring: string | null;
  comment_competency_skills: string | null;
  performance_group: string | null;
  impact_statement: string | null;
  secondary_evaluations: SecondaryEvalResponse[];
  created_at: string;
  updated_at: string | null;
}

export interface MyProjectCard {
  review_id: number | null;
  project_id: number;
  project_name: string;
  project_code: string;
  project_start_date: string | null;
  project_expected_end_date: string | null;
  assigned_date: string | null;
  assignment_role: string | null;
  department_name: string | null;
  review_status: string | null; // "pending" | "reviewed" | null
  performance_group: string | null;
  pm_name: string | null;
  cycle: string | null;
}

export interface PMPendingReviewCard {
  review_id: number | null;
  project_id: number;
  project_name: string;
  project_code: string;
  user_id: number;
  employee_name: string;
  assignment_role: string | null;
  department_name: string | null;
  designation_name: string | null;
  assigned_date: string | null;
  review_status: string | null;
  performance_group: string | null;
  cycle: string | null;
  /** True iff the row is pending AND the PM has typed any content into
   *  it. Backend distinguishes this from empty placeholder rows so the
   *  Draft pill / filter only fires on actual saved drafts. */
  has_draft_content: boolean;
}

export interface RoleExpectation {
  id: number;
  department_name: string;
  designation_name: string;
  exp_task_execution: string | null;
  exp_ownership: string | null;
  exp_project_management: string | null;
  exp_client_deliverables: string | null;
  exp_communication: string | null;
  exp_mentoring: string | null;
  exp_firm_growth: string | null;
  exp_competency_skills: string | null;
}

// ── Request Payloads ────────────────────────────────────────────────

export interface PMEvaluationPayload {
  performance_group: PerformanceGroup;
  impact_statement: string;
  comment_task_execution: string;
  comment_ownership: string;
  comment_project_management: string;
  comment_client_deliverables: string;
  comment_communication: string;
  comment_mentoring: string;
  comment_competency_skills: string;
}

/** Save-draft payload — every field optional so the PM can park a
 *  half-typed evaluation and resume later. */
export type PMEvaluationDraftPayload = Partial<PMEvaluationPayload>;

export interface SecondaryEvalPayload {
  impact_statement: string;
}

export type SecondaryEvalDraftPayload = Partial<SecondaryEvalPayload>;

// ── Admin Management View Types ─────────────────────────────────────

export interface AdminMemberReviewRow {
  review_id: number | null;
  user_id: number;
  employee_name: string;
  assignment_role: string | null;
  department_name: string | null;
  review_status: "pending" | "reviewed" | "not_started";
  performance_group: string | null;
}

export interface AdminProjectSummary {
  project_id: number;
  project_name: string;
  project_code: string;
  pm_name: string | null;
  total_members: number;
  reviewed_count: number;
  members: AdminMemberReviewRow[];
}

// ── Service ─────────────────────────────────────────────────────────

export const projectReviewService = {
  // ── Employee ────────────────────────────────────────────────────
  /** List my assigned projects with review status. */
  getMyProjects: async (): Promise<MyProjectCard[]> => {
    const res = await apiClient.get<MyProjectCard[]>("/project-reviews/mine");
    return res.data;
  },

  /** Get a single review (after PM has evaluated). */
  getReview: async (reviewId: number): Promise<ProjectReviewResponse> => {
    const res = await apiClient.get<ProjectReviewResponse>(`/project-reviews/${reviewId}`);
    return res.data;
  },

  // ── PM (Primary Evaluator) ─────────────────────────────────────
  /** List team members needing evaluation on PM's projects. */
  getPMQueue: async (): Promise<PMPendingReviewCard[]> => {
    const res = await apiClient.get<PMPendingReviewCard[]>("/project-reviews/pm-queue");
    return res.data;
  },

  /** Get role expectations reference data for evaluation. */
  getRoleExpectations: async (): Promise<RoleExpectation[]> => {
    const res = await apiClient.get<RoleExpectation[]>("/project-reviews/role-expectations");
    return res.data;
  },

  /** PM submits evaluation for a team member. */
  submitPMEvaluation: async (
    projectId: number,
    userId: number,
    payload: PMEvaluationPayload,
  ): Promise<ProjectReviewResponse> => {
    const res = await apiClient.post<ProjectReviewResponse>(
      `/project-reviews/${projectId}/evaluate/${userId}`,
      payload,
    );
    return res.data;
  },

  /** PM saves an in-progress evaluation as a draft (status=DRAFT). All
   *  fields optional — only those present on the payload are written.
   *  Submit (POST /evaluate) promotes the row to REVIEWED. */
  savePMDraft: async (
    projectId: number,
    userId: number,
    payload: PMEvaluationDraftPayload,
  ): Promise<ProjectReviewResponse> => {
    const res = await apiClient.patch<ProjectReviewResponse>(
      `/project-reviews/${projectId}/evaluate/${userId}/draft`,
      payload,
    );
    return res.data;
  },

  /** PM edits an already-submitted evaluation. */
  updateReview: async (
    reviewId: number,
    payload: PMEvaluationPayload,
  ): Promise<ProjectReviewResponse> => {
    const res = await apiClient.put<ProjectReviewResponse>(
      `/project-reviews/${reviewId}`,
      payload,
    );
    return res.data;
  },

  // ── Secondary Evaluator ────────────────────────────────────────
  /** List reviews pending secondary impact statement. */
  getSecondaryQueue: async (): Promise<ProjectReviewResponse[]> => {
    const res = await apiClient.get<ProjectReviewResponse[]>("/project-reviews/secondary-queue");
    return res.data;
  },

  /** Submit secondary impact statement. */
  submitSecondaryEval: async (
    reviewId: number,
    payload: SecondaryEvalPayload,
  ): Promise<SecondaryEvalResponse> => {
    const res = await apiClient.post<SecondaryEvalResponse>(
      `/project-reviews/${reviewId}/secondary`,
      payload,
    );
    return res.data;
  },

  /** Secondary evaluator saves an in-progress impact statement as a
   *  draft. Submit promotes it. */
  saveSecondaryDraft: async (
    reviewId: number,
    payload: SecondaryEvalDraftPayload,
  ): Promise<SecondaryEvalResponse> => {
    const res = await apiClient.patch<SecondaryEvalResponse>(
      `/project-reviews/${reviewId}/secondary/draft`,
      payload,
    );
    return res.data;
  },

  /** Update an existing secondary impact statement. */
  updateSecondaryEval: async (
    reviewId: number,
    payload: SecondaryEvalPayload,
  ): Promise<SecondaryEvalResponse> => {
    const res = await apiClient.put<SecondaryEvalResponse>(
      `/project-reviews/${reviewId}/secondary`,
      payload,
    );
    return res.data;
  },

  // ── Admin ──────────────────────────────────────────────────────
  /** Admin-only: all reviews for the active cycle. */
  getAllReviews: async (): Promise<ProjectReviewResponse[]> => {
    const res = await apiClient.get<ProjectReviewResponse[]>("/project-reviews/all");
    return res.data;
  },

  /** Admin-only: per-project completion overview. Pass cycle string to view historical data. */
  getManagementView: async (cycle?: string): Promise<AdminProjectSummary[]> => {
    const params = cycle ? { cycle } : {};
    const res = await apiClient.get<AdminProjectSummary[]>("/project-reviews/management", { params });
    return res.data;
  },
};