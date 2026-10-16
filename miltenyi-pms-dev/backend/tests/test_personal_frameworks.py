"""
test_personal_frameworks.py — the Admin overrides one staff member's Project
Goals framework (16 Oct 2026, docs/plans/2026-10-16-personal-frameworks-plan.md):
title, the two paragraphs, KPI texts and weightages and the Additional goals %
for that person only, applied to their goal sheet at once.

Covers: personalise before Start; a draft sheet follows (goal text stays on its
row, KPIs added / removed / reordered); approved sheets change texts and
weights only; revert; personal rows stay out of the role views (matrix,
mapping, team queue, column edits, year roll-over); the past-year lock; Admin
only and the 100 rule; the editor opening with a sheet's custom weights.

The `as_user` fixture rebinds the app's current user, so every call below
re-binds to the actor it needs instead of holding two clients at once.
"""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import app.services.notification_service as notification_service
from app.core.config import settings
from app.models.notification_models import Notification
from app.models.organization_models import Organization
from app.models.project_goal_models import (
    GoalFramework,
    GoalFrameworkKpi,
    ProjectGoalChangeLog,
    ProjectGoalItem,
    ProjectGoalPeriodSettings,
    ProjectGoalReviewItem,
    ProjectGoalSet,
)
from app.models.reference_models import Designation, Function
from app.models.system_settings_models import CycleType, SystemSettings
from app.models.user_models import Role, User
from app.services import project_goal_periods as periods

CSRF = "test-csrf-token"
PERIOD = "CY 26-27"
PAST = "CY 25-26"
FW = "/api/v1/admin/goal-frameworks"
PF = f"{FW}/personal"
PG = "/api/v1/project-goals"


@pytest.fixture(autouse=True)
def _no_email(monkeypatch) -> None:
    monkeypatch.setattr(notification_service, "is_smtp_configured", lambda: False)


def _seed(db: Session) -> dict:
    org = Organization(name="Personal Framework Org", enabled_features=["project_goals", "admin"])
    db.add(org); db.flush()
    db.add(SystemSettings(org_id=org.id, active_cycle_name="H2 FY26-27", cycle_type=CycleType.HALF_YEARLY.value,
                          fiscal_start_month=4, timezone="UTC"))
    fn = Function(org_id=org.id, name="Regulatory Affairs"); db.add(fn); db.flush()
    desig = Designation(org_id=org.id, name="Regulatory Affairs Associate", level=1, career_level=1,
                        career_level_label="Entry", function_id=fn.id)
    desig2 = Designation(org_id=org.id, name="Regulatory Affairs Specialist", level=2, career_level=2,
                         career_level_label="Intermediate", function_id=fn.id)
    db.add_all([desig, desig2]); db.flush()
    admin = User(org_id=org.id, employee_code="ADM-1", full_name="Aanya", email="aanya@healthark.ai",
                 role=Role.ADMIN.value, password_hash="x")
    mentor = User(org_id=org.id, employee_code="MNT-1", full_name="Rahul", email="rahul@healthark.ai",
                  role=Role.MENTOR.value, password_hash="x")
    db.add_all([admin, mentor]); db.flush()
    aarav = User(org_id=org.id, employee_code="STF-1", full_name="Aarav", email="aarav@healthark.ai",
                 role=Role.STAFF.value, password_hash="x", mentor_id=mentor.id, function_id=fn.id, designation_id=desig.id)
    diya = User(org_id=org.id, employee_code="STF-2", full_name="Diya", email="diya@healthark.ai",
                role=Role.STAFF.value, password_hash="x", mentor_id=mentor.id, function_id=fn.id, designation_id=desig.id)
    db.add_all([aarav, diya]); db.flush()
    period = ProjectGoalPeriodSettings(org_id=org.id, period_label=PERIOD, is_active=True, entry_open=True,
                                       weightages_visible=True, current_quarter_seq=3, extra_goal_enabled=True)
    db.add(period); db.flush()
    periods.ensure_quarter_rows(db, period, 3, admin.id)
    column = GoalFramework(org_id=org.id, function_id=fn.id, level=1, period_label=PERIOD, title="RA Associate",
                           business_outcomes="Outcomes", functional_goals="Goals", created_by_id=admin.id, extra_goal_weightage=10)
    db.add(column); db.flush()
    for seq, w in enumerate((40, 30, 20), start=1):
        db.add(GoalFrameworkKpi(framework_id=column.id, seq=seq, text=f"KPI {seq}", weightage=w))
    db.commit()
    return {"org": org, "fn": fn, "desig2": desig2, "admin": admin, "mentor": mentor, "aarav": aarav, "diya": diya, "column_id": column.id}


def _as(as_user, user: User) -> TestClient:
    client = as_user(user)
    client.cookies.set(settings.CSRF_COOKIE_NAME, CSRF)
    client.headers.update({settings.CSRF_HEADER_NAME: CSRF})
    return client


def _payload(rows, extra, title="RA Associate · personal"):
    """rows: (text, weightage, item_id or None)"""
    return {"title": title, "business_outcomes": "Personal outcomes", "functional_goals": "Personal goals",
            "kpis": [{"text": t, "weightage": w, "item_id": i} for t, w, i in rows], "extra_goal_weightage": extra}


def _start_and_write(as_user, staff: User) -> dict:
    """Staff member starts their sheet and writes a goal in every KPI row."""
    created = _as(as_user, staff).post(f"{PG}/me", params={"period": PERIOD})
    assert created.status_code == 201, created.text
    texts = [{"item_id": it["id"], "goal_text": f"Goal {it['seq']}"} for it in created.json()["items"] if not it["is_extra"]]
    r = _as(as_user, staff).put(f"{PG}/me/items", params={"period": PERIOD}, json={"items": texts})
    assert r.status_code == 200, r.text
    return r.json()


def _sheet(db: Session, staff_id: int) -> list[ProjectGoalItem]:
    db.expire_all()
    return (
        db.query(ProjectGoalItem).join(ProjectGoalSet)
        .filter(ProjectGoalSet.user_id == staff_id, ProjectGoalSet.period_label == PERIOD)
        .order_by(ProjectGoalItem.seq).all()
    )


def _notices(db: Session, recipient_id: int) -> list[Notification]:
    return db.query(Notification).filter(Notification.recipient_id == recipient_id).order_by(Notification.id).all()


def test_personalise_before_start(db_session: Session, app_with_db: FastAPI, as_user) -> None:
    s = _seed(db_session)
    admin = _as(as_user, s["admin"])

    draft = admin.get(f"{PF}/{s['aarav'].id}")
    assert draft.status_code == 200, draft.text
    d = draft.json()
    assert d["is_personal"] is False and d["set_status"] is None and d["can_change_kpi_count"] is True
    assert [(k["text"], k["weightage"], k["item_id"]) for k in d["kpis"]] == [("KPI 1", 40, None), ("KPI 2", 30, None), ("KPI 3", 20, None)]
    assert d["extra_goal_weightage"] == 10 and d["based_on"]["title"] == "RA Associate"

    rows = [("KPI 1", 30, None), ("KPI 2", 30, None), ("KPI 3", 20, None), ("Mentoring", 10, None)]
    r = _as(as_user, s["admin"]).put(f"{PF}/{s['aarav'].id}", json=_payload(rows, 10))
    assert r.status_code == 200, r.text
    assert r.json()["is_personal"] is True and len(r.json()["kpis"]) == 4

    # Both people hear about it; the link goes to Project Goals (no sheet yet).
    staff_notes, mentor_notes = _notices(db_session, s["aarav"].id), _notices(db_session, s["mentor"].id)
    assert staff_notes[-1].message == f"The Admin personalised your {PERIOD} Project Goals framework."
    assert mentor_notes[-1].message == f"The Admin personalised the {PERIOD} Project Goals framework for Aarav."
    assert staff_notes[-1].entity_url == "/project-goals" and staff_notes[-1].module == "project_goal"

    me = _as(as_user, s["aarav"]).get(f"{PG}/me").json()
    assert me["framework"]["is_personal"] is True and me["framework"]["title"] == "RA Associate · personal"
    assert [k["weightage"] for k in me["framework"]["kpis"]] == [30, 30, 20, 10]

    # Start builds the sheet from the personal framework.
    created = _as(as_user, s["aarav"]).post(f"{PG}/me", params={"period": PERIOD})
    assert created.status_code == 201, created.text
    assert [(it["kpi_text"], it["weightage"], it["is_extra"]) for it in created.json()["items"]] == [
        ("KPI 1", 30, False), ("KPI 2", 30, False), ("KPI 3", 20, False), ("Mentoring", 10, False), ("Additional goals", 10, True),
    ]
    personal = db_session.query(GoalFramework).filter(GoalFramework.user_id == s["aarav"].id).one()
    st = db_session.query(ProjectGoalSet).filter(ProjectGoalSet.user_id == s["aarav"].id).one()
    assert st.framework_id == personal.id and personal.based_on_id == s["column_id"]
    assert {it.kpi_id for it in _sheet(db_session, s["aarav"].id) if not it.is_extra} == {k.id for k in personal.kpis}

    # Diya, same role, still follows the column.
    other = _as(as_user, s["diya"]).get(f"{PG}/me").json()
    assert other["framework"]["is_personal"] is False and len(other["framework"]["kpis"]) == 3


def test_draft_sheet_follows_and_goal_text_stays_on_its_row(db_session: Session, app_with_db: FastAPI, as_user) -> None:
    s = _seed(db_session)
    _start_and_write(as_user, s["aarav"])

    d = _as(as_user, s["admin"]).get(f"{PF}/{s['aarav'].id}").json()
    ids = [k["item_id"] for k in d["kpis"]]
    assert all(ids) and all(k["has_goal_text"] for k in d["kpis"]) and d["set_status"] == "draft"

    # Sharpen KPI 1, drop KPI 2, keep KPI 3, add a new one.
    rows = [("KPI 1 sharper", 35, ids[0]), ("KPI 3", 25, ids[2]), ("New KPI", 30, None)]
    r = _as(as_user, s["admin"]).put(f"{PF}/{s['aarav'].id}", json=_payload(rows, 10))
    assert r.status_code == 200, r.text
    sheet = _sheet(db_session, s["aarav"].id)
    assert [(it.seq, it.kpi_text, it.weightage, it.goal_text, it.is_extra) for it in sheet] == [
        (1, "KPI 1 sharper", 35, "Goal 1", False),
        (2, "KPI 3", 25, "Goal 3", False),
        (3, "New KPI", 30, None, False),
        (4, "Additional goals", 10, None, True),
    ]
    assert ids[1] not in {it.id for it in sheet}

    # Reorder: the goal text moves with its row.
    d = _as(as_user, s["admin"]).get(f"{PF}/{s['aarav'].id}").json()
    k1, k3, new = d["kpis"]
    rows = [(k3["text"], 25, k3["item_id"]), (k1["text"], 35, k1["item_id"]), (new["text"], 20, new["item_id"])]
    r = _as(as_user, s["admin"]).put(f"{PF}/{s['aarav'].id}", json=_payload(rows, 20))
    assert r.status_code == 200, r.text
    sheet = _sheet(db_session, s["aarav"].id)
    assert [(it.kpi_text, it.weightage, it.goal_text) for it in sheet] == [
        ("KPI 3", 25, "Goal 3"), ("KPI 1 sharper", 35, "Goal 1"), ("New KPI", 20, None), ("Additional goals", 20, None),
    ]

    logs = db_session.query(ProjectGoalChangeLog).filter(ProjectGoalChangeLog.action == "framework_personalised").order_by(ProjectGoalChangeLog.id).all()
    assert len(logs) == 2
    first_before, first_after = json.loads(logs[0].before), json.loads(logs[0].after)
    assert first_before["personal"] is False and [k["weightage"] for k in first_before["kpis"]] == [40, 30, 20]
    assert first_after["personal"] is True and first_after["title"] == "RA Associate · personal"

    staff_notes = _notices(db_session, s["aarav"].id)
    st = db_session.query(ProjectGoalSet).filter(ProjectGoalSet.user_id == s["aarav"].id).one()
    assert staff_notes[-1].message == f"The Admin changed your personal {PERIOD} Project Goals framework."
    assert staff_notes[-1].entity_url == f"/project-goals?set_id={st.id}"
    assert _notices(db_session, s["mentor"].id)[-1].message.endswith("for Aarav.")

    # An editor opened before the sheet changed cannot wipe its rows.
    stale = [("KPI 1", 40, None), ("KPI 2", 30, None), ("KPI 3", 20, None)]
    r = _as(as_user, s["admin"]).put(f"{PF}/{s['aarav'].id}", json=_payload(stale, 10))
    assert r.status_code == 409 and "Reload" in r.json()["detail"]


def test_approved_sheet_changes_texts_and_weights_only(db_session: Session, app_with_db: FastAPI, as_user) -> None:
    s = _seed(db_session)
    _start_and_write(as_user, s["aarav"])
    d = _as(as_user, s["admin"]).get(f"{PF}/{s['aarav'].id}").json()
    ids = [k["item_id"] for k in d["kpis"]]
    # While the sheet is a draft the Admin adds a fourth KPI.
    rows = [("KPI 1", 30, ids[0]), ("KPI 2", 30, ids[1]), ("KPI 3", 20, ids[2]), ("KPI 4", 10, None)]
    assert _as(as_user, s["admin"]).put(f"{PF}/{s['aarav'].id}", json=_payload(rows, 10)).status_code == 200

    sheet = _sheet(db_session, s["aarav"].id)
    texts = [{"item_id": it.id, "goal_text": f"Goal {it.seq}"} for it in sheet if not it.is_extra]
    assert _as(as_user, s["aarav"]).put(f"{PG}/me/items", params={"period": PERIOD}, json={"items": texts}).status_code == 200
    assert _as(as_user, s["aarav"]).post(f"{PG}/me/submit", params={"period": PERIOD}).status_code == 200
    set_id = db_session.query(ProjectGoalSet).filter(ProjectGoalSet.user_id == s["aarav"].id).one().id
    r = _as(as_user, s["mentor"]).post(f"{PG}/sets/{set_id}/approve", json={"agreed_with": "Dr. Weber", "agreed_on": "2026-10-01"})
    assert r.status_code == 200, r.text
    review = {"cycle_label": f"Q3 {PERIOD}", "self_rating": 4,
              "items": [{"item_id": t["item_id"], "self_text": f"Did {t['goal_text']}"} for t in texts]}
    assert _as(as_user, s["aarav"]).put(f"{PG}/me/self-review", json=review).status_code == 200

    d = _as(as_user, s["admin"]).get(f"{PF}/{s['aarav'].id}").json()
    assert d["set_status"] == "approved" and d["can_change_kpi_count"] is False
    ids = [k["item_id"] for k in d["kpis"]]

    # Texts and weights: fine, the quarter's self-review stays on its rows.
    rows = [("KPI 1 refined", 25, ids[0]), ("KPI 2", 35, ids[1]), ("KPI 3", 20, ids[2]), ("KPI 4", 10, ids[3])]
    r = _as(as_user, s["admin"]).put(f"{PF}/{s['aarav'].id}", json=_payload(rows, 10))
    assert r.status_code == 200, r.text
    sheet = _sheet(db_session, s["aarav"].id)
    assert [(it.kpi_text, it.weightage) for it in sheet if not it.is_extra] == [("KPI 1 refined", 25), ("KPI 2", 35), ("KPI 3", 20), ("KPI 4", 10)]
    kept = {ri.item_id: ri.self_text for ri in db_session.query(ProjectGoalReviewItem).all()}
    assert all(kept.get(i) for i in ids)

    # Removing or adding a KPI after approval is refused, and nothing changes.
    for bad in (rows[:3], rows + [("KPI 5", 0, None)]):
        weights_fix = 100 - 10 - sum(w for _, w, _ in bad)
        bad = [(t, w + (weights_fix if n == 0 else 0), i) for n, (t, w, i) in enumerate(bad)]
        r = _as(as_user, s["admin"]).put(f"{PF}/{s['aarav'].id}", json=_payload(bad, 10))
        assert r.status_code == 409, r.text
        assert r.json()["detail"] == "Aarav's goals are approved: you can change KPI texts and weightages, not add or remove KPIs."
    assert len([it for it in _sheet(db_session, s["aarav"].id) if not it.is_extra]) == 4

    # Revert would take the sheet from 4 KPIs to the column's 3: refused.
    r = _as(as_user, s["admin"]).delete(f"{PF}/{s['aarav'].id}")
    assert r.status_code == 409 and "after approval" in r.json()["detail"]


def test_revert_returns_the_sheet_to_the_role_column(db_session: Session, app_with_db: FastAPI, as_user) -> None:
    s = _seed(db_session)
    _start_and_write(as_user, s["aarav"])
    d = _as(as_user, s["admin"]).get(f"{PF}/{s['aarav'].id}").json()
    ids = [k["item_id"] for k in d["kpis"]]
    rows = [("Own 1", 40, ids[0]), ("Own 2", 20, ids[1]), ("Own 3", 20, ids[2]), ("Own 4", 20, None)]
    assert _as(as_user, s["admin"]).put(f"{PF}/{s['aarav'].id}", json=_payload(rows, 0)).status_code == 200

    r = _as(as_user, s["admin"]).delete(f"{PF}/{s['aarav'].id}")
    assert r.status_code == 200, r.text
    assert r.json()["is_personal"] is False
    sheet = _sheet(db_session, s["aarav"].id)
    assert [(it.kpi_text, it.weightage, it.goal_text) for it in sheet] == [
        ("KPI 1", 40, "Goal 1"), ("KPI 2", 30, "Goal 2"), ("KPI 3", 20, "Goal 3"), ("Additional goals", 10, None),
    ]
    assert db_session.query(GoalFramework).filter(GoalFramework.user_id.isnot(None)).count() == 0
    st = db_session.query(ProjectGoalSet).filter(ProjectGoalSet.user_id == s["aarav"].id).one()
    assert st.framework_id == s["column_id"]
    column_kpis = {k.id for k in db_session.get(GoalFramework, s["column_id"]).kpis}
    assert {it.kpi_id for it in sheet if not it.is_extra} == column_kpis
    assert db_session.query(ProjectGoalChangeLog).filter(ProjectGoalChangeLog.action == "framework_reverted").count() == 1
    assert _notices(db_session, s["aarav"].id)[-1].message == f"Your {PERIOD} Project Goals framework is back to the standard for your role."
    assert _notices(db_session, s["mentor"].id)[-1].message == f"Aarav's {PERIOD} Project Goals framework is back to the standard for their role."

    # Nothing left to revert.
    assert _as(as_user, s["admin"]).delete(f"{PF}/{s['aarav'].id}").status_code == 404


def test_personal_rows_stay_out_of_the_role_views(db_session: Session, app_with_db: FastAPI, as_user) -> None:
    s = _seed(db_session)
    diya_sheet = _as(as_user, s["diya"]).post(f"{PG}/me", params={"period": PERIOD})
    assert diya_sheet.status_code == 201
    _start_and_write(as_user, s["aarav"])
    d = _as(as_user, s["admin"]).get(f"{PF}/{s['aarav'].id}").json()
    rows = [(k["text"], w, k["item_id"]) for k, w in zip(d["kpis"], (50, 30, 20))]
    assert _as(as_user, s["admin"]).put(f"{PF}/{s['aarav'].id}", json=_payload(rows, 0, title="Aarav's own")).status_code == 200
    personal_id = db_session.query(GoalFramework.id).filter(GoalFramework.user_id == s["aarav"].id).scalar()

    admin = _as(as_user, s["admin"])
    matrix = admin.get(f"{FW}/").json()
    assert [rw["id"] for f in matrix["functions"] for rw in f["rows"]] == [s["column_id"]]

    mapping = {m["full_name"]: m for m in admin.get(f"{FW}/mapping").json()}
    assert mapping["Aarav"]["personalised"] is True and mapping["Aarav"]["status"] == "mapped"
    assert mapping["Diya"]["personalised"] is False

    team = {t["full_name"]: t for t in admin.get(f"{PG}/team").json()}
    assert team["Aarav"]["personalised"] is True and team["Aarav"]["framework_title"] == "Aarav's own"
    assert team["Diya"]["personalised"] is False and team["Diya"]["framework_title"] == "RA Associate"

    listing = admin.get(PF).json()
    assert [(p["full_name"], p["title"], p["based_on_title"], p["kpi_count"], p["set_status"]) for p in listing] == [
        ("Aarav", "Aarav's own", "RA Associate", 3, "draft"),
    ]

    # The column endpoints do not reach a personal row.
    col = {"title": "x", "business_outcomes": "x", "functional_goals": "x", "kpis": [{"text": "x", "weightage": 100}], "extra_goal_weightage": 0}
    assert admin.put(f"{FW}/{personal_id}", json=col).status_code == 404
    assert admin.delete(f"{FW}/{personal_id}").status_code == 404

    # Editing the column moves Diya's draft, not Aarav's personal sheet.
    col = {"title": "RA Associate", "business_outcomes": "Outcomes", "functional_goals": "Goals",
           "kpis": [{"text": "KPI 1", "weightage": 40}, {"text": "KPI 2", "weightage": 25}, {"text": "KPI 3", "weightage": 15}],
           "extra_goal_weightage": 20}
    assert admin.put(f"{FW}/{s['column_id']}", json=col).status_code == 200
    assert [it.weightage for it in _sheet(db_session, s["diya"].id) if it.is_extra] == [20]
    assert [it.weightage for it in _sheet(db_session, s["aarav"].id)] == [50, 30, 20, 0]

    # Year roll-over copies role columns only.
    from app.api.routes.goal_framework_routes import _copy_frameworks
    assert _copy_frameworks(db_session, s["org"].id, PERIOD, "CY 27-28", s["admin"].id) == 1
    db_session.commit()
    nxt = db_session.query(GoalFramework).filter(GoalFramework.period_label == "CY 27-28").all()
    assert len(nxt) == 1 and nxt[0].user_id is None

    # One personal row per person per year.
    db_session.add(GoalFramework(org_id=s["org"].id, function_id=s["fn"].id, level=1, period_label=PERIOD, user_id=s["aarav"].id,
                                 title="dup", business_outcomes="x", functional_goals="x"))
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()

    # Function and designation stay put while the personal framework exists.
    r = admin.patch(f"/api/v1/admin/users/{s['diya'].id}", json={"designation_id": s["desig2"].id})
    assert r.status_code == 409  # Diya has a sheet in progress (existing rule)
    db_session.query(ProjectGoalSet).filter(ProjectGoalSet.user_id == s["aarav"].id).delete()
    db_session.commit()
    r = _as(as_user, s["admin"]).patch(f"/api/v1/admin/users/{s['aarav'].id}", json={"designation_id": s["desig2"].id})
    assert r.status_code == 409 and "personal" in r.json()["detail"]


def test_past_years_are_locked(db_session: Session, app_with_db: FastAPI, as_user) -> None:
    s = _seed(db_session)
    db_session.add(ProjectGoalPeriodSettings(org_id=s["org"].id, period_label=PAST, is_active=False, entry_open=False,
                                             weightages_visible=True, current_quarter_seq=4))
    old = GoalFramework(org_id=s["org"].id, function_id=s["fn"].id, level=1, period_label=PAST, title="RA Associate 25",
                        business_outcomes="Outcomes", functional_goals="Goals", extra_goal_weightage=0)
    db_session.add(old); db_session.flush()
    db_session.add(GoalFrameworkKpi(framework_id=old.id, seq=1, text="Old KPI", weightage=100))
    db_session.commit()
    locked = f"{PAST} is a past year; its framework is locked."

    admin = _as(as_user, s["admin"])
    col = {"title": "x", "business_outcomes": "x", "functional_goals": "x", "kpis": [{"text": "x", "weightage": 100}], "extra_goal_weightage": 0}
    r = admin.put(f"{FW}/{old.id}", json=col)
    assert r.status_code == 409 and r.json()["detail"] == locked
    r = admin.delete(f"{FW}/{old.id}")
    assert r.status_code == 409 and r.json()["detail"] == locked
    r = admin.post(f"{FW}/", json={**col, "function_id": s["fn"].id, "level": 2, "period_label": PAST})
    assert r.status_code == 409 and r.json()["detail"] == locked

    r = admin.put(f"{PF}/{s['aarav'].id}", params={"period": PAST}, json=_payload([("KPI", 100, None)], 0))
    assert r.status_code == 409 and r.json()["detail"] == locked
    r = admin.get(f"{PF}/{s['aarav'].id}", params={"period": PAST})
    assert r.status_code == 409 and r.json()["detail"] == locked

    # The active year stays editable.
    r = admin.post(f"{FW}/", json={**col, "function_id": s["fn"].id, "level": 2})
    assert r.status_code == 201, r.text


def test_admin_only_and_the_100_rule(db_session: Session, app_with_db: FastAPI, as_user) -> None:
    s = _seed(db_session)
    body = _payload([("KPI 1", 50, None), ("KPI 2", 40, None)], 10)
    for who in ("mentor", "aarav"):
        assert _as(as_user, s[who]).get(PF).status_code == 403
        assert _as(as_user, s[who]).put(f"{PF}/{s['aarav'].id}", json=body).status_code == 403
        assert _as(as_user, s[who]).delete(f"{PF}/{s['aarav'].id}").status_code == 403

    admin = _as(as_user, s["admin"])
    r = admin.put(f"{PF}/{s['aarav'].id}", json=_payload([("KPI 1", 50, None), ("KPI 2", 50, None)], 10))
    assert r.status_code == 422 and "100" in str(r.json()["detail"])
    assert admin.put(f"{PF}/{s['mentor'].id}", json=body).status_code == 404

    s["diya"].function_id = None
    db_session.commit()
    r = admin.put(f"{PF}/{s['diya'].id}", json=body)
    assert r.status_code == 409 and r.json()["detail"] == "Diya has no function yet. Set it on the Framework Mapping tab first."


def test_editor_opens_with_the_sheets_custom_weights(db_session: Session, app_with_db: FastAPI, as_user) -> None:
    """Ramanadh's case (7 Oct 2026): his weights were set on his rows by a
    script. The editor shows them as they are, and saving them unchanged
    turns them into his personal framework without touching the sheet."""
    s = _seed(db_session)
    _start_and_write(as_user, s["aarav"])
    for it in _sheet(db_session, s["aarav"].id):
        it.weightage = {1: 50, 2: 30, 3: 20}.get(it.seq, 0)
    # Last year's personal framework, for "Copy last year's".
    db_session.add(ProjectGoalPeriodSettings(org_id=s["org"].id, period_label=PAST, is_active=False, entry_open=False,
                                             weightages_visible=True, current_quarter_seq=4))
    last = GoalFramework(org_id=s["org"].id, function_id=s["fn"].id, level=1, period_label=PAST, user_id=s["aarav"].id,
                         title="Aarav 25-26", business_outcomes="Old outcomes", functional_goals="Old goals", extra_goal_weightage=0)
    db_session.add(last); db_session.flush()
    db_session.add(GoalFrameworkKpi(framework_id=last.id, seq=1, text="Old KPI", weightage=100))
    db_session.commit()

    d = _as(as_user, s["admin"]).get(f"{PF}/{s['aarav'].id}").json()
    assert d["is_personal"] is False
    assert [k["weightage"] for k in d["kpis"]] == [50, 30, 20] and d["extra_goal_weightage"] == 0
    assert d["last_year"]["title"] == "Aarav 25-26" and d["last_year"]["is_personal"] is True

    before = [(it.id, it.kpi_text, it.weightage, it.goal_text) for it in _sheet(db_session, s["aarav"].id)]
    rows = [(k["text"], k["weightage"], k["item_id"]) for k in d["kpis"]]
    payload = {**_payload(rows, d["extra_goal_weightage"]), "title": d["title"],
               "business_outcomes": d["business_outcomes"], "functional_goals": d["functional_goals"]}
    r = _as(as_user, s["admin"]).put(f"{PF}/{s['aarav'].id}", json=payload)
    assert r.status_code == 200, r.text
    assert [(it.id, it.kpi_text, it.weightage, it.goal_text) for it in _sheet(db_session, s["aarav"].id)] == before
    personal = db_session.query(GoalFramework).filter(GoalFramework.user_id == s["aarav"].id, GoalFramework.period_label == PERIOD).one()
    assert [k.weightage for k in personal.kpis] == [50, 30, 20] and personal.extra_goal_weightage == 0
    assert personal.title == "RA Associate"
