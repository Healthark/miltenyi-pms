"""
SystemSettingsYearOverride — Per-Fiscal-Year Access Configuration.

Where `SystemSettings` holds one row per org for cadence / fiscal start
month / dev escape hatches, this table holds one row per `(org_id,
fy_label)` for the four access-control toggles that previously lived
on `SystemSettings`:

    - annual_reviews_enabled
    - annual_review_final_rating_visible
    - annual_goals_edit_enabled
    - project_ratings_visible

Why per-year: the singleton model couldn't express "FY26-27 is still
open" while FY27-28 was beginning. With per-year rows, HR can configure
each fiscal year independently — including reopening a past year while
the current one is active.

Lookup convention: gating helpers in the route layer call
`get_year_override(org_id, fy_label)` to resolve a row. Missing row =
default-deny on writes; past-FY reads still pass through per the legacy
visibility semantics.
"""

from sqlalchemy import (
    Column, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class SystemSettingsYearOverride(Base):
    __tablename__ = "system_settings_year_overrides"

    id = Column(Integer, primary_key=True, index=True)

    # ── Multi-Tenancy ────────────────────────────────────────────────
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False, index=True)

    # ── Fiscal-Year Key ──────────────────────────────────────────────
    # Canonical bare-FY label as produced by `extract_fy_label`
    # (e.g. "FY26-27"). Matches the shape stored on `Goal.cycle_name`
    # for annual goals and on `AnnualReview.cycle_name`. Use
    # `_fy_label_of_review` / `_fy_label_of_goal` in `cycle_utils` when
    # resolving from a project review's `cycle` ("Q1 FY26-27") instead.
    fy_label = Column(String, nullable=False)

    # ── Access Control Toggles (per year) ────────────────────────────
    # Gate: state-changing annual review endpoints (submit self-review,
    # mentor eval, management rating) check this for the review's FY.
    annual_reviews_enabled = Column(Boolean, default=False, nullable=False)
    # Visibility: final_performance_rating exposure to the employee.
    # Past-FY reads ignore this and always show the rating when
    # `final_rating_enabled` is True on the row.
    annual_review_final_rating_visible = Column(Boolean, default=False, nullable=False)
    # Gate: annual goal create/edit endpoints check this for the goal's FY.
    annual_goals_edit_enabled = Column(Boolean, default=False, nullable=False)
    # Visibility: project_review.performance_group exposure to non-HR /
    # non-authoring viewers. Past-FY reads always pass through.
    project_ratings_visible = Column(Boolean, default=False, nullable=False)

    # ── Audit Trail ──────────────────────────────────────────────────
    updated_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # ── Constraints ──────────────────────────────────────────────────
    __table_args__ = (
        # Exactly one override row per (org, fy) — the lookup contract.
        UniqueConstraint("org_id", "fy_label", name="uq_settings_year_org_fy"),
    )

    # ── Relationships ────────────────────────────────────────────────
    organization = relationship("Organization")
    updated_by = relationship("User", foreign_keys=[updated_by_id])
