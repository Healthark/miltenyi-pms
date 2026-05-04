"""
CSRF protection — double-submit cookie pattern.

At login the backend sets two cookies:
    - access_token   : HttpOnly, the JWT itself (not readable by JS)
    - csrf_token     : readable by JS, a random per-session value

The frontend copies csrf_token into an X-CSRF-Token header on every
mutating request. This middleware rejects any mutating request where the
header is missing or does not match the cookie — an attacker site cannot
read the csrf cookie (same-origin policy protects document.cookie) and
therefore cannot forge the header, so a cross-site POST is blocked even
if the browser auto-attaches the access_token cookie.

Exemptions:
    - Safe methods (GET, HEAD, OPTIONS) — the browser won't let cross-site
      reads leak back to the attacker anyway, and we'd break preflight.
    - /auth/login and /auth/logout — the cookies don't exist yet (login)
      or we're just asking the server to clear them (logout).
    - /docs, /redoc, /openapi.json — Swagger UI uses its own flow.
"""

from __future__ import annotations

from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

from app.core.config import settings


_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
_EXEMPT_PATHS = frozenset(
    {
        "/docs",
        "/redoc",
        "/openapi.json",
        f"{settings.API_V1_STR}/auth/login",
        f"{settings.API_V1_STR}/auth/logout",
        # Public — the user has no auth/CSRF cookies yet (they lost access
        # to their account, which is the whole reason they're hitting it).
        f"{settings.API_V1_STR}/auth/reset-password",
        f"{settings.API_V1_STR}/auth/forgot-password",
    }
)


class CSRFMiddleware(BaseHTTPMiddleware):
    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next):
        if request.method in _SAFE_METHODS or request.url.path in _EXEMPT_PATHS:
            return await call_next(request)

        cookie_token = request.cookies.get(settings.CSRF_COOKIE_NAME)
        header_token = request.headers.get(settings.CSRF_HEADER_NAME)

        if not cookie_token or not header_token or cookie_token != header_token:
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF token missing or invalid."},
            )

        return await call_next(request)
