import apiClient from "@/services/api.client";

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
}

// ── HR org-wide dashboard ─────────────────────────────────────────────
//
// Separate response model from DashboardSummary — the HR view shows
// org-wide rollups, not the caller's personal queue. Both HR roles
// (HR_MyOrg, HR_Miltenyi) hit the same endpoint and receive the same
// payload for now; widgets that diverge get gated on the frontend.

export interface HeadcountByRole {
  employee: number;
  mentor: number;
  pm: number;
  // Combined HR_MyOrg + HR_Miltenyi.
  hr: number;
}

export interface HeadcountSummary {
  total_active: number;
  by_role: HeadcountByRole;
}

export interface AnnualReviewFunnel {
  /** Fiscal start year the counts cover (e.g. 2026 for FY26-27). Null
   *  when neither the request's `fy` param nor the active FY resolves —
   *  the widget treats that as "no FY in scope" and renders an empty
   *  state. */
  fy_year: number | null;
  total: number;
  draft: number;
  pending_mentor: number;
  pending_management: number;
  completed: number;
}

export interface GoalApprovalFunnel {
  /** Same null semantics as AnnualReviewFunnel.fy_year. */
  fy_year: number | null;
  total: number;
  /** Mentee submitted, awaiting mentor approve / changes-requested. */
  pending_approval: number;
  /** Mentor pushed back; employee needs to revise. */
  changes_requested: number;
  /** Rolls up APPROVED + all post-approval review states (H1/H2 +
   *  Q1..Q4 self/mentor-reviewed). From HR's funnel-view this is one
   *  bucket: "done with approval, progressing through the cycle". */
  approved: number;
}

export interface ProjectReviewCompletion {
  /** Same null semantics as the funnel widgets. */
  fy_year: number | null;
  /** Sum of every project-review row in this org × FY × cycle (H1+H2
   *  for half-yearly orgs, Q1..Q4 for quarterly). */
  total: number;
  /** Row exists, PM hasn't started writing yet. */
  pending: number;
  /** PM saved partial work, hasn't submitted. */
  draft: number;
  /** Final, locked. */
  reviewed: number;
}

export interface MissingAnnualReviewUser {
  user_id: number;
  full_name: string;
  function_name: string | null;
  designation_name: string | null;
  mentor_name: string | null;
}

/** Same shape as MissingAnnualReviewUser but with the existing draft
 *  row's id so the HR dashboard can deep-link to a specific review. */
export interface DraftAnnualReviewUser {
  user_id: number;
  review_id: number;
  full_name: string;
  function_name: string | null;
  designation_name: string | null;
  mentor_name: string | null;
}

export interface MissingAnnualReviewsSummary {
  fy_year: number | null;
  /** Count of employees with NO AnnualReview row at all. */
  count: number;
  users: MissingAnnualReviewUser[];
  /** Count of employees who opened a review but never submitted it
   *  (AnnualReview row exists with status='draft'). Surfaced as a
   *  separate chase list on the HR Pending Actions card. */
  draft_count: number;
  drafts: DraftAnnualReviewUser[];
}

export interface StalledGoal {
  goal_id: number;
  title: string;
  owner_name: string;
  mentor_name: string | null;
  days_waiting: number;
}

export interface StalledGoalsSummary {
  fy_year: number | null;
  /** Number of days a goal must sit in `pending_approval` before it
   *  counts as stalled. Echoed back by the backend so the frontend
   *  doesn't have to duplicate the constant. */
  threshold_days: number;
  count: number;
  goals: StalledGoal[];
}

export interface UnmentoredEmployee {
  user_id: number;
  full_name: string;
  function_name: string | null;
  designation_name: string | null;
}

export interface MentorLoad {
  mentor_id: number;
  full_name: string;
  mentee_count: number;
}

export interface MentorCoverage {
  unmentored_employees: UnmentoredEmployee[];
  top_mentors: MentorLoad[];
}

export interface HrDashboardSummary {
  headcount: HeadcountSummary;
  annual_review_funnel: AnnualReviewFunnel;
  goal_approval_funnel: GoalApprovalFunnel;
  project_review_completion: ProjectReviewCompletion;
  missing_annual_reviews: MissingAnnualReviewsSummary;
  stalled_goals: StalledGoalsSummary;
  mentor_coverage: MentorCoverage;
  /** Distinct fiscal start years that have annual-review or annual-goal
   *  data in the caller's org, sorted newest-first. The active FY is
   *  always included so the dashboard's picker can offer the current
   *  cycle even when no rows exist for it yet. */
  available_fys: number[];
}

export const dashboardService = {
  getSummary: async (): Promise<DashboardSummary> => {
    const res = await apiClient.get<DashboardSummary>("/dashboard/summary");
    return res.data;
  },

  /** HR-only aggregate. `fyYear` is the 4-digit fiscal start year
   *  (e.g. 2026 for FY26-27). Sent today even though only cycle-scoped
   *  widgets we add later will consume it — the headcount widget is a
   *  snapshot and ignores it. */
  getHrSummary: async (fyYear?: number): Promise<HrDashboardSummary> => {
    const res = await apiClient.get<HrDashboardSummary>(
      "/dashboard/hr-summary",
      { params: fyYear !== undefined ? { fy: fyYear } : undefined },
    );
    return res.data;
  },
};
