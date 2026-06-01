"""Password reset email — admin-initiated and self-service flows.

Inline-styled HTML for broad email-client support (Gmail web, Outlook,
Apple Mail). Table-based layout, inline CSS, no web fonts, no external
CSS, no background images. All user-supplied values escaped at the
interpolation boundary via `esc()`.
"""

from __future__ import annotations

from typing import Literal

from app.services.email_templates._shared import EmailTheme, esc


def password_reset_html(
    full_name: str,
    reset_link: str,
    expires_in_minutes: int,
    theme: EmailTheme,
    triggered_by: Literal["self", "admin"] = "admin",
) -> str:
    """Inline-styled HTML for the password reset email.

    `triggered_by` selects the lead-paragraph + security-tip variant:
    - `"self"` — the user clicked Forgot Password. Lead acknowledges
                 they made the request; security tip tells them they
                 can safely ignore the email if they didn't.
    - `"admin"` — an HR administrator initiated on their behalf. Lead
                  says so explicitly; security tip tells them to
                  contact HR if unexpected. (Legacy default for
                  back-compat with the admin reset endpoint.)

    The body header and footer brand name come from `theme.brand_name`
    directly (per-org), independent of the SMTP_FROM_NAME env override —
    that override only steers the visible From: address so multi-tenant
    deployments don't misbrand the email body."""

    # Escape every interpolation that could plausibly carry user-
    # controlled content. Defense-in-depth — even fields like
    # `theme.brand_name` (config-driven) are escaped because configs can
    # rotate and we'd rather be paranoid than ship an HTML-injection
    # sink that's "currently fine".
    full_name_e = esc(full_name)
    reset_link_e = esc(reset_link)
    expires_e = esc(expires_in_minutes)
    brand_name_e = esc(theme.brand_name)
    brand_e = esc(theme.brand)
    brand_light_e = esc(theme.brand_light)

    # Variant copy — branched on `triggered_by`. Pre-computed so the
    # f-string template body stays readable and the conditional logic
    # doesn't fight with the inline HTML markup.
    if triggered_by == "self":
        lead_html = (
            "You requested a password reset for your account. Click the "
            "button below to choose a new password. This link expires in "
            f"<strong>{expires_e} minutes</strong> and can only be used once."
        )
        security_tip_html = (
            f"<strong>Security tip:</strong> this link is one-time-use "
            f"and expires in {expires_e} minutes. Your previous password "
            "is still valid until you choose a new one. If you did not "
            "request this reset, you can safely ignore this email — the "
            "link will expire on its own and your password won't change."
        )
    else:  # "admin"
        lead_html = (
            "An administrator has initiated a password reset for your "
            "account. Click the button below to choose a new password. "
            f"This link expires in <strong>{expires_e} minutes</strong> "
            "and can only be used once."
        )
        security_tip_html = (
            f"<strong>Security tip:</strong> this link is one-time-use "
            f"and expires in {expires_e} minutes. Your previous password "
            "is no longer valid. If you did not expect a password reset, "
            "contact your HR administrator immediately and do not click "
            "the link."
        )

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
                {lead_html}
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
                      {security_tip_html}
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


def password_reset_text(
    full_name: str,
    reset_link: str,
    expires_in_minutes: int,
    from_name: str,
    triggered_by: Literal["self", "admin"] = "admin",
) -> str:
    """Plain-text fallback. No HTML, so no escape needed — user-
    controlled text in plaintext can't break out of any markup.

    `triggered_by` selects the same lead + security-tip variants as
    `password_reset_html`. See that function's docstring for rationale.
    """
    if triggered_by == "self":
        lead = (
            "You requested a password reset for your account. Open the "
            "link below to choose a new password. This link expires in "
            f"{expires_in_minutes} minutes and can only be used once."
        )
        security_tip = (
            f"Security tip: this link is one-time-use and expires in "
            f"{expires_in_minutes} minutes. Your previous password is "
            "still valid until you choose a new one. If you did not "
            "request this reset, you can safely ignore this email — "
            "the link will expire on its own and your password won't change."
        )
    else:  # "admin"
        lead = (
            "An administrator has initiated a password reset for your "
            "account. Open the link below to choose a new password. "
            f"This link expires in {expires_in_minutes} minutes and can "
            "only be used once."
        )
        security_tip = (
            f"Security tip: this link is one-time-use and expires in "
            f"{expires_in_minutes} minutes. Your previous password is "
            "no longer valid. If you did not expect a password reset, "
            "contact your HR administrator immediately and do not "
            "click the link."
        )
    return (
        f"Hi {full_name},\n\n"
        f"{lead}\n\n"
        f"{reset_link}\n\n"
        f"{security_tip}\n\n"
        f"— {from_name}\n"
    )
