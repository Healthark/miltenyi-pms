from enum import Enum as PyEnum
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base


class Role(str, PyEnum):
    """User roles — controls every UI surface and every permission check.

    Five distinct values:
      HR_MyOrg     — full super-admin (the platform owner's HR)
      HR_Miltenyi  — limited admin (the client's HR; cannot edit Mentors or HR_MyOrg users)
      Mentor       — fixed mentor; reviews Employee goals + writes annual reviews;
                     no own goals, never rated, never on a project
      PM           — Miltenyi project manager; submits per-cycle project reviews
                     on their team; no goals, never rated
      Employee     — MyOrg employee assigned to Miltenyi work; sets goals,
                     self-reviews on goals (H1/H2) and annual reviews,
                     receives project reviews from PMs and annual reviews from Mentors

    Email-domain rules (enforced in admin_routes._validate_email_for_role):
      HR_MyOrg, Mentor                  → @healthark.ai
      HR_Miltenyi, PM, Employee         → @miltenyi.com OR @external.miltenyi.com

    The pairing is checked on user create AND on any role change (so HR
    can't promote an @miltenyi.com Employee to Mentor without also fixing
    the email — which is itself immutable, so role changes that cross the
    domain boundary are effectively blocked).

    Stored as plain VARCHAR in the DB for portability and human-readable raw
    queries. The string value (not the Python name) is what hits the column.
    """
    HR_MYORG = "HR_MyOrg"
    HR_MILTENYI = "HR_Miltenyi"
    MENTOR = "Mentor"
    PM = "PM"
    EMPLOYEE = "Employee"


# Role groupings used by auth guards. Centralised so the routes stay readable
# and the boundaries can be audited from one place.
ADMIN_ROLES = frozenset({Role.HR_MYORG.value, Role.HR_MILTENYI.value})
PROTECTED_USER_ROLES = frozenset({Role.HR_MYORG.value, Role.MENTOR.value})  # HR_Miltenyi cannot edit these


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

    avatar_url = Column(String, nullable=True)
    password_hash = Column(String, nullable=False)
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
