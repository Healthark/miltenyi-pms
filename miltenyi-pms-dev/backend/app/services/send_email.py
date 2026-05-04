"""
Outbound email service.

Transport is plain SMTP-with-STARTTLS (works for Gmail, O365, Mailgun, SES). All
credentials read from `settings`; if SMTP_USERNAME or SMTP_PASSWORD is missing we
log a warning and skip sending — callers should treat send failures as
non-fatal because the admin reveal-modal still shows the reset link in-app
as a manual-relay fallback.

Templates live in this file as inline f-strings (no Jinja yet) since we
currently have a single email type. When a second template is added, extract
them into `backend/app/services/email_templates/` with one function per
template.

Design notes:
    * All user-supplied fields (`full_name`, recipient address, etc.) are
      escaped via `html.escape(quote=True)` at the template boundary so a
      malicious or imported value like ``<img onerror=...>`` cannot inject
      HTML/JS into the rendered email body.
    * Per-org theming is resolved from a Python-side mirror of the frontend
      THEME_MAP / BRAND_META (see `_ORG_THEMES`). Keep the two in sync when
      adding a new tenant.
    * The From: address is decoupled from SMTP_USERNAME via SMTP_FROM_EMAIL
      so production can send from `noreply@<your-domain>` while still
      authenticating against a transactional-provider mailbox. See the
      DNS checklist in `app/core/config.py`.
"""

from __future__ import annotations

import json
import logging
import smtplib
import socket
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formataddr
from html import escape as _html_escape
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from app.core.config import settings

logger = logging.getLogger(__name__)


# ── Per-org theming (mirror of frontend THEME_MAP / BRAND_META) ─────


@dataclass(frozen=True)
class EmailTheme:
    """Color + display-name palette for a single tenant's outbound mail.

    Mirrors `--brand` / `--brand-light` in `frontend/src/index.css` and the
    title in `BRAND_META` from `frontend/src/contexts/AuthProvider.tsx`.
    Keep them in sync when adding a tenant — if they drift, the email a
    Miltenyi user receives will look like a HealthArk email."""

    brand_name: str
    brand: str
    brand_light: str


_DEFAULT_THEME = EmailTheme(
    brand_name="Healthark PMS",
    brand="#315C84",
    brand_light="#EBF1F6",
)

# org_id → theme. Org IDs match `data-theme` slugs:
#   1 = healthark, 2 = miltenyi  (per CLAUDE.md / AuthProvider.tsx)
_ORG_THEMES: dict[int, EmailTheme] = {
    1: _DEFAULT_THEME,
    2: EmailTheme(
        brand_name="Miltenyi PMS",
        brand="#3C1053",
        brand_light="#F4EFF8",
    ),
}


def _resolve_theme(org_id: int | None) -> EmailTheme:
    """Look up the per-org theme. Unknown org_id → default (HealthArk).
    Same fallback behavior as the frontend's THEME_MAP."""
    if org_id is None:
        return _DEFAULT_THEME
    return _ORG_THEMES.get(org_id, _DEFAULT_THEME)


def _resolve_from_name(theme: EmailTheme) -> str:
    """Display name in the From: header. SMTP_FROM_NAME (env) wins as a
    global override; otherwise we use the per-org brand name. This keeps
    single-tenant deployments using their existing env config while letting
    multi-tenant deployments brand per-org by leaving the env unset."""
    return settings.SMTP_FROM_NAME or theme.brand_name


def _resolve_from_address() -> str:
    """The mailbox in From:. Falls back to SMTP_USERNAME for dev/Gmail
    where the auth account and the visible sender must match."""
    return settings.SMTP_FROM_EMAIL or settings.SMTP_USERNAME or ""


# ── Escaping helper ─────────────────────────────────────────────────


def _esc(value: object) -> str:
    """HTML-escape a value for safe interpolation into both HTML attribute
    and text contexts. `quote=True` flips `"` → `&quot;` and `&` → `&amp;`,
    so a user with `full_name='Bobby <img onerror=x>'` lands in the email
    body as harmless text rather than a rendered tag."""
    return _html_escape(str(value), quote=True)


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

    from_address = _resolve_from_address()
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


# ── Templates ───────────────────────────────────────────────────────


def _password_reset_html(
    full_name: str,
    reset_link: str,
    expires_in_minutes: int,
    theme: EmailTheme,
) -> str:
    """Inline-styled HTML for the admin-initiated password reset email.

    Uses table-based layout + inline CSS for broad email-client support
    (Gmail web, Outlook, Apple Mail). No web fonts, no external CSS, no
    background images.

    The body header and footer brand name come from `theme.brand_name`
    directly (per-org), independent of the SMTP_FROM_NAME env override —
    that override only steers the visible From: address so multi-tenant
    deployments don't misbrand the email body. User-supplied fields are
    escaped via `_esc()` before interpolation."""

    # Escape every interpolation that could plausibly carry user-controlled
    # content. Defense-in-depth — even fields like `theme.brand_name`
    # (config-driven) are escaped because configs can rotate and we'd
    # rather be paranoid than ship an HTML-injection sink that's
    # "currently fine".
    full_name_e = _esc(full_name)
    reset_link_e = _esc(reset_link)
    expires_e = _esc(expires_in_minutes)
    brand_name_e = _esc(theme.brand_name)
    brand_e = _esc(theme.brand)
    brand_light_e = _esc(theme.brand_light)

    return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Reset your password</title>
</head>
<body style="margin:0;padding:0;background-color:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0F172A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
          <!-- Header band (brand) -->
          <tr>
            <td style="background-color:{brand_e};padding:24px 32px;">
              <p style="margin:0;color:#FFFFFF;font-size:18px;font-weight:600;letter-spacing:0.2px;">
                {brand_name_e}
              </p>
              <p style="margin:4px 0 0 0;color:{brand_light_e};font-size:13px;">
                Account security notification
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#0F172A;">
                Reset your password
              </h1>
              <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#0F172A;">
                Hi {full_name_e},
              </p>
              <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#0F172A;">
                An administrator has initiated a password reset for your
                account. Click the button below to choose a new password.
                This link expires in <strong>{expires_e} minutes</strong>
                and can only be used once.
              </p>

              <!-- CTA button (brand) -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
                <tr>
                  <td align="center" style="background-color:{brand_e};border-radius:8px;">
                    <a href="{reset_link_e}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">
                      Set new password
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Plain-link fallback -->
              <p style="margin:0 0 8px 0;font-size:12px;color:#64748B;">
                If the button doesn't work, copy and paste this URL into your
                browser:
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 16px;">
                    <a href="{reset_link_e}" target="_blank" rel="noopener" style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:12px;color:{brand_e};word-break:break-all;text-decoration:none;">
                      {reset_link_e}
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Security warning -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;">
                <tr>
                  <td style="background-color:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:14px 16px;">
                    <p style="margin:0;font-size:13px;line-height:1.5;color:#92400E;">
                      <strong>Security tip:</strong> this link is one-time-use
                      and expires in {expires_e} minutes. Your previous
                      password is no longer valid. If you did not expect a
                      password reset, contact your HR administrator
                      immediately and do not click the link.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px 32px;border-top:1px solid #E2E8F0;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#64748B;">
                This is an automated message from {brand_name_e}.
                Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""


def _password_reset_text(
    full_name: str,
    reset_link: str,
    expires_in_minutes: int,
    from_name: str,
) -> str:
    """Plain-text fallback. No HTML, so no escape needed — user-controlled
    text in plaintext can't break out of any markup."""
    return (
        f"Hi {full_name},\n\n"
        "An administrator has initiated a password reset for your account. "
        "Open the link below to choose a new password. This link expires in "
        f"{expires_in_minutes} minutes and can only be used once.\n\n"
        f"{reset_link}\n\n"
        f"Security tip: this link is one-time-use and expires in "
        f"{expires_in_minutes} minutes. Your previous password is no longer "
        "valid. If you did not expect a password reset, contact your HR "
        "administrator immediately and do not click the link.\n\n"
        f"— {from_name}\n"
    )


# ── Public API ──────────────────────────────────────────────────────


def _welcome_user_html(
    full_name: str,
    email: str,
    password: str,
    login_url: str,
    theme: EmailTheme,
) -> str:
    """Inline-styled HTML for the new-user welcome email. Same table-based
    layout / inline CSS contract as `_password_reset_html` so both renders
    look consistent in restrictive clients (Gmail, Outlook, Apple Mail).

    Every interpolation is escaped via `_esc()` because the credentials
    box renders user-controlled values (full_name, email) directly into
    the HTML body."""
    full_name_e = _esc(full_name)
    email_e = _esc(email)
    password_e = _esc(password)
    login_url_e = _esc(login_url)
    brand_name_e = _esc(theme.brand_name)
    brand_e = _esc(theme.brand)
    brand_light_e = _esc(theme.brand_light)

    return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Welcome to {brand_name_e}</title>
</head>
<body style="margin:0;padding:0;background-color:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0F172A;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#FFFFFF;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(15,23,42,0.06);">
          <!-- Header band (brand) -->
          <tr>
            <td style="background-color:{brand_e};padding:24px 32px;">
              <p style="margin:0;color:#FFFFFF;font-size:18px;font-weight:600;letter-spacing:0.2px;">
                {brand_name_e}
              </p>
              <p style="margin:4px 0 0 0;color:{brand_light_e};font-size:13px;">
                Account created
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#0F172A;">
                Welcome to {brand_name_e}
              </h1>
              <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#0F172A;">
                Hi {full_name_e},
              </p>
              <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#0F172A;">
                Your {brand_name_e} account has been created by your
                administrator. Use the credentials below to sign in.
              </p>

              <!-- Credentials box -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
                <tr>
                  <td style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:16px 20px;">
                    <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:#64748B;">
                      Email
                    </p>
                    <p style="margin:0 0 14px 0;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:13px;color:#0F172A;word-break:break-all;">
                      {email_e}
                    </p>
                    <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:#64748B;">
                      Temporary password
                    </p>
                    <p style="margin:0;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:13px;color:#0F172A;word-break:break-all;">
                      {password_e}
                    </p>
                  </td>
                </tr>
              </table>

              <!-- CTA button (brand) -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
                <tr>
                  <td align="center" style="background-color:{brand_e};border-radius:8px;">
                    <a href="{login_url_e}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">
                      Sign in
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Plain-link fallback -->
              <p style="margin:0 0 8px 0;font-size:12px;color:#64748B;">
                If the button doesn't work, copy and paste this URL into your
                browser:
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 24px 0;">
                <tr>
                  <td style="background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;padding:12px 16px;">
                    <a href="{login_url_e}" target="_blank" rel="noopener" style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:12px;color:{brand_e};word-break:break-all;text-decoration:none;">
                      {login_url_e}
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Security note -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px 0;">
                <tr>
                  <td style="background-color:#FFFBEB;border:1px solid #FDE68A;border-radius:8px;padding:14px 16px;">
                    <p style="margin:0;font-size:13px;line-height:1.5;color:#92400E;">
                      <strong>Security tip:</strong> change your password after
                      signing in for the first time. You can do this from the
                      Profile page. If you did not expect this account, please
                      contact your HR administrator.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 32px 28px 32px;border-top:1px solid #E2E8F0;">
              <p style="margin:0;font-size:12px;line-height:1.5;color:#64748B;">
                This is an automated message from {brand_name_e}.
                Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
"""


def _welcome_user_text(
    full_name: str,
    email: str,
    password: str,
    login_url: str,
    from_name: str,
) -> str:
    """Plain-text fallback for the welcome email."""
    return (
        f"Hi {full_name},\n\n"
        f"Your {from_name} account has been created by your administrator. "
        "Use the credentials below to sign in.\n\n"
        f"  Email:    {email}\n"
        f"  Password: {password}\n\n"
        f"Sign in: {login_url}\n\n"
        "Security tip: change your password after signing in for the first "
        "time. You can do this from the Profile page. If you did not expect "
        "this account, please contact your HR administrator.\n\n"
        f"— {from_name}\n"
    )


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
    theme = _resolve_theme(org_id)
    sender_display_name = _resolve_from_name(theme)
    return _send(
        to_email=to_email,
        subject=f"Welcome to {theme.brand_name} — your account is ready",
        html_body=_welcome_user_html(
            full_name, to_email, password, login_url, theme
        ),
        text_body=_welcome_user_text(
            full_name, to_email, password, login_url, theme.brand_name
        ),
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
    theme = _resolve_theme(org_id)
    # The body always uses the org's brand name; the From: line uses the
    # env override when set so the visible sender can stay consistent
    # across orgs even when the body re-brands per recipient.
    sender_display_name = _resolve_from_name(theme)
    return _send(
        to_email=to_email,
        subject=f"Reset your {theme.brand_name} password",
        html_body=_password_reset_html(
            full_name, reset_link, expires_in_minutes, theme
        ),
        text_body=_password_reset_text(
            full_name, reset_link, expires_in_minutes, theme.brand_name
        ),
        from_name=sender_display_name,
    )
