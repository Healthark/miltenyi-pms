"""
SystemSettings Schemas — The Contract Between Frontend and Backend.

These schemas enforce strict validation on every system settings request.
The CycleType enum is imported from the model layer (single source of truth)
to ensure the API and database always agree on valid values.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import date, datetime

from app.models.system_settings_models import CycleType


# ── Response Schema ──────────────────────────────────────────────────
# What we send BACK to the React frontend. This is the most-used schema
# since both the Topbar (GET) and Admin panel (after PATCH) consume it.
class SystemSettingsResponse(BaseModel):
    id: int
    org_id: int

    active_cycle_name: str
    cycle_type: CycleType
    fiscal_start_month: int
    # IANA timezone (e.g. "UTC", "Asia/Kolkata", "Europe/Berlin"). Used
    # by the backend to anchor every calendar-day decision so users near
    # midnight in non-UTC zones don't hit off-by-one rollovers. Exposed
    # here for completeness; the frontend doesn't need to act on it.
    timezone: str = "UTC"

    # The three per-FY access toggles, mirrored from the CURRENT fiscal
    # year's `system_settings_year_overrides` row by GET /settings/ so
    # banners and gates that don't know a record's FY keep working. They
    # are not columns on the settings row.
    annual_goals_edit_enabled: bool = False
    annual_reviews_enabled: bool = False
    annual_review_final_rating_visible: bool = False
    goal_reviews_visible_h1: bool = False
    goal_reviews_visible_h2: bool = False
    management_review_enabled: bool = False

    updated_by_id: Optional[int] = None
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


# ── Create Schema ────────────────────────────────────────────────────
# Used only during org onboarding / seed script to initialize settings.
# org_id is NOT accepted here — it is forced from current_user.org_id
# on the backend (Multi-Tenancy Golden Rule).
class SystemSettingsCreate(BaseModel):
    active_cycle_name: str = Field(
        ...,
        min_length=1,
        max_length=50,
        description="Display label for the active cycle, e.g. 'H1 FY26'"
    )
    cycle_type: CycleType = CycleType.HALF_YEARLY
    fiscal_start_month: int = Field(
        default=4,
        ge=1,
        le=12,
        description="Month (1-12) the fiscal year starts"
    )


# ── Update Schema ────────────────────────────────────────────────────
# Everything is Optional — Pydantic's model_dump(exclude_unset=True)
# ensures only fields the Admin actually sent are written to the DB.
# Field: fiscal_start_month. The timezone is read-only in the UI, the
# per-FY toggles and the developer date simulation have their own routes,
# and the H1/H2 calendar bypass was removed on 20 Sep 2026.
class SystemSettingsUpdate(BaseModel):
    fiscal_start_month: Optional[int] = Field(
        default=None,
        ge=1,
        le=12,
        description="Month (1-12) the fiscal year starts"
    )
    # The active cycle label is computed on every read, and the cadence is
    # fixed at half-yearly, so neither is accepted here. The per-FY toggles
    # are written through /admin/settings/year/{fy}.
