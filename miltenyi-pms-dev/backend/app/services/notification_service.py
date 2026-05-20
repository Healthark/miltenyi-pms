"""Centralized writer for in-app + email notifications.

Every lifecycle endpoint that needs to alert another user calls
`notify()` (or `notify_many()`) AFTER its primary `db.commit()`, then
commits again to persist the notification row. The two-commit pattern
keeps a notification-write failure from rolling back the user-facing
action — the lifecycle event is the source of truth and must always
land first.

Email delivery uses FastAPI `BackgroundTasks` (matches the existing
send_welcome_user_email / send_password_reset_email precedent —
admin_routes.py / auth_routes.py). When SMTP is unconfigured,
`send_notification_email` silently no-ops and returns False; the in-app
row still writes. There is no retry / queue at this scale — pull-based
polling from the Topbar covers any transient loss.

Design choices:
    * `db.add` + `db.flush` only — caller commits. Lets the route
      control transaction boundaries.
    * Self-suppression: if recipient_id == sender_id, returns None
      without writing. A mentor who approves their own bulk-created
      goal shouldn't get pinged.
    * `entity_url` is built backend-side from a module → URL prefix map
      so the dropdown deep-link and the email CTA always agree.
"""

from __future__ import annotations

import logging
from typing import Optional, Sequence

from fastapi import BackgroundTasks
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.notification_models import Notification
from app.models.user_models import User
from app.services.send_email import is_smtp_configured, send_notification_email

logger = logging.getLogger(__name__)


# Module → SPA path the dropdown/email links to. `notify()` accepts an
# explicit `entity_url` override for endpoints that need a deeper link
# than the module landing page (e.g. ?review_id=42).
_MODULE_URL: dict[str, str] = {
    "goal":           "/annual-goals",
    "annual_review":  "/annual-reviews",
    "project_review": "/project-reviews",
    "project":        "/admin",
    "admin":          "/profile",
}


def _build_entity_url(module: str, entity_id: int | None) -> str | None:
    """Derive a default deep-link path from module + entity_id. Routes
    that need a more specific query string pass `entity_url` to override."""
    base = _MODULE_URL.get(module)
    if base is None:
        return None
    if entity_id is None:
        return base
    sep = "&" if "?" in base else "?"
    return f"{base}{sep}{module}_id={entity_id}"


def _absolute_url(path: str | None) -> str:
    """Resolve a relative SPA path to an absolute URL for email CTAs.
    Falls back to APP_BASE_URL when no path is provided."""
    base = settings.APP_BASE_URL.rstrip("/")
    if not path:
        return base
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if not path.startswith("/"):
        path = "/" + path
    return f"{base}{path}"


_DEFAULT_SUBJECTS: dict[str, str] = {
    "goal":           "Update on your goal",
    "annual_review":  "Update on your annual review",
    "project_review": "Update on your project review",
    "project":        "Project update",
    "admin":          "Account update",
}


def notify(
    db: Session,
    *,
    org_id: int,
    recipient_id: int,
    sender_id: int,
    module: str,
    entity_type: str,
    entity_id: int | None,
    message: str,
    entity_url: str | None = None,
    background_tasks: BackgroundTasks | None = None,
    send_email: bool = False,
    email_subject: str | None = None,
    email_body_lead: str | None = None,
    email_cta_label: str = "Open in PMS",
) -> Optional[Notification]:
    """Write one in-app notification row; optionally schedule an email.

    Returns the new Notification row (flushed but not committed) or
    None when the call is suppressed (e.g. recipient == sender).

    The caller is expected to commit the surrounding transaction after
    this returns. If the commit fails, the notification rolls back with
    the rest of the transaction — fine: we never want a notification
    for an event that didn't persist."""
    if recipient_id == sender_id:
        return None

    url = entity_url or _build_entity_url(module, entity_id)

    row = Notification(
        org_id=org_id,
        recipient_id=recipient_id,
        sender_id=sender_id,
        module=module,
        entity_type=entity_type,
        entity_id=entity_id,
        entity_url=url,
        message=message,
        is_read=False,
    )
    db.add(row)
    db.flush()

    if send_email and background_tasks is not None and is_smtp_configured():
        recipient = db.query(User).filter(User.id == recipient_id).first()
        if recipient and recipient.email:
            background_tasks.add_task(
                send_notification_email,
                to_email=recipient.email,
                full_name=recipient.full_name,
                subject=email_subject or _DEFAULT_SUBJECTS.get(module, "Notification"),
                lead=email_body_lead or message,
                cta_label=email_cta_label,
                cta_url=_absolute_url(url),
                org_id=org_id,
            )

    return row


def notify_many(
    db: Session,
    *,
    org_id: int,
    recipient_ids: Sequence[int],
    sender_id: int,
    module: str,
    entity_type: str,
    entity_id: int | None,
    message: str,
    entity_url: str | None = None,
    background_tasks: BackgroundTasks | None = None,
    send_email: bool = False,
    email_subject: str | None = None,
    email_body_lead: str | None = None,
    email_cta_label: str = "Open in PMS",
) -> list[Notification]:
    """Fan out the same notification to multiple recipients.

    Used by bulk endpoints (bulk-approve, project complete). The sender
    is filtered out automatically; duplicates in `recipient_ids` are
    de-duplicated so a user can't get the same ping twice from one
    call."""
    seen: set[int] = set()
    out: list[Notification] = []
    for rid in recipient_ids:
        if rid in seen or rid == sender_id:
            continue
        seen.add(rid)
        row = notify(
            db,
            org_id=org_id,
            recipient_id=rid,
            sender_id=sender_id,
            module=module,
            entity_type=entity_type,
            entity_id=entity_id,
            message=message,
            entity_url=entity_url,
            background_tasks=background_tasks,
            send_email=send_email,
            email_subject=email_subject,
            email_body_lead=email_body_lead,
            email_cta_label=email_cta_label,
        )
        if row is not None:
            out.append(row)
    return out
