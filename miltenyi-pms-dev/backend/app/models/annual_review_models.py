"""
AnnualReview Model — The 3-Stage Performance Appraisal.

Lifecycle:
    Stage 1 — Employee Self-Review:
        Employee writes a single self_overall_review and picks a
        self_performance_rating (1=best .. 5=worst, matching the Project
        Review rating guide), then submits.
        Status: DRAFT → PENDING_MENTOR

    Stage 2 — Mentor Evaluation:
        Mentor reads the employee's self-review, writes a
        mentor_overall_review, and assigns mentor_performance_rating.
        Status: PENDING_MENTOR → PENDING_MANAGEMENT

    Stage 3 — Management Calibration:
        HR/Leadership reviews both scores, optionally overrides with
        management_performance_rating, sets final_performance_rating, and
        publishes.
        Status: PENDING_MANAGEMENT → COMPLETED
        (final_rating_enabled flips to True)

Design Decisions:
    - One review per user per cycle is enforced by a composite unique index.
    - cycle_name is denormalized from SystemSettings at creation time so the
      review remains tagged to the correct cycle even if the admin rotates it.
    - Annual reviews are strictly yearly — cycle_name is always a bare FY
      label (e.g. "FY26") regardless of the org's half-yearly/quarterly
      cadence (see annual_review_routes._get_active_cycle).
"""

from enum import Enum as PyEnum
from sqlalchemy import (
    Column, Integer, String, Text, Boolean, DateTime, ForeignKey, Index
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class ReviewStatus(str, PyEnum):
    """Tracks which stage the review is currently in."""
    DRAFT                = "draft"
    PENDING_MENTOR       = "pending_mentor"
    PENDING_MANAGEMENT   = "pending_management"
    COMPLETED            = "completed"


class AnnualReview(Base):
    __tablename__ = "annual_reviews"

    id = Column(Integer, primary_key=True, index=True)

    # ── Multi-Tenancy + Identity ─────────────────────────────────────
    org_id    = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    user_id   = Column(Integer, ForeignKey("users.id"), nullable=False)
    mentor_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # ── Cycle Tag ────────────────────────────────────────────────────
    cycle_name = Column(String, nullable=False)  # e.g. "FY26"

    # ── Workflow Status ──────────────────────────────────────────────
    status = Column(String, default=ReviewStatus.DRAFT.value, nullable=False)

    # ── Stage 1: Employee Self-Review ────────────────────────────────
    self_overall_review     = Column(Text, nullable=True)
    # 1 = Performed beyond expectations ... 5 = Did not achieve goals
    self_performance_rating = Column(Integer, nullable=True)

    # ── Stage 2: Mentor Evaluation ───────────────────────────────────
    mentor_overall_review     = Column(Text, nullable=True)
    mentor_performance_rating = Column(Integer, nullable=True)
    # Draft slots — written by Save Draft while status=PENDING_MENTOR; the
    # row's `status` itself stays PENDING_MENTOR so the mentee doesn't see
    # premature mentor content. Submit copies these into the final cols and
    # clears them, then advances status to PENDING_MANAGEMENT.
    mentor_overall_review_draft     = Column(Text, nullable=True)
    mentor_performance_rating_draft = Column(Integer, nullable=True)

    # ── Stage 3: Management Calibration ──────────────────────────────
    management_performance_rating = Column(Integer, nullable=True)  # Optional override
    final_performance_rating      = Column(Integer, nullable=True)  # Official rating
    management_comments           = Column(Text, nullable=True)
    final_rating_enabled          = Column(Boolean, default=False)  # Per-row publish flag

    # ── Audit Trail ──────────────────────────────────────────────────
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # ── Constraints ──────────────────────────────────────────────────
    __table_args__ = (
        Index("ix_annual_reviews_org_user_cycle", "org_id", "user_id", "cycle_name", unique=True),
    )

    # ── Relationships ────────────────────────────────────────────────
    organization = relationship("Organization")
    employee     = relationship("User", foreign_keys=[user_id])
    mentor       = relationship("User", foreign_keys=[mentor_id])
