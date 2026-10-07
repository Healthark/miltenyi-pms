"""
User Routes — Self-Service Endpoints for Authenticated Users.

Endpoints:
    GET  /api/v1/users/me            → Fetch own profile (rich data for Profile page)
    POST /api/v1/users/me/password   → Change own password

These are NOT admin endpoints — any authenticated user can access them,
but they only ever return or modify the current user's own data.

Security Layers Applied:
    Layer 1 — Authentication:   CurrentUser dependency (JWT validation)
    Layer 2 — Tenant Isolation: Implicit (only reads current_user's own record)
    Layer 3 — Role Authorization: Not needed (self-service, no privilege required)
    Layer 4 — Ownership:        Guaranteed (CurrentUser IS the owner)
"""

from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import DbSession, CurrentUser, CurrentUserAllowingPasswordReset
from app.core.security import verify_password, get_password_hash
from app.schemas.user_schemas import PasswordChangeRequest, UserProfile
from app.services.role_expectations import role_expectation_for
from app.schemas.user_schemas import UserRoleExpectationResponse

router = APIRouter()


@router.get("/me", response_model=UserProfile)
def get_my_profile(
    current_user: CurrentUser,
):
    """
    Return the authenticated user's full profile for the Profile page.

    This is richer than GET /auth/me (which returns minimal identity data).
    It includes org name, function/designation names, and mentor name —
    all resolved from SQLAlchemy relationships so the frontend doesn't
    need to make separate lookups.
    """
    return UserProfile(
        id=current_user.id,
        org_id=current_user.org_id,
        org_name=current_user.organization.name if current_user.organization else "Unknown",
        employee_code=current_user.employee_code,
        full_name=current_user.full_name,
        email=current_user.email,
        phone=current_user.phone,
        role=current_user.role,
        avatar_url=current_user.avatar_url,
        function=current_user.function.name if current_user.function else None,
        designation=current_user.designation.name if current_user.designation else None,
        mentor_name=current_user.mentor.full_name if current_user.mentor else None,
        created_at=current_user.created_at,
    )


@router.post("/me/password", status_code=status.HTTP_200_OK)
def change_password(
    request: PasswordChangeRequest,
    db: DbSession,
    current_user: CurrentUserAllowingPasswordReset,
):
    """
    Allows any authenticated user to change their own password.
    Requires the current password for verification — prevents session
    hijacking from an unlocked screen.

    Uses `CurrentUserAllowingPasswordReset` so a user with
    `must_change_password=True` (after an admin reset or forgot-password
    flow) can actually reach this endpoint to clear the flag. Every other
    authenticated route is gated until the flag clears.
    """
    # 1. Verify they actually know their current password
    if not verify_password(request.current_password, current_user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Current password is incorrect.",
        )

    # 2. Prevent no-op changes
    if request.current_password == request.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="New password must be different from your current password.",
        )

    # 3. Hash and persist. Also clear the admin-reset flag so subsequent
    # logins don't force the user back into the change-password screen.
    # `password_changed_at = now()` bumps the timestamp embedded in the
    # JWT's `pwd_iat` claim — every OTHER active session for this user
    # (other browsers, other devices, captured tokens) gets invalidated
    # on its next request. The current session's cookie gets re-issued
    # by the sliding-refresh in resolve_authenticated_user with the new
    # `pwd_iat`, so the user stays signed in here.
    current_user.password_hash = get_password_hash(request.new_password)
    current_user.must_change_password = False
    current_user.password_changed_at = datetime.now(timezone.utc)
    db.commit()

    return {"message": "Password updated successfully."}


@router.get("/me/expectations", response_model=UserRoleExpectationResponse)
def get_my_role_expectations(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return the GCC role expectations (6 columns) for the current user,
    resolved by (function, designation.career_level). Missing pieces come
    back as a 'Role expectation not defined' placeholder; see
    app/services/role_expectations.py.
    """
    return role_expectation_for(db, current_user)