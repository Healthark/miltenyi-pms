"""
annual_cycle — the annual half-year cycle follows the Project Goals quarter.

Decided 25 Sep 2026 (option 1 of the roll-out design): one calendar, one
roll-out. The Admin advances the Project Goals quarter in System Settings;
the annual goals and annual reviews cycle is derived from it:

    Q1, Q2 of "CY 26-27"  ->  "H1 FY26-27"
    Q3, Q4 of "CY 26-27"  ->  "H2 FY26-27"
    Q4 -> Q1 of "CY 27-28" -> "H1 FY27-28" (the annual year rolls with it)

"CY 26-27" and "FY26-27" are the same April-to-March span; the FY token is
what annual goals, annual reviews and the per-year switches are stored
against. When no Project Goals year is active (fresh org, feature off) the
cycle falls back to the calendar, as before.

`system_settings.active_cycle_name` is the cache every reader uses (Topbar,
dashboards, gates). `sync_annual_cycle` keeps it in step: the quarter
roll-out calls it, and so does every settings read.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.core.cache import invalidate_settings
from app.core.cycle_utils import (
    _format_fy_span,
    extract_fy_year,
    get_current_cycle_info,
    resolve_today,
)
from app.models.project_goal_models import period_start_year
from app.models.system_settings_models import CycleType, SystemSettings
from app.services import project_goal_periods as pg_periods

HALVES = ("H1", "H2")


def annual_cycle_for_quarter(period_label: str, seq: int) -> Optional[str]:
    """("CY 26-27", 3) -> "H2 FY26-27"; None when the label is unreadable."""
    year = period_start_year(period_label)
    if year is None or not seq:
        return None
    return f"{'H1' if seq <= 2 else 'H2'} {_format_fy_span(year)}"


def derive_annual_cycle(db: Session, settings: SystemSettings) -> str:
    """The annual cycle the org is in right now."""
    period = pg_periods.active_period(db, settings.org_id)
    if period is not None and period.current_quarter_seq:
        derived = annual_cycle_for_quarter(period.period_label, period.current_quarter_seq)
        if derived:
            return derived
    return get_current_cycle_info(
        resolve_today(settings), CycleType(settings.cycle_type), settings.fiscal_start_month,
    )


def sync_annual_cycle(db: Session, settings: SystemSettings) -> str:
    """Refresh `settings.active_cycle_name` from the roll-out and return it.
    Commits only when the value changed."""
    fresh = derive_annual_cycle(db, settings)
    if settings.active_cycle_name != fresh:
        settings.active_cycle_name = fresh
        db.commit()
        invalidate_settings(settings.org_id)
    return fresh


def half_and_year_of(cycle_name: Optional[str]) -> tuple[Optional[str], Optional[int]]:
    """"H2 FY26-27" -> ("H2", 2026); ("Q3 FY26-27" -> ("H2", 2026)); (None, None) when unreadable."""
    if not cycle_name:
        return None, None
    parts = cycle_name.strip().split()
    if len(parts) < 2:
        return None, extract_fy_year(cycle_name)
    code = parts[0].upper()
    if code in ("Q1", "Q2"):
        code = "H1"
    elif code in ("Q3", "Q4"):
        code = "H2"
    if code not in HALVES:
        return None, extract_fy_year(cycle_name)
    return code, extract_fy_year(parts[-1])


def is_half_open(target_half: str, target_fy_year: int, active_cycle_name: Optional[str]) -> bool:
    """Annual goal self-review / mentor-review window for one half.

    Open while the goal's year is the active annual year and the half is the
    current one or an earlier one (the earlier half stays open for backfill
    until the Admin rolls the year over). A later half, or any half of
    another year, is closed. Legacy quarter codes map onto their half."""
    current_half, current_year = half_and_year_of(active_cycle_name)
    if current_half is None or current_year is None or current_year != target_fy_year:
        return False
    target = target_half.upper()
    if target in ("Q1", "Q2"):
        target = "H1"
    elif target in ("Q3", "Q4"):
        target = "H2"
    if target not in HALVES:
        return False
    return HALVES.index(target) <= HALVES.index(current_half)
