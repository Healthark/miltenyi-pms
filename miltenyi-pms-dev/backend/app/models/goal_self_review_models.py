"""
GoalSelfReview Model — Per-half self-reflection on an approved annual goal.

An annual goal has an FY scope (e.g. FY 2026), and within that FY the
employee is expected to reflect on their own delivery TWICE: once for
the first half (H1) and once for the second half (H2).  Each half is a
separate, one-shot submission captured here.

Relationship:
    Goal 1 ─ 0..2 ─ GoalSelfReview   (keyed by cycle_half)

Uniqueness:
    (goal_id, cycle_half) — at most one row per half per goal.
"""

import enum

from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.core.database import Base


class SelfReviewCycleHalf(str, enum.Enum):
    """Which review window this row covers.

    Half-yearly orgs use H1 / H2 (two windows per FY).
    Quarterly  orgs use Q1 / Q2 / Q3 / Q4 (four windows per FY).

    The org's `cycle_type` (SystemSettings) decides which set is in play —
    routes derive that from the value's prefix (`H` vs `Q`) so a single
    string column can hold either family without a separate column."""
    H1 = "H1"
    H2 = "H2"
    Q1 = "Q1"
    Q2 = "Q2"
    Q3 = "Q3"
    Q4 = "Q4"


class GoalSelfReview(Base):
    __tablename__ = "goal_self_reviews"

    id         = Column(Integer, primary_key=True, index=True)
    goal_id    = Column(
        Integer,
        ForeignKey("goals.id", ondelete="CASCADE"),
        nullable=False,
    )
    org_id     = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    # "H1" or "H2" — which half of the goal's fiscal year this review covers.
    cycle_half = Column(String, nullable=False)

    # Stamped once at submission; the presence of this row (and its
    # timestamp) is the single source of truth for "submitted for this half".
    submitted_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Single freeform paragraph capturing the employee's reflection on
    # their delivery for this half. Replaces the previous 8 per-competency
    # textareas — Firm Growth and Competency & Skills role expectations
    # are surfaced as a reference panel on the form instead.
    self_overall_review = Column(Text, nullable=False)

    # When True, this row is a saved-but-not-yet-submitted draft; the
    # mentee can keep editing it. The Submit endpoint flips it to False
    # which advances the parent goal's approval_status. Mentors don't see
    # draft rows.
    is_draft = Column(Boolean, default=False, nullable=False)

    __table_args__ = (
        # A goal can have at most one submission per half.  Enforcing at
        # the DB layer keeps accidental double-submits out even if route
        # logic regresses.
        Index(
            "ix_goal_self_review_unique",
            "goal_id",
            "cycle_half",
            unique=True,
        ),
    )

    goal = relationship("Goal", back_populates="self_reviews")
