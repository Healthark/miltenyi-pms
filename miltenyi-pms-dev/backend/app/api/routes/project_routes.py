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
    - The Secondary evaluator (Project.secondary_evaluator_id) must be EITHER
      role=PM or role=HR_Miltenyi. Employees / Mentors / HR_MyOrg are not
      eligible — the impact statement is a Miltenyi-side editorial gate, and
      narrowing the pool to PMs + Miltenyi HR keeps it inside that team's
      management chain. (Historical projects may carry legacy values from
      before this rule was tightened; `update_project` skips re-validating
      when `secondary_evaluator_id` is unchanged so those rows still save.)
    - Both HR roles (HR_MyOrg, HR_Miltenyi) can manage projects.
"""

from datetime import date, datetime, timezone
from typing import List, Literal, Optional
from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, status
from sqlalchemy import extract, func, or_
from sqlalchemy.orm import aliased

from app.api.dependencies import DbSession, CurrentUser
from app.services.notification_service import notify, notify_many
from app.core.cycle_utils import resolve_today
from app.models.project_models import (
    Project, ProjectAssignment,
    PROJECT_STATUS_ACTIVE, PROJECT_STATUS_COMPLETED,
)
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User, Role, ADMIN_ROLES
from app.models.reference_models import Function
from app.schemas.project_schemas import (
    ProjectCreate, ProjectUpdate, ProjectResponse, ProjectDetail,
    AssignmentCreate, AssignmentUpdate, AssignmentResponse,
)
from app.schemas.pagination import Paginated
# Single-source the PM cascade helper in admin_routes — same pattern
# the mentor backfill script uses (`from app.api.routes.admin_routes
# import _cascade_mentor_reassignment`). Keeps the cascade logic
# co-located with the user-lifecycle code that also calls it from
# deactivate_user + update_user.
from app.api.routes.admin_routes import _cascade_pm_reassignment

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
    """The Secondary evaluator may ONLY be role=PM or role=HR_Miltenyi.

    Previously this allowed anyone except PM + Mentor (i.e. HR_MyOrg /
    HR_Miltenyi / Employee). The pool was narrowed because the impact
    statement is a Miltenyi-side editorial gate — opening it to Employees
    or to Healthark's HR diluted that intent. The disjoint check on
    Project.pm_id covers the "can't be the PM of THIS project" case for
    the PM-as-Secondary scenario (a PM may secondary on other projects
    they don't manage, just not their own).
    """
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
    if user.role not in (Role.PM.value, Role.HR_MILTENYI.value):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The Secondary evaluator must be a PM or a Miltenyi HR user.",
        )


def _validate_assigned_date_window(
    *,
    assigned_date: Optional[date],
    project_start: Optional[date],
    project_end: Optional[date],
    user_label: str,
) -> None:
    """A team member's joined date must fall inside the project's date
    window when both endpoints are known. `assigned_date is None` is
    allowed (HR hasn't recorded a start date yet) and any open end of
    the window (start or end unset) is treated as unconstrained on
    that side.

    Reused by `create_project`'s inline-assignments loop and by
    `add_assignment` — keeping the rule single-sourced so the two
    surfaces can't drift."""
    if assigned_date is None:
        return
    if project_start is not None and assigned_date < project_start:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Joined date for {user_label} is before the project's "
                f"start date ({project_start.isoformat()})."
            ),
        )
    if project_end is not None and assigned_date > project_end:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Joined date for {user_label} is after the project's "
                f"expected end date ({project_end.isoformat()})."
            ),
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
    ended_by = (
        db.query(User).filter(User.id == assignment.ended_by_id).first()
        if assignment.ended_by_id else None
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
        end_date=assignment.end_date,
        ended_by_name=ended_by.full_name if ended_by else None,
        created_at=assignment.created_at,
    )


def _resolve_user_name(db: DbSession, user_id: int | None) -> str | None:
    """Resolve a user_id to full_name, skipping deactivated rows.

    Deactivated users keep their row for audit but should not appear in
    operational project surfaces (HR list, employee project cards, etc.).
    `admin_routes.deactivate_user` cascades `Project.pm_id` and
    `Project.secondary_evaluator_id` to NULL on deactivation, which would
    short-circuit on the `if not user_id` check above — this is the
    belt-and-braces filter for any row that pre-dates that cascade.
    """
    if not user_id:
        return None
    user = (
        db.query(User)
        .filter(
            User.id == user_id,
            User.is_deleted == False,  # noqa: E712
        )
        .first()
    )
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
    resp.completed_by_name = _resolve_user_name(db, project.completed_by_id)
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
    include_completed: bool = False,
):
    """List projects with member counts.

    Defaults to active-only. Pass `?include_completed=true` to include
    archived projects (HR can use this when reviewing or re-opening).
    `is_deleted` (hard-wipe) rows are always excluded.
    """
    _require_hr_any(current_user)

    q = db.query(Project).filter(
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    )
    if not include_completed:
        q = q.filter(Project.status == PROJECT_STATUS_ACTIVE)

    projects = q.order_by(Project.created_at.desc()).all()

    # Member counts only consider active assignments — completed projects
    # will report 0 here since their members are end-dated. That matches
    # what the UI wants ("how many people work on this today").
    count_map = dict(
        db.query(ProjectAssignment.project_id, func.count(ProjectAssignment.id))
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.end_date.is_(None),
        )
        .group_by(ProjectAssignment.project_id)
        .all()
    )

    return [
        _build_project_response(p, db, count_map.get(p.id, 0))
        for p in projects
    ]


# ── Paginated project listing ──────────────────────────────────────────
# `_PROJECTS_SORT_COLUMNS` maps the frontend `ProjectsSortKey` union to
# server-side SQLAlchemy columns. Derived columns (pm_name,
# member_count) involve user joins / count subqueries — those headers
# stay non-sortable, matching the goal_routes `/all` deferred-sort
# pattern.
_PROJECTS_SORT_COLUMNS = {
    "name":         Project.name,
    "project_code": Project.project_code,
    "start_date":   Project.start_date,
    "created_at":   Project.created_at,
    "status":       Project.status,
}

# Mirrors frontend's `(No PM)` sentinel — same shape as UsersTab's
# `(No mentor)`. Parens + leading space guarantee no collision with
# a real user full_name.
_PROJECTS_NO_PM_SENTINEL = "(No PM)"


@router.get("/paginated", response_model=Paginated[ProjectResponse])
def list_projects_paginated(
    db: DbSession,
    current_user: CurrentUser,
    limit: int = Query(
        50,
        ge=1,
        le=200,
        description=(
            "Maximum projects to return on this page. Server-clamped "
            "to 1..200 (matches every other paginated endpoint)."
        ),
    ),
    offset: int = Query(
        0,
        ge=0,
        description="Projects to skip before this page.",
    ),
    search: Optional[str] = Query(
        None,
        description=(
            "Case-insensitive substring across name + project_code."
        ),
    ),
    status_: Optional[str] = Query(
        None,
        alias="status",
        description=(
            "'active' / 'completed' / 'all'. Omitted treated as 'all' "
            "(returns both active + completed; hard-deleted always "
            "excluded)."
        ),
    ),
    pm_name: Optional[str] = Query(
        None,
        description=(
            "Exact match on the PM's full_name. The special value "
            "`(No PM)` matches rows whose `pm_id` is NULL — same "
            "sentinel the ProjectsTab PM filter uses."
        ),
    ),
    start_year: Optional[int] = Query(
        None,
        description=(
            "Filter on EXTRACT(year FROM start_date). NULL-start_date "
            "rows are excluded when this filter is set."
        ),
    ),
    sort_by: Optional[
        Literal["name", "project_code", "start_date", "created_at", "status"]
    ] = Query(
        None,
        description=(
            "Sort column. Direct project-attribute columns only; "
            "pm_name + member_count sorts are deferred."
        ),
    ),
    sort_dir: Literal["asc", "desc"] = Query(
        "asc",
        description="Sort direction. Default 'asc'.",
    ),
):
    """HR-only paginated project listing — companion to the
    unpaginated `GET /projects/` above.

    The unpaginated endpoint is preserved unchanged for callers that
    need the full project list (dropdown options: `useOrgProjectNames`
    and ProjectsTab's own filter-option derivation). This endpoint
    serves ProjectsTab's row query with proper server-side pagination
    + filtering + sort, so the admin table stays performant as the
    project count scales past current seed-org sizes.

    Two-query pattern matches `admin_routes.list_users_paginated`:
      1. Apply filters + sort to a Project query.
      2. `total` = `.count()` over the filtered query.
      3. Page slice = `.offset().limit().all()`.
      4. Batched member-count + name resolution for the page slice
         only — the unpaginated endpoint resolves these org-wide; we
         scope to the returned project_ids.
    """
    _require_hr_any(current_user)

    projects_q = db.query(Project).filter(
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    )

    if status_ and status_ != "all":
        projects_q = projects_q.filter(Project.status == status_)

    if search:
        like = f"%{search.strip()}%"
        projects_q = projects_q.filter(
            or_(
                Project.name.ilike(like),
                Project.project_code.ilike(like),
            )
        )

    if pm_name:
        if pm_name == _PROJECTS_NO_PM_SENTINEL:
            projects_q = projects_q.filter(Project.pm_id.is_(None))
        else:
            PMAlias = aliased(User)
            projects_q = projects_q.join(
                PMAlias, PMAlias.id == Project.pm_id,
            ).filter(
                PMAlias.full_name == pm_name,
                # Deactivated PMs would have their pm_id null'd out by
                # the cascade in admin_routes.deactivate_user; this
                # check protects pre-cascade rows.
                PMAlias.is_deleted == False,  # noqa: E712
            )

    if start_year is not None:
        # EXTRACT works against the start_date Date column. Rows with
        # NULL start_date naturally drop out — that matches the
        # legacy client-side filter's behaviour exactly.
        projects_q = projects_q.filter(
            extract("year", Project.start_date) == start_year
        )

    # ── Sort ────────────────────────────────────────────────────────────
    if sort_by is None:
        # Default mirrors the unpaginated endpoint's implicit ordering.
        projects_q = projects_q.order_by(
            Project.created_at.desc(), Project.id.asc(),
        )
    else:
        sort_column = _PROJECTS_SORT_COLUMNS[sort_by]
        primary = sort_column.asc() if sort_dir == "asc" else sort_column.desc()
        projects_q = projects_q.order_by(primary, Project.id.asc())

    total_projects = projects_q.with_entities(Project.id).count()

    page_projects = projects_q.offset(offset).limit(limit).all()
    page_project_ids = [p.id for p in page_projects]

    # Member counts only for the page slice. Same active-assignment
    # filter the unpaginated endpoint uses (end_date IS NULL).
    if page_project_ids:
        count_map = dict(
            db.query(
                ProjectAssignment.project_id,
                func.count(ProjectAssignment.id),
            )
            .filter(
                ProjectAssignment.org_id == current_user.org_id,
                ProjectAssignment.project_id.in_(page_project_ids),
                ProjectAssignment.end_date.is_(None),
            )
            .group_by(ProjectAssignment.project_id)
            .all()
        )
    else:
        count_map = {}

    items = [
        _build_project_response(p, db, count_map.get(p.id, 0))
        for p in page_projects
    ]

    return Paginated[ProjectResponse](
        items=items,
        total=total_projects,
        limit=limit,
        offset=offset,
        has_more=(offset + len(items)) < total_projects,
    )


@router.post("/", response_model=ProjectDetail, status_code=status.HTTP_201_CREATED)
def create_project(
    project_in: ProjectCreate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Create a project with an assigned PM and optional team members."""
    _require_hr_any(current_user)

    # Case-insensitive uniqueness — "PRJ-001" and "prj-001" must not
    # coexist. Whitespace was already stripped by the Pydantic
    # `_strip_or_none` pre-validator before this point.
    existing = db.query(Project).filter(
        Project.org_id == current_user.org_id,
        func.lower(Project.project_code) == project_in.project_code.lower(),
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
        # Joined-date sanity vs the parent project window. Pydantic can't
        # check this at the schema level — assignment validation runs
        # before the parent model's fields are bound. Doing it here keeps
        # the rule co-located with the other cross-field checks.
        _validate_assigned_date_window(
            assigned_date=a.assigned_date,
            project_start=project_in.start_date,
            project_end=project_in.expected_end_date,
            user_label=f"user {a.user_id}",
        )

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

    # Tell the assigned Secondary they have an impact statement to write on
    # this project's review cycle. Without this they'd find out only by
    # stumbling onto the Project Reviews page.
    if new_project.secondary_evaluator_id is not None:
        notify(
            db,
            org_id=current_user.org_id,
            recipient_id=new_project.secondary_evaluator_id,
            sender_id=current_user.id,
            module="project_review",
            entity_type="project",
            entity_id=new_project.id,
            message=(
                f"You were assigned as Secondary evaluator on {new_project.name}."
            ),
            entity_url=f"/projects/{new_project.id}",
        )
        db.commit()

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
        status=new_project.status,
        completed_at=new_project.completed_at,
        completed_by_name=_resolve_user_name(db, new_project.completed_by_id),
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

    # Sort: active assignments first, then end-dated ones (newest end first).
    sorted_assignments = sorted(
        project.assignments,
        key=lambda a: (a.end_date is not None, -(a.end_date.toordinal() if a.end_date else 0)),
    )
    assignment_responses = [_build_assignment_response(a, db) for a in sorted_assignments]
    active_count = sum(1 for a in project.assignments if a.end_date is None)

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
        status=project.status,
        completed_at=project.completed_at,
        completed_by_name=_resolve_user_name(db, project.completed_by_id),
        is_deleted=project.is_deleted,
        created_at=project.created_at,
        updated_at=project.updated_at,
        member_count=active_count,
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

    # PM is required on Project — ProjectCreate enforces that, and on
    # update the column is left nullable only to keep the FK legal during
    # a PM swap (see Project.pm_id docstring). We reject `pm_id: null`
    # explicitly so the project doesn't end up persistently PM-less,
    # which breaks downstream cycle generation that assumes pm_id is set.
    if "pm_id" in update_data and update_data["pm_id"] is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Project must have a PM. To swap PMs, send the new pm_id; "
                "unsetting pm_id is not supported."
            ),
        )

    if "project_code" in update_data and update_data["project_code"] != project.project_code:
        # Case-insensitive uniqueness; whitespace already stripped by the
        # schema validator.
        existing = db.query(Project).filter(
            Project.org_id == current_user.org_id,
            func.lower(Project.project_code) == update_data["project_code"].lower(),
            Project.is_deleted == False,  # noqa: E712
            Project.id != project_id,
        ).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Project code '{update_data['project_code']}' already exists.",
            )

    # Role validation on incoming pm_id / secondary_evaluator_id —
    # gated on the value ACTUALLY changing relative to the persisted
    # row. The frontend modal sends the full payload on every save
    # (not just the diff), so without this gate a no-op edit on a
    # legacy project — one whose Secondary was set when the rule was
    # looser (pre-PR #85: anyone except PM/Mentor was allowed) —
    # would 400 here on every save until HR cleaned up the Secondary,
    # which would break unrelated edits. Re-validating only on real
    # changes keeps legacy data settable + still rejects fresh
    # invalid assignments. The user-facing nudge to clean up the
    # legacy value lives on the frontend modal as an inline warning.
    if (
        "pm_id" in update_data
        and update_data["pm_id"] is not None
        and update_data["pm_id"] != project.pm_id
    ):
        _validate_pm_role(db, current_user.org_id, update_data["pm_id"])
    if (
        "secondary_evaluator_id" in update_data
        and update_data["secondary_evaluator_id"] is not None
        and update_data["secondary_evaluator_id"] != project.secondary_evaluator_id
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

    # Date range: validated against the post-merge state so a PATCH that
    # changes only one of the two dates still gets checked against the
    # persisted value of the other. Sanity bounds (year window) already
    # applied by the schema's per-field validators.
    final_start = update_data.get("start_date", project.start_date)
    final_end = update_data.get("expected_end_date", project.expected_end_date)
    if (
        final_start is not None
        and final_end is not None
        and final_end < final_start
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Expected end date cannot be before start date.",
        )

    # Capture the prior Secondary so we can notify when it changes. Done
    # BEFORE the setattr loop overwrites the column.
    prior_secondary_id = project.secondary_evaluator_id

    # PM swap / orphan-recovery cascade. When pm_id changes, in-flight
    # ProjectReview.reviewer_id rows on this project need to follow
    # the live PM (or be claimed back from NULL when re-assigning an
    # orphaned project to a new PM). Closed reviews keep their stamped
    # reviewer for audit. Mirrors `_cascade_mentor_reassignment` —
    # symmetric semantics for the PM axis. See the audit doc on the
    # PR for the bug this closes (in-flight reviewer_id frozen at the
    # deactivated PM's id).
    if "pm_id" in update_data and update_data["pm_id"] != project.pm_id:
        old_pm_id = project.pm_id
        new_pm_id = update_data["pm_id"]
        _cascade_pm_reassignment(
            db,
            project=project,
            old_pm_id=old_pm_id,
            new_pm_id=new_pm_id,
        )
        # Re-mentoring an orphaned project clears the stamp. Only on
        # transitions to a real PM — NULL→NULL would be a no-op anyway,
        # and the PATCH guard above rejects pm_id=NULL entirely.
        if new_pm_id is not None:
            update_data["pm_orphaned_at"] = None

    for field, value in update_data.items():
        setattr(project, field, value)

    db.commit()
    db.refresh(project)

    # Notify the newly-assigned Secondary when they weren't the previous
    # assignee. Covers both "no prior secondary" and "swap to a different
    # user" cases. We don't notify the displaced previous secondary —
    # they'd see the Project Reviews row drop off their queue naturally.
    new_secondary_id = project.secondary_evaluator_id
    if (
        new_secondary_id is not None
        and new_secondary_id != prior_secondary_id
    ):
        notify(
            db,
            org_id=current_user.org_id,
            recipient_id=new_secondary_id,
            sender_id=current_user.id,
            module="project_review",
            entity_type="project",
            entity_id=project.id,
            message=(
                f"You were assigned as Secondary evaluator on {project.name}."
            ),
            entity_url=f"/projects/{project.id}",
        )
        db.commit()

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
    background_tasks: BackgroundTasks,
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

    if project.status == PROJECT_STATUS_COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot assign members to a completed project. Re-open it first.",
        )

    if assignment_in.user_id == project.pm_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The PM is not a project member; do not add them via assignments.",
        )

    _validate_member_role(db, current_user.org_id, assignment_in.user_id)

    # Joined-date must fall inside the project's date window. Mirrors
    # the same check applied to inline assignments in `create_project`.
    _validate_assigned_date_window(
        assigned_date=assignment_in.assigned_date,
        project_start=project.start_date,
        project_end=project.expected_end_date,
        user_label=f"user {assignment_in.user_id}",
    )

    # Only block when there's an *active* row already. End-dated rows are
    # historical stints and may coexist with a fresh active row (re-join).
    existing_active = db.query(ProjectAssignment).filter(
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.user_id == assignment_in.user_id,
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.end_date.is_(None),
    ).first()
    if existing_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This user is already actively assigned to this project.",
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

    notify(
        db,
        org_id=current_user.org_id,
        recipient_id=new_assignment.user_id,
        sender_id=current_user.id,
        module="project",
        entity_type="assignment",
        entity_id=new_assignment.id,
        message=f"You were assigned to {project.name} as {new_assignment.assignment_role}.",
        entity_url=f"/project-reviews?project_id={project.id}",
        background_tasks=background_tasks,
        send_email=True,
        email_subject=f"You've been assigned to {project.name}",
    )
    db.commit()

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
    if not update_data:
        # No-op PATCH — don't notify or commit a meaningless event.
        return _build_assignment_response(assignment, db)

    # Joined-date window check when the PATCH touches assigned_date.
    # We re-validate against the project's CURRENT window — same rule
    # as create / add. Sanity bounds (year window) already applied by
    # AssignmentUpdate's per-field validator.
    if "assigned_date" in update_data:
        parent = db.query(Project).filter(
            Project.id == assignment.project_id
        ).first()
        if parent is not None:
            _validate_assigned_date_window(
                assigned_date=update_data["assigned_date"],
                project_start=parent.start_date,
                project_end=parent.expected_end_date,
                user_label=f"user {assignment.user_id}",
            )

    for field, value in update_data.items():
        setattr(assignment, field, value)

    db.commit()
    db.refresh(assignment)

    project = db.query(Project).filter(Project.id == assignment.project_id).first()
    notify(
        db,
        org_id=current_user.org_id,
        recipient_id=assignment.user_id,
        sender_id=current_user.id,
        module="project",
        entity_type="assignment",
        entity_id=assignment.id,
        message=(
            f"Your role on {project.name} was updated."
            if project else "Your project assignment was updated."
        ),
        entity_url=f"/project-reviews?project_id={assignment.project_id}",
    )
    db.commit()

    return _build_assignment_response(assignment, db)


@router.delete("/assignments/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def end_assignment(
    assignment_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """End a member's assignment on a project (soft-end). HR-only.

    Sets end_date=today and ended_by_id=current_user. The row is kept so
    the user keeps seeing their past project reviews under My Reviews,
    and the PM can still finish in-flight reviews for the cycle the
    person was removed in.
    """
    _require_hr_any(current_user)

    assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.id == assignment_id,
        ProjectAssignment.org_id == current_user.org_id,
    ).first()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")

    if assignment.end_date is not None:
        # Idempotent: already ended.
        return None

    # Use the org's configured timezone for "today" so HR ending an
    # assignment near midnight in IST/AEST/etc. lands on the day they
    # actually pressed the button — not the server's UTC day.
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id
    ).first()
    assignment.end_date = resolve_today(settings)
    assignment.ended_by_id = current_user.id
    db.commit()
    return None


@router.post("/assignments/{assignment_id}/restore", response_model=AssignmentResponse)
def restore_assignment(
    assignment_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """Undo a recent soft-end. HR-only.

    Clears end_date and ended_by_id. Used by the Undo toast that appears
    right after end_assignment — gives HR a 6-second window to reverse a
    misclick without having to re-add the user from scratch.

    Refuses if the parent project is now completed (re-opening must come
    first), or if a different active assignment for the same user already
    exists (avoids two simultaneous active rows for one (project, user)).
    """
    _require_hr_any(current_user)

    assignment = db.query(ProjectAssignment).filter(
        ProjectAssignment.id == assignment_id,
        ProjectAssignment.org_id == current_user.org_id,
    ).first()
    if not assignment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")

    if assignment.end_date is None:
        # Idempotent: already active.
        return _build_assignment_response(assignment, db)

    project = db.query(Project).filter(Project.id == assignment.project_id).first()
    if not project or project.is_deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")
    if project.status == PROJECT_STATUS_COMPLETED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cannot restore an assignment on a completed project. Re-open the project first.",
        )

    conflicting_active = db.query(ProjectAssignment).filter(
        ProjectAssignment.project_id == assignment.project_id,
        ProjectAssignment.user_id == assignment.user_id,
        ProjectAssignment.end_date.is_(None),
        ProjectAssignment.id != assignment.id,
    ).first()
    if conflicting_active:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This user already has another active assignment on this project.",
        )

    assignment.end_date = None
    assignment.ended_by_id = None
    db.commit()
    db.refresh(assignment)

    notify(
        db,
        org_id=current_user.org_id,
        recipient_id=assignment.user_id,
        sender_id=current_user.id,
        module="project",
        entity_type="assignment",
        entity_id=assignment.id,
        message=f"Your assignment to {project.name} was restored.",
        entity_url=f"/project-reviews?project_id={project.id}",
    )
    db.commit()

    return _build_assignment_response(assignment, db)


# =====================================================================
# PROJECT LIFECYCLE
# =====================================================================

@router.post("/{project_id}/complete", response_model=ProjectResponse)
def complete_project(
    project_id: int,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
):
    """Mark a project as completed (HR-only).

    Side effect: every active ProjectAssignment on the project is
    end-dated to today (with ended_by_id=current_user). The PM can
    still finish in-flight reviews for the cycle that was open at
    completion; future cycles stop generating placeholders.

    Idempotent: already-completed projects return their current state
    without re-end-dating anything.
    """
    _require_hr_any(current_user)

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    if project.status == PROJECT_STATUS_COMPLETED:
        # Idempotent return — don't re-stamp completed_at or re-end-date.
        count = db.query(func.count(ProjectAssignment.id)).filter(
            ProjectAssignment.project_id == project.id,
            ProjectAssignment.end_date.is_(None),
        ).scalar() or 0
        return _build_project_response(project, db, count)

    # `today` is used as the assignments' end_date — a calendar-day
    # decision that should reflect the org's local timezone. The
    # `project.completed_at` instant below stays UTC for audit trail
    # canonicalisation.
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id
    ).first()
    today = resolve_today(settings)
    project.status = PROJECT_STATUS_COMPLETED
    project.completed_at = datetime.now(timezone.utc)
    project.completed_by_id = current_user.id

    # Bulk end-date all currently-active assignments.
    active_assignments = db.query(ProjectAssignment).filter(
        ProjectAssignment.project_id == project.id,
        ProjectAssignment.end_date.is_(None),
    ).all()
    notified_user_ids = [a.user_id for a in active_assignments]
    for a in active_assignments:
        a.end_date = today
        a.ended_by_id = current_user.id

    db.commit()
    db.refresh(project)

    if notified_user_ids:
        notify_many(
            db,
            org_id=current_user.org_id,
            recipient_ids=notified_user_ids,
            sender_id=current_user.id,
            module="project",
            entity_type="project",
            entity_id=project.id,
            message=f"{project.name} has been marked completed.",
            entity_url=f"/project-reviews?project_id={project.id}",
            background_tasks=background_tasks,
            send_email=True,
            email_subject=f"{project.name} marked completed",
        )
        db.commit()

    # All active assignments were just end-dated, so live count is 0.
    return _build_project_response(project, db, 0)


@router.post("/{project_id}/reopen", response_model=ProjectResponse)
def reopen_project(
    project_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """Re-open a completed project (HR-only).

    Clears status / completed_at / completed_by_id. Does NOT re-open
    assignments — HR re-adds team members explicitly via the assignment
    endpoint. Idempotent for already-active projects.
    """
    _require_hr_any(current_user)

    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found.")

    if project.status != PROJECT_STATUS_COMPLETED:
        count = db.query(func.count(ProjectAssignment.id)).filter(
            ProjectAssignment.project_id == project.id,
            ProjectAssignment.end_date.is_(None),
        ).scalar() or 0
        return _build_project_response(project, db, count)

    project.status = PROJECT_STATUS_ACTIVE
    project.completed_at = None
    project.completed_by_id = None

    db.commit()
    db.refresh(project)

    return _build_project_response(project, db, 0)
