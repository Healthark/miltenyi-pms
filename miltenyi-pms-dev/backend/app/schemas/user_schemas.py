"""
User Schemas — Self-Service Endpoints for Authenticated Users.

These schemas power the Profile page and password change flow.
They are NOT admin schemas — these are what regular users see about themselves.
"""

from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime


# ── Password Change ──────────────────────────────────────────────────

class PasswordChangeRequest(BaseModel):
    """Payload from the PasswordChangeCard component."""
    current_password: str = Field(..., min_length=1)
    new_password: str = Field(..., min_length=8, max_length=128)


# ── Profile Response ─────────────────────────────────────────────────

class UserProfile(BaseModel):
    """
    Rich profile payload for the Profile page.

    Contains everything the ProfileInfoCard needs to render:
    identity fields, HR-controlled metadata (function, designation,
    mentor), and the org name for context. All of this is read-only
    on the frontend — only password and avatar are user-editable.
    """
    id: int
    org_id: int
    org_name: str

    employee_code: str
    full_name: str
    email: str
    phone: Optional[str] = None
    role: str
    avatar_url: Optional[str] = None

    # HR-controlled fields — displayed as read-only text
    function: Optional[str] = None
    designation: Optional[str] = None
    mentor_name: Optional[str] = None

    created_at: datetime

# Add this to the bottom of app/schemas/user_schemas.py
class UserRoleExpectationResponse(BaseModel):
    """The current user's GCC role expectation — resolved from
    (function, designation.career_level). When no matching row exists,
    the route still returns a payload with every exp_* field carrying
    a 'not defined' placeholder string so the frontend never has to
    null-check the panel."""
    function_name: str | None
    designation_name: str | None
    career_level: int | None = None             # 1..4 or null
    career_level_label: str | None = None       # "Entry" / "Mid" / "Senior" / "Lead"
    exp_scope_of_role: str
    exp_key_responsibilities: str
    exp_technical_competencies: str
    exp_delivery_ownership: str
    exp_regulatory_compliance: str
    exp_project_resource_management: str