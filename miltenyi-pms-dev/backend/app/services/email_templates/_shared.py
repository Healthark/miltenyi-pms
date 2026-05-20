"""Shared theming + escaping helpers for outbound email templates.

Per-org theme resolution and HTML-attribute-safe escaping. Used by every
template in this package and by `send_email.py` (for the From: line).

Mirrors the frontend's THEME_MAP / BRAND_META — keep the two in sync
when adding a tenant, otherwise a Miltenyi user receives a HealthArk-
branded email or vice versa.
"""

from __future__ import annotations

from dataclasses import dataclass
from html import escape as _html_escape

from app.core.config import settings


@dataclass(frozen=True)
class EmailTheme:
    """Color + display-name palette for a single tenant's outbound mail.

    Mirrors `--brand` / `--brand-light` in `frontend/src/index.css` and
    the title in `BRAND_META` from `frontend/src/contexts/AuthProvider.tsx`."""

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


def resolve_theme(org_id: int | None) -> EmailTheme:
    """Look up the per-org theme. Unknown org_id → default (HealthArk).
    Same fallback behavior as the frontend's THEME_MAP."""
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
