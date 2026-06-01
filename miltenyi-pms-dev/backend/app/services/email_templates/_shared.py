"""Shared theming + escaping helpers for outbound email templates.

Theme resolution and HTML-attribute-safe escaping. Used by every
template in this package and by `send_email.py` (for the From: line).

Single-brand mode: every outbound email — regardless of recipient's
org_id — renders with the Miltenyi PMS palette. The previous
per-tenant branching (Healthark blue for org_id=1, Miltenyi purple
for org_id=2) was retired because the product is positioned as a
single Miltenyi-branded surface; the Healthark/Miltenyi split lives
on as a role / data-model concept (HR_MyOrg vs HR_Miltenyi) but is
not surfaced in email branding.

Re-enabling per-tenant theming is a small re-add: drop entries into
`_ORG_THEMES` keyed by org_id and they'll override the default.
"""

from __future__ import annotations

from dataclasses import dataclass
from html import escape as _html_escape

from app.core.config import settings


@dataclass(frozen=True)
class EmailTheme:
    """Color + display-name palette for outbound mail.

    Brand color mirrors `--brand` / `--brand-light` in
    `frontend/src/index.css` (Miltenyi purple)."""

    brand_name: str
    brand: str
    brand_light: str


_DEFAULT_THEME = EmailTheme(
    brand_name="Miltenyi PMS",
    brand="#3C1053",
    brand_light="#F4EFF8",
)

# Per-org overrides. Empty in single-brand mode — every org_id falls
# through to `_DEFAULT_THEME` above. To bring back per-tenant
# branding, add entries here keyed by org_id; the resolve_theme()
# fallback handles unmapped orgs.
_ORG_THEMES: dict[int, EmailTheme] = {}


def resolve_theme(org_id: int | None) -> EmailTheme:
    """Look up the email theme for an org. Unknown or unmapped org_id
    → `_DEFAULT_THEME` (Miltenyi PMS palette)."""
    if org_id is None:
        return _DEFAULT_THEME
    return _ORG_THEMES.get(org_id, _DEFAULT_THEME)


def resolve_from_name(theme: EmailTheme) -> str:
    """Display name in the From: header. SMTP_FROM_NAME (env) wins as a
    global override; otherwise we use the per-org brand name. This keeps
    single-tenant deployments using their existing env config while
    letting multi-tenant deployments brand per-org by leaving the env
    unset."""
    return settings.SMTP_FROM_NAME or theme.brand_name


def resolve_from_address() -> str:
    """The mailbox in From:. Falls back to SMTP_USERNAME for dev/Gmail
    where the auth account and the visible sender must match."""
    return settings.SMTP_FROM_EMAIL or settings.SMTP_USERNAME or ""


def esc(value: object) -> str:
    """HTML-escape a value for safe interpolation into both HTML
    attribute and text contexts. `quote=True` flips `"` → `&quot;` and
    `&` → `&amp;`, so a user with `full_name='Bobby <img onerror=x>'`
    lands in the email body as harmless text rather than a rendered
    tag."""
    return _html_escape(str(value), quote=True)
