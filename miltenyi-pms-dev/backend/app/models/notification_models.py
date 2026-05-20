"""Notification model — polymorphic in-app notification row.

One row per event the user should see in the topbar bell. Used by every
module (goals, annual reviews, project reviews, admin, projects). The
`module` + `entity_type` + `entity_id` triple identifies the source
event; `entity_url` is the SPA deep-link the dropdown navigates to on
click.
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


class Notification(Base):
    __tablename__ = "notifications"

    id           = Column(Integer, primary_key=True, index=True)
    org_id       = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    recipient_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    sender_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    message      = Column(Text, nullable=False)
    is_read      = Column(Boolean, default=False, nullable=False)
    created_at   = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    module       = Column(String(32), nullable=False)
    entity_type  = Column(String(32), nullable=False)
    entity_id    = Column(Integer, nullable=True)
    entity_url   = Column(String(512), nullable=True)

    __table_args__ = (
        Index(
            "ix_notifications_recipient_unread_created",
            "recipient_id",
            "is_read",
            "created_at",
        ),
    )
