"""
Mentee Routes — The Mentor's Master View.

Endpoints:
    GET /api/v1/mentees/summary            → Rolled-up cards for the /my-mentees grid
    GET /api/v1/mentees/{mentee_id}/detail → Full data for /my-mentees/:id

Security Layers Applied:
    Layer 1 — Authentication:   CurrentUser dependency (JWT validation)
    Layer 2 — Tenant Isolation: All queries filter by current_user.org_id
    Layer 3 — Role Awareness:   Any user with mentees gets data; non-mentors see []
    Layer 4 — Ownership:        Detail 404s when target user is not the caller's mentee

Note on scope: unlike /goals/team there is no Admin bypass — Admin role
does not grant mentor authority. An Admin who is also an assigned mentor
sees the relationship; otherwise they see an empty list here.
"""

from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, status
from sqlalchemy.orm import joinedload

from app.api.dependencies import DbSession, CurrentUser
from app.api.routes.project_review_routes import _build_review_response
from app.core.cycle_utils import get_current_cycle_info
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.goal_models import Goal, GoalType, ApprovalStatus, POST_APPROVAL_STATES
from app.models.project_models import Project, ProjectAssignment
from app.models.project_review_models import ProjectReview, ProjectReviewStatus
from app.models.system_settings_models import SystemSettings, CycleType
from app.models.user_models import User
from app.schemas.annual_review_schemas import AnnualReviewResponse
from app.schemas.goal_schemas import TeamGoalResponse
from app.schemas.mentee_schemas import (
    MenteeDetail,
    MenteeGoalsStats,
    MenteeProjectAssignment,
    MenteeProjectsStats,
    MenteeReviewStatus,
    MenteeSummary,
)

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────

def _get_active_cycle(db: DbSession, org_id: int) -> str:
    """
    Return the active cycle name for this org. Falls back to a computed
    label if SystemSettings is missing an active_cycle_name so the endpoint
    never 500s purely because settings are mid-setup.
    """
    settings = db.query(SystemSettings).filter(SystemSettings.org_id == org_id).first()
    if settings and settings.active_cycle_name:
        return settings.active_cycle_name
    cycle_type = (
        CycleType(settings.cycle_type) if settings else CycleType.HALF_YEARLY
    )
    fiscal_start = settings.fiscal_start_month if settings else 4
    return get_current_cycle_info(datetime.now(timezone.utc).date(), cycle_type, fiscal_start)


def _list_mentees(db: DbSession, mentor: User) -> list[User]:
    """All active users whose mentor_id points at the caller, same tenant."""
    return (
        db.query(User)
        .options(joinedload(User.department), joinedload(User.designation))
        .filter(
            User.mentor_id == mentor.id,
            User.org_id == mentor.org_id,
            User.is_deleted == False,  # noqa: E712
        )
        .order_by(User.full_name.asc())
        .all()
    )


def _build_goal_stats(annual_goals: list[Goal]) -> MenteeGoalsStats:
    """Roll up annual-goal counts + progress for a single mentee.

    All post-approval review states (h1_*/h2_* for half-yearly orgs and
    q1_*..q4_* for quarterly orgs) are folded into the `approved` bucket
    so the mentee card keeps showing one consolidated count regardless of
    cadence — see POST_APPROVAL_STATES.
    """
    counts = {s.value: 0 for s in ApprovalStatus}
    for g in annual_goals:
        counts[g.approval_status] = counts.get(g.approval_status, 0) + 1

    approved_goals = [g for g in annual_goals if g.approval_status in POST_APPROVAL_STATES]
    if approved_goals:
        progress_values: list[int] = []
        for g in approved_goals:
            if not g.criteria:
                progress_values.append(0)
                continue
            done = sum(1 for c in g.criteria if c.is_completed)
            progress_values.append(round((done / len(g.criteria)) * 100))
        avg = round(sum(progress_values) / len(progress_values))
    else:
        avg = 0

    return MenteeGoalsStats(
        total=len(annual_goals),
        approved=sum(counts[s] for s in POST_APPROVAL_STATES),
        submitted=counts[ApprovalStatus.PENDING_APPROVAL.value],
        draft=counts[ApprovalStatus.DRAFT.value],
        changes_requested=counts[ApprovalStatus.CHANGES_REQUESTED.value],
        avg_progress_percent=avg,
    )


def _build_review_status(active_review: AnnualReview | None) -> MenteeReviewStatus:
    """Shape the active-cycle review (or its absence) for the card."""
    if not active_review:
        return MenteeReviewStatus()
    return MenteeReviewStatus(
        review_id=active_review.id,
        cycle_name=active_review.cycle_name,
        status=active_review.status,
        mentor_performance_rating=active_review.mentor_performance_rating,
        final_performance_rating=active_review.final_performance_rating if active_review.final_rating_enabled else None,
    )


def _build_project_stats(
    assignments: list[ProjectAssignment],
    reviews: list[ProjectReview],
) -> MenteeProjectsStats:
    """Active project count + outstanding reviews + latest rating."""
    pending_reviews = [r for r in reviews if r.status == ProjectReviewStatus.PENDING.value]

    latest_rated = [
        r for r in reviews
        if r.status == ProjectReviewStatus.REVIEWED.value and r.performance_group
    ]
    latest_rated.sort(key=lambda r: r.updated_at or r.created_at, reverse=True)
    latest_rating: Optional[int] = None
    if latest_rated:
        try:
            latest_rating = int(latest_rated[0].performance_group)
        except (TypeError, ValueError):
            latest_rating = None

    return MenteeProjectsStats(
        active_count=len(assignments),
        pending_reviews_count=len(pending_reviews),
        latest_performance_group=latest_rating,
    )


def _compose_summary(
    user: User,
    annual_goals: list[Goal],
    active_review: AnnualReview | None,
    assignments: list[ProjectAssignment],
    reviews: list[ProjectReview],
) -> MenteeSummary:
    goals = _build_goal_stats(annual_goals)
    review = _build_review_status(active_review)
    projects = _build_project_stats(assignments, reviews)

    pending_actions = goals.submitted
    if review.status == ReviewStatus.PENDING_MENTOR.value:
        pending_actions += 1

    return MenteeSummary(
        user_id=user.id,
        full_name=user.full_name,
        email=user.email,
        employee_code=user.employee_code,
        phone=user.phone,
        department_name=user.department.name if user.department else None,
        designation_name=user.designation.name if user.designation else None,
        role=user.role,
        is_active=not user.is_deleted,
        goals=goals,
        review=review,
        projects=projects,
        pending_actions_count=pending_actions,
    )


# =====================================================================
# ENDPOINTS
# =====================================================================

@router.get("/summary", response_model=List[MenteeSummary])
def list_mentee_summaries(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return one rolled-up card per direct mentee of the caller.

    Includes draft goals in the totals so the mentor sees the mentee's
    full footprint; visibility into draft *content* still requires the
    mentee to submit (the Goals tab filters drafts out like /goals/team).
    """
    mentees = _list_mentees(db, current_user)
    if not mentees:
        return []

    mentee_ids = [u.id for u in mentees]
    active_cycle = _get_active_cycle(db, current_user.org_id)

    # One query each for goals, reviews, assignments, project reviews —
    # then bucket by user_id in Python. Avoids N+1s across the mentee list.
    annual_goals_all = (
        db.query(Goal)
        .options(joinedload(Goal.criteria))
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.user_id.in_(mentee_ids),
            Goal.goal_type == GoalType.ANNUAL.value,
        )
        .all()
    )
    goals_by_user: dict[int, list[Goal]] = {uid: [] for uid in mentee_ids}
    for g in annual_goals_all:
        goals_by_user[g.user_id].append(g)

    active_reviews = (
        db.query(AnnualReview)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.user_id.in_(mentee_ids),
            AnnualReview.cycle_name == active_cycle,
        )
        .all()
    )
    review_by_user: dict[int, AnnualReview] = {r.user_id: r for r in active_reviews}

    assignments_all = (
        db.query(ProjectAssignment)
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.user_id.in_(mentee_ids),
        )
        .all()
    )
    assignments_by_user: dict[int, list[ProjectAssignment]] = {uid: [] for uid in mentee_ids}
    for a in assignments_all:
        assignments_by_user[a.user_id].append(a)

    reviews_all = (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.user_id.in_(mentee_ids),
            ProjectReview.is_deleted == False,  # noqa: E712
        )
        .all()
    )
    project_reviews_by_user: dict[int, list[ProjectReview]] = {uid: [] for uid in mentee_ids}
    for r in reviews_all:
        project_reviews_by_user[r.user_id].append(r)

    return [
        _compose_summary(
            user=u,
            annual_goals=goals_by_user[u.id],
            active_review=review_by_user.get(u.id),
            assignments=assignments_by_user[u.id],
            reviews=project_reviews_by_user[u.id],
        )
        for u in mentees
    ]


@router.get("/{mentee_id}/detail", response_model=MenteeDetail)
def get_mentee_detail(
    mentee_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Full per-mentee payload for the /my-mentees/:id page.

    Ownership check: 404 when `mentee_id` is not a direct mentee of the
    caller. Using 404 (not 403) intentionally — we don't leak whether the
    user exists in another tenant or under a different mentor.
    """
    mentee = (
        db.query(User)
        .options(joinedload(User.department), joinedload(User.designation))
        .filter(
            User.id == mentee_id,
            User.org_id == current_user.org_id,
            User.is_deleted == False,  # noqa: E712
            User.mentor_id == current_user.id,
        )
        .first()
    )
    if not mentee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Mentee not found or not assigned to you.",
        )

    active_cycle = _get_active_cycle(db, current_user.org_id)

    # Annual goals for this mentee (drives stats + goals tab).
    annual_goals = (
        db.query(Goal)
        .options(
            joinedload(Goal.owner).joinedload(User.department),
            joinedload(Goal.owner).joinedload(User.designation),
            joinedload(Goal.manager),
            joinedload(Goal.criteria),
        )
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.user_id == mentee_id,
            Goal.goal_type == GoalType.ANNUAL.value,
        )
        .order_by(Goal.created_at.desc())
        .all()
    )
    # Inject owner_name + owner_department_name + owner_designation_name for
    # TeamGoalResponse. Mirrors goal_routes.list_team_goals so the mentor
    # review modal can match the right RoleExpectation row.
    mentee_dept_name = mentee.department.name if mentee.department else None
    mentee_desig_name = mentee.designation.name if mentee.designation else None
    for g in annual_goals:
        g.owner_name = g.owner.full_name if g.owner else mentee.full_name
        g.owner_department_name = (
            g.owner.department.name
            if g.owner and g.owner.department
            else mentee_dept_name
        )
        g.owner_designation_name = (
            g.owner.designation.name
            if g.owner and g.owner.designation
            else mentee_desig_name
        )

    # Goals tab hides DRAFT for the mentor — but stats should reflect the
    # full footprint. Split into two lists.
    goals_list = [g for g in annual_goals if g.approval_status != ApprovalStatus.DRAFT.value]

    # All reviews across all cycles, newest first.
    reviews_list = (
        db.query(AnnualReview)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.user_id == mentee_id,
        )
        .order_by(AnnualReview.created_at.desc())
        .all()
    )
    active_review = next((r for r in reviews_list if r.cycle_name == active_cycle), None)

    # Project assignments, joined with the review for the active cycle
    # (if one exists). Latest rating stat needs all reviews though.
    assignments = (
        db.query(ProjectAssignment)
        .options(joinedload(ProjectAssignment.project))
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.user_id == mentee_id,
        )
        .all()
    )
    # Mentor's own evaluator role on each of the mentee's projects — drives
    # the Projects tab action buttons (Evaluate / Write Impact / View).
    # "Primary" comes from the mentor's own ProjectAssignment.evaluator_type.
    # "Secondary" now comes from the project-level Project.secondary_evaluator_id.
    mentee_project_ids = [a.project_id for a in assignments] if assignments else []
    mentor_assignments = (
        db.query(ProjectAssignment)
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.user_id == current_user.id,
            ProjectAssignment.project_id.in_(mentee_project_ids),
        )
        .all()
    ) if mentee_project_ids else []
    mentor_role_by_project: dict[int, Optional[str]] = {
        ma.project_id: ma.evaluator_type for ma in mentor_assignments
    }
    # Overlay project-level Secondary for projects where the mentor is the
    # designated Secondary evaluator (Secondary takes priority over None,
    # but we keep an existing Primary if both somehow apply).
    if mentee_project_ids:
        secondary_project_ids = (
            db.query(Project.id)
            .filter(
                Project.org_id == current_user.org_id,
                Project.id.in_(mentee_project_ids),
                Project.secondary_evaluator_id == current_user.id,
            )
            .all()
        )
        for (pid,) in secondary_project_ids:
            if mentor_role_by_project.get(pid) != "Primary":
                mentor_role_by_project[pid] = "Secondary"
    project_reviews = (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.user_id == mentee_id,
            ProjectReview.is_deleted == False,  # noqa: E712
        )
        .order_by(ProjectReview.updated_at.desc().nullslast(), ProjectReview.created_at.desc())
        .all()
    )

    # PM (Primary evaluator) per project — one Primary assignment per project.
    pm_assignment_rows = (
        db.query(ProjectAssignment, User)
        .join(User, ProjectAssignment.user_id == User.id)
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.evaluator_type == "Primary",
            ProjectAssignment.project_id.in_([a.project_id for a in assignments]),
        )
        .all()
    ) if assignments else []
    pm_name_by_project: dict[int, str] = {
        pa.project_id: u.full_name for pa, u in pm_assignment_rows
    }

    # Bucket reviews by project_id and track which projects have an
    # active-cycle review (so we can emit a placeholder row otherwise).
    reviews_by_project: dict[int, list[ProjectReview]] = {}
    project_ids_with_active_cycle_review: set[int] = set()
    for r in project_reviews:
        reviews_by_project.setdefault(r.project_id, []).append(r)
        if r.cycle == active_cycle:
            project_ids_with_active_cycle_review.add(r.project_id)

    project_assignments_out: list[MenteeProjectAssignment] = []
    for a in assignments:
        if a.project is None or a.project.is_deleted:
            continue
        common = dict(
            project_id=a.project_id,
            project_name=a.project.name,
            project_code=a.project.project_code,
            assignment_role=a.assignment_role,
            evaluator_type=a.evaluator_type,
            pm_name=pm_name_by_project.get(a.project_id),
            viewer_evaluator_role=mentor_role_by_project.get(a.project_id),
        )

        # One row per existing ProjectReview (across cycles).
        for review in reviews_by_project.get(a.project_id, []):
            review_detail = (
                _build_review_response(review, db)
                if review.status == ProjectReviewStatus.REVIEWED.value
                else None
            )
            project_assignments_out.append(
                MenteeProjectAssignment(
                    **common,
                    review_status=review.status,
                    performance_group=review.performance_group,
                    cycle=review.cycle,
                    review_detail=review_detail,
                )
            )

        # Placeholder for the active cycle when no review row exists for it.
        # Status = None signals "not yet evaluated for this cycle"; the
        # frontend renders it as a Pending row so a Primary mentor can act.
        if a.project_id not in project_ids_with_active_cycle_review:
            project_assignments_out.append(
                MenteeProjectAssignment(
                    **common,
                    review_status=None,
                    performance_group=None,
                    cycle=active_cycle,
                    review_detail=None,
                )
            )

    summary = _compose_summary(
        user=mentee,
        annual_goals=annual_goals,
        active_review=active_review,
        assignments=assignments,
        reviews=project_reviews,
    )

    return MenteeDetail(
        **summary.model_dump(),
        goals_list=[TeamGoalResponse.model_validate(g) for g in goals_list],
        reviews_list=[AnnualReviewResponse.model_validate(r) for r in reviews_list],
        project_assignments=project_assignments_out,
    )
