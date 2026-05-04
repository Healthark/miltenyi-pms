"""
AnnualReview Schemas — The API Contract for the 3-Stage Appraisal.

Schema Map:
    SelfAppraisalCreate   → Stage 1: Employee submits overall review + rating
    MentorEvalUpdate      → Stage 2: Mentor submits overall review + rating
    AnnualReviewResponse  → What the frontend receives (all stages)
    CalibrationRow        → Simplified row for the HR calibration grid

Fields captured per stage:
    Employee: self_overall_review (free text) + self_performance_rating (1–5)
    Mentor:   mentor_overall_review (free text) + mentor_performance_rating (1–5)
    HR:       management_performance_rating (optional override) +
              final_performance_rating (1–5)

Performance rating (1=best .. 5=worst), matching the Project Review guide:
    1 — Performed beyond expectations
    2 — Exceeded goals at expected level
    3 — Achieved goals at expected level
    4 — Partially achieved goals
    5 — Did not achieve goals
"""

from pydantic import BaseModel, Field, ConfigDict
from typing import Optional
from datetime import datetime
from app.models.annual_review_models import ReviewStatus


# ── Stage 1: Employee Self-Review ───────────────────────────────────

class SelfAppraisalCreate(BaseModel):
    """Payload from the SelfAppraisalFormModal when the employee submits."""
    self_overall_review: str = Field(..., min_length=1, max_length=10000)
    self_performance_rating: int = Field(
        ..., ge=1, le=5,
        description="Self-rating on a 1–5 scale (1=beyond expectations, 5=did not achieve)",
    )


class SelfAppraisalDraft(BaseModel):
    """Partial save — employee can save progress without submitting."""
    self_overall_review: Optional[str] = None
    self_performance_rating: Optional[int] = Field(default=None, ge=1, le=5)


# ── Stage 2: Mentor Evaluation ──────────────────────────────────────

class MentorEvalUpdate(BaseModel):
    """Payload from the Mentor's evaluation form."""
    mentor_overall_review: str = Field(..., min_length=1, max_length=10000)
    mentor_performance_rating: int = Field(..., ge=1, le=5)


class MentorEvalDraft(BaseModel):
    """Partial save — mentor can save progress without submitting. Both
    fields optional so the mentor can park work mid-thought."""
    mentor_overall_review: Optional[str] = Field(default=None, max_length=10000)
    mentor_performance_rating: Optional[int] = Field(default=None, ge=1, le=5)


# ── Stage 3: Management Calibration ─────────────────────────────────

class ManagementRatingUpdate(BaseModel):
    """
    Lightweight payload for the Management Review tab's inline rating
    action. Sets only management_performance_rating and unlocks the
    per-row visibility flag so the user-side fallback
    (management ?? mentor) becomes visible.
    """
    management_performance_rating: int = Field(..., ge=1, le=5)


# ── Response Schemas ─────────────────────────────────────────────────

class AnnualReviewResponse(BaseModel):
    """Full review record returned to the frontend."""
    id: int
    org_id: int
    user_id: int
    mentor_id: Optional[int] = None
    cycle_name: str
    status: ReviewStatus

    # Stage 1
    self_overall_review: Optional[str] = None
    self_performance_rating: Optional[int] = None

    # Stage 2
    mentor_overall_review: Optional[str] = None
    mentor_performance_rating: Optional[int] = None
    # Mentor's in-progress draft (only set while status=pending_mentor and
    # the mentor has clicked Save Draft at least once). Cleared on submit.
    mentor_overall_review_draft: Optional[str] = None
    mentor_performance_rating_draft: Optional[int] = None

    # Stage 3
    management_performance_rating: Optional[int] = None
    final_performance_rating: Optional[int] = None
    final_rating_enabled: bool = False

    # Metadata
    created_at: datetime
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class CalibrationRow(BaseModel):
    """Simplified row for the HR Calibration Grid datatable."""
    review_id: int
    user_id: int
    employee_name: str
    employee_email: Optional[str] = None
    mentor_name: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
    self_performance_rating: Optional[int] = None
    mentor_performance_rating: Optional[int] = None
    management_performance_rating: Optional[int] = None
    final_performance_rating: Optional[int] = None
    status: ReviewStatus
    final_rating_enabled: bool = False


class MenteeAnnualReview(AnnualReviewResponse):
    """
    A mentee's review enriched with employee display info. Used by the
    Team Review tab so the mentor can see names, department, and designation
    alongside the review state.
    """
    employee_name: str
    employee_email: Optional[str] = None
    department: Optional[str] = None
    designation: Optional[str] = None
