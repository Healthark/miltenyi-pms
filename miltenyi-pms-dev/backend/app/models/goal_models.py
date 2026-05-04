from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index, Text
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base
import enum


class ApprovalStatus(str, enum.Enum):
    """Goal lifecycle. Linear from DRAFT through the final cycle's
    mentor-reviewed state, with one looping branch (CHANGES_REQUESTED →
    DRAFT on next employee edit) and skip paths inside the post-approval
    segment when an earlier cycle is missed during its review window.
    See cycle_utils.is_review_window_open for the time gate.

    Two parallel cycle families coexist on the same string column,
    keyed off the org's cycle_type:
        - half_yearly orgs use the H1/H2 states (4 review states total).
        - quarterly  orgs use the Q1..Q4 states (8 review states total).
    A single goal only ever moves through one family — never both.
    """
    DRAFT              = "draft"
    PENDING_APPROVAL   = "pending_approval"
    CHANGES_REQUESTED  = "changes_requested"
    APPROVED           = "approved"
    # Half-yearly cadence
    H1_SELF_REVIEWED   = "h1_self_reviewed"
    H1_MENTOR_REVIEWED = "h1_mentor_reviewed"
    H2_SELF_REVIEWED   = "h2_self_reviewed"
    H2_MENTOR_REVIEWED = "h2_mentor_reviewed"
    # Quarterly cadence
    Q1_SELF_REVIEWED   = "q1_self_reviewed"
    Q1_MENTOR_REVIEWED = "q1_mentor_reviewed"
    Q2_SELF_REVIEWED   = "q2_self_reviewed"
    Q2_MENTOR_REVIEWED = "q2_mentor_reviewed"
    Q3_SELF_REVIEWED   = "q3_self_reviewed"
    Q3_MENTOR_REVIEWED = "q3_mentor_reviewed"
    Q4_SELF_REVIEWED   = "q4_self_reviewed"
    Q4_MENTOR_REVIEWED = "q4_mentor_reviewed"


# Convenience set used across routes / aggregators to identify the
# "approved-or-later" segment of the goal lifecycle. Any time you want to
# answer "is this goal locked from employee editing?" or "should this
# show in the approved bucket of dashboards?" — use this set.
POST_APPROVAL_STATES: frozenset[str] = frozenset({
    ApprovalStatus.APPROVED.value,
    ApprovalStatus.H1_SELF_REVIEWED.value,
    ApprovalStatus.H1_MENTOR_REVIEWED.value,
    ApprovalStatus.H2_SELF_REVIEWED.value,
    ApprovalStatus.H2_MENTOR_REVIEWED.value,
    ApprovalStatus.Q1_SELF_REVIEWED.value,
    ApprovalStatus.Q1_MENTOR_REVIEWED.value,
    ApprovalStatus.Q2_SELF_REVIEWED.value,
    ApprovalStatus.Q2_MENTOR_REVIEWED.value,
    ApprovalStatus.Q3_SELF_REVIEWED.value,
    ApprovalStatus.Q3_MENTOR_REVIEWED.value,
    ApprovalStatus.Q4_SELF_REVIEWED.value,
    ApprovalStatus.Q4_MENTOR_REVIEWED.value,
})


class GoalType(str, enum.Enum):
    REGULAR = "regular"
    ANNUAL  = "annual"


class Goal(Base):
    __tablename__ = "goals"

    id         = Column(Integer, primary_key=True, index=True)
    org_id     = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    manager_id = Column(Integer, ForeignKey("users.id"), nullable=True)

    title       = Column(String, nullable=False)
    description = Column(Text, nullable=True)

    # Classifies the goal as a full-year objective or a regular project goal.
    # Annual goals are created once per FY, gate-controlled by the Admin,
    # and stamped with a cycle_name ("FY26") at creation time.
    goal_type  = Column(String, nullable=False, default=GoalType.REGULAR.value)
    # Bare fiscal-year label stamped at creation for annual goals, e.g. "FY26".
    # Null for regular goals. Enables future filtering like "all FY26 goals".
    cycle_name     = Column(String, nullable=True)
    # Optional URL to a Google Drive folder or external reference document.
    attachment_url = Column(String, nullable=True)

    # Approval status — controlled by the approval workflow.
    # Progress tracking is driven entirely by criteria completion (progress_percent),
    # so there is no separate employee-controlled progress state.
    approval_status  = Column(String, default=ApprovalStatus.DRAFT.value, nullable=False)
    # Written by the manager when requesting changes; visible to the employee
    manager_feedback = Column(Text, nullable=True)
    # Written by the employee to log progress, proof of completion, etc.
    progress_notes   = Column(Text, nullable=True)

    start_date  = Column(DateTime(timezone=True), nullable=True)
    due_date    = Column(DateTime(timezone=True), nullable=True)
    # Stamped the moment the goal transitions to APPROVED. Null until then.
    # Enables filtering like "goals approved in H1 FY26" for future dashboards.
    approved_at = Column(DateTime(timezone=True), nullable=True)
    created_at  = Column(DateTime(timezone=True), server_default=func.now())
    updated_at  = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        Index("ix_goals_org_user", "org_id", "user_id"),
        # Supports future filtered queries: "all FY26 annual goals for this org"
        Index("ix_goals_org_type_cycle", "org_id", "goal_type", "cycle_name"),
    )

    owner   = relationship("User", foreign_keys=[user_id], backref="goals")
    manager = relationship("User", foreign_keys=[manager_id])

    criteria = relationship(
        "GoalCriterion",
        back_populates="goal",
        cascade="all, delete-orphan",
        order_by="GoalCriterion.sort_order",
        lazy="joined",
    )

    # 0..2 self-reviews per goal (one per fiscal-year half).
    # Always loaded together — they are small and the UI renders both rows
    # in the H1 / H2 cycle dropdown every time a goal card is shown.
    self_reviews = relationship(
        "GoalSelfReview",
        back_populates="goal",
        cascade="all, delete-orphan",
        order_by="GoalSelfReview.cycle_half",
        lazy="joined",
    )

    # 0..2 mentor reviews per goal — one per fiscal-year half, submitted by
    # the mentor after reading the mentee's corresponding self-review.
    mentor_reviews = relationship(
        "GoalMentorReview",
        back_populates="goal",
        cascade="all, delete-orphan",
        order_by="GoalMentorReview.cycle_half",
        lazy="joined",
    )

    @property
    def manager_name(self):
        """
        Display name of the mentor this goal was routed to at creation time.
        None when the goal owner has no mentor assigned — the frontend
        renders that as "No Mentor Assigned".
        """
        return self.manager.full_name if self.manager else None