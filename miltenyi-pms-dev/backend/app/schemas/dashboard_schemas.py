"""
Dashboard Schemas — The Dashboard Page's API Contract.

Goal progress is now tracked entirely through criteria completion —
there is no separate employee-controlled progress state.  The dashboard
therefore summarises annual goals by APPROVAL state, which reflects
where the goal sits in the mentor-approval workflow.

The payload is role-additive: every authenticated user gets the
"Personal" fields filled in (goals, own annual review, project review
queue). Users with direct mentees additionally get the "Mentor" fields
filled in. The frontend gates which widgets to render off the user's
auth claims (has_mentees, hasFeature(...)) — so we always return every
field regardless of role, defaulting to zero/null when the layer
doesn't apply.
"""

from pydantic import BaseModel
from typing import Optional


class DashboardSummary(BaseModel):
    """
    Aggregated widget data for the Dashboard page.

    One GET, one response, all widgets fed at once.
    """
    # ── Personal: Annual Goals ───────────────────────────────────────
    total_goals: int = 0
    draft_goals: int = 0
    submitted_goals: int = 0
    approved_goals: int = 0
    changes_requested_goals: int = 0
    # Criteria-driven average completion across approved goals (0–100).
    completion_percent: int = 0

    # ── Personal: Active Cycle ───────────────────────────────────────
    active_cycle: Optional[str] = None

    # ── Personal: My Annual Review (current FY) ──────────────────────
    # All None when no AnnualReview row exists yet for the active FY —
    # the widget treats that as "not started" and renders the start CTA.
    annual_review_id: Optional[int] = None
    annual_review_status: Optional[str] = None  # draft|pending_mentor|pending_management|completed
    annual_review_cycle: Optional[str] = None   # bare FY label, e.g. "FY26-27"

    # ── Personal: Project Reviews where caller is evaluator ──────────
    # Primary: ProjectReview.reviewer_id == me AND status in (pending, draft).
    # Secondary: ProjectReviewEvaluator.evaluator_id == me AND status == draft.
    project_reviews_pending_primary: int = 0
    project_reviews_pending_secondary: int = 0

    # ── Mentor: only meaningful when caller has direct mentees ───────
    mentee_count: int = 0
    # Mentee goals submitted for approval.
    mentor_goals_pending_approval: int = 0
    # Mentee goals at H1_SELF_REVIEWED or H2_SELF_REVIEWED — the half-cycle
    # mentor review hasn't been written yet.
    mentor_goal_reviews_pending: int = 0
    # Mentee AnnualReview rows in PENDING_MENTOR for the active FY.
    mentor_annual_reviews_pending: int = 0


# ── HR org-wide dashboard ─────────────────────────────────────────────
#
# Separate response model from DashboardSummary because the HR view is
# org-wide rollups, not the caller's personal queue. Both HR roles
# (HR_MyOrg, HR_Miltenyi) receive the same shape for now — divergent
# widgets in later versions will be either gated on the frontend or
# split into role-specific endpoints if the payloads grow apart.

class HeadcountByRole(BaseModel):
    """Active-user breakdown by role. HR combines HR_MyOrg + HR_Miltenyi."""
    staff: int = 0
    mentor: int = 0
    pm: int = 0
    hr: int = 0


class HeadcountSummary(BaseModel):
    total_active: int = 0
    by_role: HeadcountByRole = HeadcountByRole()


class AnnualReviewFunnel(BaseModel):
    """Per-status row count for annual reviews in a single FY.

    `total` is the sum of the four buckets (= number of AnnualReview
    rows in the system for this FY in this org); employees with no
    review row at all aren't counted here. The "missing reviews" widget
    in Theme D will cover that separately."""
    fy_year: int | None = None
    total: int = 0
    draft: int = 0
    pending_mentor: int = 0
    pending_management: int = 0
    completed: int = 0


class GoalApprovalFunnel(BaseModel):
    """Per-stage count for annual goals in a single FY.

    Draft goals are private mentee work and are not surfaced to HR
    anywhere in the app, so they're not counted here. `approved` rolls
    up the literal APPROVED state plus all post-approval review states
    (H1/H2 + Q1..Q4 self/mentor-reviewed) — from HR's approval-funnel
    perspective, anything past APPROVED is "done with approval, now
    progressing through the review cycle". `total` is the sum of the
    three visible buckets."""
    fy_year: int | None = None
    total: int = 0
    pending_approval: int = 0
    changes_requested: int = 0
    approved: int = 0


class ProjectReviewCompletion(BaseModel):
    """Project-review completion state aggregated across every cycle
    in a single FY (H1+H2 for half-yearly orgs, Q1..Q4 for quarterly).

    Soft-deleted reviews are skipped. Buckets:
        pending  — row exists, PM hasn't started writing
        draft    — PM saved partial work, hasn't submitted
        reviewed — final, locked
    """
    fy_year: int | None = None
    total: int = 0
    pending: int = 0
    draft: int = 0
    reviewed: int = 0


class MissingAnnualReviewUser(BaseModel):
    """One row in the missing-annual-reviews chase list."""
    user_id: int
    full_name: str
    function_name: str | None = None
    designation_name: str | None = None
    mentor_name: str | None = None


class MissingAnnualReviewsSummary(BaseModel):
    """Staff users with NO AnnualReview row for the selected FY — the
    silent population that the funnel widget can't surface.

    Scope is Staff only: Mentors / PMs / HR aren't rated in this system
    so they're never expected to have an annual review row.
    `count` always equals `len(users)` — we keep both so the frontend
    can render a headline number even if the list is cropped client-
    side. (Backend doesn't cap the list itself; org sizes are small.)
    """
    fy_year: int | None = None
    count: int = 0
    users: list[MissingAnnualReviewUser] = []


class StalledGoal(BaseModel):
    """One row in the stalled-goal-approvals chase list."""
    goal_id: int
    title: str
    owner_name: str
    mentor_name: str | None = None
    days_waiting: int


class StalledGoalsSummary(BaseModel):
    """Annual goals stuck in `pending_approval` longer than the
    threshold for the selected FY.

    The mentor is the natural escalation target — when an employee
    submits, the goal sits at `pending_approval` until their mentor
    acts. After `threshold_days` we surface the row here so HR can
    nudge the mentor."""
    fy_year: int | None = None
    threshold_days: int = 7
    count: int = 0
    goals: list[StalledGoal] = []


class UnmentoredStaff(BaseModel):
    """One row in the unmentored-Staff list."""
    user_id: int
    full_name: str
    function_name: str | None = None
    designation_name: str | None = None


class MentorLoad(BaseModel):
    """Mentor + their currently-active mentee count."""
    mentor_id: int
    full_name: str
    mentee_count: int


class MentorCoverage(BaseModel):
    """Org-wide mentor pairing health snapshot.

    Two paired insights HR cares about:
      - `unmentored_staff` — active Staff with no mentor (or with a
        mentor that's been deactivated). These users are blocked from
        submitting annual goals/reviews. List is unbounded; the
        frontend scrolls.
      - `top_mentors` — top 5 mentors by active mentee count. Useful
        for spotting overload and for picking who to assign new
        Staff to. Sorted desc by count, ties broken alphabetically.

    Not FY-scoped — this is a "right now" snapshot, like Headcount.
    """
    unmentored_staff: list[UnmentoredStaff] = []
    top_mentors: list[MentorLoad] = []


class HrDashboardSummary(BaseModel):
    """Aggregated HR dashboard payload — one GET, every widget fed.

    Subsequent dashboard widgets add sibling fields (calibration_progress,
    project_review_completion, etc.) without breaking existing clients."""
    headcount: HeadcountSummary = HeadcountSummary()
    annual_review_funnel: AnnualReviewFunnel = AnnualReviewFunnel()
    goal_approval_funnel: GoalApprovalFunnel = GoalApprovalFunnel()
    project_review_completion: ProjectReviewCompletion = ProjectReviewCompletion()
    missing_annual_reviews: MissingAnnualReviewsSummary = MissingAnnualReviewsSummary()
    stalled_goals: StalledGoalsSummary = StalledGoalsSummary()
    mentor_coverage: MentorCoverage = MentorCoverage()
    # Distinct 4-digit FY start years that have any annual review or
    # annual goal row in the caller's org, plus the active FY (so the
    # picker always offers the current cycle even when no data exists
    # for it yet). Sorted newest-first for direct use in the dropdown.
    available_fys: list[int] = []