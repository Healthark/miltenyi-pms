"""
Project Review Routes — PM-Centric Evaluation (Revised).

No self-review. The PM writes the evaluation directly for each team member.

Endpoints:
    ── Employee ──
    GET   /project-reviews/mine                    → My assigned projects with review status
    GET   /project-reviews/{id}                    → View single review (after PM evaluates)

    ── PM (Primary Evaluator) ──
    GET   /project-reviews/pm-queue                → Team members awaiting evaluation
    GET   /project-reviews/role-expectations        → Reference data for evaluation
    POST  /project-reviews/{user_id}/evaluate       → Submit PM evaluation for a team member

    ── Secondary Evaluator ──
    GET   /project-reviews/secondary-queue          → Reviews pending secondary feedback
    POST  /project-reviews/{review_id}/secondary    → Submit secondary impact statement

    ── Admin ──
    GET   /project-reviews/management               → Per-project completion overview for active cycle
    GET   /project-reviews/all                      → All reviews for the org (flat list)
"""

from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from sqlalchemy.orm import joinedload

from app.api.dependencies import DbSession, CurrentUser
from app.models.project_models import Project, ProjectAssignment
from app.models.project_review_models import (
    ProjectReview, ProjectReviewStatus,
    ProjectReviewEvaluator, EvaluatorStatus,
)
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.models.reference_models import Department, Designation
from app.models.role_expectation_models import RoleExpectation
from app.schemas.project_review_schemas import (
    PMEvaluationSubmit, PMEvaluationDraft,
    SecondaryEvalSubmit, SecondaryEvalDraft,
    ProjectReviewResponse, SecondaryEvalResponse,
    MyProjectCard, PMPendingReviewCard,
    RoleExpectationResponse,
    AdminMemberReviewRow, AdminProjectSummary,
)

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────

_DRAFT_COMMENT_FIELDS = (
    "comment_task_execution",
    "comment_ownership",
    "comment_project_management",
    "comment_client_deliverables",
    "comment_communication",
    "comment_mentoring",
    "comment_competency_skills",
)


def _pm_review_has_draft_content(review: ProjectReview) -> bool:
    """True iff the PM has typed anything into this review row.

    Distinguishes a saved draft from the empty placeholder rows that
    seed.py / the queue pre-creates for upcoming cycles. A row counts as
    a draft if any of: rating selected, impact statement filled, or any
    per-competency comment present (after stripping whitespace).
    """
    if review.performance_group:
        return True
    if review.impact_statement and review.impact_statement.strip():
        return True
    for f in _DRAFT_COMMENT_FIELDS:
        v = getattr(review, f, None)
        if v and v.strip():
            return True
    return False


def _get_active_cycle(db: DbSession, org_id: int) -> str:
    """Return the admin-configured active cycle name from SystemSettings."""
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == org_id
    ).first()

    if not settings or not settings.active_cycle_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active performance cycle configured.",
        )

    return settings.active_cycle_name


def _build_review_response(
    review: ProjectReview,
    db: DbSession,
    viewer_user_id: Optional[int] = None,
) -> ProjectReviewResponse:
    """
    Convert a ProjectReview ORM row to its API response shape.

    `viewer_user_id` is used to decide whether to include in-progress
    secondary-evaluator drafts: an evaluator can see their own draft (so
    reopening the modal pre-populates), but other viewers (PM, mentor,
    mentee, admin) only see submitted impact statements.
    """
    employee = db.query(User).filter(User.id == review.user_id).first()
    reviewer = db.query(User).filter(User.id == review.reviewer_id).first() if review.reviewer_id else None
    project = db.query(Project).filter(Project.id == review.project_id).first()

    secondary_responses: list[SecondaryEvalResponse] = []
    for ev in review.secondary_evaluations:
        # Always include submitted; include drafts only for their author.
        if (
            ev.status == EvaluatorStatus.SUBMITTED.value
            or (
                ev.status == EvaluatorStatus.DRAFT.value
                and viewer_user_id is not None
                and ev.evaluator_id == viewer_user_id
            )
        ):
            ev_user = db.query(User).filter(User.id == ev.evaluator_id).first()
            secondary_responses.append(SecondaryEvalResponse(
                id=ev.id,
                evaluator_id=ev.evaluator_id,
                evaluator_name=ev_user.full_name if ev_user else "Unknown",
                impact_statement=ev.impact_statement,
                status=ev.status,
                created_at=ev.created_at,
            ))

    return ProjectReviewResponse(
        id=review.id,
        org_id=review.org_id,
        user_id=review.user_id,
        project_id=review.project_id,
        reviewer_id=review.reviewer_id,
        cycle=review.cycle,
        status=review.status,
        employee_name=employee.full_name if employee else "Unknown",
        reviewer_name=reviewer.full_name if reviewer else None,
        project_name=project.name if project else "Unknown",
        project_code=project.project_code if project else "???",
        comment_task_execution=review.comment_task_execution,
        comment_ownership=review.comment_ownership,
        comment_project_management=review.comment_project_management,
        comment_client_deliverables=review.comment_client_deliverables,
        comment_communication=review.comment_communication,
        comment_mentoring=review.comment_mentoring,
        comment_competency_skills=review.comment_competency_skills,
        performance_group=review.performance_group,
        impact_statement=review.impact_statement,
        secondary_evaluations=secondary_responses,
        created_at=review.created_at,
        updated_at=review.updated_at,
    )


# =====================================================================
# EMPLOYEE ENDPOINTS
# =====================================================================

@router.get("/mine", response_model=List[MyProjectCard])
def get_my_projects(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    List all projects the current user is assigned to, with review status
    across ALL cycles. Returns one card per (project, cycle). For the
    current cycle a 'pending' card is added if no review exists yet.
    Frontend handles cycle filtering.
    """
    current_cycle = _get_active_cycle(db, current_user.org_id)

    assignments = (
        db.query(ProjectAssignment)
        .join(Project, ProjectAssignment.project_id == Project.id)
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.user_id == current_user.id,
            Project.is_deleted == False,  # noqa: E712
        )
        .all()
    )

    cards: list[MyProjectCard] = []
    for a in assignments:
        project = db.query(Project).filter(Project.id == a.project_id).first()
        if not project:
            continue

        dept = db.query(Department).filter(Department.id == a.department_id).first() if a.department_id else None

        pm_assignment = db.query(ProjectAssignment).filter(
            ProjectAssignment.project_id == a.project_id,
            ProjectAssignment.evaluator_type == "Primary",
        ).first()
        pm_user = db.query(User).filter(User.id == pm_assignment.user_id).first() if pm_assignment else None

        # Get ALL reviews for this user on this project (across all cycles)
        reviews = db.query(ProjectReview).filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.user_id == current_user.id,
            ProjectReview.project_id == a.project_id,
        ).all()

        seen_cycles = set()
        for review in reviews:
            seen_cycles.add(review.cycle)
            cards.append(MyProjectCard(
                review_id=review.id,
                project_id=project.id,
                project_name=project.name,
                project_code=project.project_code,
                project_start_date=project.start_date,
                project_expected_end_date=project.expected_end_date,
                assigned_date=a.assigned_date,
                assignment_role=a.assignment_role,
                department_name=dept.name if dept else None,
                review_status=review.status,
                performance_group=review.performance_group,
                pm_name=pm_user.full_name if pm_user else None,
                cycle=review.cycle,
            ))

        # If no review exists for the current cycle, add a pending card
        if current_cycle not in seen_cycles:
            cards.append(MyProjectCard(
                review_id=None,
                project_id=project.id,
                project_name=project.name,
                project_code=project.project_code,
                project_start_date=project.start_date,
                project_expected_end_date=project.expected_end_date,
                assigned_date=a.assigned_date,
                assignment_role=a.assignment_role,
                department_name=dept.name if dept else None,
                review_status="pending",
                pm_name=pm_user.full_name if pm_user else None,
                cycle=current_cycle,
            ))

    return cards


# =====================================================================
# PM (PRIMARY EVALUATOR) ENDPOINTS
# =====================================================================

@router.get("/pm-queue", response_model=List[PMPendingReviewCard])
def get_pm_evaluation_queue(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    List all team members on projects where the current user is PM, across
    ALL cycles. For each (team_member, project) pair we emit one card per
    existing ProjectReview row (any cycle) plus a placeholder card for the
    active cycle when no review has been created for it yet.

    The frontend defaults its Cycle filter to the active cycle, so by default
    the page shows the same data it always did; switching the filter exposes
    historical evaluations the PM may want to edit or review.
    """
    active_cycle = _get_active_cycle(db, current_user.org_id)

    # Find projects where current user is Primary
    pm_assignments = (
        db.query(ProjectAssignment)
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.user_id == current_user.id,
            ProjectAssignment.evaluator_type == "Primary",
        )
        .all()
    )

    if not pm_assignments:
        return []

    cards: list[PMPendingReviewCard] = []

    for pm_a in pm_assignments:
        project = db.query(Project).filter(
            Project.id == pm_a.project_id,
            Project.is_deleted == False,  # noqa: E712
        ).first()
        if not project:
            continue

        # Get all team members on this project (excluding the PM themselves)
        team_assignments = (
            db.query(ProjectAssignment)
            .filter(
                ProjectAssignment.project_id == pm_a.project_id,
                ProjectAssignment.org_id == current_user.org_id,
                ProjectAssignment.user_id != current_user.id,
            )
            .all()
        )

        for ta in team_assignments:
            user = db.query(User).filter(User.id == ta.user_id).first()
            if not user or user.is_deleted:
                continue

            dept = db.query(Department).filter(Department.id == ta.department_id).first() if ta.department_id else None
            desig = db.query(Designation).filter(Designation.id == user.designation_id).first() if user.designation_id else None

            # All ProjectReview rows for this (team_member, project) across cycles
            reviews = (
                db.query(ProjectReview)
                .filter(
                    ProjectReview.org_id == current_user.org_id,
                    ProjectReview.user_id == ta.user_id,
                    ProjectReview.project_id == pm_a.project_id,
                    ProjectReview.is_deleted == False,  # noqa: E712
                )
                .order_by(ProjectReview.created_at.desc())
                .all()
            )
            cycles_with_review = {r.cycle for r in reviews}

            # One card per existing review (any cycle)
            for review in reviews:
                cards.append(PMPendingReviewCard(
                    review_id=review.id,
                    project_id=project.id,
                    project_name=project.name,
                    project_code=project.project_code,
                    user_id=ta.user_id,
                    employee_name=user.full_name,
                    assignment_role=ta.assignment_role,
                    department_name=dept.name if dept else None,
                    designation_name=desig.name if desig else None,
                    assigned_date=ta.assigned_date,
                    review_status=review.status,
                    performance_group=review.performance_group,
                    cycle=review.cycle,
                    has_draft_content=_pm_review_has_draft_content(review),
                ))

            # Placeholder for the active cycle when no review row exists yet
            if active_cycle not in cycles_with_review:
                cards.append(PMPendingReviewCard(
                    review_id=None,
                    project_id=project.id,
                    project_name=project.name,
                    project_code=project.project_code,
                    user_id=ta.user_id,
                    employee_name=user.full_name,
                    assignment_role=ta.assignment_role,
                    department_name=dept.name if dept else None,
                    designation_name=desig.name if desig else None,
                    assigned_date=ta.assigned_date,
                    review_status=None,
                    performance_group=None,
                    cycle=active_cycle,
                    has_draft_content=False,
                ))

    return cards


@router.get("/role-expectations", response_model=List[RoleExpectationResponse])
def get_role_expectations(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return all role expectations for the org.
    PM uses this as reference while evaluating team members.
    """
    expectations = (
        db.query(RoleExpectation)
        .filter(RoleExpectation.org_id == current_user.org_id)
        .all()
    )

    results: list[RoleExpectationResponse] = []
    for exp in expectations:
        dept = db.query(Department).filter(Department.id == exp.department_id).first()
        desig = db.query(Designation).filter(Designation.id == exp.designation_id).first()
        results.append(RoleExpectationResponse(
            id=exp.id,
            department_name=dept.name if dept else "Unknown",
            designation_name=desig.name if desig else "Unknown",
            exp_task_execution=exp.exp_task_execution,
            exp_ownership=exp.exp_ownership,
            exp_project_management=exp.exp_project_management,
            exp_client_deliverables=exp.exp_client_deliverables,
            exp_communication=exp.exp_communication,
            exp_mentoring=exp.exp_mentoring,
            exp_firm_growth=exp.exp_firm_growth,
            exp_competency_skills=exp.exp_competency_skills,
        ))

    return results


@router.post("/{project_id}/evaluate/{user_id}", response_model=ProjectReviewResponse, status_code=status.HTTP_201_CREATED)
def submit_pm_evaluation(
    project_id: int,
    user_id: int,
    payload: PMEvaluationSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    PM submits evaluation for a specific team member on a specific project.

    Creates the ProjectReview row if it doesn't exist, fills in the
    7 competency comments + performance group + impact, and sets
    status to 'reviewed'. The employee can now see the evaluation.
    """
    cycle = _get_active_cycle(db, current_user.org_id)

    # Verify caller is PM for this project
    pm_assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.user_id == current_user.id,
        ProjectAssignment.evaluator_type == "Primary",
    ).first()

    if not pm_assignment:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Project Manager for this project.",
        )

    # Verify the target user is assigned to this project
    target_assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.user_id == user_id,
    ).first()

    if not target_assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This employee is not assigned to this project.",
        )

    # Can't evaluate yourself
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot evaluate yourself.",
        )

    # Find any existing review row for this (employee, project, cycle).
    # PENDING and DRAFT are both promotable to REVIEWED; only an existing
    # REVIEWED row is a true 409.
    review = db.query(ProjectReview).filter(
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.user_id == user_id,
        ProjectReview.project_id == project_id,
        ProjectReview.cycle == cycle,
    ).first()

    if review and review.status == ProjectReviewStatus.REVIEWED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This employee has already been evaluated for this project this cycle.",
        )

    if review:
        # Promote PENDING / DRAFT row to REVIEWED.
        review.reviewer_id = current_user.id
        review.status = ProjectReviewStatus.REVIEWED.value
        review.comment_task_execution = payload.comment_task_execution
        review.comment_ownership = payload.comment_ownership
        review.comment_project_management = payload.comment_project_management
        review.comment_client_deliverables = payload.comment_client_deliverables
        review.comment_communication = payload.comment_communication
        review.comment_mentoring = payload.comment_mentoring
        review.comment_competency_skills = payload.comment_competency_skills
        review.performance_group = payload.performance_group.value
        review.impact_statement = payload.impact_statement
    else:
        review = ProjectReview(
            org_id=current_user.org_id,
            user_id=user_id,
            project_id=project_id,
            reviewer_id=current_user.id,
            cycle=cycle,
            status=ProjectReviewStatus.REVIEWED.value,
            comment_task_execution=payload.comment_task_execution,
            comment_ownership=payload.comment_ownership,
            comment_project_management=payload.comment_project_management,
            comment_client_deliverables=payload.comment_client_deliverables,
            comment_communication=payload.comment_communication,
            comment_mentoring=payload.comment_mentoring,
            comment_competency_skills=payload.comment_competency_skills,
            performance_group=payload.performance_group.value,
            impact_statement=payload.impact_statement,
        )
        db.add(review)

    db.commit()
    db.refresh(review)

    return _build_review_response(review, db, viewer_user_id=current_user.id)


@router.patch("/{project_id}/evaluate/{user_id}/draft", response_model=ProjectReviewResponse)
def save_pm_evaluation_draft(
    project_id: int,
    user_id: int,
    payload: PMEvaluationDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    PM saves an in-progress evaluation as a DRAFT. Same auth gates as the
    submit endpoint, but the row's status is set to DRAFT and the PM can
    keep editing. Submit (POST /evaluate) promotes DRAFT → REVIEWED.

    All fields in the payload are optional — a half-typed evaluation can
    be parked and resumed later. Fields not present on the payload are
    left as-is on the row.
    """
    cycle = _get_active_cycle(db, current_user.org_id)

    # Same role gate as submit.
    pm_assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.user_id == current_user.id,
        ProjectAssignment.evaluator_type == "Primary",
    ).first()
    if not pm_assignment:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Project Manager for this project.",
        )

    target_assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.user_id == user_id,
    ).first()
    if not target_assignment:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This employee is not assigned to this project.",
        )
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot evaluate yourself.",
        )

    review = db.query(ProjectReview).filter(
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.user_id == user_id,
        ProjectReview.project_id == project_id,
        ProjectReview.cycle == cycle,
    ).first()

    if review and review.status == ProjectReviewStatus.REVIEWED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "This employee has already been evaluated; drafts can no "
                "longer be saved."
            ),
        )

    if not review:
        review = ProjectReview(
            org_id=current_user.org_id,
            user_id=user_id,
            project_id=project_id,
            reviewer_id=current_user.id,
            cycle=cycle,
            status=ProjectReviewStatus.DRAFT.value,
        )
        db.add(review)
    else:
        review.reviewer_id = current_user.id
        review.status = ProjectReviewStatus.DRAFT.value

    # Apply only the fields the client included (partial save).
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        if field == "performance_group" and value is not None:
            # Pydantic model gives us the enum; persist the string value.
            setattr(review, field, value.value if hasattr(value, "value") else value)
        else:
            setattr(review, field, value)

    db.commit()
    db.refresh(review)
    return _build_review_response(review, db, viewer_user_id=current_user.id)


# =====================================================================
# SECONDARY EVALUATOR ENDPOINTS
# =====================================================================

@router.get("/secondary-queue", response_model=List[ProjectReviewResponse])
def get_secondary_evaluation_queue(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    List PM-reviewed reviews on projects where the current user is a
    Secondary evaluator, across ALL cycles. The frontend defaults its
    Cycle filter to the active cycle, so default UX is unchanged; the
    filter exposes historical entries the secondary may want to edit.

    Only `status == reviewed` rows are returned — secondaries write
    impact AFTER the PM has evaluated.
    """
    # Secondary evaluator is now a project-level field (Project.secondary_evaluator_id),
    # not a per-member ProjectAssignment row.
    secondary_projects = (
        db.query(Project.id)
        .filter(
            Project.org_id == current_user.org_id,
            Project.secondary_evaluator_id == current_user.id,
            Project.is_deleted == False,  # noqa: E712
        )
        .all()
    )

    if not secondary_projects:
        return []

    project_ids = [pid for (pid,) in secondary_projects]

    reviews = (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.project_id.in_(project_ids),
            ProjectReview.status == ProjectReviewStatus.REVIEWED.value,
            ProjectReview.user_id != current_user.id,
            ProjectReview.is_deleted == False,  # noqa: E712
        )
        .order_by(ProjectReview.created_at.desc())
        .all()
    )

    return [_build_review_response(r, db, viewer_user_id=current_user.id) for r in reviews]


@router.post("/{review_id}/secondary", response_model=SecondaryEvalResponse, status_code=status.HTTP_201_CREATED)
def submit_secondary_evaluation(
    review_id: int,
    payload: SecondaryEvalSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """Secondary evaluator submits impact statement."""
    review = db.query(ProjectReview).filter(
        ProjectReview.id == review_id,
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.status == ProjectReviewStatus.REVIEWED.value,
    ).first()

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reviewed project review not found.",
        )

    # Verify caller is the project's Secondary evaluator (project-level field).
    project = db.query(Project).filter(
        Project.id == review.project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()

    if not project or project.secondary_evaluator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Secondary evaluator for this project.",
        )

    if review.user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot evaluate yourself.",
        )

    existing = db.query(ProjectReviewEvaluator).filter(
        ProjectReviewEvaluator.project_review_id == review.id,
        ProjectReviewEvaluator.evaluator_id == current_user.id,
    ).first()

    if existing and existing.status == EvaluatorStatus.SUBMITTED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already submitted your evaluation for this review.",
        )

    if existing is not None:
        # Promote draft → submitted.
        existing.status = EvaluatorStatus.SUBMITTED.value
        existing.impact_statement = payload.impact_statement
        evaluator = existing
    else:
        evaluator = ProjectReviewEvaluator(
            org_id=current_user.org_id,
            project_review_id=review.id,
            evaluator_id=current_user.id,
            evaluator_type="Secondary",
            status=EvaluatorStatus.SUBMITTED.value,
            impact_statement=payload.impact_statement,
        )
        db.add(evaluator)
    db.commit()
    db.refresh(evaluator)

    ev_user = db.query(User).filter(User.id == evaluator.evaluator_id).first()
    return SecondaryEvalResponse(
        id=evaluator.id,
        evaluator_id=evaluator.evaluator_id,
        evaluator_name=ev_user.full_name if ev_user else "Unknown",
        impact_statement=evaluator.impact_statement,
        status=evaluator.status,
        created_at=evaluator.created_at,
    )


@router.patch("/{review_id}/secondary/draft", response_model=SecondaryEvalResponse)
def save_secondary_draft(
    review_id: int,
    payload: SecondaryEvalDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Secondary evaluator saves an in-progress impact statement as DRAFT.
    The row uses ``EvaluatorStatus.DRAFT`` so the PM, mentor, and mentee
    don't see it until the evaluator submits via POST /secondary.
    """
    review = db.query(ProjectReview).filter(
        ProjectReview.id == review_id,
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.status == ProjectReviewStatus.REVIEWED.value,
    ).first()
    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reviewed project review not found.",
        )

    project = db.query(Project).filter(
        Project.id == review.project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project or project.secondary_evaluator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Secondary evaluator for this project.",
        )
    if review.user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot evaluate yourself.",
        )

    existing = db.query(ProjectReviewEvaluator).filter(
        ProjectReviewEvaluator.project_review_id == review.id,
        ProjectReviewEvaluator.evaluator_id == current_user.id,
    ).first()
    if existing and existing.status == EvaluatorStatus.SUBMITTED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Your impact statement has already been submitted; drafts "
                "can no longer be saved."
            ),
        )

    if existing is not None:
        if payload.impact_statement is not None:
            existing.impact_statement = payload.impact_statement
        existing.status = EvaluatorStatus.DRAFT.value
        evaluator = existing
    else:
        evaluator = ProjectReviewEvaluator(
            org_id=current_user.org_id,
            project_review_id=review.id,
            evaluator_id=current_user.id,
            evaluator_type="Secondary",
            status=EvaluatorStatus.DRAFT.value,
            impact_statement=payload.impact_statement,
        )
        db.add(evaluator)
    db.commit()
    db.refresh(evaluator)

    ev_user = db.query(User).filter(User.id == evaluator.evaluator_id).first()
    return SecondaryEvalResponse(
        id=evaluator.id,
        evaluator_id=evaluator.evaluator_id,
        evaluator_name=ev_user.full_name if ev_user else "Unknown",
        impact_statement=evaluator.impact_statement,
        status=evaluator.status,
        created_at=evaluator.created_at,
    )


@router.put("/{review_id}/secondary", response_model=SecondaryEvalResponse)
def update_secondary_evaluation(
    review_id: int,
    payload: SecondaryEvalSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """Secondary evaluator updates their previously submitted impact statement."""
    review = db.query(ProjectReview).filter(
        ProjectReview.id == review_id,
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.status == ProjectReviewStatus.REVIEWED.value,
    ).first()

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reviewed project review not found.",
        )

    existing = db.query(ProjectReviewEvaluator).filter(
        ProjectReviewEvaluator.project_review_id == review.id,
        ProjectReviewEvaluator.evaluator_id == current_user.id,
    ).first()

    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No existing secondary evaluation found to update.",
        )

    existing.impact_statement = payload.impact_statement
    db.commit()
    db.refresh(existing)

    ev_user = db.query(User).filter(User.id == existing.evaluator_id).first()
    return SecondaryEvalResponse(
        id=existing.id,
        evaluator_id=existing.evaluator_id,
        evaluator_name=ev_user.full_name if ev_user else "Unknown",
        impact_statement=existing.impact_statement,
        status=existing.status,
        created_at=existing.created_at,
    )


# =====================================================================
# ADMIN OVERVIEW
# =====================================================================

@router.get("/all", response_model=List[ProjectReviewResponse])
def get_all_reviews(
    db: DbSession,
    current_user: CurrentUser,
):
    """Admin-only: list all reviews across the org for the active cycle."""
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can view all reviews.",
        )

    cycle = _get_active_cycle(db, current_user.org_id)

    reviews = (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.cycle == cycle,
            ProjectReview.is_deleted == False,  # noqa: E712
        )
        .order_by(ProjectReview.created_at.desc())
        .all()
    )

    return [_build_review_response(r, db, viewer_user_id=current_user.id) for r in reviews]


# =====================================================================
# ADMIN MANAGEMENT VIEW
# =====================================================================

@router.get("/management", response_model=List[AdminProjectSummary])
def get_management_overview(
    db: DbSession,
    current_user: CurrentUser,
    cycle: Optional[str] = None,
):
    """
    Admin: per-project review completion overview for the active cycle.

    Returns one AdminProjectSummary per project that has non-PM members,
    each containing per-member review status. Uses eager loading to avoid
    N+1 queries — all project/assignment/user/department data is fetched
    in a single query, and a review_map dict provides O(1) lookups.
    """
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin only.",
        )

    resolved_cycle = cycle if cycle else _get_active_cycle(db, current_user.org_id)

    # Single query: projects + assignments + users + departments
    projects = (
        db.query(Project)
        .options(
            joinedload(Project.assignments).joinedload(ProjectAssignment.user),
            joinedload(Project.assignments).joinedload(ProjectAssignment.department),
        )
        .filter(
            Project.org_id == current_user.org_id,
            Project.is_deleted == False,  # noqa: E712
        )
        .all()
    )

    # All reviews for this org + cycle in one query → O(1) dict lookup
    all_reviews = (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.cycle == resolved_cycle,
        )
        .all()
    )
    review_map: dict[tuple[int, int], ProjectReview] = {
        (r.project_id, r.user_id): r for r in all_reviews
    }

    summaries: list[AdminProjectSummary] = []

    for project in projects:
        members: list[AdminMemberReviewRow] = []
        reviewed_count = 0
        pm_name: str | None = None

        for a in project.assignments:
            if not a.user or a.user.is_deleted:
                continue

            if a.evaluator_type == "Primary":
                pm_name = a.user.full_name
                continue  # PM is excluded from the members list

            review = review_map.get((project.id, a.user_id))
            review_status = review.status if review else "not_started"

            if review_status == ProjectReviewStatus.REVIEWED.value:
                reviewed_count += 1

            members.append(AdminMemberReviewRow(
                review_id=review.id if review else None,
                user_id=a.user_id,
                employee_name=a.user.full_name,
                assignment_role=a.assignment_role,
                department_name=a.department.name if a.department else None,
                review_status=review_status,
                performance_group=review.performance_group if review else None,
            ))

        if members:
            summaries.append(AdminProjectSummary(
                project_id=project.id,
                project_name=project.name,
                project_code=project.project_code,
                pm_name=pm_name,
                total_members=len(members),
                reviewed_count=reviewed_count,
                members=members,
            ))

    return summaries


# =====================================================================
# SINGLE REVIEW — GET + PUT (must be LAST — catch-all paths)
# =====================================================================

@router.put("/{review_id}", response_model=ProjectReviewResponse)
def update_review(
    review_id: int,
    payload: PMEvaluationSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    PM (or Admin) edits an already-submitted review.

    Authorization: ONLY the PM who originally wrote the review
    (review.reviewer_id == current_user.id) or an Admin may update it.
    The employee who was reviewed cannot edit it.
    """
    review = db.query(ProjectReview).filter(
        ProjectReview.id == review_id,
        ProjectReview.org_id == current_user.org_id,
    ).first()

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review not found.",
        )

    is_admin = current_user.role == "Admin"
    is_reviewer = review.reviewer_id == current_user.id

    if not (is_reviewer or is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the PM who submitted this review (or an Admin) may edit it.",
        )

    review.comment_task_execution = payload.comment_task_execution
    review.comment_ownership = payload.comment_ownership
    review.comment_project_management = payload.comment_project_management
    review.comment_client_deliverables = payload.comment_client_deliverables
    review.comment_communication = payload.comment_communication
    review.comment_mentoring = payload.comment_mentoring
    review.comment_competency_skills = payload.comment_competency_skills
    review.impact_statement = payload.impact_statement
    review.performance_group = payload.performance_group.value

    db.commit()
    db.refresh(review)

    return _build_review_response(review, db, viewer_user_id=current_user.id)


@router.get("/{review_id}", response_model=ProjectReviewResponse)
def get_review(
    review_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Get a single review. Access control:
    - Employee sees their own review (only after PM evaluates)
    - PM sees any review they wrote
    - Secondary sees reviews on their projects
    - Admin sees everything
    """
    review = db.query(ProjectReview).filter(
        ProjectReview.id == review_id,
        ProjectReview.org_id == current_user.org_id,
    ).first()

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review not found.",
        )

    is_admin = current_user.role == "Admin"
    is_owner = review.user_id == current_user.id
    is_reviewer = review.reviewer_id == current_user.id

    # Check if caller is assigned to same project
    is_on_project = db.query(ProjectAssignment).filter(
        ProjectAssignment.project_id == review.project_id,
        ProjectAssignment.user_id == current_user.id,
        ProjectAssignment.org_id == current_user.org_id,
    ).first() is not None

    if not (is_owner or is_reviewer or is_on_project or is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this review.",
        )

    # Employee can only see their review after PM has evaluated
    if is_owner and not is_admin and review.status != ProjectReviewStatus.REVIEWED.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your review has not been completed yet.",
        )

    return _build_review_response(review, db, viewer_user_id=current_user.id)