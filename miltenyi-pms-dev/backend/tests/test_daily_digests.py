"""
test_daily_digests.py — the daily summary emails (services/daily_digests.py).

Seeds one org in H2 FY26-27 / Q3 CY 26-27 with a mentor and two staff:
    Aarav — annual goal awaiting approval; Project Goals set awaiting approval
    Arjun — annual goal approved today with a submitted H1 self-review that the
            mentor has not answered; Project Goals set approved today; Q3
            self-review submitted (review still a draft); Q2 review published
            and not yet acknowledged
and checks what each digest lists, that a run sends one mail per person and a
second run on the same day sends nothing, and that no slot is claimed while
SMTP is unconfigured.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from sqlalchemy.orm import Session

import app.services.send_email as send_email_module
from app.models.daily_digest_log_models import DailyDigestLog
from app.models.goal_models import ApprovalStatus, Goal, GoalType
from app.models.goal_self_review_models import GoalSelfReview
from app.models.organization_models import Organization
from app.models.project_goal_models import (
    ProjectGoalPeriodSettings,
    ProjectGoalQuarter,
    ProjectGoalReview,
    ProjectGoalSet,
    ProjectGoalSetStatus,
    quarter_label,
)
from app.models.system_settings_models import CycleType, SystemSettings
from app.models.user_models import Role, User
from app.services.daily_digests import (
    build_mentor_digests,
    build_staff_digests,
    run_daily_digests,
)

NOW = datetime(2026, 9, 26, 6, 0, tzinfo=timezone.utc)
TODAY = date(2026, 9, 26)
PERIOD = "CY 26-27"


def _user(org_id: int, code: str, name: str, role: str, mentor_id: int | None = None) -> User:
    return User(org_id=org_id, employee_code=code, full_name=name, email=f"{code.lower()}@test.local",
                role=role, mentor_id=mentor_id, password_hash="x")


def _seed(db: Session) -> dict:
    org = Organization(name="Digest Test Org", enabled_features=["project_goals"])
    db.add(org); db.flush()
    db.add(SystemSettings(org_id=org.id, active_cycle_name="H2 FY26-27", cycle_type=CycleType.HALF_YEARLY.value,
                          fiscal_start_month=4, timezone="UTC"))
    mentor = _user(org.id, "MNT-1", "Rahul Mentor", Role.MENTOR.value)
    db.add(mentor); db.flush()
    aarav = _user(org.id, "STF-1", "Aarav Staff", Role.STAFF.value, mentor.id)
    arjun = _user(org.id, "STF-2", "Arjun Staff", Role.STAFF.value, mentor.id)
    db.add_all([aarav, arjun]); db.flush()

    # Annual goals
    g_pending = Goal(org_id=org.id, user_id=aarav.id, manager_id=mentor.id, title="Dossier on time",
                     goal_type=GoalType.ANNUAL.value, cycle_name="FY26-27",
                     approval_status=ApprovalStatus.PENDING_APPROVAL.value, created_at=NOW - timedelta(days=4))
    g_approved = Goal(org_id=org.id, user_id=arjun.id, manager_id=mentor.id, title="Zero major findings",
                      goal_type=GoalType.ANNUAL.value, cycle_name="FY26-27",
                      approval_status=ApprovalStatus.H1_SELF_REVIEWED.value, approved_at=NOW - timedelta(hours=3))
    db.add_all([g_pending, g_approved]); db.flush()
    db.add(GoalSelfReview(goal_id=g_approved.id, org_id=org.id, cycle_half="H1", is_draft=False,
                          submitted_at=NOW - timedelta(days=2), self_overall_review="Delivered"))

    # Project Goals: CY 26-27, Q3 current, Q1–Q3 rolled out
    db.add(ProjectGoalPeriodSettings(org_id=org.id, period_label=PERIOD, is_active=True, entry_open=True,
                                     weightages_visible=True, current_quarter_seq=3))
    for seq in (1, 2, 3):
        db.add(ProjectGoalQuarter(org_id=org.id, period_label=PERIOD, seq=seq, cycle_label=quarter_label(PERIOD, seq),
                                  ratings_visible=False, backfill_open=True))
    s_pending = ProjectGoalSet(org_id=org.id, user_id=aarav.id, period_label=PERIOD,
                               status=ProjectGoalSetStatus.SUBMITTED.value, submitted_at=NOW - timedelta(days=6))
    s_approved = ProjectGoalSet(org_id=org.id, user_id=arjun.id, period_label=PERIOD,
                                status=ProjectGoalSetStatus.APPROVED.value, submitted_at=NOW - timedelta(days=9),
                                approved_at=NOW - timedelta(hours=1), approved_by_id=mentor.id)
    db.add_all([s_pending, s_approved]); db.flush()
    db.add(ProjectGoalReview(org_id=org.id, set_id=s_approved.id, cycle_label=quarter_label(PERIOD, 3),
                             self_is_draft=False, self_submitted_at=NOW - timedelta(days=1), review_is_draft=True))
    db.add(ProjectGoalReview(org_id=org.id, set_id=s_approved.id, cycle_label=quarter_label(PERIOD, 2),
                             self_is_draft=False, self_submitted_at=NOW - timedelta(days=20),
                             review_is_draft=False, review_submitted_at=NOW - timedelta(days=3), acknowledged_at=None))
    db.commit()
    return {"org": org, "mentor": mentor, "aarav": aarav, "arjun": arjun}


def test_mentor_digest_lists_every_kind_of_pending_work(db_session: Session) -> None:
    s = _seed(db_session)
    digests = build_mentor_digests(db_session, s["org"].id, TODAY)
    assert set(digests) == {s["mentor"].id}
    d = digests[s["mentor"].id]
    assert d["item_count"] == 4 and d["mentee_count"] == 2
    assert d["counts"] == {"annual_approval": 1, "annual_review": 1, "pg_approval": 1, "pg_review": 1}
    labels = [i["label"] for m in d["mentees"] for i in m["items"]]
    assert any("Dossier on time" in l and "awaits approval" in l for l in labels)
    assert any("H1 · CY 26-27 self-review" in l for l in labels)
    assert any("Project Goals CY 26-27 await approval" in l for l in labels)
    assert any("Q3 · CY 26-27 self-review awaits the Miltenyi review" in l for l in labels)
    # Aarav has waited longest (6 days on the goal set) → listed first.
    assert d["mentees"][0]["name"] == "Aarav Staff" and d["oldest_days"] == 6


def test_staff_digests_split_waiting_from_moved(db_session: Session) -> None:
    s = _seed(db_session)
    digests = build_staff_digests(db_session, s["org"].id, TODAY)
    assert set(digests) == {s["aarav"].id, s["arjun"].id}
    a = digests[s["aarav"].id]
    assert [i["label"] for i in a["awaiting_approval"]] == ["Annual goal “Dossier on time”", "Project Goals CY 26-27"]
    assert a["mentor_name"] == "Rahul Mentor" and not a["approved"] and not a["to_acknowledge"]
    b = digests[s["arjun"].id]
    assert not b["awaiting_approval"]
    assert [i["label"] for i in b["approved"]] == ["Annual goal “Zero major findings”", "Project Goals CY 26-27"]
    assert [i["label"] for i in b["to_acknowledge"]] == ["Q2 · CY 26-27 review"]


def test_run_sends_once_per_person_per_day(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    s = _seed(db_session)
    monkeypatch.setattr(send_email_module, "is_smtp_configured", lambda: True)
    sent: list[dict] = []

    def capture(fn, **kwargs):
        sent.append(kwargs)

    result = run_daily_digests(db_session, today=TODAY, enqueue=capture)
    assert result == {"mentor": 1, "staff": 2, "skipped_already_sent": 0, "skipped_no_smtp": False}
    assert len(sent) == 3
    mentor_mail = next(m for m in sent if m["to_email"] == s["mentor"].email)
    assert mentor_mail["subject"] == "4 items need your attention" and mentor_mail["title"] == mentor_mail["subject"]
    assert "from 2 mentees" in mentor_mail["lead"] and len(mentor_mail["details"]) == 2
    arjun_mail = next(m for m in sent if m["to_email"] == s["arjun"].email)
    assert arjun_mail["subject"] == "1 review to acknowledge"
    assert ("Q2 · CY 26-27 review", "Reviewed · acknowledge it · 3d") in arjun_mail["details"]
    assert arjun_mail["cta_url"].endswith("/dashboard")

    again = run_daily_digests(db_session, today=TODAY, enqueue=capture)
    assert again["mentor"] == 0 and again["staff"] == 0 and again["skipped_already_sent"] == 3
    assert len(sent) == 3
    assert db_session.query(DailyDigestLog).count() == 3


def test_no_smtp_claims_no_slot(db_session: Session, monkeypatch: pytest.MonkeyPatch) -> None:
    s = _seed(db_session)
    monkeypatch.setattr(send_email_module, "is_smtp_configured", lambda: False)
    result = run_daily_digests(db_session, today=TODAY, enqueue=lambda fn, **kw: None)
    assert result["skipped_no_smtp"] is True and result["mentor"] == 0 and result["staff"] == 0
    assert db_session.query(DailyDigestLog).filter(DailyDigestLog.org_id == s["org"].id).count() == 0
