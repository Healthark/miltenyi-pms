import hashlib
import secrets
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone

from app.core.database import get_db
from app.core.security import verify_password, get_password_hash
from app.core.config import settings
from app.core.cycle_utils import get_current_cycle_info, resolve_today
from app.core.rate_limit import limiter
from app.models.user_models import User
from app.models.organization_models import Organization
from app.models.password_reset_token_models import PasswordResetToken
from app.models.system_settings_models import SystemSettings, CycleType
from app.schemas.auth_schemas import (
    SessionResponse,
    TokenResponse,
    ResetPasswordRequest,
    ForgotPasswordRequest,
    ThemePreferenceUpdate,
)
from app.schemas.user_schemas import UserProfile as UserProfileResponse
from app.api.dependencies import CurrentUser, CurrentUserAllowingPasswordReset, issue_auth_cookies
from app.services.send_email import is_smtp_configured, send_password_reset_email

router = APIRouter()
DbSession = Annotated[Session, Depends(get_db)]

# Must match the values in admin_routes.py — both endpoints write to the
# same password_reset_tokens table and the email template renders the TTL
# verbatim, so divergence would surface as inconsistent UX.
RESET_TOKEN_TTL_MINUTES = 15
# Per-user quota: at most one ACTIVE (unused + unexpired) token at a time.
# Dropped from 3 to 1 alongside narrowing the count query to only active
# tokens (see `forgot_password` below). The combination eliminates the
# email-volume side channel that previously signalled account existence:
# every request results in at most one email per cycle, and a follow-up
# request only succeeds once the previous token is consumed or expires.
RESETS_PER_USER_PER_HOUR = 1
# How long expired tokens live before cleanup. 7 days gives a forensic
# attribution window (security audit, support tickets) without letting
# the table grow indefinitely. Piggybacked on every forgot-password call
# in lieu of a scheduled-task infrastructure that doesn't exist here.
RESET_TOKEN_RETENTION_DAYS = 7


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
        "theme_preference": user.theme_preference or "light",
        "last_seen_cycle": user.last_seen_cycle,
    }


@router.post("/login", response_model=TokenResponse)
@limiter.limit("10/5minutes")
def login(
    request: Request,
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: DbSession,
    response: Response,
):
    # Normalize email to lowercase so "David@x.com" and "david@x.com" both log
    # in the same account. Requires emails to be stored lowercase — enforced
    # at user creation time and verified with case-insensitive lookup here.
    email = (form_data.username or "").strip().lower()
    user = db.query(User).filter(func.lower(User.email) == email).first()

    if not user or not verify_password(form_data.password, user.password_hash):
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

    # Mint a fresh JWT + new CSRF and stamp both as cookies on the outgoing
    # response. The CSRF value is also returned in the body for cross-origin
    # clients (Vercel → Render) that can't read cookies set on a different
    # domain — those store it in localStorage and copy it into the
    # X-CSRF-Token header on mutating requests.
    _, csrf_token_value = issue_auth_cookies(response, user)

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
def get_session(current_user: CurrentUserAllowingPasswordReset, db: DbSession):
    """
    Live-refresh the auth claims (role, features, has_mentor, has_mentees) that
    were cached at login. The frontend calls this on app mount so promotions,
    feature toggles, and mentor assignments take effect without re-login.

    Uses `CurrentUserAllowingPasswordReset` so a user gated by
    `must_change_password` can still refresh their session — the response
    carries `must_change_password: True`, which is what the frontend's
    `ProtectedRoute` uses to route them to `/change-password`.
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
    # Bump the JWT revocation timestamp so every active session for this
    # user (other browsers, captured tokens, the attacker who stole the
    # session that prompted this reset) is invalidated on its next
    # request. See dependencies.resolve_authenticated_user for the
    # `pwd_iat` comparison that enforces this.
    user.password_changed_at = now
    record.used_at = now
    db.commit()

    return None


@router.post("/forgot-password", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("10/hour")
def forgot_password(
    request: Request,
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

    Returns 204 unconditionally. The endpoint deliberately does NOT
    distinguish "unknown email" from "valid email, token issued" from
    "valid email, per-user quota hit" — all three return the same
    status code with the same shape of work performed up front, so the
    response cannot be used to enumerate registered accounts (risk 1.8).

    Abuse protection:
        - Per-IP rate limit (10/hour) via the slowapi decorator above,
          which is the only path that legitimately returns 429.
        - Per-user reset cap (RESETS_PER_USER_PER_HOUR) silently caps
          how many active tokens a single account can accumulate, so a
          high-throughput IP that spreads requests across many accounts
          still can't email-bomb any one victim.

    Unauthenticated by design — the user has lost access to their account.
    The CSRF middleware exempts this path because no auth/CSRF cookies
    exist at the time of call.
    """
    email = payload.email.strip().lower()
    user = db.query(User).filter(func.lower(User.email) == email).first()

    now = datetime.now(timezone.utc)

    # Hygiene: drop tokens whose expiry passed RESET_TOKEN_RETENTION_DAYS
    # ago. Piggybacked on every forgot-password call in lieu of a
    # scheduled-task infrastructure that doesn't exist in this codebase.
    # Runs BEFORE the per-user count below so stale rows can't inflate
    # the active-token count. `synchronize_session=False` skips the
    # in-memory ORM bookkeeping (we're about to commit anyway).
    cleanup_cutoff = now - timedelta(days=RESET_TOKEN_RETENTION_DAYS)
    db.query(PasswordResetToken).filter(
        PasswordResetToken.expires_at < cleanup_cutoff
    ).delete(synchronize_session=False)

    # Pre-compute the same crypto + DB work along every path so response
    # time does not leak whether the email maps to a real account. We
    # query against `user.id` when present and a sentinel (-1) otherwise;
    # both incur the same index lookup cost.
    #
    # The count now narrows to ACTIVE tokens only (`used_at IS NULL AND
    # expires_at > now`). Previously the filter was `created_at` within
    # the past hour — that double-counted recently-consumed tokens
    # against the quota, and combined with the 3-per-hour cap meant a
    # single forgot/consume/forgot loop could lock the user out of
    # further requests for an hour. The narrowed filter + the
    # RESETS_PER_USER_PER_HOUR=1 cap together mean: at most one active
    # token at a time, but consuming it frees the slot immediately.
    active_count = (
        db.query(PasswordResetToken)
        .filter(
            PasswordResetToken.user_id == (user.id if user else -1),
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
        .count()
    )
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()

    # Silently skip the issue + email side-effects if the email is unknown,
    # the account is deactivated, or the per-user quota is exhausted. The
    # response itself is identical to the success path.
    if (
        not user
        or user.is_deleted
        or active_count >= RESETS_PER_USER_PER_HOUR
    ):
        return None

    expires_at = now + timedelta(minutes=RESET_TOKEN_TTL_MINUTES)

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
    # NOTE (security): `must_change_password = True` is deliberately NOT
    # set here. Previously this line let any attacker with knowledge of
    # a victim's email lock the victim out of their already-active
    # session — every forgot-password request would flip the gate and
    # cause the victim's next API call to 403 (per-IP cap of 10/hour
    # was the only ceiling). The flag is meaningful for admin-issued
    # temp passwords (admin chose your password; you must change it on
    # first login) but the self-service flow already requires the user
    # to choose a new password via the email link, so the gate adds
    # no value here. `reset_password` clears the flag anyway when the
    # email link is consumed.
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
            # Self-service path — the email template branches lead copy
            # + security tip on this flag so the user doesn't get the
            # alarming "an administrator initiated…" wording when they
            # personally clicked Forgot Password.
            triggered_by="self",
        )

    return None


@router.patch("/me/theme", response_model=SessionResponse)
def update_theme_preference(
    payload: ThemePreferenceUpdate,
    current_user: CurrentUser,
    db: DbSession,
):
    """
    Persist the authenticated user's UI theme preference. Returns a
    fresh session payload so the frontend can update its cached claims
    without a separate /auth/session call.
    """
    current_user.theme_preference = payload.theme_preference
    db.commit()
    db.refresh(current_user)
    return _build_session(current_user, db)


@router.post("/me/dismiss-cycle-banner", response_model=SessionResponse)
def dismiss_cycle_banner(
    current_user: CurrentUser,
    db: DbSession,
):
    """
    Stamp the user's `last_seen_cycle` to the org's current active
    cycle, suppressing the "cycle rolled over" banner for them. Driven
    by the dismiss button on the dashboard banner.

    The active cycle is computed fresh here (not read from the stored
    column) so the dismiss sticks even if `system_settings.active_cycle_name`
    is briefly out of date between rollover and the next settings save.
    """
    settings_row = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id,
    ).first()
    if settings_row is not None:
        current_user.last_seen_cycle = get_current_cycle_info(
            resolve_today(settings_row),
            CycleType(settings_row.cycle_type),
            settings_row.fiscal_start_month,
        )
    # If there's no settings row yet, there's no cycle to dismiss; stamp
    # null and the banner stays hidden by virtue of nothing-to-compare-to.
    db.commit()
    db.refresh(current_user)
    return _build_session(current_user, db)


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
        function=current_user.function.name if current_user.function else None,
        designation=current_user.designation.name if current_user.designation else None,
        mentor_name=current_user.mentor.full_name if current_user.mentor else None,
    )