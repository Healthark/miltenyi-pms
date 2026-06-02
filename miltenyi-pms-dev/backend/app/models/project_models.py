"""
Project Models — PM-as-project-level field.

Schema:
    - Project.pm_id            → the PM who reviews team members (Miltenyi PM role).
                                  Project-level, single FK; NOT in project_assignments.
    - Project.secondary_evaluator_id → optional senior who adds an impact
                                       statement after the PM submits.
    - Project.status / completed_at  → lifecycle. "active" or "completed".
                                       Completed projects no longer generate
                                       cycle placeholders for their team.
    - ProjectAssignment        → only the team members. The PM is excluded.
                                  Has no evaluator_type — the "Primary" concept
                                  is replaced by Project.pm_id at the project level.
    - ProjectAssignment.end_date → soft-end. Active iff NULL. Past stints stay
                                   in the table so the user keeps seeing their
                                   own historical reviews.
"""

from sqlalchemy import (
    Column, Integer, String, Text, Date, Boolean, DateTime, ForeignKey, Index
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


# Project lifecycle states. Single string column rather than a DB enum so we
# stay DB-agnostic and Pydantic-friendly (matches the Role taxonomy pattern).
PROJECT_STATUS_ACTIVE = "active"
PROJECT_STATUS_COMPLETED = "completed"


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
    # legal during edits where the PM is being swapped (transient null) AND so
    # the deactivation / role-change cascade in admin_routes can null this
    # column when a PM goes away (see `pm_orphaned_at` below).
    pm_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    # Stamped when this project's PM is deactivated or role-changed away from
    # PM and the cascade nulled `pm_id`. Cleared when HR assigns a new live
    # PM via the project edit form. Drives the "Orphaned Projects" bucket on
    # the HR dashboard — distinguishes a project whose PM went away mid-flight
    # (has in-flight review work that froze) from a project that was created
    # without one (which can't happen today — ProjectCreate.pm_id is required —
    # but the bucket would still surface the dangling case if it ever did).
    # NULL on every project with a live PM. Mirrors the User.mentor_orphaned_at
    # pattern from PR #81 (mentor cascade). See
    # docs/policies/mentor-transition-policy.md for the original policy
    # rationale; the PM cascade applies the same Option-C semantics to
    # ProjectReview.reviewer_id.
    pm_orphaned_at = Column(DateTime(timezone=True), nullable=True)

    # Optional Secondary evaluator. Adds an impact statement after the PM has
    # submitted their review. May or may not be a project member. Cannot be a
    # PM or Mentor (validated at the route layer).
    secondary_evaluator_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Lifecycle. "active" by default. HR flips to "completed" via the dedicated
    # route — that also bulk-end-dates every active assignment. Re-open clears
    # completed_at but does NOT auto-restore assignments.
    status = Column(String, nullable=False, server_default=PROJECT_STATUS_ACTIVE)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    completed_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

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
    completed_by = relationship("User", foreign_keys=[completed_by_id])
    assignments = relationship(
        "ProjectAssignment",
        back_populates="project",
        cascade="all, delete-orphan",
    )


class ProjectAssignment(Base):
    """One row per team member on a project, per stint. The PM is NOT a member —
    they live at the project level via Project.pm_id.

    A user can have multiple rows for the same project over time (re-assignment
    after a break) — only one of them may have end_date IS NULL at a time.
    Enforced at the route layer; no DB-level partial unique index so we stay
    portable. Past stints with end_date set are kept so the user still sees
    their own review history under My Reviews."""
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

    # When the employee was removed from the project. NULL = currently active.
    # Cycles whose review window opens after end_date no longer generate
    # placeholders for this row.
    end_date = Column(Date, nullable=True)
    ended_by_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        # Non-unique — allow multiple rows for the same (project, user) over
        # time. Active-row uniqueness is enforced at the route layer.
        Index("ix_project_assignments_org_proj_user", "org_id", "project_id", "user_id"),
    )

    # Relationships
    project = relationship("Project", back_populates="assignments")
    user = relationship("User", foreign_keys=[user_id])
    ended_by = relationship("User", foreign_keys=[ended_by_id])
    function = relationship("Function")
