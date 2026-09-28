"""
test_login_errors.py — every failed sign-in answers with a sentence a person
can act on (28 Sep 2026).

Covers: empty fields (422 with a plain `detail`, not a field-error list),
wrong password / unknown email (401, one generic sentence), a deactivated
account (403 with the right password, 401 with a wrong one so the account is
not revealed), the rate limit (429 with a plain `detail`), and the
forgot-password email validation.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.rate_limit import limiter
from app.core.security import get_password_hash
from app.models.organization_models import Organization
from app.models.user_models import Role, User

EMAIL = "aanya@test.local"
GONE = "gone@test.local"


def _seed(db: Session) -> None:
    org = Organization(name="Login Test Org", enabled_features=["dashboard"])
    db.add(org)
    db.flush()
    pw = get_password_hash("password123")
    db.add(User(org_id=org.id, employee_code="A-1", full_name="Aanya", email=EMAIL, role=Role.ADMIN.value, password_hash=pw))
    db.add(User(org_id=org.id, employee_code="G-1", full_name="Gone", email=GONE, role=Role.STAFF.value, password_hash=pw, is_deleted=True))
    db.commit()


def _login(client: TestClient, email: str, password: str):
    return client.post("/api/v1/auth/login", data={"username": email, "password": password})


def test_login_failures_answer_with_sentences(db_session: Session, app_with_db: FastAPI) -> None:
    _seed(db_session)
    limiter.reset()
    client = TestClient(app_with_db)
    try:
        r = _login(client, EMAIL, "")
        assert r.status_code == 422 and r.json()["detail"] == "Enter your email and password."
        r = _login(client, "", "password123")
        assert r.status_code == 422 and r.json()["detail"] == "Enter your email and password."
        r = _login(client, EMAIL, "wrong")
        assert r.status_code == 401 and r.json()["detail"] == "Incorrect email or password"
        r = _login(client, "nobody@test.local", "password123")
        assert r.status_code == 401 and r.json()["detail"] == "Incorrect email or password"
        r = _login(client, GONE, "password123")
        assert r.status_code == 403 and r.json()["detail"] == "This account has been deactivated."
        r = _login(client, GONE, "wrong")
        assert r.status_code == 401 and r.json()["detail"] == "Incorrect email or password"
        r = _login(client, "  " + EMAIL.upper() + " ", "password123")
        assert r.status_code == 200, r.text

        # The limit is 10 per 5 minutes per address and counts only calls
        # that reach the endpoint: the two 422s above never did, so 5 have
        # counted so far. Five more make 10; the next one is refused.
        for _ in range(5):
            _login(client, EMAIL, "wrong")
        r = _login(client, EMAIL, "password123")
        assert r.status_code == 429
        assert r.json()["detail"] == "Too many attempts. Wait a few minutes and try again."
    finally:
        limiter.reset()


def test_forgot_password_validation_answers_with_a_sentence(db_session: Session, app_with_db: FastAPI) -> None:
    _seed(db_session)
    limiter.reset()
    client = TestClient(app_with_db)
    try:
        for bad in ("", "not-an-email", "   "):
            r = client.post("/api/v1/auth/forgot-password", json={"email": bad})
            assert r.status_code == 422, r.text
            assert r.json()["detail"] == "Enter a valid email address."
        # email-validator refuses reserved domains such as .local, hence a real-looking one.
        r = client.post("/api/v1/auth/forgot-password", json={"email": "nobody@healthark.ai"})
        assert r.status_code == 204  # never reveals whether the account exists
    finally:
        limiter.reset()
