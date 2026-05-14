"""
Admin Routes — The HR Administrator's Control Panel.

Endpoints:
    GET    /api/v1/admin/users              → List all org users
    POST   /api/v1/admin/users              → Create a new user
    PATCH  /api/v1/admin/users/{user_id}    → Update user details
    DELETE /api/v1/admin/users/{user_id}    → Soft-delete (deactivate) a user
    GET    /api/v1/admin/functions           → List functions (for dropdowns)
    GET    /api/v1/admin/designations        → List designations (for dropdowns)
    GET    /api/v1/admin/settings            → Get simplified active cycle info
    PATCH  /api/v1/admin/settings            → Update active cycle

Security Layers Applied (ALL endpoints):
    Layer 1 — Authentication:   CurrentUser dependency (JWT validation)
    Layer 2 — Tenant Isolation: Every query filters by current_user.org_id
    Layer 3 — Role Authorization: Each endpoint requires HR_MyOrg or HR_Miltenyi
    Layer 4 — Target Protection: HR_Miltenyi cannot create/edit/deactivate
                                 Mentor or HR_MyOrg users (security boundary)
"""

import secrets
import string
from typing import List
from fastapi import APIRouter, BackgroundTasks, HTTPException, status
from sqlalchemy.orm import joinedload

from app.api.dependencies import DbSession, CurrentUser
from app.core.cache import (
    functions_cache,
    designations_cache,
    invalidate_settings,
)
from app.core.config import settings
from app.core.security import get_password_hash
from app.models.user_models import User, Role, ADMIN_ROLES, PROTECTED_USER_ROLES
from app.models.reference_models import Function, Designation
from app.models.system_settings_models import SystemSettings, CycleType
from app.core.cycle_utils import (
    apply_rollover_resets,
    extract_fy_label,
    get_current_cycle_info,
    resolve_today,
)
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.goal_models import Goal, GoalType
from sqlalchemy import func as sql_func
from app.services.send_email import (
    is_smtp_configured,
    send_welcome_user_email,
)
from datetime import date, datetime, timedelta, timezone
from app.schemas.admin_schemas import (
    FunctionBrief,
    DesignationBrief,
    UserResponse,
    UserCreate,
    UserUpdate,
    AdminSettingsResponse,
    AdminSettingsUpdate,
)


_TEMP_PASSWORD_ALPHABET = string.ascii_letters + string.digits


def _generate_temp_password(length: int = 12) -> str:
    """Crypto-random temp password using `secrets.choice`. Letters+digits only
    to avoid ambiguous shell-escape characters when the admin relays it."""
    return "".join(secrets.choice(_TEMP_PASSWORD_ALPHABET) for _ in range(length))

router = APIRouter()


# ── Reusable Role Guards ─────────────────────────────────────────────

def _require_hr_any(current_user: User) -> None:
    """Raise 403 unless the caller is HR_MyOrg or HR_Miltenyi.

    Both HR roles can hit the read endpoints + most write endpoints; the
    target-protection check below adds the extra constraint on which rows
    HR_Miltenyi may mutate.
    """
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only HR users can access this resource.",
        )


def _require_hr_myorg(current_user: User) -> None:
    """Raise 403 unless the caller is HR_MyOrg (the full super-admin)."""
    if current_user.role != Role.HR_MYORG.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the Healthark HR can access this resource.",
        )


def _authorize_user_mutation(current_user: User, target_role: str | None) -> None:
    """Enforce the security boundary on user-mutating endpoints.

    HR_MyOrg may create/edit/deactivate any user.
    HR_Miltenyi may NOT touch a row whose role is Mentor or HR_MyOrg —
    that's the boundary the user defined: "Miltenyi HR can't edit the 3
    mentors or the HR from MyOrg as a security measure."

    Also blocks HR_Miltenyi from *promoting* a user TO a protected role
    (e.g. flipping a Staff row's role to Mentor).

    Pass `target_role=None` when the operation doesn't change the role
    (e.g. deactivate); we look up the row's existing role at the call site.
    """
    if current_user.role == Role.HR_MYORG.value:
        return  # Healthark HR has full powers
    if target_role and target_role in PROTECTED_USER_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Miltenyi HR cannot create or modify Mentors or Healthark HR users."
            ),
        )


# =====================================================================
# USER MANAGEMENT
# =====================================================================

@router.get("/users", response_model=List[UserResponse])
def list_users(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return every user in the organization (including deactivated ones).

    Uses joinedload to eagerly fetch function + designation in ONE query,
    avoiding the N+1 problem when the table renders 50+ rows.
    """
    _require_hr_any(current_user)

    users = (
        db.query(User)
        .options(
            joinedload(User.function),
            joinedload(User.designation),
        )
        .filter(User.org_id == current_user.org_id)
        .order_by(User.created_at.desc())
        .all()
    )

    return users


@router.post("/users", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
def create_user(
    user_in: UserCreate,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
):
    """
    Create a new user in the organization.

    The email is checked for uniqueness within the org (not globally)
    because the composite index ix_users_org_email enforces this.

    On success, a welcome email containing the email + plaintext password
    is queued for delivery (best-effort via BackgroundTasks). Failed
    delivery does NOT roll back the creation — the user row is already
    persisted and the admin can relay the credentials manually.
    """
    _require_hr_any(current_user)
    _authorize_user_mutation(current_user, user_in.role)

    # Check for duplicate email within this org
    existing = db.query(User).filter(
        User.org_id == current_user.org_id,
        User.email == user_in.email,
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A user with email '{user_in.email}' already exists in this organization.",
        )

    # Check for duplicate employee code within this org
    existing_code = db.query(User).filter(
        User.org_id == current_user.org_id,
        User.employee_code == user_in.employee_code,
    ).first()

    if existing_code:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Employee code '{user_in.employee_code}' is already in use.",
        )

    new_user = User(
        org_id=current_user.org_id,  # Forced from JWT — never trusted from body
        employee_code=user_in.employee_code,
        full_name=user_in.full_name,
        email=user_in.email,
        phone=user_in.phone,
        role=user_in.role,
        function_id=user_in.function_id,
        designation_id=user_in.designation_id,
        mentor_id=user_in.mentor_id,
        password_hash=get_password_hash(user_in.password),
        # Force a password change on first login. The admin chose the
        # initial password and emailed it to the user; ProtectedRoute
        # routes the user to /change-password until they pick their own.
        must_change_password=True,
    )

    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Send the welcome email after the row is committed so a delivery
    # failure can't prevent account creation. The plaintext password is
    # only available here (we hashed it before storage); after this
    # function returns, no other code path can reconstruct it.
    if is_smtp_configured():
        login_url = f"{settings.APP_BASE_URL.rstrip('/')}/login"
        background_tasks.add_task(
            send_welcome_user_email,
            to_email=new_user.email,
            full_name=new_user.full_name,
            password=user_in.password,
            login_url=login_url,
            org_id=new_user.org_id,
        )

    # Eagerly load relationships for the response
    return _load_user_with_relations(db, new_user.id)


@router.patch("/users/{user_id}", response_model=UserResponse)
def update_user(
    user_id: int,
    user_in: UserUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Update a user's details (name, role, function, mentor, etc.).

    Email is intentionally NOT updatable — the frontend makes the field
    read-only during edit mode to prevent orphaned JWT tokens.
    """
    _require_hr_any(current_user)

    user = db.query(User).filter(
        User.id == user_id,
        User.org_id == current_user.org_id,
    ).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    # Security boundary: HR_Miltenyi can't edit a Mentor or HR_MyOrg row
    # (block based on the existing role) and can't promote anyone TO a
    # protected role (block based on the incoming role, if changing).
    _authorize_user_mutation(current_user, user.role)
    if user_in.role and user_in.role != user.role:
        _authorize_user_mutation(current_user, user_in.role)

    # If employee_code is changing, check for duplicates
    update_data = user_in.model_dump(exclude_unset=True)

    if "employee_code" in update_data and update_data["employee_code"] != user.employee_code:
        existing_code = db.query(User).filter(
            User.org_id == current_user.org_id,
            User.employee_code == update_data["employee_code"],
            User.id != user_id,
        ).first()

        if existing_code:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Employee code '{update_data['employee_code']}' is already in use.",
            )

    for field, value in update_data.items():
        setattr(user, field, value)

    db.commit()

    # Return with eagerly loaded relationships
    return _load_user_with_relations(db, user.id)


@router.post("/users/{user_id}/reactivate", response_model=UserResponse)
def reactivate_user(
    user_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Reverse a soft-delete (set is_deleted = False).

    The user's historical password, mentor assignment, reviews, and goals
    are preserved — reactivation just flips the access flag. They can log
    in with their old password immediately. If admin wants a clean slate,
    they should follow up with a password reset.
    """
    _require_hr_any(current_user)

    user = db.query(User).filter(
        User.id == user_id,
        User.org_id == current_user.org_id,
    ).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    _authorize_user_mutation(current_user, user.role)

    if not user.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This user is already active.",
        )

    user.is_deleted = False
    db.commit()

    return _load_user_with_relations(db, user.id)


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def deactivate_user(
    user_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Soft-delete a user (set is_deleted = True).

    Hard deletes are NEVER used — this preserves audit trails and
    historical review/goal data. The user's JWT will still work until
    it expires, but the CurrentUser dependency checks is_deleted on
    every request, so they are blocked immediately.
    """
    _require_hr_any(current_user)

    user = db.query(User).filter(
        User.id == user_id,
        User.org_id == current_user.org_id,
    ).first()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found.",
        )

    _authorize_user_mutation(current_user, user.role)

    # Guard: Admin should not deactivate themselves
    if user.id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot deactivate your own account.",
        )

    user.is_deleted = True
    db.commit()

    return None  # 204 No Content — no body


# =====================================================================
# REFERENCE DATA (for dropdown menus)
# =====================================================================

@router.get("/functions", response_model=List[FunctionBrief])
def list_functions(
    db: DbSession,
    current_user: CurrentUser,
):
    """Return all active functions for the org (powers the <select> dropdown)."""
    _require_hr_any(current_user)

    def _query() -> List[FunctionBrief]:
        rows = (
            db.query(Function)
            .filter(
                Function.org_id == current_user.org_id,
                Function.is_active == True,  # noqa: E712
            )
            .order_by(Function.name)
            .all()
        )
        # Serialize to plain Pydantic models so the cache holds stable values
        # rather than ORM objects bound to a (now-closed) Session.
        return [FunctionBrief.model_validate(r, from_attributes=True) for r in rows]

    return functions_cache.get_or_compute(current_user.org_id, _query)


@router.get("/designations", response_model=List[DesignationBrief])
def list_designations(
    db: DbSession,
    current_user: CurrentUser,
):
    """Return all active designations for the org, sorted by hierarchy level."""
    _require_hr_any(current_user)

    def _query() -> List[DesignationBrief]:
        rows = (
            db.query(Designation)
            .filter(
                Designation.org_id == current_user.org_id,
                Designation.is_active == True,  # noqa: E712
            )
            .order_by(Designation.level)
            .all()
        )
        return [DesignationBrief.model_validate(r, from_attributes=True) for r in rows]

    return designations_cache.get_or_compute(current_user.org_id, _query)


# =====================================================================
# ADMIN SETTINGS (Simplified Active Cycle View)
# =====================================================================

@router.get("/settings", response_model=AdminSettingsResponse)
def get_admin_settings(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return the active cycle for the Admin Panel's SystemSettingsTab.

    This is a simplified view of the same SystemSettings table used by
    the /api/v1/settings/ endpoints. The frontend field name 'active_cycle'
    maps to the database column 'active_cycle_name'.
    """
    _require_hr_any(current_user)

    def _query() -> AdminSettingsResponse:
        row = db.query(SystemSettings).filter(
            SystemSettings.org_id == current_user.org_id,
        ).first()

        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="System settings have not been configured.",
            )

        # active_cycle is computed on-the-fly so it never goes stale
        # between settings saves; resolve_today honours simulated_today.
        live_active_cycle = get_current_cycle_info(
            resolve_today(row),
            CycleType(row.cycle_type),
            row.fiscal_start_month,
        )
        # On cycle rollover, reset the org-wide submission /
        # visibility flags so HR opens the new cycle deliberately.
        # `annual_goals_edit_enabled` is preserved.
        if apply_rollover_resets(row, live_active_cycle):
            db.commit()
            invalidate_settings(current_user.org_id)
        return AdminSettingsResponse(
            id=row.id,
            org_id=row.org_id,
            active_cycle=live_active_cycle,
            cycle_type=row.cycle_type,
            fiscal_start_month=row.fiscal_start_month,
            goals_edit_enabled=row.goals_edit_enabled,
            annual_goals_edit_enabled=row.annual_goals_edit_enabled,
            project_ratings_visible=row.project_ratings_visible,
            annual_reviews_enabled=row.annual_reviews_enabled,
            annual_review_final_rating_visible=row.annual_review_final_rating_visible,
            simulated_today=row.simulated_today,
            simulation_allowed=settings.ALLOW_DATE_SIMULATION,
            updated_at=row.updated_at,
        )

    # Bypass the admin_settings_cache because the live active_cycle
    # depends on today's date and a cached value would go stale.
    return _query()


@router.patch("/settings", response_model=AdminSettingsResponse)
def update_admin_settings(
    settings_in: AdminSettingsUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Update cycle configuration and goal access controls from the Admin Panel.

    Cycle cadence and fiscal month are editable; active_cycle_name is
    recomputed automatically from those two values + today's date.
    """
    _require_hr_any(current_user)

    # Snapshot the env flag before the local `settings` variable shadows
    # the imported config-settings module.
    simulation_allowed = settings.ALLOW_DATE_SIMULATION

    settings_row = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id,
    ).first()

    if not settings_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System settings have not been configured.",
        )

    # simulated_today is gated behind ALLOW_DATE_SIMULATION env flag so
    # production deployments are safe from accidental cycle-time shifts.
    # Validate the gate before mutating anything.
    wants_simulation_write = (
        settings_in.simulated_today is not None
        or bool(settings_in.clear_simulated_today)
    )
    if wants_simulation_write and not simulation_allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Date simulation is disabled for this deployment. "
                "Set ALLOW_DATE_SIMULATION=true on the backend to enable."
            ),
        )

    # Apply cadence / fiscal / simulated_today changes FIRST so the
    # rollover detection below sees the new cycle text. Other field
    # updates (the flag overrides) come AFTER the rollover reset, so
    # HR's intentional toggle changes in this same save aren't clobbered.
    if settings_in.cycle_type is not None:
        settings_row.cycle_type = settings_in.cycle_type
    if settings_in.fiscal_start_month is not None:
        settings_row.fiscal_start_month = settings_in.fiscal_start_month
    if settings_in.clear_simulated_today:
        settings_row.simulated_today = None
    elif settings_in.simulated_today is not None:
        settings_row.simulated_today = settings_in.simulated_today

    # Cycle rollover — reset the time-bound flags before HR's explicit
    # toggle values are applied below. Also pins
    # `settings_row.active_cycle_name` to the fresh value.
    fresh_cycle = get_current_cycle_info(
        resolve_today(settings_row),
        CycleType(settings_row.cycle_type),
        settings_row.fiscal_start_month,
    )
    rollover_fired = apply_rollover_resets(settings_row, fresh_cycle)

    # `annual_goals_edit_enabled` and `goals_edit_enabled` are never part
    # of the rollover reset, so HR's overrides for them always apply.
    if settings_in.goals_edit_enabled is not None:
        settings_row.goals_edit_enabled = settings_in.goals_edit_enabled
    if settings_in.annual_goals_edit_enabled is not None:
        settings_row.annual_goals_edit_enabled = settings_in.annual_goals_edit_enabled

    # The three time-bound flags: only apply HR's override when NO
    # rollover happened this save. When a rollover fires, the UI's
    # toggle values reflect the pre-rollover view and would otherwise
    # silently re-enable what we just cleared. HR re-opens these
    # deliberately in a subsequent save.
    if not rollover_fired:
        if settings_in.project_ratings_visible is not None:
            settings_row.project_ratings_visible = settings_in.project_ratings_visible
        if settings_in.annual_reviews_enabled is not None:
            settings_row.annual_reviews_enabled = settings_in.annual_reviews_enabled
        if settings_in.annual_review_final_rating_visible is not None:
            settings_row.annual_review_final_rating_visible = settings_in.annual_review_final_rating_visible

    settings_row.updated_by_id = current_user.id

    db.commit()
    db.refresh(settings_row)
    invalidate_settings(current_user.org_id)

    return AdminSettingsResponse(
        id=settings_row.id,
        org_id=settings_row.org_id,
        active_cycle=settings_row.active_cycle_name,
        cycle_type=settings_row.cycle_type,
        fiscal_start_month=settings_row.fiscal_start_month,
        goals_edit_enabled=settings_row.goals_edit_enabled,
        annual_goals_edit_enabled=settings_row.annual_goals_edit_enabled,
        project_ratings_visible=settings_row.project_ratings_visible,
        annual_reviews_enabled=settings_row.annual_reviews_enabled,
        annual_review_final_rating_visible=settings_row.annual_review_final_rating_visible,
        simulated_today=settings_row.simulated_today,
        simulation_allowed=simulation_allowed,
        updated_at=settings_row.updated_at,
    )


@router.get("/settings/preflight")
def settings_preflight(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return per-setting "in-flight" counts so the frontend can show an
    advisory confirmation before HR flips a toggle off mid-cycle. The
    response shape is:

        {
            "<setting_key>": {"in_flight_count": int, "warning": str | None},
            ...
        }

    Visibility-only flags always return count 0 — they don't lock anyone
    out, so there's nothing to warn about. The two action gates
    (`annual_goals_edit_enabled`, `annual_reviews_enabled`) compute real
    counts so the UI can name exactly who would be stranded.
    """
    _require_hr_any(current_user)

    settings_row = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id,
    ).first()
    if not settings_row:
        # No settings = no in-flight work to worry about.
        return {
            "annual_goals_edit_enabled":          {"in_flight_count": 0, "warning": None},
            "annual_reviews_enabled":             {"in_flight_count": 0, "warning": None},
            "project_ratings_visible":            {"in_flight_count": 0, "warning": None},
            "annual_review_final_rating_visible": {"in_flight_count": 0, "warning": None},
        }

    active_cycle = get_current_cycle_info(
        resolve_today(settings_row),
        CycleType(settings_row.cycle_type),
        settings_row.fiscal_start_month,
    )
    active_fy = extract_fy_label(active_cycle)

    # ── annual_goals_edit_enabled ───────────────────────────────────
    # Count active Staff in this org with zero annual Goal rows for the
    # active FY. They're the users who would be locked out by flipping
    # this off mid-cycle.
    staff_ids_subq = (
        db.query(User.id)
        .filter(
            User.org_id == current_user.org_id,
            User.role == Role.STAFF.value,
            User.is_deleted == False,  # noqa: E712
        )
        .subquery()
    )
    goal_user_ids_subq = (
        db.query(Goal.user_id)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.goal_type == GoalType.ANNUAL.value,
            Goal.cycle_name == active_fy,
        )
        .distinct()
        .subquery()
    )
    staff_without_goals = (
        db.query(sql_func.count(staff_ids_subq.c.id))
        .filter(staff_ids_subq.c.id.notin_(db.query(goal_user_ids_subq.c.user_id)))
        .scalar()
        or 0
    )

    # ── annual_reviews_enabled ──────────────────────────────────────
    # Two buckets, summed:
    #   1. Reviews already started but not yet past the mentor stage
    #      (draft / pending_mentor) — they can't progress while paused.
    #   2. Active Staff with no AnnualReview row for the active FY at
    #      all — they can't even create one while paused.
    in_flight_reviews = (
        db.query(sql_func.count(AnnualReview.id))
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == active_fy,
            AnnualReview.status.in_([
                ReviewStatus.DRAFT.value,
                ReviewStatus.PENDING_MENTOR.value,
            ]),
        )
        .scalar()
        or 0
    )
    review_user_ids_subq = (
        db.query(AnnualReview.user_id)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == active_fy,
        )
        .distinct()
        .subquery()
    )
    staff_without_reviews = (
        db.query(sql_func.count(staff_ids_subq.c.id))
        .filter(staff_ids_subq.c.id.notin_(db.query(review_user_ids_subq.c.user_id)))
        .scalar()
        or 0
    )
    review_in_flight = in_flight_reviews + staff_without_reviews

    def _msg(count: int, kind: str) -> str | None:
        if count <= 0:
            return None
        noun = "employee" if count == 1 else "employees"
        verb = "hasn't" if count == 1 else "haven't"
        if kind == "goals":
            return (
                f"{count} {noun} {verb} created annual goals for {active_fy} yet. "
                f"Disabling will block them from doing so until you re-enable."
            )
        return (
            f"{count} {noun} {verb} completed self-review/mentor evaluation for {active_fy}. "
            f"Disabling will block new submissions until you re-enable."
        )

    return {
        "annual_goals_edit_enabled": {
            "in_flight_count": staff_without_goals,
            "warning": _msg(staff_without_goals, "goals"),
        },
        "annual_reviews_enabled": {
            "in_flight_count": review_in_flight,
            "warning": _msg(review_in_flight, "reviews"),
        },
        # Visibility-only — flipping off doesn't lock anyone out, so no
        # preflight warning is needed.
        "project_ratings_visible":            {"in_flight_count": 0, "warning": None},
        "annual_review_final_rating_visible": {"in_flight_count": 0, "warning": None},
    }


# =====================================================================
# INTERNAL HELPERS
# =====================================================================

def _load_user_with_relations(db: DbSession, user_id: int) -> User:
    """
    Re-query a user with eagerly loaded relationships.

    Called after create/update to ensure the response includes nested
    function and designation objects, not just their IDs.
    """
    return (
        db.query(User)
        .options(
            joinedload(User.function),
            joinedload(User.designation),
        )
        .filter(User.id == user_id)
        .first()
    )