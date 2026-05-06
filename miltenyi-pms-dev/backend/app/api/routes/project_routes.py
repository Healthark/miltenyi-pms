"""
Project Routes — HR-managed projects with PM-as-project-level field.

Endpoints:
    GET    /api/v1/projects/                       → List projects (org-scoped, with member counts + PM names)
    POST   /api/v1/projects/                       → Create project + initial assignments
    GET    /api/v1/projects/{project_id}           → Project detail (with assignments)
    PATCH  /api/v1/projects/{project_id}           → Update metadata (incl. swapping PM)
    DELETE /api/v1/projects/{project_id}           → Soft-delete
    POST   /api/v1/projects/{project_id}/assignments
    PATCH  /api/v1/projects/assignments/{assignment_id}
    DELETE /api/v1/projects/assignments/{assignment_id}

Notes:
    - The PM is NOT a project_assignments row. They live on Project.pm_id.
    - The PM must have role=PM (Miltenyi manager).
    - The Secondary evaluator (Project.secondary_evaluator_id) must NOT have
      role=PM or role=Mentor.
    - Both HR roles (HR_MyOrg, HR_Miltenyi) can manage projects.
"""

from typing import List
from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func

from app.api.dependencies import DbSession, CurrentUser
from app.models.project_models import Project, ProjectAssignment
from app.models.user_models import User, Role, ADMIN_ROLES
from app.models.reference_models import Function
from app.schemas.project_schemas import (
    ProjectCreate, ProjectUpdate, ProjectResponse, ProjectDetail,
    AssignmentCreate, AssignmentUpdate, AssignmentResponse,
)

router = APIRouter()


def _require_hr_any(current_user: User) -> None:
    """Both HR roles can manage projects (Miltenyi HR has explicit project edit access)."""
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only HR users can manage projects.",
        )


# ── Validators ──────────────────────────────────────────────────────


def _validate_pm_role(db: DbSession, org_id: int, pm_id: int) -> None:
    """Confirm the user assigned as PM has role=PM (Miltenyi manager)."""
    pm_user = db.query(User).filter(
        User.id == pm_id,
        User.org_id == org_id,
        User.is_deleted == False,  # noqa: E712
    ).first()
    if not pm_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PM user not found in this org.",
        )
    if pm_user.role != Role.PM.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The selected PM user is not a Miltenyi PM (role=PM).",
        )


def _validate_secondary_role(db: DbSession, org_id: int, secondary_id: int) -> None:
    """The Secondary evaluator may be any role except PM and Mentor."""
    user = db.query(User).filter(
        User.id == secondary_id,
        User.org_id == org_id,
        User.is_deleted == False,  # noqa: E712
    ).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Secondary evaluator user not found in this org.",
        )
    if user.role in (Role.PM.value, Role.MENTOR.value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The Secondary evaluator cannot be a PM or Mentor.",
        )


def _validate_member_role(db: DbSession, org_id: int, user_id: int) -> None:
    """Project members must be Staff. PMs and Mentors don't work on projects."""
    user = db.query(User).filter(
        User.id == user_id,
        User.org_id == org_id,
        User.is_deleted == False,  # noqa: E712
    ).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Assignment user {user_id} not found in this org.",
        )
    if user.role in (Role.PM.value, Role.MENTOR.value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="PMs and Mentors cannot be project members.",
        )


# ── Builders ────────────────────────────────────────────────────────


def _build_assignment_response(assignment: ProjectAssignment, db: DbSession) -> AssignmentResponse:
    """Resolve user name and function name for an assignment."""
    user = db.query(User).filter(User.id == assignment.user_id).first()
    func_obj = (
        db.query(Function).filter(Function.id == assignment.function_id).first()
        if assignment.function_id else None
    )

    return AssignmentResponse(
        id=assignment.id,
        project_id=assignment.project_id,
        user_id=assignment.user_id,
        user_name=user.full_name if user else "Unknown",
        assignment_role=assignment.assignment_role,
        function_id=assignment.function_id,
        function_name=func_obj.name if func_obj else None,
        assigned_date=assignment.assigned_date,
        created_at=assignment.created_at,
    )


def _resolve_user_name(db: DbSession, user_id: int | None) -> str | None:
    if not user_id:
        return None
    user = db.query(User).filter(User.id == user_id).first()
    return user.full_name if user else None


def _build_project_response(
    project: Project,
    db: DbSession,
    count: int,
) -> ProjectResponse:
    resp = ProjectResponse.model_validate(project)
    resp.member_count = count
    resp.pm_name = _resolve_user_name(db, project.pm_id)
    resp.secondary_evaluator_name = _resolve_user_name(db, project.secondary_evaluator_id)
    return resp


def _auto_fill_assignment(assignment_in: AssignmentCreate, db: DbSession) -> AssignmentCreate:
    """Auto-fill assignment_role from designation and function_id from user."""
    user = db.query(User).filter(User.id == assignment_in.user_id).first()
    if not user:
        return assignment_in

    if not assignment_in.assignment_role and user.designation_id:
        from app.models.reference_models import Designation
        desig = db.query(Designation).filter(Designation.id == user.designation_id).first()
        if desig:
            assignment_in.assignment_role = desig.name

    if not assignment_in.function_id and user.function_id:
        assignment_in.function_id = user.function_id

    return assignment_in


# =====================================================================
# PROJECT CRUD
# =====================================================================

@router.get("/", response_model=List[ProjectResponse])
def list_projects(
    db: DbSession,
    current_user: CurrentUser,
):
    """List all active projects with member counts."""
    _require_hr_any(current_user)

    projects = (
        db.query(Project)
        .filter(
            Project.org_id == current_user.org_id,
            Project.is_deleted == False,  # noqa: E712
        )
        .order_by(Project.created_at.desc())
        .all()
    )

    count_map = dict(
        db.query(ProjectAssignment.project_id, func.count(ProjectAssignment.id))
        .filter(ProjectAssignment.org_id == current_user.org_id)
        .group_by(ProjectAssignment.project_id)
        .all()
    )

    return [
        _build_project_response(p, db, count_map.get(p.id, 0))
        for p in projects
    ]


@router.post("/", response_model=ProjectDetail, status_code=status.HTTP_201_CREATED)
def create_project(
    project_in: ProjectCreate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Create a project with an assigned PM and optional team members."""
    _require_hr_any(current_user)

    existing = db.query(Project).filter(
        Project.org_id == current_user.org_id,
        Project.project_code == project_in.project_code,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Project code '{project_in.project_code}' already exists.",
        )

    # Role validation
    _validate_pm_role(db, current_user.org_id, project_in.pm_id)
    if project_in.secondary_evaluator_id is not None:
        _validate_secondary_role(db, current_user.org_id, project_in.secondary_evaluator_id)
    for a in project_in.assignments:
        _validate_member_role(db, current_user.org_id, a.user_id)

    new_project = Project(
        org_id=current_user.org_id,
        project_code=project_in.project_code,
        name=project_in.name,
        description=project_in.description,
        start_date=project_in.start_date,
        expected_end_date=project_in.expected_end_date,
        pm_id=project_in.pm_id,
        secondary_evaluator_id=project_in.secondary_evaluator_id,
    )
    db.add(new_project)
    db.flush()

    for assignment_in in project_in.assignments:
        assignment_in = _auto_fill_assignment(assignment_in, db)
        db.add(ProjectAssignment(
            org_id=current_user.org_id,
            project_id=new_project.id,
            user_id=assignment_in.user_id,
            assignment_role=assignment_in.assignment_role,
            function_id=assignment_in.function_id,
            assigned_date=assignment_in.assigned_date,
        ))

    db.commit()
    db.refresh(new_project)

    assignment_responses = [_build_assignment_response(a, db) for a in new_project.assignments]

    return ProjectDetail(
        id=new_project.id,
        org_id=new_project.org_id,
        project_code=new_project.project_code,
        name=new_project.name,
        description=new_project.description,
        start_date=new_project.start_date,
        expected_end_date=new_project.expected_end_date,
        pm_id=new_project.pm_id,
        pm_name=_resolve_user_name(db, new_project.pm_id),
        secondary_evaluator_id=new_project.secondary_evaluator_id,
        secondary_evaluator_name=_resolve_user_name(db, new_project.secondary_evaluator_id),
        is_deleted=new_project.is_deleted,
        created_at=new_project.created_at,
        updated_at=new_project.updated_at,
        member_count=len(assignment_responses),
        assignments=assignment_responses,
    )


@router.get("/{project_id}", response_model=ProjectDetail)
def get_project_detail(
    project_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """Get a project with all team assignments."""
    _require_hr_any(current_user)

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    assignment_responses = [_build_assignment_response(a, db) for a in project.assignments]

    return ProjectDetail(
        id=project.id,
        org_id=project.org_id,
        project_code=project.project_code,
        name=project.name,
        description=project.description,
        start_date=project.start_date,
        expected_end_date=project.expected_end_date,
        pm_id=project.pm_id,
        pm_name=_resolve_user_name(db, project.pm_id),
        secondary_evaluator_id=project.secondary_evaluator_id,
        secondary_evaluator_name=_resolve_user_name(db, project.secondary_evaluator_id),
        is_deleted=project.is_deleted,
        created_at=project.created_at,
        updated_at=project.updated_at,
        member_count=len(assignment_responses),
        assignments=assignment_responses,
    )


@router.patch("/{project_id}", response_model=ProjectResponse)
def update_project(
    project_id: int,
    project_in: ProjectUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Update project metadata. Can swap PM or Secondary."""
    _require_hr_any(current_user)

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    update_data = project_in.model_dump(exclude_unset=True)

    if "project_code" in update_data and update_data["project_code"] != project.project_code:
        existing = db.query(Project).filter(
            Project.org_id == current_user.org_id,
            Project.project_code == update_data["project_code"],
            Project.is_deleted == False,  # noqa: E712
            Project.id != project_id,
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Project code '{update_data['project_code']}' already exists.",
            )

    # Role validation on incoming pm_id / secondary_evaluator_id (if changing).
    if "pm_id" in update_data and update_data["pm_id"] is not None:
        _validate_pm_role(db, current_user.org_id, update_data["pm_id"])
    if (
        "secondary_evaluator_id" in update_data
        and update_data["secondary_evaluator_id"] is not None
    ):
        _validate_secondary_role(db, current_user.org_id, update_data["secondary_evaluator_id"])

    # Reviewer disjointness: PM and Secondary must be different people in the
    # post-merge state.
    final_pm = update_data.get("pm_id", project.pm_id)
    final_secondary = update_data.get(
        "secondary_evaluator_id", project.secondary_evaluator_id,
    )
    if (
        final_pm is not None
        and final_secondary is not None
        and final_pm == final_secondary
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Secondary Evaluator must be a different user than the PM.",
        )

    for field, value in update_data.items():
        setattr(project, field, value)

    db.commit()
    db.refresh(project)

    count = db.query(func.count(ProjectAssignment.id)).filter(
        ProjectAssignment.project_id == project.id
    ).scalar() or 0

    return _build_project_response(project, db, count)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project(
    project_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """Soft-delete a project."""
    _require_hr_any(current_user)

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    project.is_deleted = True
    db.commit()
    return None


# =====================================================================
# ASSIGNMENT CRUD
# =====================================================================

@router.post("/{project_id}/assignments", response_model=AssignmentResponse, status_code=status.HTTP_201_CREATED)
def add_assignment(
    project_id: int,
    assignment_in: AssignmentCreate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Add a team member to a project. Auto-fills role and function from user profile."""
    _require_hr_any(current_user)

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    if assignment_in.user_id == project.pm_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The PM is not a project member; do not add them via assignments.",
        )

    _validate_member_role(db, current_user.org_id, assignment_in.user_id)

    existing = db.query(ProjectAssignment).filter(
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.user_id == assignment_in.user_id,
        ProjectAssignment.org_id == current_user.org_id,
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This user is already assigned to this project.",
        )

    assignment_in = _auto_fill_assignment(assignment_in, db)

    new_assignment = ProjectAssignment(
        org_id=current_user.org_id,
        project_id=project_id,
        user_id=assignment_in.user_id,
        assignment_role=assignment_in.assignment_role,
        function_id=assignment_in.function_id,
        assigned_date=assignment_in.assigned_date,
    )
    db.add(new_assignment)
    db.commit()
    db.refresh(new_assignment)

    return _build_assignment_response(new_assignment, db)


@router.patch("/assignments/{assignment_id}", response_model=AssignmentResponse)
def update_assignment(
    assignment_id: int,
    assignment_in: AssignmentUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Update a member's project role, function, or assigned date."""
    _require_hr_any(current_user)

    assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.id == assignment_id,
        ProjectAssignment.org_id == current_user.org_id,
    ).first()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")

    update_data = assignment_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(assignment, field, value)

    db.commit()
    db.refresh(assignment)

    return _build_assignment_response(assignment, db)


@router.delete("/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_assignment(
    assignment_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """Remove a member from a project."""
    _require_hr_any(current_user)

    assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.id == assignment_id,
        ProjectAssignment.org_id == current_user.org_id,
    ).first()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")

    db.delete(assignment)
    db.commit()
    return None
