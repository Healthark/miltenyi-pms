"""
test_employee_code.py — the employee code on Add User is the Admin's to set
(29 Sep 2026): blank keeps the generated HRK-<ROLE>-nnn code, a typed code is
kept as typed, a taken code answers 409 on create and on edit, and custom
codes never disturb the generated sequence.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import app.api.routes.admin_routes as admin_routes
from app.core.config import settings
from app.models.organization_models import Organization
from app.models.user_models import Role, User

CSRF = "test-csrf-token"


def _admin(db: Session) -> User:
    org = Organization(name="Code Test Org", enabled_features=["admin"])
    db.add(org)
    db.flush()
    admin = User(org_id=org.id, employee_code="HRK-ADM-001", full_name="Aanya Admin",
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
    body = {"full_name": "New Person", "email": email, "role": "Staff", "password": "Welcome-2026"}
    body.update(extra)
    return client.post("/api/v1/admin/users", json=body)


def test_blank_code_is_generated_and_custom_code_is_kept(db_session: Session, app_with_db: FastAPI, as_user, monkeypatch) -> None:
    admin = _admin(db_session)
    monkeypatch.setattr(admin_routes, "is_smtp_configured", lambda: False)
    client = _client(as_user, admin)

    r = _create(client, "a@healthark.ai")                       # no code sent
    assert r.status_code == 201 and r.json()["employee_code"] == "HRK-STF-001", r.text
    r = _create(client, "b@healthark.ai", employee_code="   ")   # blank counts as absent
    assert r.status_code == 201 and r.json()["employee_code"] == "HRK-STF-002", r.text
    r = _create(client, "c@healthark.ai", employee_code=" MB-2026-17 ")
    assert r.status_code == 201 and r.json()["employee_code"] == "MB-2026-17", r.text
    # The generated sequence ignores custom codes and carries on.
    r = _create(client, "d@healthark.ai")
    assert r.status_code == 201 and r.json()["employee_code"] == "HRK-STF-003", r.text
    assert client.get("/api/v1/admin/users/next-employee-code", params={"role": "Staff"}).json()["code"] == "HRK-STF-004"


def test_taken_code_is_refused_on_create_and_edit(db_session: Session, app_with_db: FastAPI, as_user, monkeypatch) -> None:
    admin = _admin(db_session)
    monkeypatch.setattr(admin_routes, "is_smtp_configured", lambda: False)
    client = _client(as_user, admin)

    first = _create(client, "a@healthark.ai", employee_code="MB-01").json()
    r = _create(client, "b@healthark.ai", employee_code="MB-01")
    assert r.status_code == 409 and "MB-01" in r.json()["detail"]
    second = _create(client, "b@healthark.ai", employee_code="MB-02").json()
    r = client.patch(f"/api/v1/admin/users/{second['id']}", json={"employee_code": "MB-01"})
    assert r.status_code == 409, r.text
    r = client.patch(f"/api/v1/admin/users/{second['id']}", json={"employee_code": "MB-03"})
    assert r.status_code == 200 and r.json()["employee_code"] == "MB-03", r.text
    assert first["employee_code"] == "MB-01"
