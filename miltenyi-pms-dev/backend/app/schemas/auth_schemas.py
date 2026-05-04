from pydantic import BaseModel, EmailStr, Field

# 1. The Incoming Request (What the React frontend sends us)
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class ResetPasswordRequest(BaseModel):
    """Body for POST /auth/reset-password — user-facing token consumption.

    Submitted by the unauthenticated user via the public reset page after
    clicking the email link. The plaintext token is hashed in-process and
    looked up against `password_reset_tokens.token_hash`."""
    token: str = Field(..., min_length=20, max_length=128)
    new_password: str = Field(..., min_length=8, max_length=128)


class ForgotPasswordRequest(BaseModel):
    """Body for POST /auth/forgot-password — self-service reset request.

    The unauthenticated user enters their email on the login page. Backend
    looks up the account and, if found, issues a reset token + emails the
    link (same format/template as the admin-triggered reset)."""
    email: EmailStr


class SessionResponse(BaseModel):
    """Live auth claims — role, features, mentor/mentee flags — refreshed
    independently of the JWT so admin changes take effect without re-login."""
    user_id: int
    full_name: str
    role: str
    org_id: int
    features: list[str]
    # True when at least one active user reports to this user via mentor_id.
    # Drives mentor-only UI (e.g. the Team Goals tab) independent of role,
    # since mentorship is an FK relationship, not a role attribute.
    has_mentees: bool = False
    # False for CEO/founders (mentor_id IS NULL) OR when the assigned mentor
    # is soft-deleted. Annual goal creation is blocked in both cases because
    # the approval workflow needs a live mentor to route to.
    has_mentor: bool = False
    # True when an admin just reset the user's password. The frontend gates
    # all routes until the user completes the change-password flow, which
    # clears this flag.
    must_change_password: bool = False
    # Sub-role of Admin — always implies role == "Admin". Gates the
    # Management Review tab in the admin panel and the finalize/override
    # actions on annual reviews.
    is_management: bool = False


# 2. The Outgoing Response (What we send back to React)
# After C12 the JWT rides in an HttpOnly cookie set on the response — it is
# deliberately NOT part of the body so JS can never read it. The body carries
# only the session claims the frontend needs to render.
class TokenResponse(SessionResponse):
    # The CSRF token value is also included in the response body so that
    # cross-origin deployments (e.g. Vercel frontend → Render backend) can
    # store it in localStorage and replay it as the X-CSRF-Token header.
    # The double-submit cookie trick breaks cross-origin because JS running on
    # vercel.app cannot read cookies set by onrender.com — document.cookie is
    # domain-scoped. The body field is the escape hatch; same-origin dev
    # continues to use the cookie path unchanged.
    csrf_token: str = ""