"""
Project Review Schemas — Revised PM-Centric Evaluation.

No self-review. The PM writes the evaluation directly.

Schema Map:
    PMEvaluationSubmit       → PM fills 7 competency comments + performance group + impact
    SecondaryEvalSubmit      → Secondary writes impact statement only
    ProjectReviewResponse    → Full review with PM evaluation + secondary feedback
    MyProjectCard            → Employee's view — project info + review status
    PMPendingReviewCard      → PM's queue — team members awaiting evaluation
    RoleExpectationResponse  → Reference data shown to PM during evaluation

7 Competencies:
    1. Task Execution & Problem Solving
    2. Ownership & Accountability
    3. Project Management and Risk Mitigation
    4. Building Client-Ready Deliverables
    5. Communication & Client/Stakeholder Management
    6. Mentoring and Team Development
    7. Competency and Skills
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
    All 7 competency comments + performance group + impact required.
    """
    performance_group: PerformanceGroup
    impact_statement: str = Field(..., min_length=1, max_length=5000)
    comment_task_execution: str = Field(..., min_length=1, max_length=5000)
    comment_ownership: str = Field(..., min_length=1, max_length=5000)
    comment_project_management: str = Field(..., min_length=1, max_length=5000)
    comment_client_deliverables: str = Field(..., min_length=1, max_length=5000)
    comment_communication: str = Field(..., min_length=1, max_length=5000)
    comment_mentoring: str = Field(..., min_length=1, max_length=5000)
    comment_competency_skills: str = Field(..., min_length=1, max_length=5000)


class PMEvaluationDraft(BaseModel):
    """Partial save for the PM's evaluation. Every field optional so the PM
    can park work mid-thought and pick up later."""
    performance_group: Optional[PerformanceGroup] = None
    impact_statement: Optional[str] = Field(default=None, max_length=5000)
    comment_task_execution: Optional[str] = Field(default=None, max_length=5000)
    comment_ownership: Optional[str] = Field(default=None, max_length=5000)
    comment_project_management: Optional[str] = Field(default=None, max_length=5000)
    comment_client_deliverables: Optional[str] = Field(default=None, max_length=5000)
    comment_communication: Optional[str] = Field(default=None, max_length=5000)
    comment_mentoring: Optional[str] = Field(default=None, max_length=5000)
    comment_competency_skills: Optional[str] = Field(default=None, max_length=5000)


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

    # Resolved names
    employee_name: str
    reviewer_name: Optional[str] = None
    project_name: str
    project_code: str

    # PM's 7 competency comments (null while pending)
    comment_task_execution: Optional[str] = None
    comment_ownership: Optional[str] = None
    comment_project_management: Optional[str] = None
    comment_client_deliverables: Optional[str] = None
    comment_communication: Optional[str] = None
    comment_mentoring: Optional[str] = None
    comment_competency_skills: Optional[str] = None

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
    department_name: Optional[str] = None
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
    department_name: Optional[str] = None
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
    Reference data shown to the PM while evaluating.
    Contains expected behaviors per competency for a specific
    department × designation combination.
    """
    id: int
    department_name: str
    designation_name: str
    exp_task_execution: Optional[str] = None
    exp_ownership: Optional[str] = None
    exp_project_management: Optional[str] = None
    exp_client_deliverables: Optional[str] = None
    exp_communication: Optional[str] = None
    exp_mentoring: Optional[str] = None
    exp_firm_growth: Optional[str] = None
    exp_competency_skills: Optional[str] = None


# =====================================================================
# ADMIN MANAGEMENT VIEW
# =====================================================================

class AdminMemberReviewRow(BaseModel):
    """One row per team member in the admin per-cycle management view."""
    review_id: Optional[int] = None
    user_id: int
    employee_name: str
    assignment_role: Optional[str] = None
    department_name: Optional[str] = None
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