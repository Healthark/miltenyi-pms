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
from app.core.cycle_utils import cycle_date_range, parse_cycle_name
from app.models.project_models import (
    Project, ProjectAssignment, PROJECT_STATUS_COMPLETED,
)
from app.models.project_review_models import (
    ProjectReview, ProjectReviewStatus,
    ProjectReviewEvaluator, EvaluatorStatus,
)
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User, ADMIN_ROLES
from app.models.reference_models import Function, Designation
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


def _get_fiscal_start_month(db: DbSession, org_id: int) -> int:
    """Return the org's fiscal_start_month (default 4 if settings missing)."""
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == org_id
    ).first()
    return settings.fiscal_start_month if settings else 4


def _assignment_active_for_cycle(
    assignment: ProjectAssignment,
    cycle_name: str,
    fiscal_start_month: int,
) -> bool:
    """Did this assignment's stint overlap the cycle's review window?

    True iff:
        assigned_date is on or before cycle_end, AND
        end_date is NULL or on or after cycle_start.

    For annual orgs (no cycle code in the name), this is permissive —
    we have no review window to enforce, so assignment-state-at-now is
    the only signal.
    """
    parsed = parse_cycle_name(cycle_name)
    if parsed is None:
        # Annual cadence: no per-cycle window to check. Anyone whose
        # assignment isn't entirely in the future and isn't already
        # ended counts as active.
        return assignment.end_date is None
    code, fy = parsed
    cycle_start, cycle_end = cycle_date_range(code, fy, fiscal_start_month)
    if assignment.assigned_date and assignment.assigned_date > cycle_end:
        return False
    if assignment.end_date and assignment.end_date < cycle_start:
        return False
    return True


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
    current cycle a 'pending' card is added if no review exists yet —
    but only when the assignment is currently active and the project is
    not completed. Removed-from-project users still see their past
    reviews; they just don't get fresh placeholders.

    Across stints (re-joined the same project later), each
    ProjectAssignment row contributes its own pending placeholder for
    the active cycle if it overlaps that window.
    """
    current_cycle = _get_active_cycle(db, current_user.org_id)
    fiscal_start = _get_fiscal_start_month(db, current_user.org_id)

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
    # Reviews are independent of assignment rows (they FK directly to
    # user_id + project_id), so we only emit each existing review once
    # per project — even if the user has multiple stints on it.
    seen_review_ids: set[int] = set()

    for a in assignments:
        project = db.query(Project).filter(Project.id == a.project_id).first()
        if not project:
            continue

        func_obj = db.query(Function).filter(Function.id == a.function_id).first() if a.function_id else None

        # PM lives on the project, not in assignments
        pm_user = (
            db.query(User).filter(User.id == project.pm_id).first()
            if project.pm_id else None
        )

        # Get ALL reviews for this user on this project (across all cycles).
        reviews = db.query(ProjectReview).filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.user_id == current_user.id,
            ProjectReview.project_id == a.project_id,
        ).all()

        for review in reviews:
            if review.id in seen_review_ids:
                continue
            seen_review_ids.add(review.id)
            cards.append(MyProjectCard(
                review_id=review.id,
                project_id=project.id,
                project_name=project.name,
                project_code=project.project_code,
                project_start_date=project.start_date,
                project_expected_end_date=project.expected_end_date,
                assigned_date=a.assigned_date,
                assignment_role=a.assignment_role,
                function_name=func_obj.name if func_obj else None,
                review_status=review.status,
                performance_group=review.performance_group,
                pm_name=pm_user.full_name if pm_user else None,
                cycle=review.cycle,
            ))

        # Active-cycle placeholder only when:
        #   - the project is still active (not completed), AND
        #   - this assignment is currently active (end_date IS NULL), AND
        #   - this assignment overlaps the current cycle's window, AND
        #   - no review row exists yet for this (user, project, current_cycle).
        if project.status == PROJECT_STATUS_COMPLETED:
            continue
        if a.end_date is not None:
            continue
        if not _assignment_active_for_cycle(a, current_cycle, fiscal_start):
            continue
        already_has_review = any(r.cycle == current_cycle for r in reviews)
        if already_has_review:
            continue

        cards.append(MyProjectCard(
            review_id=None,
            project_id=project.id,
            project_name=project.name,
            project_code=project.project_code,
            project_start_date=project.start_date,
            project_expected_end_date=project.expected_end_date,
            assigned_date=a.assigned_date,
            assignment_role=a.assignment_role,
            function_name=func_obj.name if func_obj else None,
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
    fiscal_start = _get_fiscal_start_month(db, current_user.org_id)

    # Find projects where current user is the PM (project-level FK).
    # Skip completed projects — past reviews remain editable through the
    # admin All Reviews surface, but the PM's queue should only show
    # projects that are still operational.
    pm_projects = (
        db.query(Project)
        .filter(
            Project.org_id == current_user.org_id,
            Project.pm_id == current_user.id,
            Project.is_deleted == False,  # noqa: E712
            Project.status != PROJECT_STATUS_COMPLETED,
        )
        .all()
    )

    if not pm_projects:
        return []

    cards: list[PMPendingReviewCard] = []

    for project in pm_projects:
        # All assignment rows for this project — including end-dated ones,
        # because the PM may still need to write up the cycle a person was
        # removed in. We filter the placeholder logic per-row below.
        team_assignments = (
            db.query(ProjectAssignment)
            .filter(
                ProjectAssignment.project_id == project.id,
                ProjectAssignment.org_id == current_user.org_id,
            )
            .all()
        )

        seen_review_ids: set[int] = set()

        for ta in team_assignments:
            user = db.query(User).filter(User.id == ta.user_id).first()
            if not user or user.is_deleted:
                continue

            func_obj = db.query(Function).filter(Function.id == ta.function_id).first() if ta.function_id else None
            desig = db.query(Designation).filter(Designation.id == user.designation_id).first() if user.designation_id else None

            # All ProjectReview rows for this (team_member, project) across cycles
            reviews = (
                db.query(ProjectReview)
                .filter(
                    ProjectReview.org_id == current_user.org_id,
                    ProjectReview.user_id == ta.user_id,
                    ProjectReview.project_id == project.id,
                    ProjectReview.is_deleted == False,  # noqa: E712
                )
                .order_by(ProjectReview.created_at.desc())
                .all()
            )
            cycles_with_review = {r.cycle for r in reviews}

            # One card per existing review (any cycle). Reviews are FK'd to
            # (user, project) — independent of which assignment stint, so we
            # de-dup by review.id across stints.
            for review in reviews:
                if review.id in seen_review_ids:
                    continue
                seen_review_ids.add(review.id)
                cards.append(PMPendingReviewCard(
                    review_id=review.id,
                    project_id=project.id,
                    project_name=project.name,
                    project_code=project.project_code,
                    user_id=ta.user_id,
                    employee_name=user.full_name,
                    assignment_role=ta.assignment_role,
                    function_name=func_obj.name if func_obj else None,
                    designation_name=desig.name if desig else None,
                    assigned_date=ta.assigned_date,
                    review_status=review.status,
                    performance_group=review.performance_group,
                    cycle=review.cycle,
                    has_draft_content=_pm_review_has_draft_content(review),
                ))

            # Placeholder for the active cycle is generated only when:
            #   - this assignment row is currently active (end_date IS NULL),
            #     so the person is still on the project today; AND
            #   - this assignment overlapped the active cycle's window; AND
            #   - no review row exists yet for that cycle.
            #
            # End-dated assignments contribute to the PM queue *only* through
            # their existing review rows above — letting the PM finish a
            # partial-period review without creating brand new ones.
            if ta.end_date is None \
               and _assignment_active_for_cycle(ta, active_cycle, fiscal_start) \
               and active_cycle not in cycles_with_review:
                cards.append(PMPendingReviewCard(
                    review_id=None,
                    project_id=project.id,
                    project_name=project.name,
                    project_code=project.project_code,
                    user_id=ta.user_id,
                    employee_name=user.full_name,
                    assignment_role=ta.assignment_role,
                    function_name=func_obj.name if func_obj else None,
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
        func_obj = db.query(Function).filter(Function.id == exp.function_id).first()
        desig = db.query(Designation).filter(Designation.id == exp.designation_id).first()
        results.append(RoleExpectationResponse(
            id=exp.id,
            function_name=func_obj.name if func_obj else "Unknown",
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
    fiscal_start = _get_fiscal_start_month(db, current_user.org_id)

    # Verify caller is the PM for this project (project-level field).
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project or project.pm_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Project Manager for this project.",
        )

    # Verify the target user has at least one assignment row for this
    # project (active or historical). Multiple rows are possible across
    # re-joins; any one is enough to anchor a review.
    user_assignments = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.user_id == user_id,
    ).all()

    if not user_assignments:
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

    # Lifecycle gate: refuse to *create* a new review row when the
    # project is completed or no stint covered this cycle. Editing an
    # already-existing draft / pending row is always allowed (so the PM
    # can finish a partial-period review for someone who was removed
    # mid-cycle, and HR can backfill via the PM after completion).
    if review is None:
        if project.status == PROJECT_STATUS_COMPLETED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot create new reviews on a completed project.",
            )
        any_overlap = any(
            _assignment_active_for_cycle(a, cycle, fiscal_start)
            for a in user_assignments
        )
        if not any_overlap:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This employee was not on the project during this cycle.",
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
    fiscal_start = _get_fiscal_start_month(db, current_user.org_id)

    # Same role gate as submit (PM lives on the project, not in assignments).
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project or project.pm_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Project Manager for this project.",
        )

    user_assignments = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.user_id == user_id,
    ).all()
    if not user_assignments:
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

    # Same lifecycle gate as submit_pm_evaluation: don't allow new draft
    # rows on completed projects or for cycles a stint didn't cover.
    if review is None:
        if project.status == PROJECT_STATUS_COMPLETED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot create new reviews on a completed project.",
            )
        any_overlap = any(
            _assignment_active_for_cycle(a, cycle, fiscal_start)
            for a in user_assignments
        )
        if not any_overlap:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This employee was not on the project during this cycle.",
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


# =====================================================================
# MENTOR ENDPOINTS (read-only view of mentees' project reviews)
# =====================================================================

@router.get("/mentees", response_model=List[ProjectReviewResponse])
def get_mentees_project_reviews(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    List every ProjectReview row where the reviewee is one of the
    caller's direct mentees, across ALL cycles. View-only — mentors
    can read but not submit / edit project reviews.

    Returns both pending and reviewed rows so the mentor can see the
    full picture (including which evaluations are still outstanding).
    Pending rows have null PM comments + null performance_group; the
    frontend renders them as "Pending PM evaluation".
    """
    mentee_ids = [
        uid for (uid,) in db.query(User.id).filter(
            User.mentor_id == current_user.id,
            User.org_id == current_user.org_id,
            User.is_deleted == False,  # noqa: E712
        ).all()
    ]

    if not mentee_ids:
        return []

    reviews = (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.user_id.in_(mentee_ids),
            ProjectReview.is_deleted == False,  # noqa: E712
        )
        .order_by(
            ProjectReview.cycle.desc(),
            ProjectReview.created_at.desc(),
        )
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
    """HR-only: list all project reviews across the org, every cycle.

    Both HR_MyOrg and HR_Miltenyi may read this — Miltenyi HR explicitly
    has visibility into project reviews per the role spec. Returns every
    cycle so the frontend can render a full read-only history with a
    cycle filter; previously this was scoped to the active cycle.
    """
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only HR users can view all reviews.",
        )

    reviews = (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.is_deleted == False,  # noqa: E712
        )
        .order_by(
            ProjectReview.cycle.desc(),
            ProjectReview.created_at.desc(),
        )
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
    N+1 queries — all project/assignment/user/function data is fetched
    in a single query, and a review_map dict provides O(1) lookups.
    """
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="HR only.",
        )

    resolved_cycle = cycle if cycle else _get_active_cycle(db, current_user.org_id)

    # Single query: projects + assignments + users + functions
    projects = (
        db.query(Project)
        .options(
            joinedload(Project.assignments).joinedload(ProjectAssignment.user),
            joinedload(Project.assignments).joinedload(ProjectAssignment.function),
            joinedload(Project.pm),
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
        pm_name: str | None = project.pm.full_name if project.pm else None

        for a in project.assignments:
            if not a.user or a.user.is_deleted:
                continue

            review = review_map.get((project.id, a.user_id))
            review_status = review.status if review else "not_started"

            if review_status == ProjectReviewStatus.REVIEWED.value:
                reviewed_count += 1

            members.append(AdminMemberReviewRow(
                review_id=review.id if review else None,
                user_id=a.user_id,
                employee_name=a.user.full_name,
                assignment_role=a.assignment_role,
                function_name=a.function.name if a.function else None,
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

    is_admin = current_user.role == "HR_MyOrg"  # HR_Miltenyi is read-only on reviews
    is_reviewer = review.reviewer_id == current_user.id

    if not (is_reviewer or is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the PM who submitted this review (or MyOrg HR) may edit it.",
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
    - Mentor sees reviews of their direct mentees (view-only)
    - HR (either) sees everything
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

    # Both HR roles may read any review (Miltenyi HR has explicit project-review visibility).
    is_admin = current_user.role in ADMIN_ROLES
    is_owner = review.user_id == current_user.id
    is_reviewer = review.reviewer_id == current_user.id

    # Check if caller is assigned to same project
    is_on_project = db.query(ProjectAssignment).filter(
        ProjectAssignment.project_id == review.project_id,
        ProjectAssignment.user_id == current_user.id,
        ProjectAssignment.org_id == current_user.org_id,
    ).first() is not None

    # Check if caller is the mentor of the reviewee (view-only access).
    owner = db.query(User).filter(User.id == review.user_id).first()
    is_mentor_of_owner = owner is not None and owner.mentor_id == current_user.id

    if not (is_owner or is_reviewer or is_on_project or is_admin or is_mentor_of_owner):
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