"""
Admin Schemas — The Admin Panel's API Contract.

These schemas mirror the TypeScript interfaces in admin.service.ts exactly.
Key mapping note: The frontend uses `active_cycle` while the database stores
`active_cycle_name`. The AdminSettingsResponse schema handles this translation
via a computed field so neither side needs to change.
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime


# ── Reference Data (Dropdowns) ───────────────────────────────────────

class DepartmentBrief(BaseModel):
    """Lightweight department payload for <select> dropdowns."""
    id: int
    name: str

    model_config = ConfigDict(from_attributes=True)


class DesignationBrief(BaseModel):
    """Lightweight designation payload for <select> dropdowns."""
    id: int
    name: str
    level: int

    model_config = ConfigDict(from_attributes=True)


# ── User Schemas ─────────────────────────────────────────────────────

class UserResponse(BaseModel):
    """
    Full user record returned to the Admin table.

    Includes nested department/designation objects so the table can
    display human-readable names without a second lookup.
    """
    id: int
    org_id: int
    employee_code: str
    full_name: str
    email: str
    phone: Optional[str] = None
    role: str
    department_id: Optional[int] = None
    designation_id: Optional[int] = None
    mentor_id: Optional[int] = None
    is_deleted: bool
    created_at: datetime

    # Nested objects — populated from SQLAlchemy relationships
    department: Optional[DepartmentBrief] = None
    designation: Optional[DesignationBrief] = None

    model_config = ConfigDict(from_attributes=True)


class UserCreate(BaseModel):
    """Payload from the 'Add New User' modal."""
    employee_code: str = Field(..., min_length=1, max_length=20)
    full_name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=5, max_length=100)
    phone: Optional[str] = None
    role: str = Field(..., pattern=r"^(Admin|Manager|Principal|Staff)$")
    department_id: Optional[int] = None
    designation_id: Optional[int] = None
    mentor_id: Optional[int] = None
    password: str = Field(..., min_length=8, max_length=128)


class UserUpdate(BaseModel):
    """Payload from the 'Edit User' modal — all fields optional (PATCH semantics)."""
    full_name: Optional[str] = Field(default=None, min_length=1, max_length=100)
    phone: Optional[str] = None
    role: Optional[str] = Field(default=None, pattern=r"^(Admin|Manager|Principal|Staff)$")
    employee_code: Optional[str] = Field(default=None, min_length=1, max_length=20)
    department_id: Optional[int] = None
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
    goals_edit_enabled: bool
    annual_goals_edit_enabled: bool
    annual_goals_final_rating_visible: bool
    project_ratings_visible: bool
    annual_reviews_enabled: bool
    annual_review_final_rating_visible: bool
    updated_at: Optional[datetime] = None


class AdminSettingsUpdate(BaseModel):
    """Payload from the SystemSettingsTab save button. All fields optional (PATCH semantics)."""
    cycle_type: Optional[str] = Field(default=None, pattern=r"^(annual|half_yearly|quarterly)$")
    fiscal_start_month: Optional[int] = Field(default=None, ge=1, le=12)
    goals_edit_enabled: Optional[bool] = None
    annual_goals_edit_enabled: Optional[bool] = None
    annual_goals_final_rating_visible: Optional[bool] = None
    project_ratings_visible: Optional[bool] = None
    annual_reviews_enabled: Optional[bool] = None
    annual_review_final_rating_visible: Optional[bool] = None