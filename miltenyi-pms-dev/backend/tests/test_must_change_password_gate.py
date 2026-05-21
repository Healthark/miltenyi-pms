"""
test_must_change_password_gate.py — server-side enforcement of the
`must_change_password` flag (risk-register 1.2).

What this test does:
    Seeds an Employee with `must_change_password=True` and makes
    requests bypassing only the JWT resolver (NOT the gate). Asserts:
      1. A normal authenticated route (GET /goals/) returns 403 with
         the gate message.
      2. The three exempt routes the user must still reach — logout,
         session refresh, password change — do NOT return that 403.

Why the override targets `resolve_authenticated_user`:
    The `as_user` fixture overrides `get_current_user` directly, which
    short-circuits the gate logic and would defeat the point of this
    test. Overriding the inner resolver instead lets the real
    `get_current_user` (with the gate) and
    `get_current_user_allow_password_reset` (without it) run unchanged,
    so we observe the actual production behaviour.

Why this test exists:
    Before the fix, `must_change_password` was enforced only by the
    frontend's ProtectedRoute redirect. A direct API client (curl,
    Postman) could ignore the redirect and call any authenticated
    endpoint normally. The flag was a UX hint, not a security control.
    This test makes the new server-side gate regression-proof.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.api.dependencies import resolve_authenticated_user
from app.core.config import settings
from app.core.security import get_password_hash
from app.models.organization_models import Organization
from app.models.user_models import Role, User


GATE_DETAIL = "You must change your password before continuing."
# Any non-empty string works as long as cookie == header — the CSRF
# middleware doesn't validate the value, only the double-submit match.
CSRF_VALUE = "test-csrf-token"


def _seed_gated_user(db: Session) -> User:
    """Org + Employee with `must_change_password=True`.

    `enabled_features=[]` so /auth/session's `_build_session` returns
    cleanly without exploding on a None list. We hash a real placeholder
    password so the change-password route's `verify_password` call gets
    a valid bcrypt hash to compare against — the test sends a
    deliberately-wrong current password, so the comparison fails and
    the route returns 400 (which is what we want to assert).
    """
    org = Organization(name="Gate Test Org", enabled_features=[])
    db.add(org)
    db.flush()

    user = User(
        org_id=org.id,
        employee_code="GATED-001",
        full_name="Gated Employee",
        email="gated@test.local",
        role=Role.EMPLOYEE.value,
        password_hash=get_password_hash("real-current-password"),
        must_change_password=True,
    )
    db.add(user)
    db.commit()
    return user


def test_must_change_password_gate_fires_and_exempts_correct_routes(
    db_session: Session,
    app_with_db: FastAPI,
) -> None:
    user = _seed_gated_user(db_session)

    # Override the inner resolver so the real `get_current_user` (which
    # holds the gate) and `get_current_user_allow_password_reset` (which
    # does not) still run — see module docstring for the rationale.
    app_with_db.dependency_overrides[resolve_authenticated_user] = lambda: user
    client = TestClient(app_with_db)

    # ── Gated route: gate must fire ──────────────────────────────────
    resp = client.get("/api/v1/goals/")
    assert resp.status_code == 403, resp.text
    assert resp.json()["detail"] == GATE_DETAIL

    # ── Exempt: POST /auth/logout ────────────────────────────────────
    # Has no auth dependency at all, so the gate cannot fire here even
    # in principle. Asserting it succeeds anyway documents the contract.
    resp = client.post("/api/v1/auth/logout")
    assert resp.status_code == 204, resp.text

    # ── Exempt: GET /auth/session ────────────────────────────────────
    # Depends on `CurrentUserAllowingPasswordReset`. Should return 200
    # with `must_change_password=True` so the frontend's refreshSession()
    # observes the flag and routes the user to /change-password.
    resp = client.get("/api/v1/auth/session")
    assert resp.status_code == 200, resp.text
    assert resp.json()["must_change_password"] is True

    # ── Exempt: POST /users/me/password ──────────────────────────────
    # Mutating endpoint, so the CSRF middleware runs first — set both
    # the cookie and the matching X-CSRF-Token header to satisfy the
    # double-submit check (it doesn't validate the value, only that
    # cookie == header). Then the body uses an intentionally-wrong
    # current password so the route itself rejects with 400 ("Current
    # password is incorrect"). That 400 — NOT a 403 with the gate
    # message — is what proves the bypass dep let us reach the handler.
    client.cookies.set(settings.CSRF_COOKIE_NAME, CSRF_VALUE)
    resp = client.post(
        "/api/v1/users/me/password",
        json={
            "current_password": "wrong-on-purpose",
            "new_password": "a-new-long-enough-password",
        },
        headers={settings.CSRF_HEADER_NAME: CSRF_VALUE},
    )
    # The gate-specific 403 must not appear. (A 403 from elsewhere
    # would be a different problem, but the message tells us which.)
    if resp.status_code == 403:
        assert resp.json().get("detail") != GATE_DETAIL, (
            "Gate fired on the password-change endpoint — bypass dep "
            "is not wired correctly."
        )
    # Tight assertion: it's the route's own 400, not anything else.
    assert resp.status_code == 400, resp.text
    assert resp.json()["detail"] == "Current password is incorrect."
