from enum import Enum as PyEnum
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class Role(str, PyEnum):
    """Who can log in — Healthark staff only. The Miltenyi engagement's own
    managers and HR do not use the application.

      Admin   Healthark HR: users, framework, settings, every review,
              mentor pairing, unlocks.
      Staff   Healthark employee placed on Miltenyi work: own annual
              goals, annual self-review, project goals + self-review.
      Mentor  Healthark mentor: mentees' annual goals and reviews, and the
              project-goal approval + review entry on the Miltenyi
              reviewer's behalf.

    Every account uses an @healthark.ai address (admin_routes._validate_email).
    A Staff member's Miltenyi reviewer is a plain name field
    (`users.miltenyi_reviewer_name`), not a login.

    Stored as plain VARCHAR for portability. History: until September 2026
    the enum also had `PM` and `HR_Miltenyi` (Miltenyi-side logins) and
    Admin / Staff were stored as `HR_MyOrg` / `Employee`; migration
    b3d9f1a7c2e4 renamed the stored values and deactivated the
    Miltenyi-side accounts.
    """
    ADMIN = "Admin"
    STAFF = "Staff"
    MENTOR = "Mentor"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)

    function_id = Column(Integer, ForeignKey("functions.id"), nullable=True)
    designation_id = Column(Integer, ForeignKey("designations.id"), nullable=True)

    employee_code = Column(String, nullable=False)
    full_name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    phone = Column(String, nullable=True)

    # One of the Role enum values above.
    role = Column(String, nullable=False)

    # Self-referencing FK for the mentoring hierarchy. Set on Employee users only;
    # points to a Mentor row. Other roles leave this NULL.
    mentor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    # Set when this user's mentor is deactivated or role-changed away
    # from Mentor — the cascade in admin_routes nulls `mentor_id` and
    # stamps this timestamp so HR's dashboard can distinguish
    # "deactivation orphans" (this user used to have a mentor, lost
    # them, needs reassignment) from "truly unmentored" (never
    # assigned). Cleared when HR assigns the user to a new live
    # Mentor via update_user. NULL on every other user. See
    # docs/policies/mentor-transition-policy.md for the full policy.
    mentor_orphaned_at = Column(DateTime(timezone=True), nullable=True)

    # Project Goals: the Miltenyi manager whose review comments this
    # employee's Mentor transcribes into the system. Miltenyi staff have no
    # login, so this is a plain name, set by HR in the Framework Mapping
    # tab and copied onto each review's provenance block.
    miltenyi_reviewer_name = Column(String, nullable=True)

    avatar_url = Column(String, nullable=True)
    password_hash = Column(String, nullable=False)
    # Timestamp of the most recent password change. Embedded in JWTs as
    # the `pwd_iat` claim; on JWT validation the server compares the
    # claim to this column and rejects tokens whose value is stale —
    # i.e. tokens issued before the current password took effect. This
    # is the mechanism that revokes every active session when the user
    # (or an admin) changes the password, closing the captured-JWT
    # window that defeated the point of password-reset.
    #
    # Set by `create_user` (initial password choice), `change_password`
    # (self-service), and `reset_password` (email-link flow). Backfilled
    # to NOW() in the migration for every existing user so all pre-deploy
    # JWTs are invalidated on rollout (strict-rollout decision; the
    # alternative — leaving the column NULL and treating that as
    # "accept any JWT" — leaves a grace window we deliberately rejected).
    password_changed_at = Column(DateTime(timezone=True), nullable=True)
    # Set to True when an admin reset this user's password to a temporary one.
    # The frontend gates the app until the user chooses a new password, and
    # the self-service change-password endpoint clears it on success.
    must_change_password = Column(Boolean, nullable=False, default=False, server_default="false")
    # Per-user UI theme preference. One of: "light" | "dark". Defaults to
    # "light" so existing users get the historical appearance until they
    # opt into dark mode via the topbar toggle.
    theme_preference = Column(String, nullable=False, default="light", server_default="light")
    # The active cycle string this user last acknowledged on their
    # dashboard. When it diverges from the org's current active cycle,
    # the dashboard renders a "cycle rolled over to X" banner; clicking
    # dismiss bumps this column to the current cycle so the banner
    # disappears for that user. Null until the user dismisses for the
    # first time — existing users see the first banner on their next
    # dashboard visit.
    last_seen_cycle = Column(String, nullable=True)
    is_deleted = Column(Boolean, default=False)
    # When the soft-delete was applied (NULL while the user is active).
    # Set by the deactivate_user route, cleared by reactivate_user.
    # Powers FY-scoped Users exports: a user appears in FY X's export
    # iff `created_at <= end_of_fy AND (deleted_at IS NULL OR deleted_at
    # >= start_of_fy)`.
    deleted_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        Index("ix_users_org_email", "org_id", "email", unique=True),
        Index("ix_users_org_empcode", "org_id", "employee_code", unique=True),
    )

    # Relationships
    organization = relationship("Organization")
    function = relationship("Function")
    designation = relationship("Designation")
    mentor = relationship("User", remote_side=[id])
