import apiClient from "./api.client";

/**
 * Status of the caller's AnnualReview row for the active FY.
 *
 * `null` distinguishes "no row exists yet" (start CTA) from "row exists in
 * DRAFT" (continue CTA). Once submitted, the row moves through pending_*
 * states until it lands at `completed` and the final rating is published.
 */
export type AnnualReviewStatus =
  | "draft"
  | "pending_mentor"
  | "pending_management"
  | "completed";

export interface DashboardSummary {
  // ── Personal: Annual Goals ─────────────────────────────────────────
  total_goals: number;
  draft_goals: number;
  submitted_goals: number;
  approved_goals: number;
  changes_requested_goals: number;
  // Criteria-driven completion average across approved annual goals (0–100)
  completion_percent: number;

  // ── Personal: Active Cycle ─────────────────────────────────────────
  active_cycle: string | null;

  // ── Personal: My Annual Review (current FY) ────────────────────────
  // All null when no AnnualReview row has been started yet — the widget
  // treats that as "not started" and renders the start CTA.
  annual_review_id: number | null;
  annual_review_status: AnnualReviewStatus | null;
  annual_review_cycle: string | null;

  // ── Personal: Project Reviews where caller is evaluator ────────────
  project_reviews_pending_primary: number;
  project_reviews_pending_secondary: number;

  // ── Mentor: only meaningful when caller has direct mentees ─────────
  mentee_count: number;
  mentor_goals_pending_approval: number;
  mentor_goal_reviews_pending: number;
  mentor_annual_reviews_pending: number;
}

export const dashboardService = {
  getSummary: async (): Promise<DashboardSummary> => {
    const res = await apiClient.get<DashboardSummary>("/dashboard/summary");
    return res.data;
  },
};
