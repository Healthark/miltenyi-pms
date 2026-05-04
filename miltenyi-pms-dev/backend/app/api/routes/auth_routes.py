import hashlib
import secrets
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone

from app.core.database import get_db
from app.core.security import verify_password, create_access_token, get_password_hash
from app.core.config import settings
from app.models.user_models import User
from app.models.organization_models import Organization
from app.models.password_reset_token_models import PasswordResetToken
from app.schemas.auth_schemas import (
    SessionResponse,
    TokenResponse,
    ResetPasswordRequest,
    ForgotPasswordRequest,
)
from app.schemas.user_schemas import UserProfile as UserProfileResponse
from app.api.dependencies import CurrentUser
from app.services.send_email import is_smtp_configured, send_password_reset_email

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]

# Must match the values in admin_routes.py — both endpoints write to the
# same password_reset_tokens table and the email template renders the TTL
# verbatim, so divergence would surface as inconsistent UX.
RESET_TOKEN_TTL_MINUTES = 15
RESETS_PER_USER_PER_HOUR = 3


def _build_session(user: User, db: Session) -> dict:
    """
    Compute the live set of auth claims for a user. Used both by /login (at
    token issue time) and /session (so the frontend can refresh its cached
    claims — role, features, mentor/mentee state — without forcing a re-login).
    """
    org = db.query(Organization).filter(Organization.id == user.org_id).first()
    features: list[str] = (org.enabled_features or []) if org else []

    # `has_mentor` is true only when the mentor pointer actually resolves to
    # an active user — a dangling FK to a soft-deleted mentor must not gate
    # annual-goal creation open.
    has_mentor = False
    if user.mentor_id is not None:
        has_mentor = db.query(User.id).filter(
            User.id == user.mentor_id,
            User.is_deleted == False,  # noqa: E712
        ).first() is not None

    has_mentees = db.query(User.id).filter(
        User.mentor_id == user.id,
        User.org_id == user.org_id,
        User.is_deleted == False,  # noqa: E712
    ).first() is not None

    return {
        "user_id": user.id,
        "full_name": user.full_name,
        "role": user.role,
        "org_id": user.org_id,
        "features": features,
        "has_mentees": has_mentees,
        "has_mentor": has_mentor,
        "must_change_password": bool(user.must_change_password),
        "is_management": bool(user.is_management) and user.role == "Admin",
    }


@router.post("/login", response_model=TokenResponse)
def login(
    request: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: DbSession,
    response: Response,
):
    # Normalize email to lowercase so "David@x.com" and "david@x.com" both log
    # in the same account. Requires emails to be stored lowercase — enforced
    # at user creation time and verified with case-insensitive lookup here.
    email = (request.username or "").strip().lower()
    user = db.query(User).filter(func.lower(User.email) == email).first()

    if not user or not verify_password(request.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )

    if user.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated.",
        )

    session = _build_session(user, db)

    token_payload = {
        "sub": user.email,
        "user_id": user.id,
        "org_id": user.org_id,
        "role": user.role,
    }
    access_token = create_access_token(
        data=token_payload,
        expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )

    # The JWT rides in an HttpOnly cookie so JS (and therefore XSS) cannot
    # read it. The CSRF token rides in a parallel non-HttpOnly cookie so the
    # frontend can copy it into the X-CSRF-Token header (double-submit).
    # The same value is also returned in the response body — cross-origin
    # deployments (Vercel → Render) cannot read a cookie set by a different
    # domain, so they fall back to reading it from the body and storing it in
    # localStorage. Same-origin dev uses the cookie path unchanged.
    max_age = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    cookie_kwargs = settings.cookie_kwargs()
    csrf_token_value = secrets.token_urlsafe(32)

    response.set_cookie(
        key=settings.ACCESS_COOKIE_NAME,
        value=access_token,
        httponly=True,
        max_age=max_age,
        **cookie_kwargs,
    )
    response.set_cookie(
        key=settings.CSRF_COOKIE_NAME,
        value=csrf_token_value,
        httponly=False,
        max_age=max_age,
        **cookie_kwargs,
    )

    return {**session, "csrf_token": csrf_token_value}


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response):
    """
    Clear the auth and CSRF cookies server-side. Idempotent — safe to call
    for an unauthenticated client (the frontend's forceLogout() fires this
    blindly on 401/403-deactivated).
    """
    cookie_kwargs = settings.cookie_kwargs()
    response.delete_cookie(key=settings.ACCESS_COOKIE_NAME, **cookie_kwargs)
    response.delete_cookie(key=settings.CSRF_COOKIE_NAME, **cookie_kwargs)
    return None


@router.get("/session", response_model=SessionResponse)
def get_session(current_user: CurrentUser, db: DbSession):
    """
    Live-refresh the auth claims (role, features, has_mentor, has_mentees) that
    were cached at login. The frontend calls this on app mount so promotions,
    feature toggles, and mentor assignments take effect without re-login.
    """
    return _build_session(current_user, db)


@router.post("/reset-password", status_code=status.HTTP_204_NO_CONTENT)
def reset_password(payload: ResetPasswordRequest, db: DbSession):
    """
    Public endpoint — consumes a one-time reset token and sets a new password.

    Called by the frontend `/reset-password?token=…` page after the user
    arrives via the email link. The token is validated by hashing the
    submitted plaintext and looking up `password_reset_tokens.token_hash`;
    the row must exist, not be expired, and not have been used. On success
    we update `password_hash`, clear `must_change_password`, and stamp
    `used_at` so the token cannot be replayed.

    Generic error messages are intentional — we do NOT distinguish "token
    not found" from "token expired" from "token already used" externally,
    so an attacker probing tokens cannot tell which condition failed.

    Unauthenticated by design (the user has lost access to their account).
    The CSRF middleware exempts this path because no auth/CSRF cookies
    exist at the time of call.
    """
    token_hash = hashlib.sha256(payload.token.encode("utf-8")).hexdigest()
    record = (
        db.query(PasswordResetToken)
        .filter(PasswordResetToken.token_hash == token_hash)
        .first()
    )

    invalid = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="This reset link is invalid or has expired. Ask your administrator to issue a new one.",
    )

    if record is None or record.used_at is not None:
        raise invalid

    # `expires_at` is stored as timezone-aware UTC. Compare in the same zone.
    now = datetime.now(timezone.utc)
    expires_at = record.expires_at
    if expires_at.tzinfo is None:
        # SQLite returns naive datetimes; treat as UTC.
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at <= now:
        raise invalid

    user = db.query(User).filter(User.id == record.user_id).first()
    if user is None or user.is_deleted:
        raise invalid

    user.password_hash = get_password_hash(payload.new_password)
    user.must_change_password = False
    record.used_at = now
    db.commit()

    return None


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
def forgot_password(
    payload: ForgotPasswordRequest,
    db: DbSession,
    background_tasks: BackgroundTasks,
):
    """
    Public self-service password reset request.

    The user enters their email on the login page. We look up an active
    account; if found, we issue a one-time reset token and email the link
    using the same template + storage as the admin-triggered reset
    (POST /admin/users/{id}/reset-password). The plaintext token leaves
    the process exactly once via the email — only its SHA-256 hash is
    persisted.

    Behaviour:
        - 204: token issued (or would be issued — email send is best-effort
               via background task).
        - 404: no active account is registered for the supplied email.
        - 429: 3 active reset tokens have been issued for this account in
               the last hour (prevents email-bombing a victim).

    Unauthenticated by design — the user has lost access to their account.
    The CSRF middleware exempts this path because no auth/CSRF cookies
    exist at the time of call.
    """
    email = payload.email.strip().lower()
    user = db.query(User).filter(func.lower(User.email) == email).first()

    if not user or user.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account is registered with that email address.",
        )

    # Per-user rate limit — mirrors the admin reset path. Self-service has
    # no admin actor, so we only apply the per-target cap.
    one_hour_ago = datetime.now(timezone.utc) - timedelta(hours=1)
    recent = (
        db.query(PasswordResetToken)
        .filter(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.created_at >= one_hour_ago,
        )
        .count()
    )
    if recent >= RESETS_PER_USER_PER_HOUR:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=(
                f"This email already has {RESETS_PER_USER_PER_HOUR} active "
                "reset requests in the last hour. Please wait for the existing "
                "link to expire or be used before requesting another."
            ),
        )

    # Issue the token — same shape as admin_routes.reset_user_password().
    raw_token = secrets.token_urlsafe(32)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=RESET_TOKEN_TTL_MINUTES)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

    db.add(
        PasswordResetToken(
            user_id=user.id,
            # Self-service: the user is the requester. The column is non-null
            # in the schema, so we point it at the same user — admin-vs-self
            # provenance can be inferred from `user_id == requested_by_id`.
            requested_by_id=user.id,
            token_hash=token_hash,
            expires_at=expires_at,
        )
    )
    user.must_change_password = True
    db.commit()

    reset_link = (
        f"{settings.APP_BASE_URL.rstrip('/')}/reset-password?token={raw_token}"
    )

    if is_smtp_configured():
        background_tasks.add_task(
            send_password_reset_email,
            to_email=user.email,
            full_name=user.full_name,
            reset_link=reset_link,
            expires_in_minutes=RESET_TOKEN_TTL_MINUTES,
            org_id=user.org_id,
        )

    return None


@router.get("/me", response_model=UserProfileResponse)
def get_my_profile(current_user: CurrentUser):
    """
    Returns the full profile of the authenticated user.
    Used by the Profile page — richer than the JWT payload alone.
    """
    return UserProfileResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        employee_code=current_user.employee_code,
        phone=current_user.phone,
        role=current_user.role,
        department=current_user.department.name if current_user.department else None,
        designation=current_user.designation.name if current_user.designation else None,
        mentor_name=current_user.mentor.full_name if current_user.mentor else None,
    )