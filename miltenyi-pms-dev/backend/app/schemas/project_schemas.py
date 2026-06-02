"""
Project Schemas — PM as a project-level field.

Schema map:
    AssignmentCreate / AssignmentResponse → team members only (no PM here)
    ProjectCreate                        → pm_id required, secondary_evaluator_id optional
    ProjectUpdate                        → patch any field, pm_id swappable
    ProjectResponse                      → resolved pm_name + secondary_evaluator_name
"""

from pydantic import BaseModel, Field, ConfigDict, field_validator, model_validator
from typing import Optional
from datetime import date, datetime


# ── Shared bounds ─────────────────────────────────────────────────────
#
# Lower + upper sanity bounds for any date entered in a project payload.
# Bounds the "we typed FY9999" / "we typed FY1900" tier of data-quality
# bugs without making the validator opinionated about FY semantics. The
# upper bound is calendar 2099-12-31 (far enough that no realistic
# expected_end_date would hit it; tight enough to catch obvious typos
# like 9999-12-31).
_MIN_PROJECT_DATE = date(2000, 1, 1)
_MAX_PROJECT_DATE = date(2099, 12, 31)


def _check_date_bounds(label: str, value: Optional[date]) -> None:
    """Raise ValueError if `value` is set and falls outside the sanity
    window. No-op when `value is None` — both project dates are
    optional."""
    if value is None:
        return
    if value < _MIN_PROJECT_DATE or value > _MAX_PROJECT_DATE:
        raise ValueError(
            f"{label} must be between {_MIN_PROJECT_DATE.isoformat()} "
            f"and {_MAX_PROJECT_DATE.isoformat()}."
        )


def _strip_or_none(v: object) -> object:
    """Lightweight pre-validator: strip leading/trailing whitespace on
    incoming strings so downstream `min_length=1` checks reject a
    string that's just spaces, and so uniqueness comparisons aren't
    defeated by trailing whitespace. Non-string values pass through
    untouched (Optional[int] fields, etc.)."""
    return v.strip() if isinstance(v, str) else v


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

    # Strip leading/trailing whitespace before max_length runs so a role
    # of "   " doesn't slip past as a 3-char string.
    _strip_role = field_validator("assignment_role", mode="before")(_strip_or_none)

    @field_validator("assigned_date")
    @classmethod
    def _assigned_date_in_bounds(cls, v: Optional[date]) -> Optional[date]:
        _check_date_bounds("Joined date", v)
        return v


class AssignmentUpdate(BaseModel):
    """Payload for updating a member's role/function."""
    assignment_role: Optional[str] = Field(default=None, max_length=100)
    function_id: Optional[int] = None
    assigned_date: Optional[date] = None

    _strip_role = field_validator("assignment_role", mode="before")(_strip_or_none)

    @field_validator("assigned_date")
    @classmethod
    def _assigned_date_in_bounds(cls, v: Optional[date]) -> Optional[date]:
        _check_date_bounds("Joined date", v)
        return v


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
        - project_code + name are stripped of whitespace BEFORE the
          min_length=1 check runs so " " is rejected as empty.
        - description is capped at 2000 chars to stop arbitrary-size
          payloads (the DB column is TEXT and would otherwise accept
          megabytes).
        - start_date, expected_end_date, and each assignment.assigned_date
          must fall in [2000-01-01, 2099-12-31] (sanity bounds — stops
          year-1900 / year-9999 typos).
        - expected_end_date must be on or after start_date when both set.
        - pm_id is required.
        - secondary_evaluator_id is optional.
        - PM and Secondary must be different people.
        - PM cannot also be in `assignments` (they're not a member).
        - Secondary can be in assignments OR not (no constraint).
        - Role validation (PM has role=PM, Secondary is role=PM OR
          role=HR_Miltenyi) is enforced at the route layer with a DB
          lookup. The Secondary pool was narrowed in PR #85 — previously
          it allowed anyone except PM/Mentor; now only PMs (on other
          projects than this one) and Miltenyi HR users are eligible.
        - Each assignment.assigned_date must fall inside the project's
          date window — enforced at the route layer because Pydantic
          model_validators are evaluated per-model and the assignment
          rows don't have access to the parent's date window during
          their own validation phase.
    """
    project_code: str = Field(..., min_length=1, max_length=20)
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
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

    # Strip whitespace before min_length / max_length checks.
    _strip_code = field_validator("project_code", mode="before")(_strip_or_none)
    _strip_name = field_validator("name", mode="before")(_strip_or_none)
    _strip_desc = field_validator("description", mode="before")(_strip_or_none)

    @field_validator("start_date")
    @classmethod
    def _start_in_bounds(cls, v: Optional[date]) -> Optional[date]:
        _check_date_bounds("Start date", v)
        return v

    @field_validator("expected_end_date")
    @classmethod
    def _end_in_bounds(cls, v: Optional[date]) -> Optional[date]:
        _check_date_bounds("Expected end date", v)
        return v

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

    @model_validator(mode="after")
    def _start_before_end(self) -> "ProjectCreate":
        if (
            self.start_date is not None
            and self.expected_end_date is not None
            and self.expected_end_date < self.start_date
        ):
            raise ValueError("Expected end date cannot be before start date.")
        return self


class ProjectUpdate(BaseModel):
    """Patch project metadata. Any field optional.

    Cross-field constraints (start_date < expected_end_date, PM != Secondary,
    pm_id must not be null) are enforced at the route layer because PATCH
    sends only the fields being changed — the validator needs to merge
    the incoming subset with the persisted project to make a meaningful
    decision. Field-shape rules (strip, length, sanity bounds) live here.
    """
    project_code: Optional[str] = Field(default=None, min_length=1, max_length=20)
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    start_date: Optional[date] = None
    expected_end_date: Optional[date] = None
    pm_id: Optional[int] = None
    secondary_evaluator_id: Optional[int] = None

    _strip_code = field_validator("project_code", mode="before")(_strip_or_none)
    _strip_name = field_validator("name", mode="before")(_strip_or_none)
    _strip_desc = field_validator("description", mode="before")(_strip_or_none)

    @field_validator("start_date")
    @classmethod
    def _start_in_bounds(cls, v: Optional[date]) -> Optional[date]:
        _check_date_bounds("Start date", v)
        return v

    @field_validator("expected_end_date")
    @classmethod
    def _end_in_bounds(cls, v: Optional[date]) -> Optional[date]:
        _check_date_bounds("Expected end date", v)
        return v


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
