/**
 * mentee.service.ts — API contract for the mentor's master view.
 *
 * Endpoints:
 *   GET /mentees/summary              → Cards for /my-mentees grid
 *   GET /mentees/{id}/detail          → Full payload for /my-mentees/:id
 *
 * Response types mirror backend/app/schemas/mentee_schemas.py exactly.
 */

import apiClient from "./api.client";
import type { TeamGoal } from "./goal.service";
import type { AnnualReview, ReviewStatus } from "./annual-review.service";
import type { ProjectReviewResponse } from "./project-review.service";

export interface MenteeGoalsStats {
  total: number;
  approved: number;
  submitted: number;
  draft: number;
  changes_requested: number;
  avg_progress_percent: number;
}

export interface MenteeReviewStatus {
  review_id: number | null;
  cycle_name: string | null;
  status: ReviewStatus | null;
  mentor_performance_rating: number | null;
  final_performance_rating: number | null;
}

export interface MenteeProjectsStats {
  active_count: number;
  pending_reviews_count: number;
  latest_performance_group: number | null;
}

export interface MenteeProjectAssignment {
  project_id: number;
  project_name: string;
  project_code: string;
  assignment_role: string | null;
  /** The MENTEE's evaluator_type on this project. */
  evaluator_type: string | null;
  /** "pending" | "reviewed" | null (placeholder row for active cycle, no review yet) */
  review_status: string | null;
  /** "1".."5" when reviewed, null otherwise. */
  performance_group: string | null;
  /** Real cycle name when a review exists; active cycle on placeholder rows. */
  cycle: string | null;
  /** Display name of the project's Primary evaluator (PM). */
  pm_name: string | null;
  /**
   * The current mentor's OWN evaluator_type on this project.
   *   "Primary"   → mentor is the PM → can Evaluate / Edit
   *   "Secondary" → mentor can write / edit an impact statement
   *   null        → mentor has no evaluator seat → read-only View
   */
  viewer_evaluator_role: string | null;
  /** Full PM evaluation; populated only when review_status === "reviewed". */
  review_detail: ProjectReviewResponse | null;
}

export interface MenteeSummary {
  user_id: number;
  full_name: string;
  email: string;
  employee_code: string;
  phone: string | null;
  department_name: string | null;
  designation_name: string | null;
  role: string;
  is_active: boolean;
  goals: MenteeGoalsStats;
  review: MenteeReviewStatus;
  projects: MenteeProjectsStats;
  /** Submitted annual goals + PENDING_MENTOR review — drives the amber strip. */
  pending_actions_count: number;
}

export interface MenteeDetail extends MenteeSummary {
  goals_list: TeamGoal[];
  reviews_list: AnnualReview[];
  project_assignments: MenteeProjectAssignment[];
}

export const menteeService = {
  getSummaries: async (): Promise<MenteeSummary[]> => {
    const res = await apiClient.get<MenteeSummary[]>("/mentees/summary");
    return res.data;
  },

  getDetail: async (menteeId: number): Promise<MenteeDetail> => {
    const res = await apiClient.get<MenteeDetail>(`/mentees/${menteeId}/detail`);
    return res.data;
  },
};
