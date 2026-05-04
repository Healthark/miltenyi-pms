"""
GoalNotification Model — Mentor-to-mentee direct notifications on a goal.

When a mentor clicks "Notify" on a submitted goal in the Team Goals tab,
a row is inserted here.  The mentee sees it as a bell badge in the Topbar.

Cascade: deleting the parent goal removes all associated notifications.
"""

from sqlalchemy import (
    Column,
    Integer,
    String,
    Text,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
)
from sqlalchemy.sql import func

from app.core.database import Base


class GoalNotification(Base):
    __tablename__ = "goal_notifications"

    id           = Column(Integer, primary_key=True, index=True)
    org_id       = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    goal_id      = Column(
        Integer,
        ForeignKey("goals.id", ondelete="CASCADE"),
        nullable=False,
    )
    recipient_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    sender_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    message      = Column(Text, nullable=False)
    is_read      = Column(Boolean, default=False, nullable=False)
    created_at   = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    __table_args__ = (
        # Fast lookup: "all unread notifications for this user in this org"
        Index("ix_goal_notifications_recipient_read", "recipient_id", "is_read"),
    )
