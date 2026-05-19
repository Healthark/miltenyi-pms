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
    YEAR_OVERRIDE_FLAGS,
    ensure_year_override_row,
    extract_fy_label,
    get_current_cycle_info,
    resolve_today,
)
from app.models.system_settings_year_override_models import (
    SystemSettingsYearOverride,
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
    YearOption,
    YearOptionsResponse,
    YearSettingsResponse,
    YearSettingsUpdate,
    YearPreflightEntry,
    YearPreflightResponse,
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

    # Identity fields on a Staff row are locked for HR_Miltenyi. Healthark
    # HR owns the Staff directory's identity columns (employee_code,
    # full_name); Miltenyi HR manages everything else (function,
    # designation, phone, role transitions within their permitted set).
    # We compare the incoming value to the stored value so a no-op
    # payload (same value resubmitted) still passes — only true changes
    # are rejected.
    update_data = user_in.model_dump(exclude_unset=True)
    if (
        current_user.role == Role.HR_MILTENYI.value
        and user.role == Role.STAFF.value
    ):
        for locked_field in ("employee_code", "full_name"):
            if (
                locked_field in update_data
                and update_data[locked_field] != getattr(user, locked_field)
            ):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=(
                        "Miltenyi HR cannot change employee code or full "
                        "name for Staff users. Ask Healthark HR to update "
                        "this record."
                    ),
                )

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
    # Clear the deactivation timestamp so any future FY-scoped export
    # treats this user as continuously active from `created_at` to now.
    user.deleted_at = None
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
    # Stamp the deactivation time so FY-scoped exports can decide
    # whether this user was around during the selected FY. The export
    # rule includes them in any FY that ends on/after `deleted_at`.
    user.deleted_at = datetime.now(timezone.utc)
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
        live_fy = extract_fy_label(live_active_cycle)
        # Keep the cached cycle label in sync. The four access toggles
        # are no longer reset on rollover — they live on the per-FY
        # override table and HR configures each year independently.
        if row.active_cycle_name != live_active_cycle:
            row.active_cycle_name = live_active_cycle
            db.commit()
            invalidate_settings(current_user.org_id)
        # Lazy-create the current-FY override row, then read flags off
        # it so legacy consumers continue to see consistent values.
        override = ensure_year_override_row(
            db, current_user.org_id, live_fy, seed_from_settings=row,
        )
        return AdminSettingsResponse(
            id=row.id,
            org_id=row.org_id,
            active_cycle=live_active_cycle,
            cycle_type=row.cycle_type,
            fiscal_start_month=row.fiscal_start_month,
            goals_edit_enabled=row.goals_edit_enabled,
            annual_goals_edit_enabled=override.annual_goals_edit_enabled,
            project_ratings_visible=override.project_ratings_visible,
            annual_reviews_enabled=override.annual_reviews_enabled,
            annual_review_final_rating_visible=override.annual_review_final_rating_visible,
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

    # Apply cadence / fiscal / simulated_today changes — these stay
    # org-wide. The four access-control toggles below now route to the
    # per-FY override table.
    if settings_in.cycle_type is not None:
        settings_row.cycle_type = settings_in.cycle_type
    if settings_in.fiscal_start_month is not None:
        settings_row.fiscal_start_month = settings_in.fiscal_start_month
    if settings_in.clear_simulated_today:
        settings_row.simulated_today = None
    elif settings_in.simulated_today is not None:
        settings_row.simulated_today = settings_in.simulated_today

    # Recompute the active cycle. We just update the cached label —
    # no auto-reset of flags (per-FY overrides are configured explicitly).
    fresh_cycle = get_current_cycle_info(
        resolve_today(settings_row),
        CycleType(settings_row.cycle_type),
        settings_row.fiscal_start_month,
    )
    settings_row.active_cycle_name = fresh_cycle
    fresh_fy = extract_fy_label(fresh_cycle)

    if settings_in.goals_edit_enabled is not None:
        settings_row.goals_edit_enabled = settings_in.goals_edit_enabled

    settings_row.updated_by_id = current_user.id

    # Route the four access toggles to the current-FY override row when
    # the legacy PATCH carries them. This keeps the existing Admin
    # Panel flow working until the UI fully migrates to the year-scoped
    # endpoints.
    override = ensure_year_override_row(
        db,
        current_user.org_id,
        fresh_fy,
        seed_from_settings=settings_row,
        updated_by_id=current_user.id,
    )
    legacy_year_writes = {
        "annual_goals_edit_enabled": settings_in.annual_goals_edit_enabled,
        "project_ratings_visible": settings_in.project_ratings_visible,
        "annual_reviews_enabled": settings_in.annual_reviews_enabled,
        "annual_review_final_rating_visible": settings_in.annual_review_final_rating_visible,
    }
    touched_year_row = False
    for flag, value in legacy_year_writes.items():
        if value is not None:
            setattr(override, flag, bool(value))
            touched_year_row = True
    if touched_year_row:
        override.updated_by_id = current_user.id

    db.commit()
    db.refresh(settings_row)
    db.refresh(override)
    invalidate_settings(current_user.org_id)

    return AdminSettingsResponse(
        id=settings_row.id,
        org_id=settings_row.org_id,
        active_cycle=settings_row.active_cycle_name,
        cycle_type=settings_row.cycle_type,
        fiscal_start_month=settings_row.fiscal_start_month,
        goals_edit_enabled=settings_row.goals_edit_enabled,
        annual_goals_edit_enabled=override.annual_goals_edit_enabled,
        project_ratings_visible=override.project_ratings_visible,
        annual_reviews_enabled=override.annual_reviews_enabled,
        annual_review_final_rating_visible=override.annual_review_final_rating_visible,
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
# PER-FISCAL-YEAR ACCESS CONFIGURATION
# =====================================================================
#
# These endpoints back the Year dropdown in the Admin Panel's System
# Settings tab. The four toggles (annual_reviews_enabled,
# annual_review_final_rating_visible, annual_goals_edit_enabled,
# project_ratings_visible) are configured per FY rather than as
# org-wide singletons — so HR can re-open FY26-27 review submissions
# while FY27-28 is the system-computed active cycle.

def _current_fy_label(settings_row: SystemSettings) -> str:
    """Compute the active FY label from a settings row (honours
    simulated_today)."""
    active_cycle = get_current_cycle_info(
        resolve_today(settings_row),
        CycleType(settings_row.cycle_type),
        settings_row.fiscal_start_month,
    )
    return extract_fy_label(active_cycle)


def _build_year_settings_response(
    row: SystemSettingsYearOverride,
    current_fy: str,
) -> YearSettingsResponse:
    return YearSettingsResponse(
        fy_label=row.fy_label,
        annual_reviews_enabled=row.annual_reviews_enabled,
        annual_review_final_rating_visible=row.annual_review_final_rating_visible,
        annual_goals_edit_enabled=row.annual_goals_edit_enabled,
        project_ratings_visible=row.project_ratings_visible,
        is_current=(row.fy_label == current_fy),
        updated_at=row.updated_at,
    )


@router.get("/settings/years", response_model=YearOptionsResponse)
def list_settings_years(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return selectable years for the System Settings dropdown.

    Sources, unioned and de-duplicated:
        - the current FY plus the two prior and two upcoming FYs
        - every FY that appears on this org's annual reviews
        - every FY that appears on this org's annual goals
        - every FY that already has an override row

    `has_override` lets the UI distinguish "configured" vs "untouched"
    years; the toggles will reflect default-deny values on years that
    haven't been saved yet.
    """
    _require_hr_any(current_user)

    settings_row = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id,
    ).first()
    if not settings_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System settings have not been configured.",
        )

    current_fy = _current_fy_label(settings_row)

    # Current FY ± 2 — gives HR a small forward / backward window without
    # cluttering the dropdown with decades. The UNION with FY labels
    # found on real data covers any straggler years outside that window.
    base_year = int(current_fy[2:4]) + 2000 if current_fy[2:4].isdigit() else None
    range_labels: set[str] = set()
    if base_year is not None:
        for delta in range(-2, 3):
            yr = base_year + delta
            range_labels.add(f"FY{yr % 100:02d}-{(yr + 1) % 100:02d}")

    review_labels = {
        row[0] for row in db.query(AnnualReview.cycle_name)
        .filter(AnnualReview.org_id == current_user.org_id)
        .distinct()
        .all()
        if row[0]
    }
    goal_labels = {
        row[0] for row in db.query(Goal.cycle_name)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.goal_type == GoalType.ANNUAL.value,
        )
        .distinct()
        .all()
        if row[0]
    }
    override_labels = {
        row[0] for row in db.query(SystemSettingsYearOverride.fy_label)
        .filter(SystemSettingsYearOverride.org_id == current_user.org_id)
        .all()
    }
    overrides_by_label = override_labels

    # AnnualReview.cycle_name and Goal.cycle_name are stored as bare FY
    # tokens (e.g. "FY26-27"), so we accept them verbatim. Defensive
    # extract_fy_label keeps any legacy "H1 FY26-27" rows in the same
    # canonical shape.
    all_labels: set[str] = set()
    all_labels.update(range_labels)
    for label in (*review_labels, *goal_labels):
        canonical = extract_fy_label(label)
        if canonical.upper().startswith("FY"):
            all_labels.add(canonical)
    all_labels.update(override_labels)

    # Sort descending so the most recent FY (typically the current one)
    # is at the top of the dropdown.
    def _sort_key(fy: str) -> int:
        # "FY26-27" → 2026; fallback 0 for malformed entries.
        head = fy[2:4]
        return 2000 + int(head) if head.isdigit() else 0

    years = sorted(all_labels, key=_sort_key, reverse=True)
    options = [
        YearOption(
            fy_label=fy,
            is_current=(fy == current_fy),
            has_override=(fy in overrides_by_label),
        )
        for fy in years
    ]
    return YearOptionsResponse(years=options)


@router.get("/settings/year/{fy_label}", response_model=YearSettingsResponse)
def get_year_settings(
    fy_label: str,
    db: DbSession,
    current_user: CurrentUser,
):
    """Return the per-FY override row, lazy-creating from the latest
    existing override (or legacy SystemSettings flags) if missing."""
    _require_hr_any(current_user)

    settings_row = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id,
    ).first()
    if not settings_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System settings have not been configured.",
        )

    canonical = extract_fy_label(fy_label)
    if not canonical.upper().startswith("FY"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{fy_label}' is not a valid fiscal-year label.",
        )

    row = ensure_year_override_row(
        db,
        current_user.org_id,
        canonical,
        seed_from_settings=settings_row,
    )
    return _build_year_settings_response(row, _current_fy_label(settings_row))


@router.patch("/settings/year/{fy_label}", response_model=YearSettingsResponse)
def update_year_settings(
    fy_label: str,
    payload: YearSettingsUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Update the four access toggles for a specific FY."""
    _require_hr_any(current_user)

    settings_row = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id,
    ).first()
    if not settings_row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System settings have not been configured.",
        )

    canonical = extract_fy_label(fy_label)
    if not canonical.upper().startswith("FY"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{fy_label}' is not a valid fiscal-year label.",
        )

    row = ensure_year_override_row(
        db,
        current_user.org_id,
        canonical,
        seed_from_settings=settings_row,
        updated_by_id=current_user.id,
    )
    for flag in YEAR_OVERRIDE_FLAGS:
        setattr(row, flag, bool(getattr(payload, flag)))
    row.updated_by_id = current_user.id
    db.commit()
    db.refresh(row)
    invalidate_settings(current_user.org_id)

    return _build_year_settings_response(row, _current_fy_label(settings_row))


@router.get(
    "/settings/year/{fy_label}/preflight",
    response_model=YearPreflightResponse,
)
def year_settings_preflight(
    fy_label: str,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Year-scoped variant of `/settings/preflight`. Counts users who would
    be stranded if the toggle flipped off, filtered to the requested FY.

    Visibility-only flags (project_ratings_visible,
    annual_review_final_rating_visible) always return 0 — flipping them
    off doesn't lock anyone out, it just hides numbers.
    """
    _require_hr_any(current_user)

    canonical = extract_fy_label(fy_label)
    if not canonical.upper().startswith("FY"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{fy_label}' is not a valid fiscal-year label.",
        )

    staff_ids_subq = (
        db.query(User.id)
        .filter(
            User.org_id == current_user.org_id,
            User.role == Role.STAFF.value,
            User.is_deleted == False,  # noqa: E712
        )
        .subquery()
    )

    # ── annual_goals_edit_enabled ───────────────────────────────────
    goal_user_ids_subq = (
        db.query(Goal.user_id)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.goal_type == GoalType.ANNUAL.value,
            Goal.cycle_name == canonical,
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
    in_flight_reviews = (
        db.query(sql_func.count(AnnualReview.id))
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == canonical,
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
            AnnualReview.cycle_name == canonical,
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
                f"{count} {noun} {verb} created annual goals for {canonical} yet. "
                f"Disabling will block them from doing so until you re-enable."
            )
        return (
            f"{count} {noun} {verb} completed self-review/mentor evaluation for {canonical}. "
            f"Disabling will block new submissions until you re-enable."
        )

    return YearPreflightResponse(
        fy_label=canonical,
        annual_goals_edit_enabled=YearPreflightEntry(
            in_flight_count=staff_without_goals,
            warning=_msg(staff_without_goals, "goals"),
        ),
        annual_reviews_enabled=YearPreflightEntry(
            in_flight_count=review_in_flight,
            warning=_msg(review_in_flight, "reviews"),
        ),
        project_ratings_visible=YearPreflightEntry(in_flight_count=0, warning=None),
        annual_review_final_rating_visible=YearPreflightEntry(in_flight_count=0, warning=None),
    )


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