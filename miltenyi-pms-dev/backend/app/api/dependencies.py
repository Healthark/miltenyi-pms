import secrets
from datetime import timedelta
from typing import Annotated

from fastapi import Cookie, Depends, Header, HTTPException, Response, status
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token
from app.models.user_models import User

# Reusable Database Session (same as we used in auth.py)
DbSession = Annotated[Session, Depends(get_db)]


def issue_auth_cookies(
    response: Response,
    user: User,
    csrf_token: str | None = None,
) -> tuple[str, str]:
    """Mint a fresh access token and stamp both auth cookies on `response`.

    Called from two places:
      - /auth/login        — `csrf_token=None`, a new CSRF value is minted
                              and returned in the response body for cross-
                              origin clients to cache in localStorage.
      - get_current_user   — sliding refresh; pass the existing CSRF value
                              from the request cookie so the frontend's
                              cached header value stays in sync with the
                              cookie. Rotating CSRF mid-session would break
                              the next mutating request.

    Returns (access_token, csrf_token) so the login route can echo both
    values to the body.
    """
    # `pwd_iat` (password-issued-at) backs JWT session revocation. The
    # claim equals `users.password_changed_at` at the moment this token
    # was minted; `resolve_authenticated_user` rejects any token whose
    # claim is lower than the current column value, which is how a
    # password change (self-service, reset link, or admin temp-password
    # issue) invalidates every other active session for that user.
    #
    # If `password_changed_at` is somehow None (shouldn't happen — the
    # migration backfills every row and every write site sets it), we
    # encode 0 and `resolve_authenticated_user` will reject mismatching
    # tokens until the next password change syncs the value.
    pwd_iat = (
        int(user.password_changed_at.timestamp())
        if user.password_changed_at is not None
        else 0
    )
    token_payload = {
        "sub": user.email,
        "user_id": user.id,
        "org_id": user.org_id,
        "role": user.role,
        "pwd_iat": pwd_iat,
    }
    access_token = create_access_token(
        data=token_payload,
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )

    effective_csrf = csrf_token or secrets.token_urlsafe(32)
    max_age = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    cookie_kwargs = settings.cookie_kwargs()

    response.set_cookie(
        key=settings.ACCESS_COOKIE_NAME,
        value=access_token,
        httponly=True,
        max_age=max_age,
        **cookie_kwargs,
    )
    response.set_cookie(
        key=settings.CSRF_COOKIE_NAME,
        value=effective_csrf,
        httponly=False,
        max_age=max_age,
        **cookie_kwargs,
    )

    return access_token, effective_csrf


def _extract_token(cookie_token: str | None, auth_header: str | None) -> str | None:
    """Prefer the HttpOnly cookie (production path). Fall back to the
    Authorization: Bearer header so Swagger UI's Authorize button still
    works for manual API exploration — the cookie path is what real browser
    clients use."""
    if cookie_token:
        return cookie_token
    if auth_header and auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1]
    return None


def resolve_authenticated_user(
    db: DbSession,
    response: Response,
    cookie_token: Annotated[
        str | None,
        Cookie(alias=settings.ACCESS_COOKIE_NAME),
    ] = None,
    csrf_cookie: Annotated[
        str | None,
        Cookie(alias=settings.CSRF_COOKIE_NAME),
    ] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    """
    Decode the JWT, look up the User, run tenant + soft-delete checks, and
    slide the cookie window forward. Does NOT enforce the
    `must_change_password` gate — that lives in `get_current_user` so the
    three exempt routes (password change, logout, session refresh) can
    depend on this resolver via `get_current_user_allow_password_reset`
    and remain reachable while a user is gated.

    Sliding refresh: after the user is validated, both auth cookies are re-
    stamped with a fresh `max_age` so the session window rolls forward with
    every authenticated call. A user who stops making calls past the window
    will be silently logged out on their next request.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
    )

    token = _extract_token(cookie_token, authorization)
    if not token:
        raise credentials_exception

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])

        user_id: int = payload.get("user_id")
        token_org_id: int | None = payload.get("org_id")
        token_pwd_iat: int | None = payload.get("pwd_iat")
        if user_id is None:
            raise credentials_exception

    except JWTError:
        raise credentials_exception

    # 3. Look up the user in the database
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception

    # 4. Tenant fence — if the user has been moved to another org since the
    # token was issued, the old token should no longer authenticate them.
    if token_org_id is not None and token_org_id != user.org_id:
        raise credentials_exception

    # 5. The Last Line of Defense
    # What if a user was fired and soft-deleted 5 minutes ago, but their token
    # is still valid for another hour? We catch them here.
    if user.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated."
        )

    # 6. JWT session revocation on password change.
    # `pwd_iat` is stamped at token issue time (see issue_auth_cookies)
    # and equals `users.password_changed_at` at the moment of mint. We
    # reject any token whose claim is lower than the current column
    # value — i.e. the password has been changed since this token was
    # issued. This closes the captured-JWT window that previously
    # defeated password reset (attacker keeps using the stolen token
    # for up to ACCESS_TOKEN_EXPIRE_MINUTES after the victim "resets").
    #
    # Strict mode (per design decision):
    #   - Token missing `pwd_iat` (pre-deploy JWT) → reject. The
    #     migration backfilled every existing row to NOW(), so even if
    #     an old-format token is replayed it gets rejected on first use.
    #   - User row missing `password_changed_at` (shouldn't happen given
    #     the backfill + write-site enforcement) → encode 0 and require
    #     token to also be 0; any non-zero token still gets rejected.
    expected_pwd_iat = (
        int(user.password_changed_at.timestamp())
        if user.password_changed_at is not None
        else 0
    )
    if token_pwd_iat is None or token_pwd_iat != expected_pwd_iat:
        raise credentials_exception

    # 6. Sliding refresh — re-issue cookies on the outgoing response so the
    # 30-minute window rolls forward from this request. Only fires for the
    # cookie auth path; Swagger's Bearer-header callers have no cookies to
    # refresh and the set_cookie below is harmless noise to them.
    if cookie_token is not None:
        issue_auth_cookies(response, user, csrf_token=csrf_cookie)

    return user


def get_current_user(
    user: Annotated[User, Depends(resolve_authenticated_user)],
) -> User:
    """
    Standard authenticated-user dependency. Resolves the JWT and then
    enforces the post-admin-reset `must_change_password` gate: a user whose
    flag is set cannot reach any route gated on this dependency until they
    change their password. Without this server-side gate, the flag was only
    enforced by the frontend's `ProtectedRoute` redirect — a direct API
    client could ignore it entirely (risk-register 1.2).

    The three exempt routes the user must still reach while gated
    (POST /users/me/password, POST /auth/logout, GET /auth/session)
    depend on `get_current_user_allow_password_reset` instead.
    """
    if user.must_change_password:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You must change your password before continuing.",
        )
    return user


def get_current_user_allow_password_reset(
    user: Annotated[User, Depends(resolve_authenticated_user)],
) -> User:
    """
    Same JWT resolution as `get_current_user` but WITHOUT the
    `must_change_password` gate. Use on the narrow set of routes a gated
    user must still reach — namely the password-change endpoint itself
    (so they can clear the flag), logout (so they can leave), and the
    session refresh endpoint (so the frontend's refreshSession() can
    still observe the gated state and route them to /change-password).
    """
    return user


# --- The Architect's Trick: The Golden Dependency ---
# Anytime you want to lock down an endpoint, you will simply add: `current_user: CurrentUser`
CurrentUser = Annotated[User, Depends(get_current_user)]
# Use only on the password-change / logout / session-refresh routes —
# everywhere else, prefer `CurrentUser` so the password-change gate fires.
CurrentUserAllowingPasswordReset = Annotated[User, Depends(get_current_user_allow_password_reset)]