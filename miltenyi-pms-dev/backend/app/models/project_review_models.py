"""
Project Review Models — PM-Centric Evaluation against the GCC framework.

    - No self-review. Employee sees "Pending" until PM evaluates.
    - PM's evaluation (6 GCC competency comments + performance group +
      impact) lives directly in the ProjectReview row.
    - ProjectReviewEvaluator is only used for Secondary impact statements.
    - Status: pending → draft → reviewed.

6 GCC competencies the PM writes against:
    1. Scope of Role
    2. Detailed Key Responsibilities
    3. Core Technical Competencies
    4. Delivery Ownership
    5. Regulatory & Compliance Exposure
    6. Project and Resource Management

The same 6-column framework backs the RoleExpectation table that the
PM sees as reference text while filling this out — there is exactly
one framework on both sides.
"""

from enum import Enum as PyEnum
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Index
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class ProjectReviewStatus(str, PyEnum):
    """Review lifecycle: pending (auto-created when cycle opens) →
    draft (PM saved but hasn't submitted) → reviewed (final). Stored as a
    plain VARCHAR so adding the DRAFT value here is enough — no migration
    needed for the column itself."""
    PENDING = "pending"
    DRAFT = "draft"
    REVIEWED = "reviewed"


class EvaluatorStatus(str, PyEnum):
    """Secondary evaluator submission status."""
    DRAFT = "draft"
    SUBMITTED = "submitted"


class PerformanceGroup(str, PyEnum):
    """
    Simple 1-5 numerical rating scale for overall project performance.
    Stored as strings in the database to maintain schema compatibility.
    """
    RATING_1 = "1"
    RATING_2 = "2"
    RATING_3 = "3"
    RATING_4 = "4"
    RATING_5 = "5"


class ProjectReview(Base):
    """
    One row per employee per project per cycle.
    Created as 'pending' when the cycle opens.
    PM fills in the evaluation → status becomes 'reviewed'.
    """
    __tablename__ = "project_reviews"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)       # The employee being reviewed
    project_id = Column(Integer, ForeignKey("projects.id"), nullable=False)
    reviewer_id = Column(Integer, ForeignKey("users.id"), nullable=True)    # The PM who wrote the evaluation
    cycle = Column(String, nullable=False)

    status = Column(String, default=ProjectReviewStatus.PENDING.value, nullable=False)

    # ── PM's Evaluation — 6 GCC competency comments ──────────────────
    comment_scope_of_role = Column(Text, nullable=True)
    comment_key_responsibilities = Column(Text, nullable=True)
    comment_technical_competencies = Column(Text, nullable=True)
    comment_delivery_ownership = Column(Text, nullable=True)
    comment_regulatory_compliance = Column(Text, nullable=True)
    comment_project_resource_management = Column(Text, nullable=True)

    # ── PM's Summary Fields ──────────────────────────────────────────
    performance_group = Column(String, nullable=True)
    impact_statement = Column(Text, nullable=True)

    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        Index(
            "ix_project_reviews_org_user_proj_cycle",
            "org_id", "user_id", "project_id", "cycle",
            unique=True,
        ),
    )

    # Relationships
    organization = relationship("Organization")
    employee = relationship("User", foreign_keys=[user_id])
    reviewer = relationship("User", foreign_keys=[reviewer_id])
    project = relationship("Project")
    secondary_evaluations = relationship(
        "ProjectReviewEvaluator",
        back_populates="review",
        cascade="all, delete-orphan",
        order_by="ProjectReviewEvaluator.created_at",
    )


class ProjectReviewEvaluator(Base):
    """
    Secondary evaluator impact statements only.
    One row per Secondary evaluator per review.
    No competency comments — just an impact statement.
    """
    __tablename__ = "project_review_evaluators"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    project_review_id = Column(
        Integer,
        ForeignKey("project_reviews.id", ondelete="CASCADE"),
        nullable=False,
    )
    evaluator_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    evaluator_type = Column(String, default="Secondary", nullable=False)

    status = Column(String, default=EvaluatorStatus.DRAFT.value, nullable=False)
    impact_statement = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index(
            "ix_pr_evaluators_review_evaluator",
            "project_review_id", "evaluator_id",
            unique=True,
        ),
    )

    # Relationships
    review = relationship("ProjectReview", back_populates="secondary_evaluations")
    evaluator = relationship("User", foreign_keys=[evaluator_id])