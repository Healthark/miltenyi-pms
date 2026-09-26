"""
test_admin_notify.py — the Admin's targeted announcements (POST /admin/notify).

Seeds one org with an Admin, two Staff in different functions and a Mentor,
then checks the audience filters (roles, functions, specific users, AND-
combined; no filter = everyone but the sender), the delivery channels
(in_app writes bell rows, email writes none) and the guards (403 for a
non-Admin, 400 when nobody matches, 422 on an empty body).
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.notification_models import Notification
from app.models.organization_models import Organization
from app.models.reference_models import Function
from app.models.user_models import Role, User

CSRF_VALUE = "test-csrf-token"


def _user(org_id: int, code: str, name: str, role: str, function_id: int | None = None) -> User:
    return User(
        org_id=org_id,
        employee_code=code,
        full_name=name,
        email=f"{code.lower()}@test.local",
        role=role,
        function_id=function_id,
        password_hash="x",
    )


def _seed(db: Session) -> dict:
    org = Organization(name="Notify Test Org", enabled_features=[])
    db.add(org)
    db.flush()
    ra = Function(org_id=org.id, name="Regulatory Affairs")
    cdm = Function(org_id=org.id, name="Clinical Data Management")
    db.add_all([ra, cdm])
    db.flush()
    admin = _user(org.id, "ADM-1", "Aanya Admin", Role.ADMIN.value)
    staff_ra = _user(org.id, "STF-1", "Aarav Staff", Role.STAFF.value, ra.id)
    staff_cdm = _user(org.id, "STF-2", "Arjun Staff", Role.STAFF.value, cdm.id)
    mentor = _user(org.id, "MNT-1", "Rahul Mentor", Role.MENTOR.value, ra.id)
    gone = _user(org.id, "STF-9", "Left Staff", Role.STAFF.value, ra.id)
    gone.is_deleted = True
    db.add_all([admin, staff_ra, staff_cdm, mentor, gone])
    db.commit()
    return {"org": org, "ra": ra, "cdm": cdm, "admin": admin, "staff_ra": staff_ra,
            "staff_cdm": staff_cdm, "mentor": mentor, "gone": gone}


def _client(as_user, user: User) -> TestClient:
    client = as_user(user)
    client.cookies.set(settings.CSRF_COOKIE_NAME, CSRF_VALUE)
    client.headers.update({settings.CSRF_HEADER_NAME: CSRF_VALUE})
    return client


def _send(client: TestClient, **body):
    payload = {"subject": "Heads up", "body": "Please read **this**.", "user_ids": [],
               "function_ids": [], "roles": [], "channel": "in_app"}
    payload.update(body)
    return client.post("/api/v1/admin/notify", json=payload)


def _rows(db: Session, org_id: int) -> list[Notification]:
    return db.query(Notification).filter(Notification.org_id == org_id).order_by(Notification.id).all()


def test_no_filter_reaches_every_active_user_but_the_sender(
    db_session: Session, app_with_db: FastAPI, as_user
) -> None:
    s = _seed(db_session)
    resp = _send(_client(as_user, s["admin"]))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"recipients": 3, "emailed": False}
    rows = _rows(db_session, s["org"].id)
    assert {r.recipient_id for r in rows} == {s["staff_ra"].id, s["staff_cdm"].id, s["mentor"].id}
    assert all(r.module == "announcement" and r.sender_id == s["admin"].id for r in rows)
    # Bell row = bold subject on its own line, then the Markdown body.
    assert rows[0].message == "**Heads up**\nPlease read **this**."
    assert rows[0].entity_url is None


def test_filters_are_and_combined(db_session: Session, app_with_db: FastAPI, as_user) -> None:
    s = _seed(db_session)
    client = _client(as_user, s["admin"])

    resp = _send(client, roles=["Staff"])
    assert resp.json()["recipients"] == 2

    resp = _send(client, function_ids=[s["ra"].id])
    assert resp.json()["recipients"] == 2  # Aarav + Rahul; the deactivated user is skipped

    resp = _send(client, roles=["Staff"], function_ids=[s["ra"].id])
    assert resp.json()["recipients"] == 1

    resp = _send(client, user_ids=[s["mentor"].id, s["staff_cdm"].id], roles=["Mentor"])
    assert resp.json()["recipients"] == 1

    resp = _send(client, roles=["Admin"])
    assert resp.status_code == 400, resp.text  # only the sender matches, and the sender is excluded


def test_email_channel_writes_no_bell_rows(db_session: Session, app_with_db: FastAPI, as_user) -> None:
    s = _seed(db_session)
    resp = _send(_client(as_user, s["admin"]), channel="email", user_ids=[s["mentor"].id])
    assert resp.status_code == 200, resp.text
    assert resp.json()["recipients"] == 1
    assert resp.json()["emailed"] is False  # no SMTP in tests, and the API says so
    assert _rows(db_session, s["org"].id) == []


def test_guards(db_session: Session, app_with_db: FastAPI, as_user) -> None:
    s = _seed(db_session)
    assert _send(_client(as_user, s["staff_ra"])).status_code == 403
    assert _send(_client(as_user, s["mentor"])).status_code == 403
    assert _send(_client(as_user, s["admin"]), body="   ").status_code == 422
    assert _send(_client(as_user, s["admin"]), subject="").status_code == 422
    assert _send(_client(as_user, s["admin"]), channel="pigeon").status_code == 422
