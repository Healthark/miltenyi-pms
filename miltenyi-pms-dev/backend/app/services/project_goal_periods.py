"""project_goal_periods — the period / quarter plumbing shared by the
Project Goals routes and the Admin framework routes.

A period is a goal year labelled as a span ("CY 26-27": it ends around
April). Its Admin-advanced current quarter IS the review window (Healthark
PMS roll-out model):

* the ACTIVE period: a quarter is writable when its seq is at or before the
  current quarter (earlier quarters stay open for backfill);
* a PAST period (the year has rolled over): its started quarters stay
  writable while the year's `backfill_open` is on — the Admin closes the
  year from System Settings once the last quarter's reviews are in;
* each started quarter also has its own `backfill_open`, so the Admin can
  close an earlier quarter on its own (the current quarter is always open);
* quarter rows exist only for quarters that have started.
"""
from __future__ import annotations

from datetime import date
from typing import Optional

from sqlalchemy.orm import Session

from app.core.cycle_utils import resolve_today
from app.models.project_goal_models import (
    QUARTER_SEQS,
    ProjectGoalPeriodSettings,
    ProjectGoalQuarter,
    ProjectGoalSet,
    default_period_label,
    parse_quarter_label,
    period_start_year,
    quarter_label,
)
from app.models.system_settings_models import SystemSettings
from app.schemas.project_goal_schemas import PeriodBriefOut, PeriodSettingsOut, QuarterOut


def default_label(db: Session, org_id: int) -> str:
    """The goal year today falls in, from the org's fiscal start month
    (April by default): September 2026 -> "CY 26-27"."""
    settings = db.query(SystemSettings).filter(SystemSettings.org_id == org_id).first()
    today: date = resolve_today(settings)
    start_month = settings.fiscal_start_month if settings and settings.fiscal_start_month else 4
    return default_period_label(today, start_month)


def active_period(db: Session, org_id: int) -> Optional[ProjectGoalPeriodSettings]:
    return (
        db.query(ProjectGoalPeriodSettings)
        .filter(ProjectGoalPeriodSettings.org_id == org_id, ProjectGoalPeriodSettings.is_active.is_(True))
        .order_by(ProjectGoalPeriodSettings.id.desc())
        .first()
    )


def period_by_label(db: Session, org_id: int, period_label: str) -> Optional[ProjectGoalPeriodSettings]:
    return (
        db.query(ProjectGoalPeriodSettings)
        .filter(ProjectGoalPeriodSettings.org_id == org_id, ProjectGoalPeriodSettings.period_label == period_label)
        .first()
    )


def list_periods(db: Session, org_id: int) -> list[ProjectGoalPeriodSettings]:
    """Every configured goal year, newest first."""
    rows = db.query(ProjectGoalPeriodSettings).filter(ProjectGoalPeriodSettings.org_id == org_id).all()

    def key(p: ProjectGoalPeriodSettings) -> int:
        try:
            return period_start_year(p.period_label)
        except ValueError:
            return 0

    return sorted(rows, key=key, reverse=True)


def quarters_for(db: Session, period: ProjectGoalPeriodSettings) -> list[ProjectGoalQuarter]:
    """Every quarter row of the period, including rows left behind by a roll
    back (seq > current). Use `started_quarters` for what the UI may show."""
    return (
        db.query(ProjectGoalQuarter)
        .filter(ProjectGoalQuarter.org_id == period.org_id, ProjectGoalQuarter.period_label == period.period_label)
        .order_by(ProjectGoalQuarter.seq)
        .all()
    )


def started_quarters(db: Session, period: ProjectGoalPeriodSettings) -> list[ProjectGoalQuarter]:
    """Quarters at or before the period's current one — the selectable ones.
    After a roll back, later rows stay in the table (their ratings flag is
    kept for when the quarter is rolled out again) but are not reported."""
    current = period.current_quarter_seq or 0
    return [q for q in quarters_for(db, period) if q.seq <= current]


def quarter_by_label(db: Session, period: ProjectGoalPeriodSettings, cycle_label: str) -> Optional[ProjectGoalQuarter]:
    """The quarter row for a stored label, or None when the label is not a
    quarter of this period or that quarter has not started yet."""
    try:
        seq, plabel = parse_quarter_label(cycle_label)
    except ValueError:
        return None
    if plabel != period.period_label:
        return None
    return (
        db.query(ProjectGoalQuarter)
        .filter(ProjectGoalQuarter.org_id == period.org_id, ProjectGoalQuarter.period_label == period.period_label, ProjectGoalQuarter.seq == seq)
        .first()
    )


def ensure_quarter_rows(db: Session, period: ProjectGoalPeriodSettings, up_to_seq: int, actor_id: Optional[int]) -> None:
    """Create the quarter rows 1..up_to_seq that do not exist yet (ratings hidden)."""
    existing = {q.seq for q in quarters_for(db, period)}
    for seq in QUARTER_SEQS:
        if seq > up_to_seq or seq in existing:
            continue
        db.add(ProjectGoalQuarter(
            org_id=period.org_id, period_label=period.period_label, seq=seq,
            cycle_label=quarter_label(period.period_label, seq), ratings_visible=False, opened_by_id=actor_id,
        ))
    db.flush()


def has_started(period: Optional[ProjectGoalPeriodSettings], quarter: Optional[ProjectGoalQuarter]) -> bool:
    if period is None or quarter is None or not period.current_quarter_seq:
        return False
    return quarter.seq <= period.current_quarter_seq


def is_writable(period: Optional[ProjectGoalPeriodSettings], quarter: Optional[ProjectGoalQuarter]) -> bool:
    """Active year: the current quarter is always open; an earlier quarter is
    open while its own `backfill_open` is on. Past year: a started quarter is
    open while both the year's and the quarter's `backfill_open` are on."""
    if not has_started(period, quarter):
        return False
    if period.is_active:
        return quarter.seq == period.current_quarter_seq or bool(quarter.backfill_open)
    return bool(period.backfill_open and quarter.backfill_open)


def current_label(period: Optional[ProjectGoalPeriodSettings]) -> Optional[str]:
    if period is None or not period.current_quarter_seq:
        return None
    return quarter_label(period.period_label, period.current_quarter_seq)


def period_out(db: Session, period: ProjectGoalPeriodSettings) -> PeriodSettingsOut:
    return PeriodSettingsOut(
        period_label=period.period_label,
        is_active=period.is_active,
        entry_open=period.entry_open,
        weightages_visible=period.weightages_visible,
        backfill_open=period.backfill_open,
        extra_goal_enabled=period.extra_goal_enabled,
        extra_goal_weightage=period.extra_goal_weightage,
        current_quarter_seq=period.current_quarter_seq,
        current_quarter_label=current_label(period),
        quarters=[
            QuarterOut(
                seq=q.seq, cycle_label=q.cycle_label, ratings_visible=q.ratings_visible, backfill_open=q.backfill_open,
                is_current=(period.is_active and q.seq == period.current_quarter_seq), opened_at=q.opened_at,
            )
            for q in started_quarters(db, period)
        ],
    )


def period_brief(period: ProjectGoalPeriodSettings, has_set: Optional[bool] = None) -> PeriodBriefOut:
    return PeriodBriefOut(
        period_label=period.period_label,
        is_active=period.is_active,
        entry_open=period.entry_open,
        backfill_open=period.backfill_open,
        current_quarter_seq=period.current_quarter_seq,
        current_quarter_label=current_label(period),
        has_set=has_set,
    )


def period_briefs(db: Session, org_id: int, for_user_id: Optional[int] = None) -> list[PeriodBriefOut]:
    """Every goal year, newest first; with `has_set` when a staff member asks."""
    rows = list_periods(db, org_id)
    owned: set[str] = set()
    if for_user_id is not None and rows:
        owned = {
            s.period_label
            for s in db.query(ProjectGoalSet.period_label)
            .filter(ProjectGoalSet.org_id == org_id, ProjectGoalSet.user_id == for_user_id)
            .all()
        }
    return [period_brief(p, (p.period_label in owned) if for_user_id is not None else None) for p in rows]
