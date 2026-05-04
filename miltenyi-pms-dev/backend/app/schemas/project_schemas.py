"""
Project Schemas — Revised for PM-centric flow.

Changes:
    - Removed allocated_hours
    - Renamed end_date → expected_end_date
    - Added reports_to_id + reports_to_name on Project (required on create)
    - Added pm_id + pm_name on Project (Primary evaluator, resolved in responses)
    - Added secondary_evaluator_id + secondary_evaluator_name on Project
      (single project-level secondary; replaces multi-row Secondary assignments)
    - Added department_id + department_name on Assignment
    - Assignment.evaluator_type is "Primary" or null only
    - ProjectCreate validates: reports_to_id required, exactly one Primary
"""

from pydantic import BaseModel, Field, ConfigDict, model_validator
from typing import Optional
from datetime import date, datetime


# ── Assignment Schemas ───────────────────────────────────────────────

class AssignmentCreate(BaseModel):
    """Payload for adding a member to a project."""
    user_id: int
    assignment_role: Optional[str] = Field(
        default=None, max_length=100,
        description="Auto-filled from designation, editable per project"
    )
    department_id: Optional[int] = Field(
        default=None,
        description="Auto-filled from user's department, editable per project"
    )
    evaluator_type: Optional[str] = Field(
        default=None, pattern=r"^Primary$",
        description="'Primary' marks the PM. Secondary lives on the project, not the assignment.",
    )
    assigned_date: Optional[date] = None


class AssignmentUpdate(BaseModel):
    """Payload for updating a member's role or PM flag."""
    assignment_role: Optional[str] = Field(default=None, max_length=100)
    department_id: Optional[int] = None
    evaluator_type: Optional[str] = Field(
        default=None, pattern=r"^Primary$"
    )
    assigned_date: Optional[date] = None


class AssignmentResponse(BaseModel):
    """Assignment with resolved user/department names."""
    id: int
    project_id: int
    user_id: int
    user_name: str
    assignment_role: Optional[str] = None
    department_id: Optional[int] = None
    department_name: Optional[str] = None
    evaluator_type: Optional[str] = None
    assigned_date: Optional[date] = None
    created_at: datetime


# ── Project Schemas ──────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    """Payload from the Admin Panel when creating a project.

    Validation:
        - reports_to_id is required.
        - assignments must contain exactly one entry with evaluator_type='Primary'
          (the PM). Members beyond the PM are optional.
        - secondary_evaluator_id is optional (editable later).
    """
    project_code: str = Field(..., min_length=1, max_length=20)
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    start_date: Optional[date] = None
    expected_end_date: Optional[date] = None
    reports_to_id: int = Field(
        ...,
        description="Senior person who reviews the PM on this project (required)",
    )
    secondary_evaluator_id: Optional[int] = Field(
        default=None,
        description="Single Secondary evaluator for the project; optional, editable later.",
    )
    assignments: list[AssignmentCreate] = Field(default_factory=list)

    @model_validator(mode="after")
    def _require_one_primary(self) -> "ProjectCreate":
        primaries = [a for a in self.assignments if a.evaluator_type == "Primary"]
        if len(primaries) != 1:
            raise ValueError(
                "A project must have exactly one Primary evaluator (PM). "
                "Mark exactly one member with evaluator_type='Primary'."
            )
        return self

    @model_validator(mode="after")
    def _no_reviewer_role_overlap(self) -> "ProjectCreate":
        """The PM, the senior who reviews them ("Reports To"), and the
        Secondary evaluator must be three distinct people. Allowing any
        two of these to be the same user would let one person review
        themselves or hold both reviewer roles, breaking the chain.
        """
        primaries = [a for a in self.assignments if a.evaluator_type == "Primary"]
        pm_user_id = primaries[0].user_id if primaries else None

        if pm_user_id is not None and self.reports_to_id == pm_user_id:
            raise ValueError(
                "PM Reports To must be a different user than the PM."
            )
        if (
            self.secondary_evaluator_id is not None
            and pm_user_id is not None
            and self.secondary_evaluator_id == pm_user_id
        ):
            raise ValueError(
                "Secondary Evaluator must be a different user than the PM."
            )
        if (
            self.secondary_evaluator_id is not None
            and self.secondary_evaluator_id == self.reports_to_id
        ):
            raise ValueError(
                "Secondary Evaluator must be a different user than PM Reports To."
            )
        return self


class ProjectUpdate(BaseModel):
    """Payload for updating project metadata."""
    project_code: Optional[str] = Field(default=None, min_length=1, max_length=20)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = None
    start_date: Optional[date] = None
    expected_end_date: Optional[date] = None
    reports_to_id: Optional[int] = None
    secondary_evaluator_id: Optional[int] = None


class ProjectResponse(BaseModel):
    """Lightweight project record for list views."""
    id: int
    org_id: int
    project_code: str
    name: str
    description: Optional[str] = None
    start_date: Optional[date] = None
    expected_end_date: Optional[date] = None
    reports_to_id: Optional[int] = None
    reports_to_name: Optional[str] = None
    pm_id: Optional[int] = None
    pm_name: Optional[str] = None
    secondary_evaluator_id: Optional[int] = None
    secondary_evaluator_name: Optional[str] = None
    is_deleted: bool
    created_at: datetime
    updated_at: Optional[datetime] = None
    member_count: int = 0

    model_config = ConfigDict(from_attributes=True)


class ProjectDetail(ProjectResponse):
    """Full project with nested assignments."""
    assignments: list[AssignmentResponse] = []