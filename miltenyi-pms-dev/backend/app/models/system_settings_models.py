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

    # The cadence the active-cycle label is derived from. Fixed at
    # half-yearly for this instance: annual goals run H1/H2 and annual
    # reviews per FY, and the quarterly cadence only ever served the
    # retired per-project reviews, so it is no longer exposed in the UI
    # or accepted by the settings API.
    cycle_type = Column(String, nullable=False, default=CycleType.HALF_YEARLY.value)

    # NEW: Anchors the fiscal year. 4 = April, 1 = January, etc.
    # Used by the utility to determine if current month belongs to Q1, Q2, etc.
    fiscal_start_month = Column(Integer, nullable=False, default=4)

    # IANA timezone string (e.g. "UTC", "Asia/Kolkata", "Europe/Berlin").
    # Controls the "what calendar day is it" reference used by every
    # cycle / FY-end / submission-window check on the backend. Instants
    # (created_at, completed_at, deleted_at, etc.) are still stored as
    # UTC via timestamptz columns — this only shifts the day boundary
    # for calendar-day decisions so users near midnight in non-UTC
    # zones don't see off-by-one rollovers. Defaults to "UTC".
    timezone = Column(String, nullable=False, default="UTC", server_default="UTC")

    # ── Access toggles live elsewhere ────────────────────────────────
    # The per-fiscal-year switches (annual reviews open, final-rating
    # visibility, annual-goal editing) are rows of
    # `system_settings_year_overrides`; the Project Goals period switches
    # are rows of `project_goal_period_settings`. This singleton keeps
    # only the calendar anchors above and the developer escape hatches
    # below. (September 2026: the duplicate org-wide copies, the never-read
    # submission gates and the project-review rating switch were dropped.)
    # Demo-only escape hatch. When True, the date-based H1/H2 review-window
    # gate (`cycle_utils.is_review_window_open`) is skipped, so a Staff /
    # Mentor pair can submit BOTH the H1 and the H2 reviews in the same
    # session — useful when stakeholders are testing the system before H2
    # has actually started in real time. Production should always leave
    # this False so the calendar gate enforces ordering.
    cycle_window_override = Column(Boolean, default=False, nullable=False, server_default="false")
    # Demo-only date simulation. When non-null, every cycle-determination
    # and review-window check uses this date instead of today's real wall
    # date — letting HR/QA preview the morning of a cycle rollover or
    # walk a stakeholder through "next quarter" without time-travelling.
    # Audit timestamps (project completion, assignment end, export
    # filename) always use the real clock; this only shifts the
    # cycle-calendar reference point. Gated by the `ALLOW_DATE_SIMULATION`
    # env flag — production deployments leave that flag off and reject
    # any non-null write to this column.
    simulated_today = Column(Date, nullable=True)

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