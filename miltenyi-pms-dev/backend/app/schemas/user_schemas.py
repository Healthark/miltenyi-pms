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
    identity fields, HR-controlled metadata (department, designation,
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
    department: Optional[str] = None
    designation: Optional[str] = None
    mentor_name: Optional[str] = None

    created_at: datetime

# Add this to the bottom of app/schemas/user_schemas.py
class UserRoleExpectationResponse(BaseModel):
    department_name: str | None
    designation_name: str | None
    exp_task_execution: str
    exp_ownership: str
    exp_project_management: str
    exp_client_deliverables: str
    exp_communication: str
    exp_mentoring: str
    exp_firm_growth: str
    exp_competency_skills: str