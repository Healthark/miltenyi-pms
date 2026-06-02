"""
MentorReassignmentLog — append-only ledger of every mentor-pointer move.

Records every time the assigned-mentor relationship changes for an
employee — either because HR explicitly reassigned them, OR because
the mentor was deactivated / role-changed away from Mentor and the
cascade orphaned them, OR because a one-shot backfill brought a
historical inconsistency into line.

One row per "moved entity":
  - entity_type="user" + entity_id=mentee_id when the User.mentor_id
    pointer itself was changed
  - entity_type="goal" + entity_id=goal_id when Goal.manager_id was
    cascaded
  - entity_type="annual_review" + entity_id=review_id when
    AnnualReview.mentor_id was cascaded

old_mentor_id and new_mentor_id are nullable to express the full
state space — orphaning sets new_mentor_id=NULL; an unmentored user
getting their first mentor sets old_mentor_id=NULL.

See docs/policies/mentor-transition-policy.md for the full policy
context and why each move generates a log row.
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.core.database import Base


class MentorReassignmentLog(Base):
    __tablename__ = "mentor_reassignment_logs"

    id = Column(Integer, primary_key=True, index=True)

    # Tenant fence. Indexed via the composite below, not standalone.
    org_id = Column(
        Integer,
        ForeignKey("organizations.id"),
        nullable=False,
    )

    # Who triggered the change. For HR-driven reassignments + admin-
    # initiated deactivations this is the HR user. For the one-shot
    # backfill script it's the user whose JWT ran the script (or a
    # system sentinel if we ever add one — currently we always have
    # a real admin_user_id).
    admin_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # The employee whose mentor relationship changed. Even when the
    # entity_type below is "goal" or "annual_review", this column
    # always refers to the affected employee (the goal/review's
    # owner), so per-mentee queries scan one column.
    employee_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Which kind of entity moved. Plain string so adding new kinds
    # later doesn't need a migration. One of:
    #   "user"           — User.mentor_id was flipped
    #   "goal"           — Goal.manager_id was cascaded
    #   "annual_review"  — AnnualReview.mentor_id was cascaded
    entity_type = Column(String(32), nullable=False)

    # The id of the moved entity. NULL only when entity_type="user"
    # AND we're logging the same row identified by employee_user_id
    # (in practice we set entity_id = employee_user_id then so
    # queries don't need to special-case nulls).
    entity_id = Column(Integer, nullable=True)

    # Previous mentor stamped on the entity (or on the user). NULL
    # when the entity was unstamped before (e.g. first-time mentor
    # assignment on a previously-unmentored user).
    old_mentor_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # New mentor stamped after the move. NULL when the cascade
    # orphaned the entity (mentor deactivation / role-change /
    # explicit unassign).
    new_mentor_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    # Why the move happened. One of:
    #   "reassignment"   — HR edited a user and changed mentor_id
    #   "deactivation"   — the previous mentor was deactivated
    #   "role_change"    — the previous mentor's role was changed
    #                      away from Mentor
    #   "backfill"       — one-shot script brought historical data
    #                      into line with current rules
    reason = Column(String(32), nullable=False)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships (loose — joinedload-on-demand from query sites).
    admin = relationship("User", foreign_keys=[admin_user_id])
    employee = relationship("User", foreign_keys=[employee_user_id])
    old_mentor = relationship("User", foreign_keys=[old_mentor_id])
    new_mentor = relationship("User", foreign_keys=[new_mentor_id])

    __table_args__ = (
        # Per-mentee history. Hot path: "show me everything that has
        # happened to Bob's mentor relationship."
        Index(
            "ix_mentor_reassign_log_employee_created",
            "employee_user_id",
            "created_at",
        ),
        # After-the-fact bulk queries when a mentor is deactivated /
        # role-changed: "what did this mentor lose / gain?" Used by
        # support tooling and the (future) reactivation flow.
        Index(
            "ix_mentor_reassign_log_old_mentor_created",
            "old_mentor_id",
            "created_at",
        ),
        Index(
            "ix_mentor_reassign_log_new_mentor_created",
            "new_mentor_id",
            "created_at",
        ),
    )
