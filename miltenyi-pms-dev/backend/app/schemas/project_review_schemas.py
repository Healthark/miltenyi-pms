"""
Project Review Schemas — PM-Centric Evaluation against the GCC framework.

The PM writes the evaluation directly against the 6 GCC competency columns
that also back the role-expectation reference data. One framework on both
sides — exactly the column names line up between RoleExpectation.exp_*
and ProjectReview.comment_*.

Schema Map:
    PMEvaluationSubmit       → PM fills 6 GCC competency comments + performance group + impact
    SecondaryEvalSubmit      → Secondary writes impact statement only
    ProjectReviewResponse    → Full review with PM evaluation + secondary feedback
    MyProjectCard            → Employee's view — project info + review status
    PMPendingReviewCard      → PM's queue — team members awaiting evaluation
    RoleExpectationResponse  → Reference data shown to PM during evaluation

6 GCC Competencies:
    1. Scope of Role
    2. Detailed Key Responsibilities
    3. Core Technical Competencies
    4. Delivery Ownership
    5. Regulatory & Compliance Exposure
    6. Project and Resource Management
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import date, datetime
from app.models.project_review_models import (
    ProjectReviewStatus,
    PerformanceGroup,
)


# =====================================================================
# PM EVALUATION
# =====================================================================

class PMEvaluationSubmit(BaseModel):
    """
    PM fills this for each team member.
    All 6 GCC competency comments + performance group + impact required.
    """
    performance_group: PerformanceGroup
    impact_statement: str = Field(..., min_length=1, max_length=5000)
    comment_scope_of_role: str = Field(..., min_length=1, max_length=5000)
    comment_key_responsibilities: str = Field(..., min_length=1, max_length=5000)
    comment_technical_competencies: str = Field(..., min_length=1, max_length=5000)
    comment_delivery_ownership: str = Field(..., min_length=1, max_length=5000)
    comment_regulatory_compliance: str = Field(..., min_length=1, max_length=5000)
    comment_project_resource_management: str = Field(..., min_length=1, max_length=5000)


class PMEvaluationDraft(BaseModel):
    """Partial save for the PM's evaluation. Every field optional so the PM
    can park work mid-thought and pick up later."""
    performance_group: Optional[PerformanceGroup] = None
    impact_statement: Optional[str] = Field(default=None, max_length=5000)
    comment_scope_of_role: Optional[str] = Field(default=None, max_length=5000)
    comment_key_responsibilities: Optional[str] = Field(default=None, max_length=5000)
    comment_technical_competencies: Optional[str] = Field(default=None, max_length=5000)
    comment_delivery_ownership: Optional[str] = Field(default=None, max_length=5000)
    comment_regulatory_compliance: Optional[str] = Field(default=None, max_length=5000)
    comment_project_resource_management: Optional[str] = Field(default=None, max_length=5000)


# =====================================================================
# SECONDARY EVALUATOR
# =====================================================================

class SecondaryEvalSubmit(BaseModel):
    """Secondary evaluator writes one impact statement only."""
    impact_statement: str = Field(..., min_length=1, max_length=5000)


class SecondaryEvalDraft(BaseModel):
    """Partial save — secondary evaluator can park their impact statement
    mid-thought and resume later."""
    impact_statement: Optional[str] = Field(default=None, max_length=5000)


# =====================================================================
# RESPONSE SCHEMAS
# =====================================================================

class SecondaryEvalResponse(BaseModel):
    """Single secondary evaluator's feedback."""
    id: int
    evaluator_id: int
    evaluator_name: str
    impact_statement: Optional[str] = None
    # "draft" while the evaluator has saved but not yet submitted; "submitted"
    # once finalised. Frontend gates editability on this.
    status: str = "submitted"
    created_at: datetime


class ProjectReviewResponse(BaseModel):
    """
    Full review record. The PM's evaluation is directly on this object
    (not nested in an evaluator sub-record).
    """
    id: int
    org_id: int
    user_id: int
    project_id: int
    reviewer_id: Optional[int] = None
    cycle: str
    status: ProjectReviewStatus

    # Resolved names.
    #   reviewer_name → who actually submitted the review (null while pending).
    #   pm_name       → the project's currently-assigned PM (always populated
    #                   when project.pm_id is set; survives even before any
    #                   review has been submitted).
    employee_name: str
    reviewer_name: Optional[str] = None
    pm_name: Optional[str] = None
    project_name: str
    project_code: str

    # PM's 6 GCC competency comments (null while pending)
    comment_scope_of_role: Optional[str] = None
    comment_key_responsibilities: Optional[str] = None
    comment_technical_competencies: Optional[str] = None
    comment_delivery_ownership: Optional[str] = None
    comment_regulatory_compliance: Optional[str] = None
    comment_project_resource_management: Optional[str] = None

    # PM's summary
    performance_group: Optional[str] = None
    impact_statement: Optional[str] = None

    # Secondary feedback
    secondary_evaluations: list[SecondaryEvalResponse] = []

    created_at: datetime
    updated_at: Optional[datetime] = None


class MyProjectCard(BaseModel):
    """
    Employee's view — their assigned projects with review status.
    No self-review action; just shows pending/reviewed + feedback once available.
    """
    review_id: Optional[int] = None
    project_id: int
    project_name: str
    project_code: str
    project_start_date: Optional[date] = None
    project_expected_end_date: Optional[date] = None
    assigned_date: Optional[date] = None
    assignment_role: Optional[str] = None
    function_name: Optional[str] = None
    review_status: Optional[str] = None  # null = no review yet, "pending", "reviewed"
    performance_group: Optional[str] = None
    pm_name: Optional[str] = None
    cycle: Optional[str] = None


class PMPendingReviewCard(BaseModel):
    """
    PM's evaluation queue — one card per team member needing evaluation.
    Includes employee info + their role expectations for reference.
    """
    review_id: Optional[int] = None  # null if review row doesn't exist yet
    project_id: int
    project_name: str
    project_code: str
    user_id: int
    employee_name: str
    assignment_role: Optional[str] = None
    function_name: Optional[str] = None
    designation_name: Optional[str] = None
    assigned_date: Optional[date] = None
    review_status: Optional[str] = None
    performance_group: Optional[str] = None
    cycle: Optional[str] = None
    # True iff the row is pending AND the PM has typed any content into
    # it (rating, impact statement, or any per-competency comment). Pre-
    # seeded placeholder pending rows have review_id != null but no
    # content, so the existence of the row alone isn't a draft signal.
    has_draft_content: bool = False


# =====================================================================
# ROLE EXPECTATIONS
# =====================================================================

class RoleExpectationResponse(BaseModel):
    """
    Reference data shown to the PM while evaluating, and as a read-only
    panel on the goal mentor-review form. One row per (function × career
    level) — designations sharing a career level share one row.

    `designation_names` lists every title that maps to this row, so the
    frontend can match an employee being reviewed (it knows the user's
    designation_name) without having to resolve career_level on its own.
    """
    id: int
    function_name: str
    career_level: int                      # 1..4
    career_level_label: Optional[str] = None  # "Entry" / "Mid" / "Senior" / "Lead"
    designation_names: list[str] = []      # all titles at this (function, career_level)
    exp_scope_of_role: Optional[str] = None
    exp_key_responsibilities: Optional[str] = None
    exp_technical_competencies: Optional[str] = None
    exp_delivery_ownership: Optional[str] = None
    exp_regulatory_compliance: Optional[str] = None
    exp_project_resource_management: Optional[str] = None


# =====================================================================
# ADMIN MANAGEMENT VIEW
# =====================================================================

class AdminMemberReviewRow(BaseModel):
    """One row per team member in the admin per-cycle management view."""
    review_id: Optional[int] = None
    user_id: int
    employee_name: str
    assignment_role: Optional[str] = None
    function_name: Optional[str] = None
    review_status: str          # "pending" | "reviewed" | "not_started"
    performance_group: Optional[str] = None


class AdminProjectSummary(BaseModel):
    """Per-project summary card for admin per-cycle management view."""
    project_id: int
    project_name: str
    project_code: str
    pm_name: Optional[str] = None
    total_members: int
    reviewed_count: int
    members: list[AdminMemberReviewRow]