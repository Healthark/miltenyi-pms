"""
SystemSettings Model — The Organization's Control Panel.

This table stores one row per organization, acting as a per-tenant configuration
singleton. The active_cycle_name drives what period is displayed in the Topbar,
and the submission flags gate whether employees can submit goals or self-reviews.

Design Decision: One row per org (enforced by a unique composite index on org_id)
rather than a key-value store. This avoids the "settings sprawl" anti-pattern and
keeps the schema explicit, queryable, and type-safe.
"""

from enum import Enum as PyEnum
from sqlalchemy import (
    Column, Integer, String, Boolean, Date, DateTime, ForeignKey, Index
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class CycleType(str, PyEnum):
    """
    Determines the cadence of the active performance cycle.

    - ANNUAL:      Full fiscal year   (e.g. "FY26")
    - HALF_YEARLY: Two halves         (e.g. "H1 FY26", "H2 FY26")
    - QUARTERLY:   Four quarters      (e.g. "Q1 FY26")

    This enum is stored as a plain string in SQLite/Postgres via .value extraction
    on write, keeping the column portable and human-readable in raw queries.
    """
    ANNUAL = "annual"
    HALF_YEARLY = "half_yearly"
    QUARTERLY = "quarterly"


class SystemSettings(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, index=True)

    # ── Multi-Tenancy (Golden Rule) ──────────────────────────────────
    # Every org gets exactly ONE settings row. The unique index below
    # enforces this at the database level, not just in application code.
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)

    # ── Active Cycle Configuration ───────────────────────────────────
    # The human-readable label displayed in the Topbar and stamped onto
    # reviews/goals created during this period.
    active_cycle_name = Column(String, nullable=False)  # e.g. "H1 FY26"

    # The machine-readable cadence — used by the utility to calculate
    # current Q1/Q2 or H1/H2 periods.
    cycle_type = Column(String, nullable=False, default=CycleType.HALF_YEARLY.value)

    # NEW: Anchors the fiscal year. 4 = April, 1 = January, etc.
    # Used by the utility to determine if current month belongs to Q1, Q2, etc.
    fiscal_start_month = Column(Integer, nullable=False, default=4)

    # Optional date boundaries for reporting and deadline enforcement.
    cycle_start_date = Column(Date, nullable=True)
    cycle_end_date = Column(Date, nullable=True)

    # ── Submission Gates ─────────────────────────────────────────────
    # HR flips these flags to open/close submission windows org-wide.
    # This is simpler and more auditable than date-based auto-gating.
    goals_submission_open = Column(Boolean, default=False)
    reviews_submission_open = Column(Boolean, default=False)

    # ── Goal & Review Access Controls ────────────────────────────────
    # Org-wide toggles surfaced in the Admin Panel's Goal Settings card.
    goals_edit_enabled = Column(Boolean, default=True, nullable=False)
    # Admin opens this gate at the start of each FY to allow employees to
    # create and edit their annual goals. Closed by default; must be
    # explicitly enabled each cycle. Annual goals are blocked at the API
    # layer when this is False — regardless of approval_status.
    annual_goals_edit_enabled = Column(Boolean, default=False, nullable=False)
    annual_goals_final_rating_visible = Column(Boolean, default=False, nullable=False)
    project_ratings_visible = Column(Boolean, default=False, nullable=False)
    # Admin gate to enable/disable the Annual Reviews module org-wide.
    # When False, the Annual Reviews page is hidden and submissions are blocked.
    annual_reviews_enabled = Column(Boolean, default=False, nullable=False)
    # When False, the Ratings column is hidden in the Mentor's Mentee Review /
    # Team Review tabs and the employee cannot see the final rating on past
    # reviews. Mentors still see their own mentor_performance_rating while
    # evaluating (that's required for the workflow).
    annual_review_final_rating_visible = Column(Boolean, default=False, nullable=False)

    # ── Audit Trail ──────────────────────────────────────────────────
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # ── Constraints ──────────────────────────────────────────────────
    __table_args__ = (
        # Singleton per org — prevents accidental duplicate settings rows.
        Index("ix_system_settings_org_id", "org_id", unique=True),
    )

    # ── Relationships ────────────────────────────────────────────────
    organization = relationship("Organization")
    updated_by = relationship("User", foreign_keys=[updated_by_id])