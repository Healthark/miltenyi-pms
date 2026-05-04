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