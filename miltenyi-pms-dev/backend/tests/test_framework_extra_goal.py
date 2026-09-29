"""
test_framework_extra_goal.py — the "Additional goals" weightage lives on each
framework column (29 Sep 2026): KPIs + additional must total 100, the Admin
edits it in the Framework tab, new goal sheets snapshot it, draft sheets
follow a change, and the per-year switch only turns the row on or off.

The `as_user` fixture rebinds the app's current user, so every call below
re-binds to the actor it needs instead of holding two clients at once.
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.organization_models import Organization
from app.models.project_goal_models import (
    GoalFramework,
    GoalFrameworkKpi,
    ProjectGoalItem,
    ProjectGoalPeriodSettings,
    ProjectGoalSet,
)
from app.models.reference_models import Designation, Function
from app.models.system_settings_models import CycleType, SystemSettings
from app.models.user_models import Role, User

CSRF = "test-csrf-token"
PERIOD = "CY 26-27"
FW = "/api/v1/admin/goal-frameworks"


def _seed(db: Session) -> dict:
    org = Organization(name="Framework Test Org", enabled_features=["project_goals", "admin"])
    db.add(org); db.flush()
    db.add(SystemSettings(org_id=org.id, active_cycle_name="H2 FY26-27", cycle_type=CycleType.HALF_YEARLY.value,
                          fiscal_start_month=4, timezone="UTC"))
    fn = Function(org_id=org.id, name="Regulatory Affairs"); db.add(fn); db.flush()
    desig = Designation(org_id=org.id, name="Regulatory Affairs Associate", level=1, career_level=1,
                        career_level_label="Entry", function_id=fn.id)
    db.add(desig); db.flush()
    admin = User(org_id=org.id, employee_code="ADM-1", full_name="Aanya", email="aanya@healthark.ai",
                 role=Role.ADMIN.value, password_hash="x")
    mentor = User(org_id=org.id, employee_code="MNT-1", full_name="Rahul", email="rahul@healthark.ai",
                  role=Role.MENTOR.value, password_hash="x")
    db.add_all([admin, mentor]); db.flush()
    staff = User(org_id=org.id, employee_code="STF-1", full_name="Aarav", email="aarav@healthark.ai",
                 role=Role.STAFF.value, password_hash="x", mentor_id=mentor.id, function_id=fn.id, designation_id=desig.id)
    db.add(staff); db.flush()
    db.add(ProjectGoalPeriodSettings(org_id=org.id, period_label=PERIOD, is_active=True, entry_open=True,
                                     weightages_visible=True, current_quarter_seq=3, extra_goal_enabled=True))
    fw = GoalFramework(org_id=org.id, function_id=fn.id, level=1, period_label=PERIOD, title="RA Associate",
                       business_outcomes="Outcomes", functional_goals="Goals", created_by_id=admin.id, extra_goal_weightage=10)
    db.add(fw); db.flush()
    for seq, w in enumerate((40, 30, 20), start=1):
        db.add(GoalFrameworkKpi(framework_id=fw.id, seq=seq, text=f"KPI {seq}", weightage=w))
    db.commit()
    return {"org": org, "admin": admin, "staff": staff, "fw_id": fw.id}


def _as(as_user, user: User) -> TestClient:
    client = as_user(user)
    client.cookies.set(settings.CSRF_COOKIE_NAME, CSRF)
    client.headers.update({settings.CSRF_HEADER_NAME: CSRF})
    return client


def _row_payload(kpis, extra):
    return {"title": "RA Associate", "business_outcomes": "Outcomes", "functional_goals": "Goals",
            "kpis": [{"text": f"KPI {i}", "weightage": w} for i, w in enumerate(kpis, start=1)],
            "extra_goal_weightage": extra}


def _extra_item(db: Session, staff_id: int):
    return db.query(ProjectGoalItem).join(ProjectGoalSet).filter(
        ProjectGoalSet.user_id == staff_id, ProjectGoalItem.is_extra == True  # noqa: E712
    )


def test_total_rule_and_the_row_in_the_matrix(db_session: Session, app_with_db: FastAPI, as_user) -> None:
    s = _seed(db_session)
    admin = _as(as_user, s["admin"])

    r = admin.get(f"{FW}/", params={"period": PERIOD})
    assert r.status_code == 200, r.text
    row = next(rw for f in r.json()["functions"] for rw in f["rows"] if rw["id"] == s["fw_id"])
    assert row["extra_goal_weightage"] == 10

    # KPIs 100 + additional 10 = 110 -> refused with a sentence naming both.
    r = admin.put(f"{FW}/{s['fw_id']}", json=_row_payload((50, 30, 20), 10))
    assert r.status_code == 422, r.text
    assert "100" in str(r.json()["detail"])
    # KPIs 80 + additional 20 = 100 -> saved.
    r = admin.put(f"{FW}/{s['fw_id']}", json=_row_payload((40, 25, 15), 20))
    assert r.status_code == 200, r.text
    assert r.json()["extra_goal_weightage"] == 20 and [k["weightage"] for k in r.json()["kpis"]] == [40, 25, 15]


def test_sheets_snapshot_the_column_weightage_and_drafts_follow(db_session: Session, app_with_db: FastAPI, as_user) -> None:
    s = _seed(db_session)

    r = _as(as_user, s["staff"]).post("/api/v1/project-goals/me", params={"period": PERIOD})
    assert r.status_code == 201, r.text
    extra = next(it for it in r.json()["items"] if it["is_extra"])
    assert extra["weightage"] == 10 and extra["kpi_text"] == "Additional goals"

    # The Admin rebalances the column: KPIs 85 + additional 15. The draft sheet follows.
    r = _as(as_user, s["admin"]).put(f"{FW}/{s['fw_id']}", json=_row_payload((40, 30, 15), 15))
    assert r.status_code == 200, r.text
    db_session.expire_all()
    assert _extra_item(db_session, s["staff"].id).one().weightage == 15

    # Turning the row off for the year removes the empty draft row; on again brings it back at the column's weight.
    r = _as(as_user, s["admin"]).patch(f"{FW}/settings", params={"period": PERIOD}, json={"extra_goal_enabled": False})
    assert r.status_code == 200 and "extra_goal_weightage" not in r.json(), r.text
    db_session.expire_all()
    assert _extra_item(db_session, s["staff"].id).count() == 0
    r = _as(as_user, s["admin"]).patch(f"{FW}/settings", params={"period": PERIOD}, json={"extra_goal_enabled": True})
    assert r.status_code == 200, r.text
    db_session.expire_all()
    assert _extra_item(db_session, s["staff"].id).one().weightage == 15
