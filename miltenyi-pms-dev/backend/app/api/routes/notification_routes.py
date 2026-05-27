"""
Notification Routes — The Topbar's Data Feed.

Endpoint:
    GET /api/v1/notifications/summary  →  Any authenticated user

This endpoint is intentionally lightweight — it runs a handful of COUNT
queries against existing tables (goals, users, system_settings) and returns
a flat payload. No dedicated notifications table exists yet.

When a dedicated notifications table is built later (Epic 5), this route
simply switches from computing to reading — the response schema stays
identical, so the frontend needs zero changes.

Security Layers Applied:
    Layer 1 — Authentication:   CurrentUser dependency (JWT validation)
    Layer 2 — Tenant Isolation: All queries filter by current_user.org_id
    Layer 3 — Role Awareness:   Mentors see mentee-goal counts; HR_MyOrg gets only own/direct notifications
    Layer 4 — Ownership:        Goal counts scoped to current_user.id
"""

from datetime import date
from sqlalchemy import func
from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import DbSession, CurrentUser
from app.models.system_settings_models import SystemSettings
from app.models.goal_models import Goal, ApprovalStatus
from app.models.user_models import User
from app.models.notification_models import Notification
from app.schemas.notification_schemas import NotificationItem, UserNotificationItem, TopbarSummary

router = APIRouter()


@router.get("/summary", response_model=TopbarSummary)
def get_topbar_summary(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return the active cycle name and a list of computed notifications
    for the currently authenticated user.
    """
    # ── Active Cycle ─────────────────────────────────────────────────
    # Read the STORED active cycle (the same one /dashboard/summary returns)
    # rather than recomputing from the calendar. Before this change the
    # topbar showed a calendar-true cycle while the dashboard showed the
    # rolled-over value, so a user could see two different "active cycles"
    # on the same screen until HR ran the rollover.
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id
    ).first()

    active_cycle = settings.active_cycle_name if settings else None

    # ── Computed Notifications ───────────────────────────────────────
    notifications: list[NotificationItem] = []

    # 1. Goals sent back by manager with "Changes Requested"
    changes_count: int = db.query(func.count(Goal.id)).filter(
        Goal.org_id == current_user.org_id,
        Goal.user_id == current_user.id,
        Goal.approval_status == ApprovalStatus.CHANGES_REQUESTED.value,
    ).scalar() or 0

    if changes_count > 0:
        notifications.append(NotificationItem(
            type="goals_changes_requested",
            message=f"{changes_count} goal(s) need revisions — check manager feedback.",
            count=changes_count,
            severity="blocking",
        ))

    # 2. Goals in "Draft" that haven't been submitted for approval yet
    draft_count: int = db.query(func.count(Goal.id)).filter(
        Goal.org_id == current_user.org_id,
        Goal.user_id == current_user.id,
        Goal.approval_status == ApprovalStatus.DRAFT.value,
    ).scalar() or 0

    if draft_count > 0:
        notifications.append(NotificationItem(
            type="goals_draft",
            message=f"{draft_count} goal(s) are still in draft — submit for approval.",
            count=draft_count,
            severity="info",
        ))

    # ── Mentor-Only Notifications ────────────────────────────────────
    # Only Mentors approve goals — the /goals/{id}/approve endpoint
    # (goal_routes.py) enforces `goal_owner.mentor_id == current_user.id`
    # with NO HR_MyOrg bypass, so surfacing a "team awaits your approval"
    # badge to HR_MyOrg pointed at an action they cannot perform.
    # Restricting this notification to actual Mentors keeps each mentor's
    # queue count accurate and silences the misleading org-wide count
    # that previously fired for HR_MyOrg.
    mentee_ids: list[int] = []
    if current_user.role == "Mentor":
        mentee_ids = [
            row[0] for row in db.query(User.id).filter(
                User.mentor_id == current_user.id,
                User.org_id == current_user.org_id,
                User.is_deleted == False,
            ).all()
        ]

    if mentee_ids:
        awaiting_count: int = db.query(func.count(Goal.id)).filter(
            Goal.org_id == current_user.org_id,
            Goal.user_id.in_(mentee_ids),
            Goal.approval_status == ApprovalStatus.PENDING_APPROVAL.value,
        ).scalar() or 0

        if awaiting_count > 0:
            notifications.append(NotificationItem(
                type="goals_pending_approval",
                message=f"{awaiting_count} goal(s) from your team await your approval.",
                count=awaiting_count,
                severity="warning",
            ))

    # ── Direct User Notifications (polymorphic across modules) ──────
    #
    # Only UNREAD rows are returned. Once a notification is marked read
    # (per-row via /{id}/mark-read, or bulk via /mark-all-read) it stays
    # in the DB for audit but is hidden from the bell. This matches the
    # inbox mental model: read == handled == out of view.
    #
    # We intentionally do NOT filter on `Notification.sender_id`'s
    # is_deleted status. The notification record is a historical
    # event ("your goal was approved on date X"); the fact the sender
    # was later deactivated doesn't invalidate the event. Hiding these
    # rows would make notifications appear and then vanish when their
    # author is offboarded, which is more confusing than letting the
    # history stand. The `notify()` writer DOES block writes to
    # deactivated recipients (notification_service.py) so dead users
    # never accumulate new alerts.
    raw_user_notifs = (
        db.query(Notification)
        .filter(
            Notification.recipient_id == current_user.id,
            Notification.org_id == current_user.org_id,
            Notification.is_read == False,  # noqa: E712
        )
        .order_by(Notification.created_at.desc())
        .limit(20)
        .all()
    )

    user_notifications = [
        UserNotificationItem(
            id=n.id,
            message=n.message,
            module=n.module,
            entity_type=n.entity_type,
            entity_id=n.entity_id,
            entity_url=n.entity_url,
            created_at=n.created_at,
            is_read=n.is_read,
        )
        for n in raw_user_notifs
    ]

    return TopbarSummary(
        active_cycle=active_cycle,
        notifications=notifications,
        user_notifications=user_notifications,
    )


@router.post("/mark-all-read", status_code=status.HTTP_204_NO_CONTENT)
def mark_all_notifications_read(
    db: DbSession,
    current_user: CurrentUser,
):
    """Mark all of the current user's direct notifications as read."""
    db.query(Notification).filter(
        Notification.recipient_id == current_user.id,
        Notification.org_id == current_user.org_id,
        Notification.is_read == False,  # noqa: E712
    ).update({"is_read": True})
    db.commit()
    return None


@router.post("/{notification_id}/mark-read", status_code=status.HTTP_204_NO_CONTENT)
def mark_single_notification_read(
    notification_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """Mark one specific notification as read.

    Scoped to the current user's own notifications — returns 404 if the
    row exists but belongs to someone else, or if it doesn't exist at
    all. The org_id filter is belt-and-braces against any future
    cross-tenant leakage; the recipient_id filter is the security gate
    that matters (users can only mark their own bell entries read, not
    someone else's).

    No-op (still 204) if the row is already read — idempotent so the
    frontend can fire-and-forget without checking current state first.
    """
    row = (
        db.query(Notification)
        .filter(
            Notification.id == notification_id,
            Notification.recipient_id == current_user.id,
            Notification.org_id == current_user.org_id,
        )
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found.",
        )
    if not row.is_read:
        row.is_read = True
        db.commit()
    return None