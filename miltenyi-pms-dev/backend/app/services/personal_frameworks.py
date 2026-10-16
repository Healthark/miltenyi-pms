"""
Personal frameworks (16 Oct 2026) — the Admin overrides one staff member's
Project Goals framework for a goal year: the title, the two paragraphs, KPI
texts and weightages and the Additional goals %. Stored as a
`goal_frameworks` row with `user_id` set; role columns keep `user_id` NULL.
Saving applies it to the person's goal sheet at once; reverting points the
sheet back at the role column. See docs/plans/2026-10-16-personal-frameworks-plan.md.

Rules:
* Goal text and quarter reviews stay on their rows; only the KPI text, the
  weightage and the KPI link of a row change.
* KPIs can be added or removed only until the goals are approved. After that
  the rows are fixed (removing one would delete its quarter reviews), so
  only KPI texts and weightages change.
* The Additional goals row takes the framework's weightage when the sheet
  has one; the year's switch still decides whether it exists.
* Not carried into the next goal year: the roll-over copies role columns
  only. The editor offers last year's personal row instead.
"""

from typing import Optional, Sequence

from app.models.project_goal_models import (
    GoalFramework,
    GoalFrameworkKpi,
    ProjectGoalItem,
    ProjectGoalSet,
    ProjectGoalSetStatus,
)
from app.models.user_models import User


class RowChangeLocked(Exception):
    """KPIs would be added or removed on a sheet whose goals are approved."""


def level_of(user: User) -> Optional[int]:
    return user.designation.career_level if user.designation else None


def role_column(db, org_id: int, function_id: Optional[int], level: Optional[int], period_label: str) -> Optional[GoalFramework]:
    """The role column (function × level) of a goal year, never a personal row."""
    if function_id is None or level is None:
        return None
    return (
        db.query(GoalFramework)
        .filter(
            GoalFramework.org_id == org_id,
            GoalFramework.function_id == function_id,
            GoalFramework.level == level,
            GoalFramework.period_label == period_label,
            GoalFramework.user_id.is_(None),
        )
        .first()
    )


def personal_framework(db, org_id: int, user_id: int, period_label: str) -> Optional[GoalFramework]:
    return (
        db.query(GoalFramework)
        .filter(GoalFramework.org_id == org_id, GoalFramework.user_id == user_id, GoalFramework.period_label == period_label)
        .first()
    )


def personal_by_user(db, org_id: int, period_label: str) -> dict[int, GoalFramework]:
    """Every personal framework of a goal year, by staff member."""
    rows = (
        db.query(GoalFramework)
        .filter(GoalFramework.org_id == org_id, GoalFramework.period_label == period_label, GoalFramework.user_id.isnot(None))
        .all()
    )
    return {fw.user_id: fw for fw in rows}


def framework_for_person(db, user: User, period_label: str) -> Optional[GoalFramework]:
    """The framework a staff member's goals follow: their personal row when
    the Admin made one for this year, else the role column."""
    return personal_framework(db, user.org_id, user.id, period_label) or role_column(
        db, user.org_id, user.function_id, level_of(user), period_label,
    )


def goal_set_of(db, user: User, period_label: str) -> Optional[ProjectGoalSet]:
    return (
        db.query(ProjectGoalSet)
        .filter(ProjectGoalSet.org_id == user.org_id, ProjectGoalSet.user_id == user.id, ProjectGoalSet.period_label == period_label)
        .first()
    )


def kpi_rows(s: ProjectGoalSet) -> list[ProjectGoalItem]:
    return sorted((it for it in s.items if not it.is_extra), key=lambda it: it.seq)


def extra_row(s: ProjectGoalSet) -> Optional[ProjectGoalItem]:
    return next((it for it in s.items if it.is_extra), None)


def can_change_kpi_count(s: Optional[ProjectGoalSet]) -> bool:
    return s is None or s.status != ProjectGoalSetStatus.APPROVED.value


def sheet_snapshot(s: ProjectGoalSet) -> dict:
    """Change-log payload: what the sheet's framework side looks like."""
    fw = s.framework
    extra = extra_row(s)
    return {
        "framework_id": s.framework_id,
        "personal": bool(fw is not None and fw.user_id is not None),
        "title": fw.title if fw is not None else None,
        "kpis": [{"seq": it.seq, "kpi_text": it.kpi_text, "weightage": it.weightage} for it in kpi_rows(s)],
        "extra_goal_weightage": extra.weightage if extra is not None else None,
    }


def match_rows(s: ProjectGoalSet, kpi_count: int, kpi_items: Optional[Sequence[Optional[int]]]) -> tuple[list[Optional[ProjectGoalItem]], list[ProjectGoalItem]]:
    """Which existing goal row each of the framework's KPIs continues, and
    which rows have no KPI any more. `kpi_items[i]` names the row (item id)
    the i-th KPI continues, None for a new row; without it rows are matched
    by position (revert to the role column). Raises RowChangeLocked when the
    goals are approved and a row would be added or removed."""
    rows = kpi_rows(s)
    if kpi_items is None:
        matched: list[Optional[ProjectGoalItem]] = [rows[i] if i < len(rows) else None for i in range(kpi_count)]
    else:
        by_id = {it.id: it for it in rows}
        used: set[int] = set()
        matched = []
        for item_id in kpi_items:
            it = by_id.get(item_id) if item_id is not None else None
            if it is not None and it.id in used:
                it = None
            if it is not None:
                used.add(it.id)
            matched.append(it)
    kept = {it.id for it in matched if it is not None}
    removed = [it for it in rows if it.id not in kept]
    if not can_change_kpi_count(s) and (removed or any(it is None for it in matched)):
        raise RowChangeLocked()
    return matched, removed


def apply_framework_to_set(db, s: ProjectGoalSet, fw: GoalFramework, kpi_items: Optional[Sequence[Optional[int]]] = None) -> None:
    """Point the sheet at `fw` and bring its goal rows in line with it, now.
    Matched rows take the KPI's text, weightage and id and keep their goal
    text and quarter reviews; new KPIs get new rows; rows without a KPI are
    deleted with their (draft) review rows. The caller commits."""
    kpis = sorted(fw.kpis, key=lambda k: k.seq)
    matched, removed = match_rows(s, len(kpis), kpi_items)

    if removed:
        gone = {it.id for it in removed}
        for review in s.reviews:
            for ri in [ri for ri in review.items if ri.item_id in gone]:
                review.items.remove(ri)
        db.flush()
        for it in removed:
            s.items.remove(it)
        db.flush()

    # Park the remaining rows on negative positions first: (set_id, seq) is
    # unique, and rows may swap places.
    extra = extra_row(s)
    for it in [m for m in matched if m is not None] + ([extra] if extra is not None else []):
        it.seq = -it.seq
    db.flush()

    for seq, (k, it) in enumerate(zip(kpis, matched), start=1):
        if it is None:
            s.items.append(ProjectGoalItem(set_id=s.id, seq=seq, kpi_id=k.id, kpi_text=k.text, weightage=k.weightage))
        else:
            it.seq = seq
            it.kpi_id = k.id
            it.kpi_text = k.text
            it.weightage = k.weightage
    if extra is not None:
        extra.seq = len(kpis) + 1
        extra.weightage = fw.extra_goal_weightage
    s.framework_id = fw.id
    s.framework = fw
    db.flush()


def save_personal(db, *, person: User, period_label: str, base: Optional[GoalFramework], actor: User,
                  title: str, business_outcomes: str, functional_goals: str,
                  kpis: Sequence[tuple[str, int]], extra_goal_weightage: int) -> GoalFramework:
    """Create or update the person's personal framework for the year. KPIs
    are kept by position, so an unchanged KPI keeps its id."""
    fw = personal_framework(db, person.org_id, person.id, period_label)
    if fw is None:
        if base is None:
            raise ValueError("A new personal framework needs the role column it is based on.")
        fw = GoalFramework(
            org_id=person.org_id, function_id=base.function_id, level=base.level, period_label=period_label,
            user_id=person.id, based_on_id=base.id, created_by_id=actor.id,
            title=title, business_outcomes=business_outcomes, functional_goals=functional_goals,
            extra_goal_weightage=extra_goal_weightage,
        )
        db.add(fw)
        db.flush()
    elif base is not None:
        fw.based_on_id = base.id
    fw.title = title
    fw.business_outcomes = business_outcomes
    fw.functional_goals = functional_goals
    fw.extra_goal_weightage = extra_goal_weightage

    existing = {k.seq: k for k in fw.kpis}
    for seq, (text, weightage) in enumerate(kpis, start=1):
        row = existing.pop(seq, None)
        if row is None:
            fw.kpis.append(GoalFrameworkKpi(seq=seq, text=text, weightage=weightage))
        else:
            row.text = text
            row.weightage = weightage
    for leftover in existing.values():
        fw.kpis.remove(leftover)
    db.flush()
    return fw
