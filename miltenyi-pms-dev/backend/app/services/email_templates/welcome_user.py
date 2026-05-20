"""Welcome-new-user email — credentials delivery on account creation.

Sent from `POST /admin/users` after the new user row is committed.
Includes the admin-chosen plaintext password (only available at that
single point in the request lifecycle — we hashed it before storage and
no other code path can reconstruct it).

Inline-styled HTML for broad email-client support; same table-based
contract as the other templates. All user-supplied values escaped at
the interpolation boundary via `esc()`.
"""

from __future__ import annotations

from app.services.email_templates._shared import EmailTheme, esc


def welcome_user_html(
    full_name: str,
    email: str,
    password: str,
    login_url: str,
    theme: EmailTheme,
) -> str:
    """Inline-styled HTML for the new-user welcome email.

    Same table-based layout / inline CSS contract as the other
    templates so all three renders look consistent in restrictive
    clients (Gmail, Outlook, Apple Mail). Every interpolation is
    escaped via `esc()` because the credentials box renders user-
    controlled values (full_name, email) directly into the HTML body."""
    full_name_e = esc(full_name)
    email_e = esc(email)
    password_e = esc(password)
    login_url_e = esc(login_url)
    brand_name_e = esc(theme.brand_name)
    brand_e = esc(theme.brand)
    brand_light_e = esc(theme.brand_light)

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


def welcome_user_text(
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
