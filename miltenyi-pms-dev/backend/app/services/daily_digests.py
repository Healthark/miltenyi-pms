"""
daily_digests — one summary email per person per weekday morning.

Item 22 of the annual audit ("snapshot emails", Zaahid, 26 Sep 2026). The bell
keeps firing per event; this is the batched EMAIL: instead of a mail per goal
or per review, each person gets at most one mail a day that lists what is
waiting on them or what moved for them. Nothing pending means no mail — that is
the stop condition, and it needs no counter and no end date.

Two audiences, because the two sides are stuck on each other:

  MENTOR  the work they owe, grouped by mentee, oldest first:
            - annual goals awaiting their approval
            - annual goal self-reviews (H1/H2) awaiting their review, while
              that half is open
            - Project Goals sets awaiting "approved (agreed offline)"
            - Project Goals quarterly self-reviews awaiting the Miltenyi
              review, while that quarter is writable
  STAFF   what is blocked on someone else, or just moved:
            - annual goals awaiting the mentor's approval (naming the mentor,
              so they can chase), goals sent back for changes, goals approved
              since their last summary
            - the Project Goals set awaiting approval, or approved since the
              last summary
            - a quarterly review that is in and still to be acknowledged

Idempotent per (recipient, digest type, day) through `daily_digest_log`; the
scheduler (services/digest_scheduler.py) and the Admin's "send now" button both
call `run_daily_digests`, and whichever runs second sends nothing.

Adapted from the Healthark PMS daily digests.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone
from typing import Callable, Optional

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.cycle_utils import extract_fy_year, half_display
from app.models.daily_digest_log_models import DIGEST_MENTOR, DIGEST_STAFF, DailyDigestLog
from app.models.goal_mentor_review_models import GoalMentorReview
from app.models.goal_models import ApprovalStatus, Goal, GoalType
from app.models.goal_self_review_models import GoalSelfReview
from app.models.organization_models import Organization
from app.models.project_goal_models import (
    ProjectGoalReview,
    ProjectGoalSet,
    ProjectGoalSetStatus,
    quarter_display,
)
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.services import project_goal_periods as pg_periods
from app.services.annual_cycle import is_half_open

logger = logging.getLogger(__name__)

#: Annual goal states that put the ball in the MENTOR's court / back with STAFF.
_AWAITING_MENTOR = (ApprovalStatus.PENDING_APPROVAL.value,)
_AWAITING_STAFF = (ApprovalStatus.CHANGES_REQUESTED.value,)


# ── small helpers ────────────────────────────────────────────────────

def _as_utc(value: Optional[datetime]) -> Optional[datetime]:
    """Force a DB-read timestamp to aware UTC (SQLite hands back naive)."""
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def _days_waiting(since: Optional[datetime | date], today: date) -> int:
    if since is None:
        return 0
    stamp = since.date() if isinstance(since, datetime) else since
    return max(0, (today - stamp).days)


def _plural(n: int, singular: str = "", many: str = "s") -> str:
    return many if n != 1 else singular


def _active_users(db: Session, ids: set[int]) -> dict[int, User]:
    if not ids:
        return {}
    return {
        u.id: u
        for u in db.query(User).filter(User.id.in_(ids), User.is_deleted == False).all()  # noqa: E712
    }


def _settings(db: Session, org_id: int) -> Optional[SystemSettings]:
    return db.query(SystemSettings).filter(SystemSettings.org_id == org_id).first()


# ── what is pending, per source ──────────────────────────────────────

def _pending_annual_goals(db: Session, org_id: int) -> list[Goal]:
    """Live annual goals blocked on somebody (awaiting approval or sent back)."""
    return (
        db.query(Goal)
        .filter(
            Goal.org_id == org_id,
            Goal.is_deleted == False,  # noqa: E712
            Goal.goal_type == GoalType.ANNUAL.value,
            Goal.approval_status.in_(_AWAITING_MENTOR + _AWAITING_STAFF),
        )
        .all()
    )


def _annual_review_backlog(db: Session, org_id: int, today: date) -> list[tuple[Goal, str, int]]:
    """[(goal, half, days_waiting)] where a mentor owes an H1/H2 goal review.

    A self-review is SUBMITTED for (goal, half) and no submitted mentor review
    answers it, and the half is still open for the goal's year (the annual
    cycle follows the Project Goals roll-out — see services/annual_cycle.py).
    A half that has closed is work the mentor can no longer do, so it is
    not nagged about.
    """
    settings = _settings(db, org_id)
    if settings is None or not settings.active_cycle_name:
        return []
    submitted = (
        db.query(GoalSelfReview.goal_id, GoalSelfReview.cycle_half, GoalSelfReview.submitted_at)
        .filter(GoalSelfReview.org_id == org_id, GoalSelfReview.is_draft == False)  # noqa: E712
        .all()
    )
    if not submitted:
        return []
    answered = {
        (gid, half)
        for gid, half in db.query(GoalMentorReview.goal_id, GoalMentorReview.cycle_half).filter(
            GoalMentorReview.org_id == org_id, GoalMentorReview.is_draft == False  # noqa: E712
        )
    }
    outstanding = [row for row in submitted if (row[0], row[1]) not in answered]
    if not outstanding:
        return []
    goals = {
        g.id: g
        for g in db.query(Goal)
        .filter(Goal.id.in_({gid for gid, _, _ in outstanding}), Goal.is_deleted == False)  # noqa: E712
        .all()
    }
    out: list[tuple[Goal, str, int]] = []
    for goal_id, half, submitted_at in outstanding:
        goal = goals.get(goal_id)
        if goal is None:
            continue
        fy_year = extract_fy_year(goal.cycle_name)
        if fy_year is None or not is_half_open(half, fy_year, settings.active_cycle_name):
            continue
        out.append((goal, half, _days_waiting(_as_utc(submitted_at), today)))
    return out


def _project_goal_pending(db: Session, org_id: int, today: date) -> dict:
    """Project Goals items of the ACTIVE goal year.

    Returns {"sets_awaiting_approval": [(set, days)],
             "reviews_awaiting_mentor": [(set, review, days)],
             "reviews_to_acknowledge": [(set, review, days)]}.
    """
    empty = {"sets_awaiting_approval": [], "reviews_awaiting_mentor": [], "reviews_to_acknowledge": []}
    period = pg_periods.active_period(db, org_id)
    if period is None:
        return empty
    sets = (
        db.query(ProjectGoalSet)
        .filter(ProjectGoalSet.org_id == org_id, ProjectGoalSet.period_label == period.period_label)
        .all()
    )
    if not sets:
        return empty
    by_id = {s.id: s for s in sets}
    out = {k: [] for k in empty}
    for s in sets:
        if s.status == ProjectGoalSetStatus.SUBMITTED.value:
            out["sets_awaiting_approval"].append((s, _days_waiting(_as_utc(s.submitted_at) or _as_utc(s.updated_at), today)))
    quarters = {q.cycle_label: q for q in pg_periods.quarters_for(db, period)}
    reviews = (
        db.query(ProjectGoalReview)
        .filter(ProjectGoalReview.org_id == org_id, ProjectGoalReview.set_id.in_(by_id.keys()))
        .all()
    )
    for r in reviews:
        s = by_id.get(r.set_id)
        quarter = quarters.get(r.cycle_label)
        if s is None or not pg_periods.has_started(period, quarter):
            continue
        if not r.self_is_draft and r.review_is_draft and pg_periods.is_writable(period, quarter):
            out["reviews_awaiting_mentor"].append((s, r, _days_waiting(_as_utc(r.self_submitted_at), today)))
        if not r.review_is_draft and r.acknowledged_at is None:
            out["reviews_to_acknowledge"].append((s, r, _days_waiting(_as_utc(r.review_submitted_at), today)))
    return out


# ── mentor digests ───────────────────────────────────────────────────

def build_mentor_digests(db: Session, org_id: int, today: date) -> dict[int, dict]:
    """{mentor_id: payload} for every mentor with work outstanding.

    Payload: recipient, mentees [{name, items [{label, days, kind}], oldest_days}],
    counts per kind, item_count, oldest_days. Mentees are ordered by who has
    waited longest.
    """
    # (owner_id, label, days, kind)
    items: list[tuple[int, str, int, str]] = []
    for g in _pending_annual_goals(db, org_id):
        if g.approval_status in _AWAITING_MENTOR:
            items.append((g.user_id, f"Annual goal “{g.title}” awaits approval", _days_waiting(_as_utc(g.updated_at) or _as_utc(g.created_at), today), "annual_approval"))
    for g, half, days in _annual_review_backlog(db, org_id, today):
        fy_year = extract_fy_year(g.cycle_name) or today.year
        items.append((g.user_id, f"{half_display(half, fy_year)} self-review of “{g.title}” awaits your review", days, "annual_review"))
    pg = _project_goal_pending(db, org_id, today)
    for s, days in pg["sets_awaiting_approval"]:
        items.append((s.user_id, f"Project Goals {s.period_label} await approval (agreed offline)", days, "pg_approval"))
    for s, r, days in pg["reviews_awaiting_mentor"]:
        items.append((s.user_id, f"{quarter_display(r.cycle_label)} self-review awaits the Miltenyi review", days, "pg_review"))
    if not items:
        return {}

    owners = _active_users(db, {oid for oid, _, _, _ in items})
    by_mentor: dict[int, list[tuple[User, str, int, str]]] = {}
    for owner_id, label, days, kind in items:
        owner = owners.get(owner_id)
        # No owner or no mentor of record: an Admin problem, not a nudge.
        if owner is None or owner.mentor_id is None:
            continue
        by_mentor.setdefault(owner.mentor_id, []).append((owner, label, days, kind))
    mentors = _active_users(db, set(by_mentor))

    out: dict[int, dict] = {}
    for mentor_id, rows in by_mentor.items():
        mentor = mentors.get(mentor_id)
        if mentor is None or not mentor.email:
            continue
        per_mentee: dict[int, dict] = {}
        for owner, label, days, kind in rows:
            entry = per_mentee.setdefault(owner.id, {"name": owner.full_name, "items": [], "oldest_days": 0})
            entry["items"].append({"label": label, "days": days, "kind": kind})
            entry["oldest_days"] = max(entry["oldest_days"], days)
        mentees = sorted(per_mentee.values(), key=lambda m: m["oldest_days"], reverse=True)
        every = [i for m in mentees for i in m["items"]]
        counts = {k: sum(1 for i in every if i["kind"] == k) for k in ("annual_approval", "annual_review", "pg_approval", "pg_review")}
        out[mentor_id] = {
            "recipient": mentor,
            "mentees": mentees,
            "counts": counts,
            "item_count": len(every),
            "mentee_count": len(mentees),
            "oldest_days": max(m["oldest_days"] for m in mentees),
        }
    return out


# ── staff digests ────────────────────────────────────────────────────

def _last_digest_at(db: Session, org_id: int, digest_type: str) -> dict[int, datetime]:
    """{recipient_id: when their last digest was sent}. Per recipient, because
    "approved since I last told YOU" must not replay a year of approvals to
    someone who joined yesterday."""
    rows = (
        db.query(DailyDigestLog.recipient_id, func.max(DailyDigestLog.created_at))
        .filter(DailyDigestLog.org_id == org_id, DailyDigestLog.digest_type == digest_type)
        .group_by(DailyDigestLog.recipient_id)
        .all()
    )
    return {rid: _as_utc(last) for rid, last in rows if last is not None}


def build_staff_digests(db: Session, org_id: int, today: date) -> dict[int, dict]:
    """{staff_id: payload} for everyone waiting on someone, sent back, or with
    something newly approved / reviewed."""
    last_sent = _last_digest_at(db, org_id, DIGEST_STAFF)
    default_start = datetime.combine(today - timedelta(days=1), time.min, tzinfo=timezone.utc)

    def since(user_id: int) -> datetime:
        return last_sent.get(user_id, default_start)

    goals = _pending_annual_goals(db, org_id)
    floor = min([*last_sent.values(), default_start])
    approved_goals = (
        db.query(Goal)
        .filter(
            Goal.org_id == org_id,
            Goal.is_deleted == False,  # noqa: E712
            Goal.goal_type == GoalType.ANNUAL.value,
            Goal.approved_at.isnot(None),
            Goal.approved_at >= floor,
        )
        .all()
    )
    approved_goals = [g for g in approved_goals if _as_utc(g.approved_at) >= since(g.user_id)]
    pg = _project_goal_pending(db, org_id, today)
    period = pg_periods.active_period(db, org_id)
    approved_sets: list[ProjectGoalSet] = []
    if period is not None:
        approved_sets = [
            s for s in db.query(ProjectGoalSet)
            .filter(
                ProjectGoalSet.org_id == org_id,
                ProjectGoalSet.period_label == period.period_label,
                ProjectGoalSet.approved_at.isnot(None),
                ProjectGoalSet.approved_at >= floor,
            )
            .all()
            if _as_utc(s.approved_at) >= since(s.user_id)
        ]

    owner_ids = (
        {g.user_id for g in goals} | {g.user_id for g in approved_goals}
        | {s.user_id for s, _ in pg["sets_awaiting_approval"]} | {s.user_id for s in approved_sets}
        | {s.user_id for s, _, _ in pg["reviews_to_acknowledge"]}
    )
    if not owner_ids:
        return {}
    owners = _active_users(db, owner_ids)
    mentors = _active_users(db, {u.mentor_id for u in owners.values() if u.mentor_id})

    out: dict[int, dict] = {}

    def entry_for(owner: User) -> dict:
        return out.setdefault(owner.id, {
            "recipient": owner,
            "mentor_name": mentors[owner.mentor_id].full_name if owner.mentor_id in mentors else None,
            "awaiting_approval": [],   # [{label, days}]
            "changes_requested": [],   # [{label}]
            "approved": [],            # [{label}]
            "to_acknowledge": [],      # [{label, days}]
            "oldest_days": 0,
        })

    for g in goals:
        owner = owners.get(g.user_id)
        if owner is None or not owner.email:
            continue
        e = entry_for(owner)
        waited = _days_waiting(_as_utc(g.updated_at) or _as_utc(g.created_at), today)
        if g.approval_status in _AWAITING_MENTOR:
            e["awaiting_approval"].append({"label": f"Annual goal “{g.title}”", "days": waited})
            e["oldest_days"] = max(e["oldest_days"], waited)
        else:
            e["changes_requested"].append({"label": f"Annual goal “{g.title}”"})
    for g in approved_goals:
        owner = owners.get(g.user_id)
        if owner is not None and owner.email:
            entry_for(owner)["approved"].append({"label": f"Annual goal “{g.title}”"})
    for s, days in pg["sets_awaiting_approval"]:
        owner = owners.get(s.user_id)
        if owner is not None and owner.email:
            e = entry_for(owner)
            e["awaiting_approval"].append({"label": f"Project Goals {s.period_label}", "days": days})
            e["oldest_days"] = max(e["oldest_days"], days)
    for s in approved_sets:
        owner = owners.get(s.user_id)
        if owner is not None and owner.email:
            entry_for(owner)["approved"].append({"label": f"Project Goals {s.period_label}"})
    for s, r, days in pg["reviews_to_acknowledge"]:
        owner = owners.get(s.user_id)
        if owner is not None and owner.email:
            entry_for(owner)["to_acknowledge"].append({"label": f"{quarter_display(r.cycle_label)} review", "days": days})

    return {
        uid: e for uid, e in out.items()
        if e["awaiting_approval"] or e["changes_requested"] or e["approved"] or e["to_acknowledge"]
    }


# ── bookkeeping ──────────────────────────────────────────────────────

def already_sent(db: Session, org_id: int, recipient_id: int, digest_type: str, day: date) -> bool:
    return (
        db.query(DailyDigestLog.id)
        .filter(
            DailyDigestLog.org_id == org_id,
            DailyDigestLog.recipient_id == recipient_id,
            DailyDigestLog.digest_type == digest_type,
            DailyDigestLog.sent_on == day,
        )
        .first()
        is not None
    )


def record_sent(db: Session, org_id: int, recipient_id: int, digest_type: str, day: date, item_count: int) -> bool:
    """Claim today's slot for this recipient; True when the claim was ours.
    Committed per row so two overlapping runs collide on the unique index."""
    db.add(DailyDigestLog(org_id=org_id, recipient_id=recipient_id, digest_type=digest_type, sent_on=day, item_count=item_count))
    try:
        db.commit()
        return True
    except IntegrityError:
        db.rollback()
        return False


# ── rendering ────────────────────────────────────────────────────────

def _mentor_email(payload: dict) -> tuple[str, str, list[tuple[str, str]]]:
    """(subject, intro, details) for a mentor summary."""
    n = payload["item_count"]
    m = payload["mentee_count"]
    c = payload["counts"]
    parts = []
    if c["annual_approval"]:
        parts.append(f"{c['annual_approval']} annual goal{_plural(c['annual_approval'])} awaiting approval")
    if c["annual_review"]:
        parts.append(f"{c['annual_review']} goal self-review{_plural(c['annual_review'])} awaiting your review")
    if c["pg_approval"]:
        parts.append(f"{c['pg_approval']} Project Goals set{_plural(c['pg_approval'])} awaiting approval")
    if c["pg_review"]:
        parts.append(f"{c['pg_review']} quarterly self-review{_plural(c['pg_review'])} awaiting the Miltenyi review")
    subject = f"{n} item{_plural(n)} need{'' if n != 1 else 's'} your attention"
    intro = f"You have {', '.join(parts)} from {m} mentee{_plural(m)}. Open the PMS to clear them."
    details = [
        (mt["name"], "; ".join(f"{i['label']} · {i['days']}d" for i in mt["items"]))
        for mt in payload["mentees"]
    ]
    return subject, intro, details


def _staff_email(payload: dict) -> tuple[str, str, list[tuple[str, str]]]:
    """(subject, intro, details) for a staff summary."""
    waiting = payload["awaiting_approval"]
    sent_back = payload["changes_requested"]
    approved = payload["approved"]
    ack = payload["to_acknowledge"]
    mentor = payload["mentor_name"] or "your mentor"

    if sent_back:
        subject = f"{len(sent_back)} goal{_plural(len(sent_back))} sent back for changes"
    elif waiting:
        subject = f"{len(waiting)} item{_plural(len(waiting))} awaiting approval"
    elif ack:
        subject = f"{len(ack)} review{_plural(len(ack))} to acknowledge"
    else:
        subject = f"{len(approved)} item{_plural(len(approved))} approved"

    parts = []
    if waiting:
        oldest = max(i["days"] for i in waiting)
        parts.append(f"{len(waiting)} of your goals {'have' if len(waiting) != 1 else 'has'} been awaiting approval from {mentor} for {oldest} day{_plural(oldest)}.")
    if sent_back:
        parts.append(f"{len(sent_back)} annual goal{_plural(len(sent_back))} {'were' if len(sent_back) != 1 else 'was'} sent back for changes and {'are' if len(sent_back) != 1 else 'is'} waiting on you.")
    if ack:
        parts.append(f"{len(ack)} quarterly review{_plural(len(ack))} {'are' if len(ack) != 1 else 'is'} in and waiting for your acknowledgement.")
    if approved:
        parts.append(f"{len(approved)} item{_plural(len(approved))} {'were' if len(approved) != 1 else 'was'} approved.")
    intro = " ".join(parts)

    details: list[tuple[str, str]] = []
    for i in sent_back:
        details.append((i["label"], "Changes requested · action needed"))
    for i in waiting:
        details.append((i["label"], f"Awaiting approval · {i['days']}d"))
    for i in ack:
        details.append((i["label"], f"Reviewed · acknowledge it · {i['days']}d"))
    for i in approved:
        details.append((i["label"], "Approved"))
    return subject, intro, details


#: (digest type, builder, renderer, deep link, CTA label). Mentors first —
#: their action unblocks the staff.
_DIGESTS = (
    (DIGEST_MENTOR, build_mentor_digests, _mentor_email, "/dashboard", "Open your dashboard"),
    (DIGEST_STAFF, build_staff_digests, _staff_email, "/dashboard", "Open your dashboard"),
)

Enqueue = Callable[..., None]


def _send_now(fn, **kwargs) -> None:
    fn(**kwargs)


def run_daily_digests(db: Session, *, today: Optional[date] = None, enqueue: Optional[Enqueue] = None) -> dict:
    """Build and send both digests for every org. Returns per-type counts.

    Safe to call twice: each recipient's slot is claimed through the unique
    index BEFORE the mail goes out, so a second run sends nothing. `enqueue`
    receives (send_notification_email, **kwargs); the scheduler sends inline,
    the Admin endpoint passes BackgroundTasks.add_task.
    """
    from app.services.notification_service import _absolute_url
    from app.services.send_email import is_smtp_configured, send_notification_email

    sent = {"mentor": 0, "staff": 0, "skipped_already_sent": 0, "skipped_no_smtp": False}
    # Bail before claiming any slot: recording a send that cannot happen would
    # burn the day's idempotency guard and suppress the real one later.
    if not is_smtp_configured():
        sent["skipped_no_smtp"] = True
        return sent

    run = enqueue or _send_now
    day = today or datetime.now(timezone.utc).date()
    for org in db.query(Organization).all():
        for digest_type, builder, render, link, cta in _DIGESTS:
            for recipient_id, payload in builder(db, org.id, day).items():
                if already_sent(db, org.id, recipient_id, digest_type, day):
                    sent["skipped_already_sent"] += 1
                    continue
                subject, intro, details = render(payload)
                if not record_sent(db, org.id, recipient_id, digest_type, day, len(details)):
                    sent["skipped_already_sent"] += 1
                    continue
                user = payload["recipient"]
                run(
                    send_notification_email,
                    to_email=user.email,
                    full_name=user.full_name,
                    subject=subject,
                    lead=intro,
                    cta_label=cta,
                    cta_url=_absolute_url(link),
                    org_id=org.id,
                    title=subject,
                    details=details,
                    snapshot_title="Summary",
                )
                sent["mentor" if digest_type == DIGEST_MENTOR else "staff"] += 1
    return sent
