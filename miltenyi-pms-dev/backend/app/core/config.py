from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "Healthark PMS"
    API_V1_STR: str = "/api/v1"

    # Security
    SECRET_KEY: str
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7 # 7 days

    # Database
    DATABASE_URL: str

    # ── Cookie auth ─────────────────────────────────────────────────
    # Whether frontend and backend share an origin in this deployment.
    # - True  (default, prod behind a reverse proxy): SameSite=Lax is fine,
    #   Secure can be False on http dev and must be True on https prod.
    # - False (dev vite↔fastapi, or prod on separate domains): SameSite=None
    #   is required for cookies to cross the boundary, which in turn forces
    #   Secure=True (browsers reject SameSite=None over http in prod; on
    #   http://localhost Chrome is lenient so dev still works).
    SAME_ORIGIN: bool = True
    COOKIE_SECURE: bool = False
    # Only set for cross-origin across subdomains (e.g. ".example.com").
    COOKIE_DOMAIN: str | None = None
    ACCESS_COOKIE_NAME: str = "access_token"
    CSRF_COOKIE_NAME: str = "csrf_token"
    CSRF_HEADER_NAME: str = "X-CSRF-Token"

    # ── CORS ─────────────────────────────────────────────────────────
    # Comma-separated list of production frontend origins to allow in addition
    # to the localhost defaults. Set this in Render env vars:
    #   CORS_ALLOWED_ORIGINS=https://your-app.vercel.app,https://www.yourapp.com
    CORS_ALLOWED_ORIGINS: str = ""

    # ── Outbound email (admin password reset, future notifications) ─
    # Two transport options, in order of preference:
    #   1. Resend HTTP API (RESEND_API_KEY)  — uses HTTPS:443, works on
    #      Render Free where outbound SMTP is silently dropped.
    #   2. SMTP STARTTLS (SMTP_USERNAME / SMTP_PASSWORD) — works on any
    #      host that allows outbound 587, including local dev. On Render
    #      Free, SMTP times out at the network layer; use Resend there.
    # If neither is configured, sending is skipped and admins fall back
    # to the reveal-modal that shows the reset link in-app.
    RESEND_API_KEY: str | None = None
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    # Optional GLOBAL display-name override. When unset, the per-org email
    # theme's brand_name wins (HealthArk vs Miltenyi vs …). Single-tenant
    # deployments can pin this; multi-tenant should leave it unset.
    SMTP_FROM_NAME: str | None = None
    # Mailbox in the From: header. When unset, _send() falls back to
    # SMTP_USERNAME (the auth account), which is required for personal
    # Gmail since Gmail rewrites/rejects mismatching From: addresses.
    #
    # Production checklist for sending from a custom domain (e.g.
    # `noreply@yourcompany.com`) so messages don't get tagged "via gmail.com"
    # and don't trip strict spam filters:
    #   1. SPF — TXT record at the apex declaring authorised senders, e.g.:
    #        "v=spf1 include:_spf.google.com include:mailgun.org ~all"
    #   2. DKIM — generate a key pair from your transactional provider
    #      (Postmark / Mailgun / SES / Google Workspace) and publish the
    #      public key as TXT at `<selector>._domainkey.yourcompany.com`.
    #      Example value (provider-issued):
    #        "v=DKIM1; k=rsa; p=MIGfMA0GCSqGSIb3DQEBAQUAA…"
    #   3. DMARC — TXT at `_dmarc.yourcompany.com`:
    #        "v=DMARC1; p=quarantine; rua=mailto:dmarc@yourcompany.com"
    #      Start with `p=none` for a week to monitor `rua` reports, then
    #      ratchet to `quarantine` and finally `reject` once aligned.
    #   4. Verify with https://www.mail-tester.com/ before sending volume.
    #
    # Personal Gmail accounts (i.e. our current dev setup) are also subject
    # to a ~500/day send cap and a 100/recipient cap. Production should run
    # via Workspace SMTP relay or a transactional provider.
    SMTP_FROM_EMAIL: str | None = None
    # Used to render the "Sign in" CTA link inside outbound emails.
    APP_BASE_URL: str = "http://localhost:5173"

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True)

    FISCAL_START_MONTH: int = 4

    def cookie_kwargs(self) -> dict:
        """Shared cookie attributes for set_cookie / delete_cookie. SameSite=None
        requires Secure=True per browser spec, so we enforce that when the
        deployment is cross-origin regardless of COOKIE_SECURE."""
        samesite = "lax" if self.SAME_ORIGIN else "none"
        return {
            "secure": self.COOKIE_SECURE or not self.SAME_ORIGIN,
            "samesite": samesite,
            "domain": self.COOKIE_DOMAIN,
            "path": "/",
        }


settings = Settings()
