"""
Project Schemas — PM as a project-level field.

Schema map:
    AssignmentCreate / AssignmentResponse → team members only (no PM here)
    ProjectCreate                        → pm_id required, secondary_evaluator_id optional
    ProjectUpdate                        → patch any field, pm_id swappable
    ProjectResponse                      → resolved pm_name + secondary_evaluator_name
"""

from pydantic import BaseModel, Field, ConfigDict, model_validator
from typing import Optional
from datetime import date, datetime


# ── Assignment Schemas ───────────────────────────────────────────────

class AssignmentCreate(BaseModel):
    """Payload for adding a member to a project. The PM is NOT added via
    assignments — they live on Project.pm_id at the project level."""
    user_id: int
    assignment_role: Optional[str] = Field(
        default=None, max_length=100,
        description="Auto-filled from designation, editable per project",
    )
    function_id: Optional[int] = Field(
        default=None,
        description="Auto-filled from user's function, editable per project",
    )
    assigned_date: Optional[date] = None


class AssignmentUpdate(BaseModel):
    """Payload for updating a member's role/function."""
    assignment_role: Optional[str] = Field(default=None, max_length=100)
    function_id: Optional[int] = None
    assigned_date: Optional[date] = None


class AssignmentResponse(BaseModel):
    """Assignment with resolved user/function names.

    `end_date` is NULL for active members; set when the user has been
    removed from the project. Removed members stay in the response
    (sorted last) so HR can see history."""
    id: int
    project_id: int
    user_id: int
    user_name: str
    assignment_role: Optional[str] = None
    function_id: Optional[int] = None
    function_name: Optional[str] = None
    assigned_date: Optional[date] = None
    end_date: Optional[date] = None
    ended_by_name: Optional[str] = None
    created_at: datetime


# ── Project Schemas ──────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    """Create-project payload from the Admin Panel.

    Validation:
        - pm_id is required.
        - secondary_evaluator_id is optional.
        - PM and Secondary must be different people.
        - PM cannot also be in `assignments` (they're not a member).
        - Secondary can be in assignments OR not (no constraint).
        - Role validation (PM has role=PM, secondary is not PM/Mentor) is
          enforced at the route layer with a DB lookup.
    """
    project_code: str = Field(..., min_length=1, max_length=20)
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    start_date: Optional[date] = None
    expected_end_date: Optional[date] = None
    pm_id: int = Field(
        ...,
        description="The Miltenyi PM who reviews team members on this project (required)",
    )
    secondary_evaluator_id: Optional[int] = Field(
        default=None,
        description="Optional senior who adds an impact statement after the PM submits.",
    )
    assignments: list[AssignmentCreate] = Field(default_factory=list)

    @model_validator(mode="after")
    def _pm_and_secondary_disjoint(self) -> "ProjectCreate":
        if (
            self.secondary_evaluator_id is not None
            and self.secondary_evaluator_id == self.pm_id
        ):
            raise ValueError("Secondary Evaluator must be a different user than the PM.")
        return self

    @model_validator(mode="after")
    def _pm_not_in_assignments(self) -> "ProjectCreate":
        if any(a.user_id == self.pm_id for a in self.assignments):
            raise ValueError(
                "The PM is not a project member — remove them from the assignments list."
            )
        return self


class ProjectUpdate(BaseModel):
    """Patch project metadata. Any field optional."""
    project_code: Optional[str] = Field(default=None, min_length=1, max_length=20)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    start_date: Optional[date] = None
    expected_end_date: Optional[date] = None
    pm_id: Optional[int] = None
    secondary_evaluator_id: Optional[int] = None


class ProjectResponse(BaseModel):
    """Lightweight project record for list views.

    `status` is "active" or "completed". A completed project is
    archived: its team's reviews remain queryable for history but
    no new cycle placeholders are generated."""
    id: int
    org_id: int
    project_code: str
    name: str
    description: Optional[str] = None
    start_date: Optional[date] = None
    expected_end_date: Optional[date] = None
    pm_id: Optional[int] = None
    pm_name: Optional[str] = None
    secondary_evaluator_id: Optional[int] = None
    secondary_evaluator_name: Optional[str] = None
    status: str = "active"
    completed_at: Optional[datetime] = None
    completed_by_name: Optional[str] = None
    is_deleted: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    member_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class ProjectDetail(ProjectResponse):
    """Full project with nested assignments."""
    assignments: list[AssignmentResponse] = []
