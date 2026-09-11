"""project_goal_periods — the period / quarter plumbing shared by the
Project Goals routes and the Admin framework routes.

A period is a calendar year ("CY 2026"). Its Admin-advanced current quarter
IS the review window (Healthark PMS roll-out model): a quarter is writable
when the period is active and its seq is at or before the current one.
Quarter rows exist only for quarters that have started.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.models.project_goal_models import (
    QUARTER_SEQS,
    ProjectGoalPeriodSettings,
    ProjectGoalQuarter,
    parse_quarter_label,
    quarter_label,
)
from app.schemas.project_goal_schemas import PeriodSettingsOut, QuarterOut

DEFAULT_PERIOD = "CY 2026"


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
    """Quarters at or before the current one — the selectable ones. After a
    roll back, later rows stay in the table (their ratings flag is kept for
    when the quarter is rolled out again) but are not reported."""
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


def is_writable(period: Optional[ProjectGoalPeriodSettings], quarter: Optional[ProjectGoalQuarter]) -> bool:
    """The current quarter is the window: at or before it, in the active period."""
    if period is None or quarter is None or not period.is_active or not period.current_quarter_seq:
        return False
    return quarter.seq <= period.current_quarter_seq


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
        current_quarter_seq=period.current_quarter_seq,
        current_quarter_label=current_label(period),
        quarters=[
            QuarterOut(
                seq=q.seq, cycle_label=q.cycle_label, ratings_visible=q.ratings_visible,
                is_current=(q.seq == period.current_quarter_seq), opened_at=q.opened_at,
            )
            for q in started_quarters(db, period)
        ],
    )
