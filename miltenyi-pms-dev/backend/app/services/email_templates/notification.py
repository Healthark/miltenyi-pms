"""Generic lifecycle-notification / announcement email.

Single-purpose template shared across every event that opts into email
delivery via `notification_service.notify(..., send_email=True)`, the
Admin's announcements (Notify tab) and the daily digests. The caller
supplies the subject, lead paragraph, CTA label and CTA URL — the
template only owns the chrome.

The lead is Markdown SOURCE in the small subset the app uses (bold,
italic, bullet and numbered lists — see app/core/rich_text.py). It is
escaped before any marker rule runs, so a lead with no markers renders
exactly as the plain paragraph it always was. Optional blocks:

    * `title`   → an H1 above the greeting (announcements, digests).
    * `details` → a labelled "{snapshot_title}" key-value table
                  (the digest's summary rows).

Inline-styled HTML for broad email-client support; same table-based
contract as the password-reset and welcome templates. All user-supplied
values escaped at the interpolation boundary via `esc()` or
`markdown_to_html()`.
"""

from __future__ import annotations

from app.core.rich_text import markdown_to_html, markdown_to_plain
from app.services.email_templates._shared import EmailTheme, esc


def notification_html(
    full_name: str,
    lead: str,
    cta_label: str,
    cta_url: str,
    theme: EmailTheme,
    *,
    title: str | None = None,
    details: list[tuple[str, str]] | None = None,
    snapshot_title: str = "Summary",
) -> str:
    """Inline-styled HTML for a generic notification / announcement email."""
    full_name_e   = esc(full_name)
    lead_html     = markdown_to_html(lead)
    cta_label_e   = esc(cta_label)
    cta_url_e     = esc(cta_url)
    brand_name_e  = esc(theme.brand_name)
    brand_e       = esc(theme.brand)
    brand_light_e = esc(theme.brand_light)

    title_block = ""
    if title:
        title_block = (
            f'<h1 style="margin:0 0 12px 0;font-size:20px;font-weight:600;color:#0F172A;">'
            f"{esc(title)}</h1>"
        )

    details_block = ""
    if details:
        rows = "".join(
            f"""
                  <tr>
                    <td style="padding:6px 16px 6px 0;font-size:13px;color:#64748B;vertical-align:top;">{esc(label)}</td>
                    <td style="padding:6px 0;font-size:13px;color:#0F172A;font-weight:500;">{esc(value)}</td>
                  </tr>"""
            for label, value in details
        )
        details_block = f"""
              <p style="margin:0 0 8px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.6px;color:#64748B;">
                {esc(snapshot_title)}
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;background-color:#F8FAFC;border:1px solid #E2E8F0;border-radius:8px;">
                <tr><td style="padding:8px 16px;">
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0">{rows}
                  </table>
                </td></tr>
              </table>"""

    return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>{esc(title) if title else brand_name_e + " notification"}</title>
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
                Notification
              </p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              {title_block}
              <p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#0F172A;">
                Hi {full_name_e},
              </p>
              {lead_html}
              {details_block}

              <!-- CTA button (brand) -->
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:4px 0 20px 0;">
                <tr>
                  <td align="center" style="background-color:{brand_e};border-radius:8px;">
                    <a href="{cta_url_e}" target="_blank" rel="noopener" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">
                      {cta_label_e}
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
                    <a href="{cta_url_e}" target="_blank" rel="noopener" style="font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:12px;color:{brand_e};word-break:break-all;text-decoration:none;">
                      {cta_url_e}
                    </a>
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


def notification_text(
    full_name: str,
    lead: str,
    cta_url: str,
    from_name: str,
    *,
    title: str | None = None,
    details: list[tuple[str, str]] | None = None,
    snapshot_title: str = "Summary",
) -> str:
    """Plain-text fallback for the notification email."""
    lines: list[str] = []
    if title:
        lines += [title, ""]
    lines += [f"Hi {full_name},", "", markdown_to_plain(lead), ""]
    if details:
        lines.append(f"{snapshot_title}:")
        lines += [f"  {label}: {value}" for label, value in details]
        lines.append("")
    lines += [f"Open: {cta_url}", "", f"— {from_name}"]
    return "\n".join(lines) + "\n"
