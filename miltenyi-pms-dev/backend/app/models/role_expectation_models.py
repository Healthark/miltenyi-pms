"""
RoleExpectation Model — Reference Data for PM Evaluations.

Maps Function × Designation to expected behaviors per competency.
Example: Strategy × Consultant → 8 competency expectation paragraphs.

3 Functions (Strategy, IDT, RWE) × 3 Designations (Consultant,
Senior Consultant, Manager) = 9 rows.

The PM sees these expectations as reference context while evaluating
a team member, so they know what "good" looks like for that role.
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
    designation_id = Column(Integer, ForeignKey("designations.id"), nullable=False)

    # ── 8 Competency Expectations ────────────────────────────────────
    exp_task_execution = Column(Text, nullable=True)
    exp_ownership = Column(Text, nullable=True)
    exp_project_management = Column(Text, nullable=True)
    exp_client_deliverables = Column(Text, nullable=True)
    exp_communication = Column(Text, nullable=True)
    exp_mentoring = Column(Text, nullable=True)
    exp_firm_growth = Column(Text, nullable=True)
    exp_competency_skills = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        # One expectation row per function × designation per org
        Index(
            "ix_role_exp_org_func_desig",
            "org_id", "function_id", "designation_id",
            unique=True,
        ),
    )

    # Relationships
    organization = relationship("Organization")
    function = relationship("Function")
    designation = relationship("Designation")
