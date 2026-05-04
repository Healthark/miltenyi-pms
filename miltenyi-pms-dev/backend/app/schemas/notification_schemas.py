"""
Notification Schemas — The Topbar's API Contract.

These schemas mirror the TypeScript interfaces in notification.service.ts exactly:
    - NotificationItem  →  { type, message, count, severity }
    - TopbarSummary     →  { active_cycle, notifications[] }

No database table backs these — they are computed on the fly from
Goals, Users, and SystemSettings data. When a dedicated notifications
table is built later (Epic 5), these schemas remain the response contract
and the route simply switches from computing to reading.
"""

from pydantic import BaseModel
from typing import Optional, Literal
from datetime import datetime


class NotificationItem(BaseModel):
    """A computed system notification (e.g. goals pending approval)."""
    type: str
    message: str
    count: int
    severity: Literal["info", "warning", "blocking"]


class UserNotificationItem(BaseModel):
    """A direct mentor-to-mentee notification created via the Notify button."""
    id: int
    message: str
    goal_id: int
    created_at: datetime
    is_read: bool


class TopbarSummary(BaseModel):
    """Lightweight payload consumed by the Topbar on every page load."""
    active_cycle: Optional[str] = None
    notifications: list[NotificationItem] = []
    # Direct user-to-user notifications (from mentor Notify button).
    user_notifications: list[UserNotificationItem] = []