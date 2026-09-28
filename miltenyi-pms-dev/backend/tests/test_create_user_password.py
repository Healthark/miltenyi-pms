"""
test_create_user_password.py — the temporary password on user creation
(28 Sep 2026): the Admin may leave it blank and the server generates one;
either way the welcome email carries exactly the password the account was
created with, and the account must change it at first sign-in.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import app.api.routes.admin_routes as admin_routes
from app.core.config import settings
from app.core.security import verify_password
from app.models.organization_models import Organization
from app.models.user_models import Role, User

CSRF = "test-csrf-token"


def _admin(db: Session) -> User:
    org = Organization(name="Create User Org", enabled_features=["admin"])
    db.add(org)
    db.flush()
    admin = User(org_id=org.id, employee_code="HRK-001", full_name="Aanya Admin",
                 email="aanya@healthark.ai", role=Role.ADMIN.value, password_hash="x")
    db.add(admin)
    db.commit()
    return admin


def _client(as_user, user: User) -> TestClient:
    client = as_user(user)
    client.cookies.set(settings.CSRF_COOKIE_NAME, CSRF)
    client.headers.update({settings.CSRF_HEADER_NAME: CSRF})
    return client


def _create(client: TestClient, email: str, **extra):
    body = {"full_name": "New Person", "email": email, "role": "Staff"}
    body.update(extra)
    return client.post("/api/v1/admin/users", json=body)


def test_blank_password_is_generated_and_emailed(db_session: Session, app_with_db: FastAPI, as_user, monkeypatch) -> None:
    admin = _admin(db_session)
    sent: list[dict] = []
    monkeypatch.setattr(admin_routes, "is_smtp_configured", lambda: True)
    monkeypatch.setattr(admin_routes, "send_welcome_user_email", lambda **kw: sent.append(kw))
    client = _client(as_user, admin)

    r = _create(client, "new.person@healthark.ai")          # no password at all
    assert r.status_code == 201, r.text
    user = db_session.query(User).filter(User.email == "new.person@healthark.ai").one()
    assert user.must_change_password is True
    assert len(sent) == 1 and sent[0]["to_email"] == user.email
    generated = sent[0]["password"]
    assert len(generated) == 12 and generated.isalnum()
    assert verify_password(generated, user.password_hash)

    r = _create(client, "blank.person@healthark.ai", password="   ")   # blank counts as absent
    assert r.status_code == 201, r.text
    assert len(sent) == 2 and verify_password(sent[1]["password"], db_session.query(User).filter(User.email == "blank.person@healthark.ai").one().password_hash)


def test_chosen_password_is_used_as_typed(db_session: Session, app_with_db: FastAPI, as_user, monkeypatch) -> None:
    admin = _admin(db_session)
    sent: list[dict] = []
    monkeypatch.setattr(admin_routes, "is_smtp_configured", lambda: True)
    monkeypatch.setattr(admin_routes, "send_welcome_user_email", lambda **kw: sent.append(kw))
    client = _client(as_user, admin)

    r = _create(client, "chosen@healthark.ai", password="Welcome-2026")
    assert r.status_code == 201, r.text
    user = db_session.query(User).filter(User.email == "chosen@healthark.ai").one()
    assert sent[0]["password"] == "Welcome-2026" and verify_password("Welcome-2026", user.password_hash)

    assert _create(client, "short@healthark.ai", password="abc").status_code == 422


def test_no_smtp_means_no_email_but_the_account_exists(db_session: Session, app_with_db: FastAPI, as_user, monkeypatch) -> None:
    admin = _admin(db_session)
    monkeypatch.setattr(admin_routes, "is_smtp_configured", lambda: False)
    monkeypatch.setattr(admin_routes, "send_welcome_user_email", lambda **kw: (_ for _ in ()).throw(AssertionError("must not send")))
    client = _client(as_user, admin)
    r = _create(client, "quiet@healthark.ai")
    assert r.status_code == 201, r.text
    assert db_session.query(User).filter(User.email == "quiet@healthark.ai").one().must_change_password is True
