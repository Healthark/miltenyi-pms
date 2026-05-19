"""Outbound email service — SMTP transport + public send_* entry points.

Templates live in `app/services/email_templates/` (one module per
template type plus a shared theming helper). This file owns the SMTP
plumbing and the three public send functions; it does not own any
HTML/text rendering.

Transport is plain SMTP-with-STARTTLS (works for Gmail, O365, Mailgun,
SES). All credentials read from `settings`; if SMTP_USERNAME or
SMTP_PASSWORD is missing we log a warning and skip sending — callers
should treat send failures as non-fatal because the admin reveal-modal
still shows the reset link in-app as a manual-relay fallback.
"""

from __future__ import annotations

import logging
import smtplib
import socket
from email.message import EmailMessage
from email.utils import formataddr

from app.core.config import settings
from app.services.email_templates._shared import (
    resolve_from_address,
    resolve_from_name,
    resolve_theme,
)
from app.services.email_templates.notification import (
    notification_html,
    notification_text,
)
from app.services.email_templates.password_reset import (
    password_reset_html,
    password_reset_text,
)
from app.services.email_templates.welcome_user import (
    welcome_user_html,
    welcome_user_text,
)

logger = logging.getLogger(__name__)


# ── Transport ───────────────────────────────────────────────────────


class _IPv4SMTP(smtplib.SMTP):
    """SMTP that resolves and connects via IPv4 only.

    Render Free/Starter tiers don't have working IPv6 outbound. `smtp.gmail.com`
    (and most managed mail providers) resolve to both AAAA and A records, so
    Python's default `socket.create_connection` tries IPv6 first and fails
    with `OSError: [Errno 101] Network is unreachable` before it ever attempts
    IPv4. Asking `getaddrinfo` for `AF_INET` only sidesteps that.
    """

    def _get_socket(self, host, port, timeout):
        if self.debuglevel > 0:
            self._print_debug("connect: to", (host, port), self.source_address)
        last_err: Exception | None = None
        for af, socktype, proto, _canon, sa in socket.getaddrinfo(
            host, port, socket.AF_INET, socket.SOCK_STREAM,
        ):
            sock: socket.socket | None = None
            try:
                sock = socket.socket(af, socktype, proto)
                sock.settimeout(timeout)
                if self.source_address is not None:
                    sock.bind(self.source_address)
                sock.connect(sa)
                return sock
            except OSError as exc:
                last_err = exc
                if sock is not None:
                    sock.close()
        if last_err is not None:
            raise last_err
        raise OSError(f"No IPv4 address found for {host}")


def is_smtp_configured() -> bool:
    """True iff outbound mail can leave the building. Callers use this to
    decide synchronously whether to bother enqueuing a background send."""
    return bool(settings.SMTP_USERNAME and settings.SMTP_PASSWORD)


def _send(
    to_email: str,
    subject: str,
    html_body: str,
    text_body: str,
    from_name: str,
) -> bool:
    """Send a multipart/alternative email. Returns True on success, False on
    any SMTP/auth/connection failure (callers log + continue).

    Intentionally synchronous — the SMTP handshake is ~200–800 ms and can
    spike to multi-seconds on transient errors. API endpoints should run
    this via FastAPI BackgroundTasks (or a real queue in prod) so the
    request thread isn't held hostage by Gmail's TLS handshake."""
    if not is_smtp_configured():
        logger.warning(
            "SMTP not configured (set SMTP_USERNAME / SMTP_PASSWORD in .env). "
            "Skipping email to %s — subject=%r.",
            to_email,
            subject,
        )
        return False

    from_address = resolve_from_address()
    if not from_address:
        logger.error("SMTP_FROM_EMAIL / SMTP_USERNAME both unset; cannot build From:")
        return False

    message = EmailMessage()
    message["From"] = formataddr((from_name, from_address))
    message["To"] = to_email
    message["Subject"] = subject
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")

    try:
        with _IPv4SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(settings.SMTP_USERNAME, settings.SMTP_PASSWORD)
            server.send_message(message)
    except smtplib.SMTPAuthenticationError:
        logger.exception("SMTP auth failed sending to %s — check app password.", to_email)
        return False
    except (smtplib.SMTPException, OSError):
        logger.exception("SMTP transport error sending to %s.", to_email)
        return False

    logger.info("Sent email to %s — subject=%r.", to_email, subject)
    return True


# ── Public API ──────────────────────────────────────────────────────


def send_welcome_user_email(
    to_email: str,
    full_name: str,
    password: str,
    login_url: str,
    org_id: int | None = None,
) -> bool:
    """Email a newly-created user their sign-in credentials.

    Called from `POST /admin/users` after the row is committed. Returns
    True if the message was handed off to the SMTP server, False
    otherwise. Caller must NOT make user creation depend on the return —
    the user is already in the database; failed delivery just means the
    admin has to relay the credentials manually.

    `org_id` selects the per-org theme. Should be invoked via
    BackgroundTasks so the SMTP handshake doesn't block the API response."""
    theme = resolve_theme(org_id)
    sender_display_name = resolve_from_name(theme)
    return _send(
        to_email=to_email,
        subject=f"Welcome to {theme.brand_name} — your account is ready",
        html_body=welcome_user_html(full_name, to_email, password, login_url, theme),
        text_body=welcome_user_text(full_name, to_email, password, login_url, theme.brand_name),
        from_name=sender_display_name,
    )


def send_password_reset_email(
    to_email: str,
    full_name: str,
    reset_link: str,
    expires_in_minutes: int,
    org_id: int | None = None,
) -> bool:
    """Email a one-time, time-limited password-reset link to the user.

    Returns True if the message was handed off to the SMTP server, False
    otherwise. The caller must NOT make the reset flow depend on this
    return value — the admin reveal modal is the authoritative fallback
    (the link is also returned in the API response so it can be relayed
    out-of-band when delivery fails).

    `org_id` selects the per-org theme (brand color + display name). When
    `None` or unmapped, falls back to the HealthArk palette.

    This function is intended to be called from `BackgroundTasks` so the
    blocking SMTP handshake doesn't sit on the API request thread."""
    theme = resolve_theme(org_id)
    sender_display_name = resolve_from_name(theme)
    return _send(
        to_email=to_email,
        subject=f"Reset your {theme.brand_name} password",
        html_body=password_reset_html(full_name, reset_link, expires_in_minutes, theme),
        text_body=password_reset_text(full_name, reset_link, expires_in_minutes, theme.brand_name),
        from_name=sender_display_name,
    )


def send_notification_email(
    to_email: str,
    full_name: str,
    subject: str,
    lead: str,
    cta_label: str,
    cta_url: str,
    org_id: int | None = None,
) -> bool:
    """Email a lifecycle-event notification to a user.

    Called via FastAPI BackgroundTasks from notification_service.notify
    when `send_email=True` and SMTP is configured. Returns True if the
    message was handed off to the SMTP server, False otherwise.

    Caller must NOT make the lifecycle action depend on the return —
    notifications are best-effort. The in-app row written alongside is
    the authoritative surface; email is a convenience signal."""
    theme = resolve_theme(org_id)
    sender_display_name = resolve_from_name(theme)
    return _send(
        to_email=to_email,
        subject=subject,
        html_body=notification_html(full_name, lead, cta_label, cta_url, theme),
        text_body=notification_text(full_name, lead, cta_url, theme.brand_name),
        from_name=sender_display_name,
    )
