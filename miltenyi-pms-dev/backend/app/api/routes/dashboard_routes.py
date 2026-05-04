"""
Dashboard Routes — The Landing Page's Data Feed.

Endpoint:
    GET /api/v1/dashboard/summary  →  Any authenticated user

Returns aggregated widget data in a single round-trip. The payload is
*role-additive*: Personal fields are always populated; Mentor fields
fall to zero when the caller has no direct mentees. The frontend gates
which widgets to render — we don't try to be clever here.

Personal layer:
    - Annual goal counts by approval state, plus criteria-driven completion %
    - Active cycle name (for the ActiveCycleWidget)
    - Caller's own AnnualReview for the active FY (id + status, or None)
    - Caller's pending project reviews as primary or secondary evaluator

Mentor layer (filled iff direct mentees exist):
    - Mentee count
    - Mentee goals awaiting caller's approval
    - Mentee goals at H1/H2 self-reviewed (caller owes the half-cycle mentor review)
    - Mentee annual reviews in PENDING_MENTOR for the active FY

Security Layers Applied:
    Layer 1 — Authentication:   CurrentUser dependency (JWT validation)
    Layer 2 — Tenant Isolation: All queries filter by current_user.org_id
    Layer 3 — Role Awareness:   Mentor counts gated on has_mentees (computed live)
    Layer 4 — Ownership:        Personal counts scoped to current_user.id
"""

from sqlalchemy import func, Integer, cast, or_
from fastapi import APIRouter

from app.api.dependencies import DbSession, CurrentUser
from app.models.system_settings_models import SystemSettings
from app.models.goal_models import Goal, GoalType, ApprovalStatus, POST_APPROVAL_STATES
from app.models.goal_criteria_models import GoalCriterion
from app.models.user_models import User
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.project_review_models import (
    ProjectReview,
    ProjectReviewEvaluator,
    ProjectReviewStatus,
    EvaluatorStatus,
)
from app.core.cycle_utils import extract_fy_label
from app.schemas.dashboard_schemas import DashboardSummary

router = APIRouter()


# Goal states that signal "mentor review of the cycle is owed."
# A goal sits at *_SELF_REVIEWED until the mentor finishes that cycle — the
# trigger for "mentor reviews pending." Covers both half-yearly (H1/H2)
# and quarterly (Q1..Q4) cadences in one set so a single org with mixed
# legacy data still rolls up correctly.
_MENTOR_REVIEW_PENDING_STATES = (
    ApprovalStatus.H1_SELF_REVIEWED.value,
    ApprovalStatus.H2_SELF_REVIEWED.value,
    ApprovalStatus.Q1_SELF_REVIEWED.value,
    ApprovalStatus.Q2_SELF_REVIEWED.value,
    ApprovalStatus.Q3_SELF_REVIEWED.value,
    ApprovalStatus.Q4_SELF_REVIEWED.value,
)


@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return aggregated counts for all dashboard widgets in one shot.
    """
    # ── Active Cycle ─────────────────────────────────────────────────
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id
    ).first()

    active_cycle = settings.active_cycle_name if settings else None
    # Annual reviews are tagged to the bare FY token regardless of the org's
    # half-yearly/quarterly cadence — mirror what annual_review_routes does.
    active_fy = extract_fy_label(active_cycle) if active_cycle else None

    # ── Annual Goal Counts by Approval State (single GROUP BY) ───────
    approval_rows = (
        db.query(Goal.approval_status, func.count(Goal.id))
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.user_id == current_user.id,
            Goal.goal_type == GoalType.ANNUAL.value,
        )
        .group_by(Goal.approval_status)
        .all()
    )
    counts: dict[str, int] = dict(approval_rows)

    draft_goals             = counts.get(ApprovalStatus.DRAFT.value, 0)
    submitted_goals         = counts.get(ApprovalStatus.PENDING_APPROVAL.value, 0)
    # Roll the 4 post-approval review states under the "approved" bucket so
    # the dashboard widget keeps rendering a single consolidated count.
    approved_goals          = sum(counts.get(s, 0) for s in POST_APPROVAL_STATES)
    changes_requested_goals = counts.get(ApprovalStatus.CHANGES_REQUESTED.value, 0)
    total_goals             = sum(counts.values())

    # ── Criteria-driven completion across approved annual goals ─────
    # Progress is no longer an employee-controlled field — it falls out
    # of (completed criteria / total criteria).  We average this over the
    # caller's approved annual goals, because draft/submitted goals don't
    # have meaningful progress yet.
    criteria_totals = (
        db.query(
            func.count(GoalCriterion.id).label("total"),
            func.sum(cast(GoalCriterion.is_completed, Integer)).label("done"),
        )
        .join(Goal, Goal.id == GoalCriterion.goal_id)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.user_id == current_user.id,
            Goal.goal_type == GoalType.ANNUAL.value,
            Goal.approval_status.in_(POST_APPROVAL_STATES),
        )
        .one()
    )
    total_criteria = int(criteria_totals.total or 0)
    done_criteria  = int(criteria_totals.done or 0)
    completion_percent = (
        round((done_criteria / total_criteria) * 100) if total_criteria > 0 else 0
    )

    # ── My Annual Review (current FY) ────────────────────────────────
    # One row per (org, user, cycle_name) is enforced by unique index, so the
    # first() lookup is exact. Fields stay None when no row exists — the
    # widget treats that as "not started" and shows the start CTA.
    annual_review_id: int | None = None
    annual_review_status: str | None = None
    annual_review_cycle: str | None = None
    if active_fy is not None:
        ar = (
            db.query(AnnualReview)
            .filter(
                AnnualReview.org_id == current_user.org_id,
                AnnualReview.user_id == current_user.id,
                AnnualReview.cycle_name == active_fy,
            )
            .first()
        )
        if ar is not None:
            annual_review_id = ar.id
            annual_review_status = ar.status
            annual_review_cycle = ar.cycle_name
        else:
            # No row yet, but we still want the widget to know which FY it
            # is offering to fill, so it can label the start CTA.
            annual_review_cycle = active_fy

    # ── Project Reviews where caller is an evaluator ─────────────────
    # Primary: caller is the project's PM. Status sits at PENDING (cycle just
    # opened) or DRAFT (PM saved partial work) until they submit → REVIEWED.
    project_reviews_pending_primary: int = (
        db.query(func.count(ProjectReview.id))
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.reviewer_id == current_user.id,
            ProjectReview.is_deleted == False,  # noqa: E712
            ProjectReview.status.in_(
                [ProjectReviewStatus.PENDING.value, ProjectReviewStatus.DRAFT.value]
            ),
        )
        .scalar()
    ) or 0

    # Secondary: caller has a per-review impact statement that's still in DRAFT.
    # Note: a Secondary slot with no row yet is created lazily when the cycle
    # opens, so DRAFT is the canonical "owed" state.
    project_reviews_pending_secondary: int = (
        db.query(func.count(ProjectReviewEvaluator.id))
        .filter(
            ProjectReviewEvaluator.org_id == current_user.org_id,
            ProjectReviewEvaluator.evaluator_id == current_user.id,
            ProjectReviewEvaluator.status == EvaluatorStatus.DRAFT.value,
        )
        .scalar()
    ) or 0

    # ── Mentor Pending Work (only meaningful with direct mentees) ────
    # Resolve mentee_ids exactly once; reuse for the three mentor counts.
    mentee_ids: list[int] = [
        row[0] for row in (
            db.query(User.id)
            .filter(
                User.mentor_id == current_user.id,
                User.org_id == current_user.org_id,
                User.is_deleted == False,  # noqa: E712
            )
            .all()
        )
    ]
    mentee_count = len(mentee_ids)

    mentor_goals_pending_approval = 0
    mentor_goal_reviews_pending = 0
    mentor_annual_reviews_pending = 0

    if mentee_ids:
        # Mentee goals submitted, awaiting caller's approve/changes-requested.
        mentor_goals_pending_approval = (
            db.query(func.count(Goal.id))
            .filter(
                Goal.org_id == current_user.org_id,
                Goal.user_id.in_(mentee_ids),
                Goal.goal_type == GoalType.ANNUAL.value,
                Goal.approval_status == ApprovalStatus.PENDING_APPROVAL.value,
            )
            .scalar()
        ) or 0

        # Mentee goals where the half-cycle self-review has landed but the
        # mentor review hasn't — H1_SELF_REVIEWED or H2_SELF_REVIEWED.
        mentor_goal_reviews_pending = (
            db.query(func.count(Goal.id))
            .filter(
                Goal.org_id == current_user.org_id,
                Goal.user_id.in_(mentee_ids),
                Goal.goal_type == GoalType.ANNUAL.value,
                Goal.approval_status.in_(_MENTOR_REVIEW_PENDING_STATES),
            )
            .scalar()
        ) or 0

        # Mentee annual reviews in PENDING_MENTOR for the active FY. We trust
        # mentor_id on the row when it's set (the canonical link), and fall
        # back to user_id IN mentee_ids to catch reviews created before the
        # mentor was wired up.
        if active_fy is not None:
            mentor_annual_reviews_pending = (
                db.query(func.count(AnnualReview.id))
                .filter(
                    AnnualReview.org_id == current_user.org_id,
                    AnnualReview.cycle_name == active_fy,
                    AnnualReview.status == ReviewStatus.PENDING_MENTOR.value,
                    or_(
                        AnnualReview.mentor_id == current_user.id,
                        AnnualReview.user_id.in_(mentee_ids),
                    ),
                )
                .scalar()
            ) or 0

    return DashboardSummary(
        total_goals=total_goals,
        draft_goals=draft_goals,
        submitted_goals=submitted_goals,
        approved_goals=approved_goals,
        changes_requested_goals=changes_requested_goals,
        completion_percent=completion_percent,
        active_cycle=active_cycle,
        annual_review_id=annual_review_id,
        annual_review_status=annual_review_status,
        annual_review_cycle=annual_review_cycle,
        project_reviews_pending_primary=project_reviews_pending_primary,
        project_reviews_pending_secondary=project_reviews_pending_secondary,
        mentee_count=mentee_count,
        mentor_goals_pending_approval=mentor_goals_pending_approval,
        mentor_goal_reviews_pending=mentor_goal_reviews_pending,
        mentor_annual_reviews_pending=mentor_annual_reviews_pending,
    )
