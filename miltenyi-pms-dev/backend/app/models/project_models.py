"""
Project Models — Revised for PM-centric evaluation flow.

Changes from previous version:
    - Removed allocated_hours from Project
    - Renamed end_date → expected_end_date
    - Added reports_to_id on Project (senior who reviews the PM)
    - Added secondary_evaluator_id on Project (single project-level secondary
      evaluator; replaces the old multi-row "Secondary" ProjectAssignment model)
    - Added department_id on ProjectAssignment (auto-filled, editable per project)
    - assignment_role auto-fills from designation but is editable
    - ProjectAssignment.evaluator_type is now "Primary" or NULL only.
"""

from sqlalchemy import (
    Column, Integer, String, Text, Date, Boolean, DateTime, ForeignKey, Index
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class Project(Base):
    __tablename__ = "projects"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)

    project_code = Column(String, nullable=False)
    name = Column(String, nullable=False)
    description = Column(Text, nullable=True)
    start_date = Column(Date, nullable=True)
    expected_end_date = Column(Date, nullable=True)

    # The senior person who reviews the PM's own performance on this project.
    # This is NOT the PM themselves — it's their reporting line for this project.
    reports_to_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # The single Secondary evaluator for this project. Provides an impact
    # statement after the PM completes their review. May or may not be a
    # project member (no ProjectAssignment row required).
    secondary_evaluator_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        Index("ix_projects_org_code", "org_id", "project_code", unique=True),
    )

    # Relationships
    organization = relationship("Organization")
    reports_to = relationship("User", foreign_keys=[reports_to_id])
    secondary_evaluator = relationship("User", foreign_keys=[secondary_evaluator_id])
    assignments = relationship(
        "ProjectAssignment",
        back_populates="project",
        cascade="all, delete-orphan",
    )


class ProjectAssignment(Base):
    __tablename__ = "project_assignments"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Auto-filled from user's designation.name but editable per project
    # e.g. "Senior Data Engineer" → overridden to "Lead Data Engineer" for this project
    assignment_role = Column(String, nullable=True)

    # Track which department the employee belongs to for this project
    # Auto-filled from user's department_id but editable per project
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)

    # "Primary" = Project Manager who evaluates all other members
    # null      = regular team member
    # The Secondary evaluator is now a project-level field
    # (Project.secondary_evaluator_id), not a row here.
    evaluator_type = Column(String, nullable=True)

    # When this employee was assigned to the project
    assigned_date = Column(Date, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_project_assignments_org_proj_user", "org_id", "project_id", "user_id", unique=True),
    )

    # Relationships
    project = relationship("Project", back_populates="assignments")
    user = relationship("User")
    department = relationship("Department")