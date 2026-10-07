"""
test_annual_goal_table.py — annual goals shown like Project Goals (7 Oct 2026).

One annual goal per person per year (every goal for the year is written in
that one row), a roster for mentors and the Admin with one row per person,
and a single-goal sheet whose content depends on who reads it.

The `as_user` fixture rebinds the app's current user, so every call below
re-binds to the actor it needs instead of holding two clients at once.
"""

from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

import app.services.notification_service as notification_service
from app.core.config import settings
from app.models.organization_models import Organization
from app.models.project_goal_models import ProjectGoalPeriodSettings
from app.models.reference_models import Designation, Function
from app.models.role_expectation_models import RoleExpectation
from app.models.system_settings_models import CycleType, SystemSettings
from app.models.system_settings_year_override_models import SystemSettingsYearOverride
from app.models.user_models import Role, User

CSRF = "test-csrf-token"
GOALS = "/api/v1/goals"


@pytest.fixture(autouse=True)
def _no_email(monkeypatch):
    # The developer's .env may hold real SMTP settings; never send from tests.
    monkeypatch.setattr(notification_service, "is_smtp_configured", lambda: False)


def _seed(db: Session) -> dict:
    org = Organization(name="Annual Goal Org", enabled_features=["goals", "annual_reviews", "project_goals", "admin"])
    db.add(org); db.flush()
    db.add(SystemSettings(org_id=org.id, active_cycle_name="H1 FY26-27", cycle_type=CycleType.HALF_YEARLY.value,
                          fiscal_start_month=4, timezone="UTC"))
    # The annual half follows the Project Goals quarter: Q1 of CY 26-27 -> H1 FY26-27.
    db.add(ProjectGoalPeriodSettings(org_id=org.id, period_label="CY 26-27", is_active=True, entry_open=True,
                                     weightages_visible=True, current_quarter_seq=1))
    db.add(SystemSettingsYearOverride(org_id=org.id, fy_label="FY26-27", annual_goals_edit_enabled=True,
                                      goal_reviews_visible_h1=False, goal_reviews_visible_h2=False))
    fn = Function(org_id=org.id, name="Regulatory Affairs"); db.add(fn); db.flush()
    desig = Designation(org_id=org.id, name="Regulatory Affairs Associate", level=1, career_level=1,
                        career_level_label="Entry", function_id=fn.id)
    db.add(desig); db.flush()
    admin = User(org_id=org.id, employee_code="ADM-1", full_name="Aanya Admin", email="aanya@healthark.ai",
                 role=Role.ADMIN.value, password_hash="x")
    mentor = User(org_id=org.id, employee_code="MNT-1", full_name="Rahul Mentor", email="rahul@healthark.ai",
                  role=Role.MENTOR.value, password_hash="x")
    db.add_all([admin, mentor]); db.flush()

    def staff(code: str, name: str, email: str, mentor_id):
        u = User(org_id=org.id, employee_code=code, full_name=name, email=email, role=Role.STAFF.value,
                 password_hash="x", mentor_id=mentor_id, function_id=fn.id, designation_id=desig.id)
        db.add(u)
        return u

    aarav = staff("STF-1", "Aarav Staff", "aarav@healthark.ai", mentor.id)
    bina = staff("STF-2", "Bina Staff", "bina@healthark.ai", mentor.id)
    chirag = staff("STF-3", "Chirag Staff", "chirag@healthark.ai", None)
    db.commit()
    return {"org": org, "admin": admin, "mentor": mentor, "aarav": aarav, "bina": bina, "chirag": chirag}


def _as(as_user, user: User) -> TestClient:
    client = as_user(user)
    client.cookies.set(settings.CSRF_COOKIE_NAME, CSRF)
    client.headers.update({settings.CSRF_HEADER_NAME: CSRF})
    return client


def _new_goal(as_user, owner: User, title: str = "Lead the eTMF quality check") -> dict:
    r = _as(as_user, owner).post(f"{GOALS}/", json={
        "title": title,
        "description": "- Run monthly QC for 3 studies\n- Cut findings by 20%",
        "goal_type": "annual",
    })
    assert r.status_code == 201, r.text
    return r.json()


def test_one_annual_goal_per_person_per_year(db_session: Session, app_with_db: FastAPI, as_user) -> None:
    s = _seed(db_session)
    goal = _new_goal(as_user, s["aarav"])
    assert goal["cycle_name"] == "FY26-27" and goal["approval_status"] == "draft"

    # A second goal for the same year is refused, in words that say what to do.
    r = _as(as_user, s["aarav"]).post(f"{GOALS}/", json={"title": "Another", "description": "x", "goal_type": "annual"})
    assert r.status_code == 409, r.text
    assert r.json()["detail"] == (
        "You already have an annual goal for CY 26-27. Write all of the year's goals in that one goal."
    )
    # The mentor creating one on the mentee's behalf hits the same rule.
    r = _as(as_user, s["mentor"]).post(f"{GOALS}/", params={"user_id": s["aarav"].id},
                                       json={"title": "On behalf", "description": "x", "goal_type": "annual"})
    assert r.status_code == 409, r.text
    assert r.json()["detail"].startswith("This staff member already has an annual goal for CY 26-27.")

    # Someone else is not affected, and a deleted goal frees the year again.
    _new_goal(as_user, s["bina"])
    r = _as(as_user, s["admin"]).delete(f"{GOALS}/{goal['id']}")
    assert r.status_code == 204, r.text
    _new_goal(as_user, s["aarav"], title="Second try")


def test_roster_lists_everyone_and_hides_draft_titles(db_session: Session, app_with_db: FastAPI, as_user) -> None:
    s = _seed(db_session)
    _new_goal(as_user, s["aarav"])

    r = _as(as_user, s["mentor"]).get(f"{GOALS}/annual/roster")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["fy_year"] == 2026 and body["fy_label"] == "FY26-27"
    assert body["active_fy_year"] == 2026 and body["active_half"] == "H1"
    assert body["years"] == [2026] and body["entry_open"] is True
    assert body["reviews_visible_h1"] is False
    rows = {row["full_name"]: row for row in body["rows"]}
    # Only the mentor's mentees; the one without a goal is listed too.
    assert set(rows) == {"Aarav Staff", "Bina Staff"}
    assert rows["Aarav Staff"]["approval_status"] == "draft" and rows["Aarav Staff"]["goal_title"] is None
    assert rows["Aarav Staff"]["goal_id"] is not None and rows["Aarav Staff"]["h1_self"] == "none"
    assert rows["Bina Staff"]["goal_id"] is None and rows["Bina Staff"]["approval_status"] is None

    # The Admin sees every Staff member, mentor names included.
    r = _as(as_user, s["admin"]).get(f"{GOALS}/annual/roster", params={"fy_year": 2026})
    assert r.status_code == 200, r.text
    rows = {row["full_name"]: row for row in r.json()["rows"]}
    assert set(rows) == {"Aarav Staff", "Bina Staff", "Chirag Staff"}
    assert rows["Aarav Staff"]["mentor_name"] == "Rahul Mentor" and rows["Chirag Staff"]["mentor_name"] is None

    # Another year has no goals yet but can still be asked for.
    r = _as(as_user, s["admin"]).get(f"{GOALS}/annual/roster", params={"fy_year": 2025})
    assert r.status_code == 200 and all(row["goal_id"] is None for row in r.json()["rows"])
    assert r.json()["years"] == [2026, 2025] and r.json()["entry_open"] is False

    # Staff read their own goal elsewhere.
    r = _as(as_user, s["aarav"]).get(f"{GOALS}/annual/roster")
    assert r.status_code == 403, r.text


def test_sheet_shows_each_reader_what_they_may_see(db_session: Session, app_with_db: FastAPI, as_user) -> None:
    s = _seed(db_session)
    gid = _new_goal(as_user, s["aarav"])["id"]
    sheet = f"{GOALS}/annual/{gid}"

    r = _as(as_user, s["aarav"]).patch(f"{GOALS}/{gid}/submit")
    assert r.status_code == 200, r.text
    r = _as(as_user, s["mentor"]).patch(f"{GOALS}/{gid}/approve", json={"approval_status": "approved"})
    assert r.status_code == 200, r.text

    # Owner's unsubmitted self-review stays with the owner.
    r = _as(as_user, s["aarav"]).patch(f"{GOALS}/{gid}/self-review/H1/draft", json={"self_overall_review": "Half done"})
    assert r.status_code == 200, r.text
    r = _as(as_user, s["mentor"]).get(sheet)
    assert r.status_code == 200, r.text
    m = r.json()
    assert m["can_review"] is True and m["is_owner"] is False and m["self_reviews"] == []
    assert m["owner_name"] == "Aarav Staff" and m["owner_mentor_name"] == "Rahul Mentor"
    assert m["owner_function_name"] == "Regulatory Affairs"
    assert m["owner_designation_name"] == "Regulatory Affairs Associate"

    r = _as(as_user, s["aarav"]).patch(f"{GOALS}/{gid}/self-review/H1", json={"self_overall_review": "QC done for 2 of 3 studies"})
    assert r.status_code == 200, r.text

    # The mentor's draft is visible to the mentor only.
    r = _as(as_user, s["mentor"]).patch(f"{GOALS}/{gid}/mentor-review/H1/draft", json={"mentor_overall_review": "Draft words"})
    assert r.status_code == 200, r.text
    assert [mr["is_draft"] for mr in _as(as_user, s["mentor"]).get(sheet).json()["mentor_reviews"]] == [True]
    a = _as(as_user, s["admin"]).get(sheet).json()
    assert a["can_review"] is False and a["mentor_reviews"] == []
    assert [sr["self_overall_review"] for sr in a["self_reviews"]] == ["QC done for 2 of 3 studies"]

    r = _as(as_user, s["mentor"]).patch(f"{GOALS}/{gid}/mentor-review/H1", json={"mentor_overall_review": "Strong half"})
    assert r.status_code == 200, r.text

    # H1 reviews are not released yet: the owner sees that a review exists, not its words.
    o = _as(as_user, s["aarav"]).get(sheet).json()
    assert o["is_owner"] is True and o["approval_status"] == "h1_mentor_reviewed"
    assert len(o["mentor_reviews"]) == 1 and o["mentor_reviews"][0]["hidden"] is True
    assert o["mentor_reviews"][0]["mentor_overall_review"] == ""

    # The roster follows the review steps.
    row = next(x for x in _as(as_user, s["mentor"]).get(f"{GOALS}/annual/roster").json()["rows"] if x["goal_id"] == gid)
    assert row["goal_title"] == "Lead the eTMF quality check"
    assert (row["h1_self"], row["h1_mentor"], row["h2_self"]) == ("submitted", "submitted", "none")

    # Someone outside the pairing cannot open the sheet.
    r = _as(as_user, s["bina"]).get(sheet)
    assert r.status_code == 403, r.text


def test_owner_role_expectations_for_the_goal_readers(db_session: Session, app_with_db: FastAPI, as_user) -> None:
    s = _seed(db_session)
    fn_id = s["aarav"].function_id
    db_session.add(RoleExpectation(org_id=s["org"].id, function_id=fn_id, career_level=1,
                                   exp_scope_of_role="Owns routine submissions under supervision."))
    db_session.commit()
    gid = _new_goal(as_user, s["aarav"])["id"]
    url = f"{GOALS}/annual/{gid}/expectations"

    # Every reader gets the owner's level. The feature-gated project-review
    # route the old mentor dialog called is not involved.
    for reader in ("mentor", "admin", "aarav"):
        r = _as(as_user, s[reader]).get(url)
        assert r.status_code == 200, (reader, r.text)
        body = r.json()
        assert body["designation_name"] == "Regulatory Affairs Associate" and body["career_level"] == 1
        assert body["exp_scope_of_role"] == "Owns routine submissions under supervision."
        assert body["exp_key_responsibilities"] == "Role expectation not defined"
    assert _as(as_user, s["bina"]).get(url).status_code == 403

    # The staff member's own lookup still answers the same way.
    r = _as(as_user, s["aarav"]).get("/api/v1/users/me/expectations")
    assert r.status_code == 200 and r.json()["exp_scope_of_role"] == "Owns routine submissions under supervision."
