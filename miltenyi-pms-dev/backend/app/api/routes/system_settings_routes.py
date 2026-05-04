"""
SystemSettings Routes — The Organization's Control Panel API.

Endpoints:
    GET  /api/v1/settings/        → Any authenticated user (Topbar needs this)
    POST /api/v1/settings/        → Admin only (first-time initialization)
    PATCH /api/v1/settings/       → Admin only (update active cycle / flags)

Security Layers Applied:
    Layer 1 — Authentication:     CurrentUser dependency (JWT validation)
    Layer 2 — Tenant Isolation:   All queries filter by current_user.org_id
    Layer 3 — Role Authorization: Write endpoints restricted to Admin role
    Layer 4 — Ownership:          Not applicable (org-level singleton, no per-user ownership)
"""

from enum import Enum
from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import DbSession, CurrentUser
from app.core.cache import invalidate_settings, system_settings_cache
from app.models.system_settings_models import SystemSettings
from app.schemas.system_settings_schemas import (
    SystemSettingsCreate,
    SystemSettingsResponse,
    SystemSettingsUpdate,
)

router = APIRouter()


@router.get("/", response_model=SystemSettingsResponse)
def get_system_settings(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Retrieve the active cycle configuration for the current user's organization.

    This endpoint is intentionally open to ALL authenticated users (not just Admins)
    because the Topbar component needs to display the active cycle name on every page.
    Tenant isolation is still enforced — you only ever see your own org's settings.

    Cached per-org via app.core.cache.system_settings_cache. Invalidated on every
    write to SystemSettings (POST/PATCH here and admin PATCH /admin/settings) so a
    save reflects immediately rather than waiting for the TTL.
    """
    def _query() -> SystemSettingsResponse:
        row = db.query(SystemSettings).filter(
            SystemSettings.org_id == current_user.org_id
        ).first()

        if not row:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="System settings have not been configured for this organization."
            )

        return SystemSettingsResponse.model_validate(row, from_attributes=True)

    return system_settings_cache.get_or_compute(current_user.org_id, _query)


@router.post(
    "/",
    response_model=SystemSettingsResponse,
    status_code=status.HTTP_201_CREATED,
)
def initialize_system_settings(
    settings_in: SystemSettingsCreate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Initialize system settings for the organization (first-time setup).

    This is a one-time operation — the unique index on org_id prevents duplicates.
    If settings already exist, we return 409 Conflict rather than silently overwriting.
    """
    # Layer 3 — Role Authorization
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can initialize system settings."
        )

    # Guard against duplicate initialization
    existing = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id
    ).first()

    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="System settings already exist for this organization. Use PATCH to update."
        )

    new_settings = SystemSettings(
        org_id=current_user.org_id,  # Forced from JWT — never trusted from request body
        active_cycle_name=settings_in.active_cycle_name,
        cycle_type=settings_in.cycle_type.value,  # Enum → string for DB storage
        fiscal_start_month=getattr(settings_in, 'fiscal_start_month', 4), # Fallback to 4 if not in schema
        cycle_start_date=settings_in.cycle_start_date,
        cycle_end_date=settings_in.cycle_end_date,
        goals_submission_open=settings_in.goals_submission_open,
        reviews_submission_open=settings_in.reviews_submission_open,
        updated_by_id=current_user.id,
    )

    db.add(new_settings)
    db.commit()
    db.refresh(new_settings)
    invalidate_settings(current_user.org_id)

    return new_settings


@router.patch("/", response_model=SystemSettingsResponse)
def update_system_settings(
    settings_in: SystemSettingsUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Update the active cycle, submission gates, or date boundaries.

    This is the endpoint HR Admins use from the Admin Panel to:
    - Rotate the active cycle (e.g. "H1 FY26" → "H2 FY26")
    - Open/close goal submission windows
    - Open/close annual review submission windows
    """
    # Layer 3 — Role Authorization
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can modify system settings."
        )

    # Layer 2 — Tenant Isolation
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id
    ).first()

    if not settings:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="System settings have not been initialized. Use POST to create."
        )

    # Dynamic field update — only touches fields the Admin actually sent.
    # model_dump(exclude_unset=True) is Pydantic V2's way of saying
    # "give me ONLY the fields that were explicitly included in the request body."
    update_data = settings_in.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        # Enum fields must be stored as their string .value in SQLite/Postgres
        if isinstance(value, Enum):
            setattr(settings, field, value.value)
        else:
            setattr(settings, field, value)

    # Stamp the audit trail — who changed it and when
    settings.updated_by_id = current_user.id

    db.commit()
    db.refresh(settings)
    invalidate_settings(current_user.org_id)

    return settings