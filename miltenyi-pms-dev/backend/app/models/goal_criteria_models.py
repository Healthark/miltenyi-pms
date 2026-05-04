"""
GoalCriterion Model — The Key Results Sub-Table.

Each Goal (objective) can have multiple Criteria (key results) that break
it down into measurable, checkable items. This is the backbone of OKR
tracking in the PMS.

Design Decisions:
    - org_id is duplicated from the parent Goal for direct tenant-filtered
      queries without joining back to goals every time.
    - is_completed is a simple boolean — the parent Goal's progress
      percentage is computed dynamically (completed / total criteria).
    - proof_comments stores free-text evidence (links, notes). File
      attachments are tracked via proof_attachment_count for now;
      actual file storage (S3/local) is a future enhancement.
    - sort_order allows the employee to reorder criteria in the UI
      without affecting database IDs.
"""

from sqlalchemy import (
    Column, Integer, String, Boolean, Text, DateTime, ForeignKey, Index
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class GoalCriterion(Base):
    __tablename__ = "goal_criteria"

    id = Column(Integer, primary_key=True, index=True)

    # ── Parent References ────────────────────────────────────────────
    goal_id = Column(Integer, ForeignKey("goals.id", ondelete="CASCADE"), nullable=False)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)

    # ── Content ──────────────────────────────────────────────────────
    title = Column(String, nullable=False)  # e.g. "Complete AWS certification by Q2"
    sort_order = Column(Integer, default=0)  # UI display order

    # ── Completion Tracking (Story 3.3) ──────────────────────────────
    is_completed = Column(Boolean, default=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # ── Proof of Work ────────────────────────────────────────────────
    proof_comments = Column(Text, nullable=True)  # Free-text evidence
    proof_attachment_count = Column(Integer, default=0)  # File count placeholder

    # ── Audit Trail ──────────────────────────────────────────────────
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # ── Indexes ──────────────────────────────────────────────────────
    __table_args__ = (
        # Fast lookup: "give me all criteria for goal X in org Y"
        Index("ix_goal_criteria_goal_org", "goal_id", "org_id"),
    )

    # ── Relationships ────────────────────────────────────────────────
    goal = relationship("Goal", back_populates="criteria")