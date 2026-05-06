"""
Project Models — PM-as-project-level field.

Schema:
    - Project.pm_id            → the PM who reviews team members (Miltenyi PM role).
                                  Project-level, single FK; NOT in project_assignments.
    - Project.secondary_evaluator_id → optional senior who adds an impact
                                       statement after the PM submits.
    - ProjectAssignment        → only the team members. The PM is excluded.
                                  Has no evaluator_type — the "Primary" concept
                                  is replaced by Project.pm_id at the project level.
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

    # The Miltenyi PM who reviews every Staff member assigned to this project.
    # Required at create time; nullable at the column level only so the FK stays
    # legal during edits where the PM is being swapped (transient null).
    pm_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Optional Secondary evaluator. Adds an impact statement after the PM has
    # submitted their review. May or may not be a project member. Cannot be a
    # PM or Mentor (validated at the route layer).
    secondary_evaluator_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    is_deleted = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        Index("ix_projects_org_code", "org_id", "project_code", unique=True),
    )

    # Relationships
    organization = relationship("Organization")
    pm = relationship("User", foreign_keys=[pm_id])
    secondary_evaluator = relationship("User", foreign_keys=[secondary_evaluator_id])
    assignments = relationship(
        "ProjectAssignment",
        back_populates="project",
        cascade="all, delete-orphan",
    )


class ProjectAssignment(Base):
    """One row per team member on a project. The PM is NOT a member —
    they live at the project level via Project.pm_id."""
    __tablename__ = "project_assignments"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    project_id = Column(Integer, ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Auto-filled from user's designation.name but editable per project.
    assignment_role = Column(String, nullable=True)

    # Auto-filled from user's function_id but editable per project.
    function_id = Column(Integer, ForeignKey("functions.id"), nullable=True)

    # When this employee was assigned to the project.
    assigned_date = Column(Date, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        Index("ix_project_assignments_org_proj_user", "org_id", "project_id", "user_id", unique=True),
    )

    # Relationships
    project = relationship("Project", back_populates="assignments")
    user = relationship("User")
    function = relationship("Function")
