"""
Admin Schemas — The Admin Panel's API Contract.

These schemas mirror the TypeScript interfaces in admin.service.ts exactly.
Key mapping note: The frontend uses `active_cycle` while the database stores
`active_cycle_name`. The AdminSettingsResponse schema handles this translation
via a computed field so neither side needs to change.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime, date


# ── Reference Data (Dropdowns) ───────────────────────────────────────

class FunctionBrief(BaseModel):
    """Lightweight function payload for <select> dropdowns."""
    id: int
    name: str

    model_config = ConfigDict(from_attributes=True)


class DesignationBrief(BaseModel):
    """Lightweight designation payload for <select> dropdowns.

    `career_level` is the GCC band (1..4) the title sits in; `level`
    remains as the legacy hierarchical sort key so existing dropdown
    ordering doesn't shift while career_level isn't yet surfaced in the
    UI.
    """
    id: int
    name: str
    level: int
    career_level: int | None = None
    career_level_label: str | None = None
    function_id: int | None = None
    function_id: int | None = None

    model_config = ConfigDict(from_attributes=True)


# ── User Schemas ─────────────────────────────────────────────────────

class UserResponse(BaseModel):
    """
    Full user record returned to the Admin table.

    Includes nested function/designation objects so the table can
    display human-readable names without a second lookup.
    """
    id: int
    org_id: int
    employee_code: str
    full_name: str
    email: str
    phone: Optional[str] = None
    role: str
    function_id: Optional[int] = None
    designation_id: Optional[int] = None
    mentor_id: Optional[int] = None
    # Project Goals: the Miltenyi manager whose comments this employee's
    # mentor transcribes. Plain text — Miltenyi staff have no login.
    miltenyi_reviewer_name: Optional[str] = None
    is_deleted: bool
    created_at: datetime

    # Nested objects — populated from SQLAlchemy relationships
    function: Optional[FunctionBrief] = None
    designation: Optional[DesignationBrief] = None

    model_config = ConfigDict(from_attributes=True)


_ROLE_PATTERN = r"^(HR_MyOrg|HR_Miltenyi|Mentor|PM|Employee)$"


class UserCreate(BaseModel):
    """Payload from the 'Add New User' modal.

    `employee_code` is OPTIONAL and effectively advisory — the create
    route auto-derives the canonical code from the role per the
    convention in `admin_routes._compute_next_employee_code`. Any
    value the client sends is ignored. Field kept on the schema so
    existing clients that still send it don't 422.
    """
    employee_code: Optional[str] = Field(default=None, max_length=20)
    full_name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=5, max_length=100)
    phone: Optional[str] = None
    role: str = Field(..., pattern=_ROLE_PATTERN)
    function_id: Optional[int] = None
    designation_id: Optional[int] = None
    mentor_id: Optional[int] = None
    miltenyi_reviewer_name: Optional[str] = Field(default=None, max_length=200)
    password: str = Field(..., min_length=8, max_length=128)


class UserUpdate(BaseModel):
    """Payload from the 'Edit User' modal — all fields optional (PATCH semantics)."""
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    phone: Optional[str] = None
    role: Optional[str] = Field(default=None, pattern=_ROLE_PATTERN)
    employee_code: Optional[str] = Field(default=None, min_length=1, max_length=20)
    function_id: Optional[int] = None
    designation_id: Optional[int] = None
    mentor_id: Optional[int] = None
    miltenyi_reviewer_name: Optional[str] = Field(default=None, max_length=200)


# ── Admin Settings (Simplified View) ─────────────────────────────────

class AdminSettingsResponse(BaseModel):
    """
    Full settings payload for the Admin Panel's SystemSettingsTab.

    'active_cycle' is the computed cycle name (read-only, system-calculated).
    cycle_type is fixed (half-yearly); fiscal_start_month drives it.
    """
    id: int
    org_id: int
    active_cycle: Optional[str] = None
    cycle_type: str
    fiscal_start_month: int
    # IANA timezone string driving every calendar-day decision on the
    # backend (cycle rollover, FY-end gates, assignment end dates, etc.).
    # Defaults to "UTC" so existing rows keep current behavior until HR
    # picks an actual zone.
    timezone: str = "UTC"
    annual_goals_edit_enabled: bool
    annual_reviews_enabled: bool
    annual_review_final_rating_visible: bool
    goal_reviews_visible_h1: bool = False
    goal_reviews_visible_h2: bool = False
    management_review_enabled: bool = False
    updated_at: Optional[datetime] = None


class AdminSettingsUpdate(BaseModel):
    """Payload from the SystemSettingsTab save button. All fields optional (PATCH semantics)."""
    fiscal_start_month: Optional[int] = Field(default=None, ge=1, le=12)
    # IANA timezone (e.g. "Asia/Kolkata", "Europe/Berlin"). Validated
    # at runtime by ZoneInfo — bad strings are tolerated at read time
    # (cycle_utils falls back to UTC) so a typo can't brick the cycle
    # path, but admins should still pick a valid zone here.
    timezone: Optional[str] = Field(default=None, min_length=1, max_length=64)
    annual_goals_edit_enabled: Optional[bool] = None
    annual_reviews_enabled: Optional[bool] = None
    annual_review_final_rating_visible: Optional[bool] = None
    goal_reviews_visible_h1: Optional[bool] = None
    goal_reviews_visible_h2: Optional[bool] = None
    management_review_enabled: Optional[bool] = None


# ── Per-Fiscal-Year Override Schemas ─────────────────────────────────
# The four access-control toggles now live on a separate per-FY table.
# The Admin Panel's Year dropdown loads the row for the selected FY and
# the four toggles drive these values.

class YearOption(BaseModel):
    """One entry in the Year dropdown."""
    fy_label: str            # canonical bare-FY token (e.g. "FY26-27")
    is_current: bool         # True for the system-computed active FY
    has_override: bool       # False until HR has saved at least once


class YearOptionsResponse(BaseModel):
    """Payload of `GET /admin/settings/years`."""
    years: list[YearOption]


class YearSettingsResponse(BaseModel):
    """Per-FY settings payload — what the Admin Panel binds toggles to."""
    fy_label: str
    annual_reviews_enabled: bool
    annual_review_final_rating_visible: bool
    annual_goals_edit_enabled: bool
    # 25 Sep 2026: mentee visibility of the mentor's goal review, per half;
    # and the Management Review (calibration) window.
    goal_reviews_visible_h1: bool = False
    goal_reviews_visible_h2: bool = False
    management_review_enabled: bool = False
    is_current: bool
    updated_at: Optional[datetime] = None


class YearSettingsUpdate(BaseModel):
    """PATCH payload — every switch of the year, sent together (HR sees them together)."""
    annual_reviews_enabled: bool
    annual_review_final_rating_visible: bool
    annual_goals_edit_enabled: bool
    goal_reviews_visible_h1: bool = False
    goal_reviews_visible_h2: bool = False
    management_review_enabled: bool = False


class YearPreflightEntry(BaseModel):
    in_flight_count: int
    warning: Optional[str] = None


class YearPreflightResponse(BaseModel):
    """Per-FY in-flight counts. Same shape as the legacy preflight, with
    counts scoped to the requested FY rather than the active one."""
    fy_label: str
    annual_goals_edit_enabled: YearPreflightEntry
    annual_reviews_enabled: YearPreflightEntry
    annual_review_final_rating_visible: YearPreflightEntry
    management_review_enabled: YearPreflightEntry = YearPreflightEntry(in_flight_count=0)
    goal_reviews_visible_h1: YearPreflightEntry = YearPreflightEntry(in_flight_count=0)
    goal_reviews_visible_h2: YearPreflightEntry = YearPreflightEntry(in_flight_count=0)


# ── Reference data writes (Framework tab) ────────────────────────────

class FunctionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class FunctionUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class DesignationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    function_id: int
    career_level: int = Field(..., ge=1, le=12)


class DesignationUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    function_id: Optional[int] = None
    career_level: Optional[int] = Field(default=None, ge=1, le=12)


# ── Reference data writes (Framework tab) ────────────────────────────

class FunctionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class FunctionUpdate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)


class DesignationCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    function_id: int
    career_level: int = Field(..., ge=1, le=12)


class DesignationUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=120)
    function_id: Optional[int] = None
    career_level: Optional[int] = Field(default=None, ge=1, le=12)
