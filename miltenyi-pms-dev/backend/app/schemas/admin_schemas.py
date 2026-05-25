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
    is_deleted: bool
    created_at: datetime

    # Nested objects — populated from SQLAlchemy relationships
    function: Optional[FunctionBrief] = None
    designation: Optional[DesignationBrief] = None

    # Project Manager names — derived from each Employee's active project
    # assignments (end_date IS NULL). Empty list for non-Employee users
    # or for Employees with no active assignments. Sorted alphabetically
    # and deduplicated. Computed in one batched query by the list_users
    # handler so the response isn't N+1.
    project_manager_names: list[str] = []

    model_config = ConfigDict(from_attributes=True)


_ROLE_PATTERN = r"^(HR_MyOrg|HR_Miltenyi|Mentor|PM|Employee)$"


class UserCreate(BaseModel):
    """Payload from the 'Add New User' modal."""
    employee_code: str = Field(..., min_length=1, max_length=20)
    full_name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=5, max_length=100)
    phone: Optional[str] = None
    role: str = Field(..., pattern=_ROLE_PATTERN)
    function_id: Optional[int] = None
    designation_id: Optional[int] = None
    mentor_id: Optional[int] = None
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


# ── Admin Settings (Simplified View) ─────────────────────────────────

class AdminSettingsResponse(BaseModel):
    """
    Full settings payload for the Admin Panel's SystemSettingsTab.

    'active_cycle' is the computed cycle name (read-only, system-calculated).
    cycle_type and fiscal_start_month are the editable inputs that drive it.
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
    goals_edit_enabled: bool
    annual_goals_edit_enabled: bool
    project_ratings_visible: bool
    annual_reviews_enabled: bool
    annual_review_final_rating_visible: bool
    # Dev / QA escape hatch. When set, the system treats this as today
    # for every cycle-determination and review-window check.
    simulated_today: Optional[date] = None
    # Tells the UI whether the date-simulation field should be shown at
    # all. Mirrors the backend's ALLOW_DATE_SIMULATION env flag — the
    # field stays hidden (and writes are rejected) when False.
    simulation_allowed: bool = False
    updated_at: Optional[datetime] = None


class AdminSettingsUpdate(BaseModel):
    """Payload from the SystemSettingsTab save button. All fields optional (PATCH semantics)."""
    cycle_type: Optional[str] = Field(default=None, pattern=r"^(annual|half_yearly|quarterly)$")
    fiscal_start_month: Optional[int] = Field(default=None, ge=1, le=12)
    # IANA timezone (e.g. "Asia/Kolkata", "Europe/Berlin"). Validated
    # at runtime by ZoneInfo — bad strings are tolerated at read time
    # (cycle_utils falls back to UTC) so a typo can't brick the cycle
    # path, but admins should still pick a valid zone here.
    timezone: Optional[str] = Field(default=None, min_length=1, max_length=64)
    goals_edit_enabled: Optional[bool] = None
    annual_goals_edit_enabled: Optional[bool] = None
    project_ratings_visible: Optional[bool] = None
    annual_reviews_enabled: Optional[bool] = None
    annual_review_final_rating_visible: Optional[bool] = None
    # Use the sentinel `Optional[date]` plus the per-request `clear`
    # convention: pass `null` to clear an existing simulated_today, or
    # a real date to set one. Omit entirely to leave unchanged.
    simulated_today: Optional[date] = None
    # Companion flag — when True, the patch wants to clear the
    # `simulated_today` value (since omitting the key is "leave
    # unchanged" in PATCH semantics, we need an explicit clear signal).
    clear_simulated_today: Optional[bool] = None


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
    project_ratings_visible: bool
    is_current: bool
    updated_at: Optional[datetime] = None


class YearSettingsUpdate(BaseModel):
    """PATCH payload — all four toggles required (HR sees them together)."""
    annual_reviews_enabled: bool
    annual_review_final_rating_visible: bool
    annual_goals_edit_enabled: bool
    project_ratings_visible: bool


class YearPreflightEntry(BaseModel):
    in_flight_count: int
    warning: Optional[str] = None


class YearPreflightResponse(BaseModel):
    """Per-FY in-flight counts. Same shape as the legacy preflight, with
    counts scoped to the requested FY rather than the active one."""
    fy_label: str
    annual_goals_edit_enabled: YearPreflightEntry
    annual_reviews_enabled: YearPreflightEntry
    project_ratings_visible: YearPreflightEntry
    annual_review_final_rating_visible: YearPreflightEntry