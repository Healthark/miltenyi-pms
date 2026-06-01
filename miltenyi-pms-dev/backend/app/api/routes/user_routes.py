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
from app.models.role_expectation_models import RoleExpectation
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

_CAREER_LEVEL_LABELS = {1: "Entry", 2: "Mid", 3: "Senior", 4: "Lead"}
_EXPECTATION_NOT_DEFINED = "Role expectation not defined"


@router.get("/me/expectations", response_model=UserRoleExpectationResponse)
def get_my_role_expectations(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return the GCC role expectations (6 columns) for the current user,
    resolved by (function, designation.career_level). When the user has
    no function / no designation / a designation without a career level,
    or the (function, career_level) row hasn't been seeded yet, every
    expectation field returns the same 'Role expectation not defined'
    placeholder so the frontend can render the panel without null-checks.
    """
    func_name = current_user.function.name if current_user.function else "Unassigned"
    desig = current_user.designation
    desig_name = desig.name if desig else "Unassigned"
    career_level = desig.career_level if desig and desig.career_level is not None else None
    career_level_label = _CAREER_LEVEL_LABELS.get(career_level) if career_level is not None else None

    fallback = UserRoleExpectationResponse(
        function_name=func_name,
        designation_name=desig_name,
        career_level=career_level,
        career_level_label=career_level_label,
        exp_scope_of_role=_EXPECTATION_NOT_DEFINED,
        exp_key_responsibilities=_EXPECTATION_NOT_DEFINED,
        exp_technical_competencies=_EXPECTATION_NOT_DEFINED,
        exp_delivery_ownership=_EXPECTATION_NOT_DEFINED,
        exp_regulatory_compliance=_EXPECTATION_NOT_DEFINED,
        exp_project_resource_management=_EXPECTATION_NOT_DEFINED,
    )

    if not current_user.function_id or career_level is None:
        return fallback

    expectation = db.query(RoleExpectation).filter(
        RoleExpectation.org_id == current_user.org_id,
        RoleExpectation.function_id == current_user.function_id,
        RoleExpectation.career_level == career_level,
    ).first()

    if not expectation:
        return fallback

    return UserRoleExpectationResponse(
        function_name=func_name,
        designation_name=desig_name,
        career_level=career_level,
        career_level_label=career_level_label,
        exp_scope_of_role=expectation.exp_scope_of_role or _EXPECTATION_NOT_DEFINED,
        exp_key_responsibilities=expectation.exp_key_responsibilities or _EXPECTATION_NOT_DEFINED,
        exp_technical_competencies=expectation.exp_technical_competencies or _EXPECTATION_NOT_DEFINED,
        exp_delivery_ownership=expectation.exp_delivery_ownership or _EXPECTATION_NOT_DEFINED,
        exp_regulatory_compliance=expectation.exp_regulatory_compliance or _EXPECTATION_NOT_DEFINED,
        exp_project_resource_management=expectation.exp_project_resource_management or _EXPECTATION_NOT_DEFINED,
    )