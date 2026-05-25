"""
RoleExpectation Model — Miltenyi GCC career-path reference data.

Maps Function × Career Level to a 6-column GCC role definition. The PM
sees these expectations as reference context while evaluating a team
member; the mentor sees them as guidance on the goal mentor-review form
and (read-only) on a user's profile.

Keying:
    (org_id, function_id, career_level)   — UNIQUE

    Multiple Designations (titles) can share the same career_level
    inside one Function — e.g. "Senior Regulatory Affairs Associate"
    and "Regulatory Affairs Specialist" both sit at career_level=2
    under Regulatory Affairs. They share ONE expectations row, not two.

The 8 GCC functions × 4 career levels = 32 expectation rows after seed.

Columns:
    exp_scope_of_role                  — short positioning of the role at this level
    exp_key_responsibilities           — detailed accountabilities
    exp_technical_competencies         — required tooling / methodology depth
    exp_delivery_ownership             — what the person is accountable for delivering
    exp_regulatory_compliance          — regulatory & compliance exposure at this band
    exp_project_resource_management    — project management + resource accountability
"""

from sqlalchemy import (
    Column, Integer, Text, DateTime, ForeignKey, Index
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class RoleExpectation(Base):
    __tablename__ = "role_expectations"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    function_id = Column(Integer, ForeignKey("functions.id"), nullable=False)

    # GCC career level 1..4 (Entry / Mid / Senior / Lead). Resolved by the
    # API layer from the requesting user's Designation.career_level.
    career_level = Column(Integer, nullable=False)

    # ── 6 GCC Content Columns ────────────────────────────────────────
    exp_scope_of_role = Column(Text, nullable=True)
    exp_key_responsibilities = Column(Text, nullable=True)
    exp_technical_competencies = Column(Text, nullable=True)
    exp_delivery_ownership = Column(Text, nullable=True)
    exp_regulatory_compliance = Column(Text, nullable=True)
    exp_project_resource_management = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        # One expectation row per (function, career_level) per org.
        Index(
            "ix_role_exp_org_func_level",
            "org_id", "function_id", "career_level",
            unique=True,
        ),
    )

    # Relationships
    organization = relationship("Organization")
    function = relationship("Function")
