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
  /** Rolls APPROVED + every post-approval cycle-review state (h1/h2/q1..q4
   *  self-reviewed + mentor-reviewed) into one bucket. The dashboard
   *  surfaces this as "Active Goals" — see GoalsWidget. */
  approved_goals: number;
  changes_requested_goals: number;

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

  // ── Personal: Project Reviews RECEIVED in the active cycle ─────────
  // Count of PM evaluations submitted against the caller in the active
  // project cycle. Drives the compact strip footer on the Employee
  // dashboard's Annual Review card. Always 0 for PM/Mentor/HR roles.
  project_reviews_received_count: number;

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

/** Same shape as UnmentoredEmployee plus `orphaned_at` so the
 *  dashboard can render "Orphaned X days ago". Backed by
 *  `users.mentor_orphaned_at` which is stamped when a mentor is
 *  deactivated or role-changed away from Mentor. See
 *  docs/policies/mentor-transition-policy.md. */
export interface OrphanedEmployee {
  user_id: number;
  full_name: string;
  function_name: string | null;
  designation_name: string | null;
  /** ISO datetime when this user lost their mentor via the cascade. */
  orphaned_at: string;
}

export interface MentorLoad {
  mentor_id: number;
  full_name: string;
  mentee_count: number;
}

export interface MentorCoverage {
  unmentored_employees: UnmentoredEmployee[];
  orphaned_employees: OrphanedEmployee[];
  top_mentors: MentorLoad[];
}

/** One project surfaced on the HR dashboard's ProjectCoverage card.
 *  Surfaces when a project's PM was deactivated or role-changed away
 *  from PM and the cascade nulled `pm_id`. Backed by
 *  `projects.pm_orphaned_at`. Mirrors OrphanedEmployee in shape. See
 *  docs/policies/mentor-transition-policy.md for the policy this
 *  extends to the PM-and-project axis. */
export interface OrphanedProject {
  project_id: number;
  project_code: string;
  name: string;
  secondary_evaluator_name: string | null;
  /** ISO datetime stamped when the cascade ran. */
  orphaned_at: string;
}

export interface ProjectCoverage {
  orphaned_projects: OrphanedProject[];
}

export interface HrDashboardSummary {
  headcount: HeadcountSummary;
  annual_review_funnel: AnnualReviewFunnel;
  goal_approval_funnel: GoalApprovalFunnel;
  project_review_completion: ProjectReviewCompletion;
  missing_annual_reviews: MissingAnnualReviewsSummary;
  stalled_goals: StalledGoalsSummary;
  mentor_coverage: MentorCoverage;
  project_coverage: ProjectCoverage;
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
