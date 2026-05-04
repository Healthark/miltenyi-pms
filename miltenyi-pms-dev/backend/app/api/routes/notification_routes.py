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
    Layer 3 — Role Awareness:   Admin sees all org goals; Mentors see mentee goals based on relationship
    Layer 4 — Ownership:        Goal counts scoped to current_user.id
"""

from datetime import date
from sqlalchemy import func
from fastapi import APIRouter, status

from app.api.dependencies import DbSession, CurrentUser
from app.models.system_settings_models import SystemSettings
from app.models.goal_models import Goal, ApprovalStatus
from app.models.user_models import User
from app.models.goal_notification_models import GoalNotification
from app.schemas.notification_schemas import NotificationItem, UserNotificationItem, TopbarSummary
from app.core.cycle_utils import get_current_cycle_info

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
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id
    ).first()

    # Dynamically calculate the active cycle based on the org's cadence
    if settings:
        active_cycle = get_current_cycle_info(
            current_date=date.today(),
            cycle_type=settings.cycle_type,
            fiscal_start_month=settings.fiscal_start_month
        )
    else:
        active_cycle = None

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

    # ── Manager-Only Notifications ───────────────────────────────────
    # We dynamically check if the user has mentees, rather than checking a "Manager" string role
    if current_user.role == "Admin":
        mentee_ids = [
            row[0] for row in db.query(User.id).filter(
                User.org_id == current_user.org_id,
                User.is_deleted == False,
                User.id != current_user.id,
            ).all()
        ]
    else:
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

    # ── Direct User Notifications (mentor → mentee via Notify button) ──
    raw_user_notifs = (
        db.query(GoalNotification)
        .filter(
            GoalNotification.recipient_id == current_user.id,
            GoalNotification.org_id == current_user.org_id,
        )
        .order_by(GoalNotification.created_at.desc())
        .limit(20)
        .all()
    )

    user_notifications = [
        UserNotificationItem(
            id=n.id,
            message=n.message,
            goal_id=n.goal_id,
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
    db.query(GoalNotification).filter(
        GoalNotification.recipient_id == current_user.id,
        GoalNotification.org_id == current_user.org_id,
        GoalNotification.is_read == False,  # noqa: E712
    ).update({"is_read": True})
    db.commit()
    return None