"""
Goal Framework Routes (Admin) — the Miltenyi "Indicative Goal Themes"
content behind Project Goals, the staff mapping view, the period switches and
the quarter roll-out. Mounted at /api/v1/admin/goal-frameworks.

    GET    /                         matrix for a period: every function with its designations (by level) and rows
    POST   /                         add one role/level row ("Add Function" in the UI) with its KPIs
    PUT    /{row_id}                 replace title, paragraphs and KPI list (weights must total 100)
    DELETE /{row_id}                 remove a row nobody has a goal set against
    GET    /personal                 the year's personal frameworks (one staff member's own framework)
    GET    /personal/{user_id}       what the personal-framework editor opens with for one staff member
    PUT    /personal/{user_id}       create / update it and apply it to their goal sheet at once
    DELETE /personal/{user_id}       revert: back to the role column, sheet updated at once
    PATCH  /designations/{id}        set a designation's level (1..12) and/or rename it
    GET    /mapping                  Staff · Function · Designation · Level · Reviewer (Mentor) · Miltenyi reviewer · Status
    GET    /periods                  every goal year (the year dropdown)
    GET    /settings                 period switches + started quarters (active period by default; ?period=)
    GET    /settings/preflight       who a switch flip would affect (counts for the Save confirmation)
    PATCH  /settings                 upsert the yearly switches; is_active=True deactivates the others
    GET    /cycle                    what the quarter roll-out card shows: current, next, roll-back target
    POST   /cycle/rollout            advance to the next quarter (Q4 → Q1 of the next year; typed confirmation)
    POST   /cycle/set                set the current quarter by label (forward or back; may start a new year)
    POST   /cycle/rollback           move one quarter back (Q1 → Q4 of the previous year)
    GET    /cycle/log                recent roll-out / set / roll-back entries
    PATCH  /quarters/{seq}           per-quarter switches: ratings visible to staff, open for backfill

The current quarter is the review window (Healthark PMS model): quarters at
or before it are writable, later ones are closed. Every move is logged and
announced in-app to every active user.

Role columns and personal frameworks share the goal_frameworks table (16 Oct
2026): a personal row has `user_id` set. The matrix, the column endpoints,
the mapping and the year roll-over work on role columns only. Past goal
years are locked: their columns and personal rows cannot change.

Guards: CurrentUser + the `project_goals` feature gate on the router; every
route additionally requires role Admin.
"""

import json
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import joinedload

from app.api.dependencies import CurrentUser, DbSession
from app.core.cycle_utils import year_display
from app.core.features import require_feature
from app.models.system_settings_models import SystemSettings
from app.services.annual_cycle import sync_annual_cycle
from app.models.project_goal_models import (
    QUARTER_SEQS,
    GoalFramework,
    GoalFrameworkKpi,
    ProjectGoalChangeLog,
    ProjectGoalCycleLog,
    ProjectGoalPeriodSettings,
    ProjectGoalReview,
    ProjectGoalSet,
    next_period_label,
    parse_quarter_label,
    period_start_year,
    previous_period_label,
    quarter_display,
    quarter_label,
)
from app.models.reference_models import MAX_LEVEL, Designation, Function, career_level_label
from app.models.user_models import Role, User
from app.schemas.project_goal_schemas import (
    CycleLogOut,
    CycleRolloutRequest,
    CycleSetRequest,
    CycleStatusOut,
    DesignationBriefOut,
    DesignationLevelUpdate,
    FrameworkFunctionOut,
    FrameworkKpiOut,
    FrameworkMatrixOut,
    FrameworkRowCreate,
    FrameworkRowOut,
    FrameworkRowUpdate,
    MappingRowOut,
    PeriodBriefOut,
    PersonalFrameworkOut,
    PersonalFrameworkRowOut,
    PersonalFrameworkSave,
    PersonalKpiDraftOut,
    PeriodPreflightOut,
    PeriodSettingsOut,
    PeriodSettingsUpdate,
    QuarterOut,
    QuarterPreflightOut,
    QuarterUpdate,
)
from app.services import personal_frameworks as pf
from app.services import project_goal_periods as periods
from app.services.notification_service import notify, notify_many

router = APIRouter(dependencies=[Depends(require_feature("project_goals"))])



def _require_admin(user: User) -> None:
    if user.role != Role.ADMIN.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only an Admin can manage the goal framework.")


def _active_period_label(db, org_id: int) -> Optional[str]:
    row = periods.active_period(db, org_id)
    return row.period_label if row else None


def _resolve_period(db, org_id: int, period: Optional[str]) -> str:
    return period or _active_period_label(db, org_id) or periods.default_label(db, org_id)


def _row_out(fw: GoalFramework) -> FrameworkRowOut:
    return FrameworkRowOut(
        id=fw.id, function_id=fw.function_id, function_name=fw.function.name if fw.function else "",
        level=fw.level, period_label=fw.period_label, title=fw.title,
        business_outcomes=fw.business_outcomes, functional_goals=fw.functional_goals,
        kpis=[FrameworkKpiOut(id=k.id, seq=k.seq, text=k.text, weightage=k.weightage) for k in fw.kpis],
        extra_goal_weightage=fw.extra_goal_weightage,
        is_personal=fw.user_id is not None,
        personal_for_name=fw.user.full_name if fw.user_id is not None and fw.user else None,
    )


def _get_row(db, row_id: int, org_id: int) -> GoalFramework:
    """A role column. Personal frameworks have their own endpoints."""
    fw = (
        db.query(GoalFramework)
        .options(joinedload(GoalFramework.function))
        .filter(GoalFramework.id == row_id, GoalFramework.org_id == org_id, GoalFramework.user_id.is_(None))
        .first()
    )
    if fw is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Framework row not found.")
    return fw


def _is_past_year(db, org_id: int, period_label: str) -> bool:
    active = periods.active_period(db, org_id)
    if active is None or active.period_label == period_label:
        return False
    try:
        return period_start_year(period_label) < period_start_year(active.period_label)
    except ValueError:
        return False


def _require_open_year(db, org_id: int, period_label: str) -> None:
    """Past goal years are locked (16 Oct 2026): their goal sheets and
    reviews were built on these rows."""
    if _is_past_year(db, org_id, period_label):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{period_label} is a past year; its framework is locked.")


# ── Matrix ───────────────────────────────────────────────────────────

@router.get("/", response_model=FrameworkMatrixOut)
def framework_matrix(db: DbSession, current_user: CurrentUser, period: Optional[str] = Query(default=None)):
    _require_admin(current_user)
    period_label = _resolve_period(db, current_user.org_id, period)

    functions = db.query(Function).filter(Function.org_id == current_user.org_id, Function.is_active.is_(True)).order_by(Function.name).all()
    designations = db.query(Designation).filter(Designation.org_id == current_user.org_id, Designation.is_active.is_(True)).order_by(Designation.career_level, Designation.name).all()
    rows = (
        db.query(GoalFramework)
        .options(joinedload(GoalFramework.function))
        .filter(GoalFramework.org_id == current_user.org_id, GoalFramework.period_label == period_label, GoalFramework.user_id.is_(None))
        .order_by(GoalFramework.function_id, GoalFramework.level)
        .all()
    )
    rows_by_fn: dict[int, list[GoalFramework]] = {}
    for fw in rows:
        rows_by_fn.setdefault(fw.function_id, []).append(fw)
    desigs_by_fn: dict[int, list[Designation]] = {}
    for d in designations:
        if d.function_id is not None:
            desigs_by_fn.setdefault(d.function_id, []).append(d)

    return FrameworkMatrixOut(
        period_label=period_label,
        functions=[
            FrameworkFunctionOut(
                function_id=f.id, function_name=f.name,
                designations=[DesignationBriefOut.model_validate(d) for d in desigs_by_fn.get(f.id, [])],
                rows=[_row_out(fw) for fw in rows_by_fn.get(f.id, [])],
            )
            for f in functions
        ],
    )


@router.post("/", response_model=FrameworkRowOut, status_code=status.HTTP_201_CREATED)
def create_row(payload: FrameworkRowCreate, db: DbSession, current_user: CurrentUser):
    _require_admin(current_user)
    fn = db.query(Function).filter(Function.id == payload.function_id, Function.org_id == current_user.org_id).first()
    if fn is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Function not found.")
    if not 1 <= payload.level <= MAX_LEVEL:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Levels run 1 to {MAX_LEVEL}.")
    period_label = _resolve_period(db, current_user.org_id, payload.period_label)
    _require_open_year(db, current_user.org_id, period_label)
    clash = pf.role_column(db, current_user.org_id, fn.id, payload.level, period_label)
    if clash is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{fn.name} already has a level {payload.level} row for {period_label}. Edit it in the matrix.")

    fw = GoalFramework(
        org_id=current_user.org_id, function_id=fn.id, level=payload.level, period_label=period_label,
        title=payload.title.strip(), business_outcomes=payload.business_outcomes.strip(),
        functional_goals=payload.functional_goals.strip(), created_by_id=current_user.id,
        extra_goal_weightage=payload.extra_goal_weightage,
    )
    db.add(fw)
    db.flush()
    for i, k in enumerate(payload.kpis, start=1):
        db.add(GoalFrameworkKpi(framework_id=fw.id, seq=i, text=k.text.strip(), weightage=k.weightage))
    db.commit()
    return _row_out(_get_row(db, fw.id, current_user.org_id))


@router.put("/{row_id}", response_model=FrameworkRowOut)
def update_row(row_id: int, payload: FrameworkRowUpdate, db: DbSession, current_user: CurrentUser):
    """Replace the paragraphs and the KPI list. KPIs are matched by sequence so
    an unchanged KPI keeps its id (goal items reference it); removed KPIs are
    deleted (items keep their snapshot; the FK is set null)."""
    _require_admin(current_user)
    fw = _get_row(db, row_id, current_user.org_id)
    _require_open_year(db, current_user.org_id, fw.period_label)
    fw.title = payload.title.strip()
    fw.business_outcomes = payload.business_outcomes.strip()
    fw.functional_goals = payload.functional_goals.strip()
    extra_changed = fw.extra_goal_weightage != payload.extra_goal_weightage
    fw.extra_goal_weightage = payload.extra_goal_weightage

    existing = {k.seq: k for k in fw.kpis}
    for i, k in enumerate(payload.kpis, start=1):
        row = existing.pop(i, None)
        if row is None:
            db.add(GoalFrameworkKpi(framework_id=fw.id, seq=i, text=k.text.strip(), weightage=k.weightage))
        else:
            row.text = k.text.strip()
            row.weightage = k.weightage
    for leftover in existing.values():
        db.delete(leftover)
    if extra_changed:
        # Draft sheets built from this column follow the new weightage;
        # submitted and approved sheets keep their snapshot.
        for st in db.query(ProjectGoalSet).filter(ProjectGoalSet.framework_id == fw.id, ProjectGoalSet.status == "draft").all():
            for it in st.items:
                if it.is_extra:
                    it.weightage = fw.extra_goal_weightage
    db.commit()
    db.expire_all()
    return _row_out(_get_row(db, fw.id, current_user.org_id))


@router.delete("/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_row(row_id: int, db: DbSession, current_user: CurrentUser):
    _require_admin(current_user)
    fw = _get_row(db, row_id, current_user.org_id)
    _require_open_year(db, current_user.org_id, fw.period_label)
    in_use = db.query(ProjectGoalSet).filter(ProjectGoalSet.framework_id == fw.id).count()
    if in_use:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{in_use} goal set(s) were created from this row; it cannot be deleted.")
    # Personal frameworks customised from this column keep working; they
    # only lose the "based on" link.
    db.query(GoalFramework).filter(GoalFramework.based_on_id == fw.id).update({GoalFramework.based_on_id: None}, synchronize_session=False)
    db.delete(fw)
    db.commit()
    return None


# ── Personal frameworks (16 Oct 2026) ────────────────────────────────
#
# One staff member's own framework for the active goal year: title, the two
# paragraphs, KPI texts and weightages, the Additional goals %. Saving applies
# it to their goal sheet at once (rows keep their goal text and reviews);
# KPIs can be added or removed only until the goals are approved. The staff
# member and their mentor are notified. See app/services/personal_frameworks.py.

def _personal_year(db, org_id: int, period: Optional[str]) -> ProjectGoalPeriodSettings:
    """Personal frameworks are set for the active goal year only."""
    active = periods.active_period(db, org_id)
    if active is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="No goal year is active yet. Personal frameworks are set for the active year.")
    label = (period or "").strip() or active.period_label
    if label != active.period_label:
        _require_open_year(db, org_id, label)
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Personal frameworks are set for the active goal year ({active.period_label}).")
    return active


def _staff_member(db, org_id: int, user_id: int) -> User:
    person = (
        db.query(User)
        .options(joinedload(User.function), joinedload(User.designation), joinedload(User.mentor))
        .filter(User.id == user_id, User.org_id == org_id, User.role == Role.STAFF.value, User.is_deleted.is_(False))
        .first()
    )
    if person is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Staff member not found.")
    return person


def _require_role_column(person: User, base: Optional[GoalFramework], period_label: str) -> GoalFramework:
    """A new personal framework starts from the person's role column."""
    if base is not None:
        return base
    if person.function_id is None or person.function is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{person.full_name} has no function yet. Set it on the Framework Mapping tab first.")
    level = pf.level_of(person)
    if level is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{person.full_name}'s designation has no level yet. Set it on the Framework tab first.")
    raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                        detail=f"There is no {person.function.name} level {level} column for {period_label}. Add it on the Framework tab first.")


def _personal_out(db, person: User, year: ProjectGoalPeriodSettings) -> PersonalFrameworkOut:
    label = year.period_label
    personal = pf.personal_framework(db, person.org_id, person.id, label)
    base = pf.role_column(db, person.org_id, person.function_id, pf.level_of(person), label)
    src = personal or _require_role_column(person, base, label)
    s = pf.goal_set_of(db, person, label)
    if s is not None:
        # The sheet's own rows, so custom weights show as they are.
        extra = pf.extra_row(s)
        kpis = [
            PersonalKpiDraftOut(item_id=it.id, text=it.kpi_text, weightage=it.weightage, has_goal_text=bool((it.goal_text or "").strip()))
            for it in pf.kpi_rows(s)
        ]
        extra_weight = extra.weightage if extra is not None else src.extra_goal_weightage
    else:
        kpis = [PersonalKpiDraftOut(text=k.text, weightage=k.weightage) for k in src.kpis]
        extra_weight = src.extra_goal_weightage
    try:
        last = pf.personal_framework(db, person.org_id, person.id, previous_period_label(label))
    except ValueError:
        last = None
    return PersonalFrameworkOut(
        user_id=person.id, full_name=person.full_name, email=person.email,
        mentor_name=person.mentor.full_name if person.mentor else None,
        function_id=src.function_id, function_name=src.function.name if src.function else "",
        level=src.level, level_label=career_level_label(src.level), period_label=label,
        is_personal=personal is not None, framework_id=personal.id if personal else None,
        based_on=_row_out(base) if base else None,
        title=src.title, business_outcomes=src.business_outcomes, functional_goals=src.functional_goals,
        kpis=kpis, extra_goal_weightage=extra_weight, extra_goal_enabled=year.extra_goal_enabled,
        set_id=s.id if s else None, set_status=s.status if s else None,
        can_change_kpi_count=pf.can_change_kpi_count(s),
        last_year=_row_out(last) if last else None,
        updated_at=(personal.updated_at or personal.created_at) if personal else None,
    )


def _log_sheet(db, s: ProjectGoalSet, actor: User, action: str, before: dict, after: dict) -> None:
    db.add(ProjectGoalChangeLog(
        org_id=s.org_id, set_id=s.id, actor_id=actor.id, action=action,
        before=json.dumps(before, default=str), after=json.dumps(after, default=str),
    ))


def _notify_personal(db, *, person: User, s: Optional[ProjectGoalSet], actor: User, background_tasks: BackgroundTasks,
                     staff_message: str, mentor_message: str, subject: str) -> None:
    url = f"/project-goals?set_id={s.id}" if s is not None else "/project-goals"
    entity = ("project_goal_set", s.id) if s is not None else ("project_goal_framework", None)
    for recipient_id, message in ((person.id, staff_message), (person.mentor_id, mentor_message)):
        if recipient_id is None:
            continue
        notify(
            db, org_id=person.org_id, recipient_id=recipient_id, sender_id=actor.id,
            module="project_goal", entity_type=entity[0], entity_id=entity[1], message=message, entity_url=url,
            background_tasks=background_tasks, send_email=True, email_subject=subject,
        )


@router.get("/personal", response_model=list[PersonalFrameworkRowOut])
def list_personal_frameworks(db: DbSession, current_user: CurrentUser, period: Optional[str] = Query(default=None)):
    _require_admin(current_user)
    period_label = _resolve_period(db, current_user.org_id, period)
    rows = (
        db.query(GoalFramework)
        .options(joinedload(GoalFramework.function), joinedload(GoalFramework.user))
        .filter(GoalFramework.org_id == current_user.org_id, GoalFramework.period_label == period_label, GoalFramework.user_id.isnot(None))
        .all()
    )
    statuses = {
        uid: st
        for uid, st in db.query(ProjectGoalSet.user_id, ProjectGoalSet.status)
        .filter(ProjectGoalSet.org_id == current_user.org_id, ProjectGoalSet.period_label == period_label)
        .all()
    }
    out = [
        PersonalFrameworkRowOut(
            user_id=fw.user_id, full_name=fw.user.full_name if fw.user else "", email=fw.user.email if fw.user else "",
            framework_id=fw.id, function_name=fw.function.name if fw.function else None,
            level=fw.level, level_label=career_level_label(fw.level), title=fw.title,
            based_on_title=fw.based_on.title if fw.based_on else None,
            kpi_count=len(fw.kpis), extra_goal_weightage=fw.extra_goal_weightage,
            set_status=statuses.get(fw.user_id), updated_at=fw.updated_at or fw.created_at,
        )
        for fw in rows
    ]
    return sorted(out, key=lambda r: r.full_name.lower())


@router.get("/personal/{user_id}", response_model=PersonalFrameworkOut)
def get_personal_framework(user_id: int, db: DbSession, current_user: CurrentUser, period: Optional[str] = Query(default=None)):
    """What the editor opens with: the personal framework when there is one;
    otherwise the role column's text with the KPI rows of the staff member's
    sheet (custom weights show as they are), or the column's KPIs before
    they start."""
    _require_admin(current_user)
    year = _personal_year(db, current_user.org_id, period)
    return _personal_out(db, _staff_member(db, current_user.org_id, user_id), year)


@router.put("/personal/{user_id}", response_model=PersonalFrameworkOut)
def save_personal_framework(user_id: int, payload: PersonalFrameworkSave, db: DbSession, current_user: CurrentUser,
                            background_tasks: BackgroundTasks, period: Optional[str] = Query(default=None)):
    """Create or update the staff member's personal framework and apply it to
    their goal sheet now. Rows named by `item_id` keep their goal text and
    reviews; KPIs can be added or removed only until the goals are approved."""
    _require_admin(current_user)
    year = _personal_year(db, current_user.org_id, period)
    person = _staff_member(db, current_user.org_id, user_id)
    label = year.period_label
    existing = pf.personal_framework(db, person.org_id, person.id, label)
    base = pf.role_column(db, person.org_id, person.function_id, pf.level_of(person), label)
    if existing is None:
        _require_role_column(person, base, label)

    s = pf.goal_set_of(db, person, label)
    kpi_items = None
    before = None
    if s is not None:
        own = {it.id for it in pf.kpi_rows(s)}
        named = [k.item_id for k in payload.kpis if k.item_id is not None]
        if any(i not in own for i in named) or len(named) != len(set(named)) or (own and not named):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail=f"{person.full_name}'s goal sheet changed since the editor opened. Reload and try again.")
        kpi_items = [k.item_id for k in payload.kpis]
        try:
            pf.match_rows(s, len(payload.kpis), kpi_items)
        except pf.RowChangeLocked:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail=f"{person.full_name}'s goals are approved: you can change KPI texts and weightages, not add or remove KPIs.")
        before = pf.sheet_snapshot(s)

    fw = pf.save_personal(
        db, person=person, period_label=label, base=base, actor=current_user,
        title=payload.title.strip(), business_outcomes=payload.business_outcomes.strip(),
        functional_goals=payload.functional_goals.strip(),
        kpis=[(k.text.strip(), k.weightage) for k in payload.kpis],
        extra_goal_weightage=payload.extra_goal_weightage,
    )
    if s is not None:
        pf.apply_framework_to_set(db, s, fw, kpi_items)
        _log_sheet(db, s, current_user, "framework_personalised", before, pf.sheet_snapshot(s))
    db.commit()

    if existing is None:
        staff_message = f"The Admin personalised your {label} Project Goals framework."
        mentor_message = f"The Admin personalised the {label} Project Goals framework for {person.full_name}."
    else:
        staff_message = f"The Admin changed your personal {label} Project Goals framework."
        mentor_message = f"The Admin changed the personal {label} Project Goals framework for {person.full_name}."
    _notify_personal(db, person=person, s=s, actor=current_user, background_tasks=background_tasks,
                     staff_message=staff_message, mentor_message=mentor_message,
                     subject=f"Project Goals framework personalised ({label})")
    db.commit()
    db.expire_all()
    return _personal_out(db, _staff_member(db, current_user.org_id, user_id), year)


@router.delete("/personal/{user_id}", response_model=PersonalFrameworkOut)
def revert_personal_framework(user_id: int, db: DbSession, current_user: CurrentUser, background_tasks: BackgroundTasks,
                              period: Optional[str] = Query(default=None)):
    """Back to the role column: the sheet takes the column's KPIs by
    position (goal text and reviews stay on their rows) and the personal
    row is deleted. After approval only while the KPI counts match."""
    _require_admin(current_user)
    year = _personal_year(db, current_user.org_id, period)
    person = _staff_member(db, current_user.org_id, user_id)
    label = year.period_label
    fw = pf.personal_framework(db, person.org_id, person.id, label)
    if fw is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{person.full_name} has no personal framework for {label}.")
    base = _require_role_column(person, pf.role_column(db, person.org_id, person.function_id, pf.level_of(person), label), label)

    s = pf.goal_set_of(db, person, label)
    if s is not None:
        before = pf.sheet_snapshot(s)
        try:
            pf.apply_framework_to_set(db, s, base)
        except pf.RowChangeLocked:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail=(f"{person.full_name}'s goals are approved with {len(pf.kpi_rows(s))} KPIs and the role column has "
                                        f"{len(base.kpis)}; KPIs cannot be added or removed after approval. Edit the personal framework instead."))
        _log_sheet(db, s, current_user, "framework_reverted", before, pf.sheet_snapshot(s))
    db.delete(fw)
    db.commit()

    _notify_personal(db, person=person, s=s, actor=current_user, background_tasks=background_tasks,
                     staff_message=f"Your {label} Project Goals framework is back to the standard for your role.",
                     mentor_message=f"{person.full_name}'s {label} Project Goals framework is back to the standard for their role.",
                     subject=f"Project Goals framework back to standard ({label})")
    db.commit()
    db.expire_all()
    return _personal_out(db, _staff_member(db, current_user.org_id, user_id), year)


# ── Designations → levels ────────────────────────────────────────────

@router.patch("/designations/{designation_id}", response_model=DesignationBriefOut)
def update_designation(designation_id: int, payload: DesignationLevelUpdate, db: DbSession, current_user: CurrentUser):
    """Change a designation's level (1..MAX_LEVEL) and/or rename it."""
    _require_admin(current_user)
    d = db.query(Designation).filter(Designation.id == designation_id, Designation.org_id == current_user.org_id).first()
    if d is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Designation not found.")
    if payload.career_level is not None:
        d.career_level = payload.career_level
        d.career_level_label = career_level_label(payload.career_level)
        d.level = payload.career_level
    if payload.name is not None:
        name = payload.name.strip()
        clash = db.query(Designation).filter(Designation.org_id == current_user.org_id, Designation.id != d.id, Designation.name == name).first()
        if clash is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"A designation named '{name}' already exists.")
        d.name = name
    db.commit()
    db.refresh(d)
    from app.core.cache import designations_cache
    designations_cache.invalidate(current_user.org_id)
    return DesignationBriefOut.model_validate(d)


# ── Mapping ──────────────────────────────────────────────────────────

@router.get("/mapping", response_model=list[MappingRowOut])
def mapping(db: DbSession, current_user: CurrentUser, period: Optional[str] = Query(default=None)):
    _require_admin(current_user)
    period_label = _resolve_period(db, current_user.org_id, period)
    employees = (
        db.query(User)
        .options(joinedload(User.function), joinedload(User.designation), joinedload(User.mentor))
        .filter(User.org_id == current_user.org_id, User.role == Role.STAFF.value, User.is_deleted.is_(False))
        .order_by(User.full_name)
        .all()
    )
    defined = {
        (fw.function_id, fw.level)
        for fw in db.query(GoalFramework.function_id, GoalFramework.level)
        .filter(GoalFramework.org_id == current_user.org_id, GoalFramework.period_label == period_label, GoalFramework.user_id.is_(None))
        .all()
    }
    personal = pf.personal_by_user(db, current_user.org_id, period_label)
    sets_by_user = {
        s.user_id: s.status
        for s in db.query(ProjectGoalSet.user_id, ProjectGoalSet.status)
        .filter(ProjectGoalSet.org_id == current_user.org_id, ProjectGoalSet.period_label == period_label)
        .all()
    }
    out: list[MappingRowOut] = []
    for u in employees:
        level = u.designation.career_level if u.designation else None
        if u.function_id is None:
            st = "no_function"
        elif level is None:
            st = "no_designation"
        elif (u.function_id, level) in defined or u.id in personal:
            st = "mapped"
        else:
            st = "no_framework"
        out.append(MappingRowOut(
            user_id=u.id, full_name=u.full_name, email=u.email,
            function_id=u.function_id, function_name=u.function.name if u.function else None,
            designation_id=u.designation_id, designation_name=u.designation.name if u.designation else None,
            level=level, level_label=career_level_label(level),
            mentor_id=u.mentor_id, mentor_name=u.mentor.full_name if u.mentor else None,
            miltenyi_reviewer_name=u.miltenyi_reviewer_name, status=st,
            has_active_set=u.id in sets_by_user, active_set_status=sets_by_user.get(u.id),
            personalised=u.id in personal,
        ))
    return out


# ── Period switches ──────────────────────────────────────────────────

@router.get("/periods", response_model=list[PeriodBriefOut])
def list_goal_periods(db: DbSession, current_user: CurrentUser):
    """Every configured goal year, newest first — the System Settings dropdown.
    Like the Healthark PMS, no future year is offered: a year is configured
    once the quarter roll-out has moved into it."""
    _require_admin(current_user)
    return periods.period_briefs(db, current_user.org_id)


@router.get("/settings", response_model=PeriodSettingsOut)
def get_period_settings(db: DbSession, current_user: CurrentUser, period: Optional[str] = Query(default=None)):
    _require_admin(current_user)
    period_label = _resolve_period(db, current_user.org_id, period)
    row = periods.period_by_label(db, current_user.org_id, period_label)
    if row is None:
        # Not persisted yet: report the defaults the PATCH would create.
        return PeriodSettingsOut(period_label=period_label, is_active=False, entry_open=True, weightages_visible=True)
    return periods.period_out(db, row)


@router.get("/settings/preflight", response_model=PeriodPreflightOut)
def period_preflight(db: DbSession, current_user: CurrentUser, period: Optional[str] = Query(default=None)):
    """Counts behind the Save confirmation: who is mid-entry, and per started
    quarter how many self-reviews / reviews are still pending or submitted."""
    _require_admin(current_user)
    period_label = _resolve_period(db, current_user.org_id, period)
    org_id = current_user.org_id
    staff_total = db.query(User).filter(User.org_id == org_id, User.role == Role.STAFF.value, User.is_deleted.is_(False)).count()
    sets = db.query(ProjectGoalSet).filter(ProjectGoalSet.org_id == org_id, ProjectGoalSet.period_label == period_label).all()
    by_status = {"draft": 0, "submitted": 0, "approved": 0}
    for st in sets:
        by_status[st.status] = by_status.get(st.status, 0) + 1
    approved_ids = [st.id for st in sets if st.status == "approved"]
    row = periods.period_by_label(db, org_id, period_label)
    quarters: list[QuarterPreflightOut] = []
    if row is not None:
        for q in periods.started_quarters(db, row):
            reviews = (
                db.query(ProjectGoalReview)
                .filter(ProjectGoalReview.org_id == org_id, ProjectGoalReview.cycle_label == q.cycle_label, ProjectGoalReview.set_id.in_(approved_ids))
                .all()
                if approved_ids else []
            )
            self_done = sum(1 for r in reviews if not r.self_is_draft)
            review_done = sum(1 for r in reviews if not r.review_is_draft)
            quarters.append(QuarterPreflightOut(
                seq=q.seq, cycle_label=q.cycle_label,
                self_pending=max(len(approved_ids) - self_done, 0),
                review_pending=max(len(approved_ids) - review_done, 0),
                reviews_submitted=review_done,
            ))
    return PeriodPreflightOut(
        period_label=period_label, staff_total=staff_total, staff_without_set=max(staff_total - len(sets), 0),
        sets_draft=by_status.get("draft", 0), sets_submitted=by_status.get("submitted", 0), sets_approved=by_status.get("approved", 0),
        quarters=quarters,
    )


@router.patch("/settings", response_model=PeriodSettingsOut)
def update_period_settings(payload: PeriodSettingsUpdate, db: DbSession, current_user: CurrentUser, period: Optional[str] = Query(default=None)):
    _require_admin(current_user)
    period_label = _resolve_period(db, current_user.org_id, period)
    row = periods.period_by_label(db, current_user.org_id, period_label)
    if row is None:
        row = ProjectGoalPeriodSettings(org_id=current_user.org_id, period_label=period_label, is_active=False)
        db.add(row)
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        if value is not None:
            setattr(row, field, value)
    row.updated_by_id = current_user.id
    if "extra_goal_enabled" in data:
        # Draft sets follow the year's switch; submitted sets keep their snapshot.
        _sync_extra_rows(db, row)
    if data.get("is_active"):
        db.query(ProjectGoalPeriodSettings).filter(
            ProjectGoalPeriodSettings.org_id == current_user.org_id,
            ProjectGoalPeriodSettings.period_label != period_label,
        ).update({ProjectGoalPeriodSettings.is_active: False})
    db.commit()
    db.refresh(row)
    return periods.period_out(db, row)


def _sync_extra_rows(db, period: ProjectGoalPeriodSettings) -> None:
    """Keep the DRAFT sets of a year in step with its "Additional goals" switch:
    add the row (at the framework column's weightage) when the Admin enables it,
    drop it again when disabled and still empty. Submitted / approved sets keep
    their snapshot."""
    from app.models.project_goal_models import EXTRA_GOAL_LABEL, ProjectGoalItem
    drafts = db.query(ProjectGoalSet).filter(
        ProjectGoalSet.org_id == period.org_id, ProjectGoalSet.period_label == period.period_label, ProjectGoalSet.status == "draft",
    ).all()
    for st in drafts:
        extra = next((it for it in st.items if it.is_extra), None)
        weight = st.framework.extra_goal_weightage if st.framework is not None else 10
        if period.extra_goal_enabled:
            if extra is None:
                seq = max((it.seq for it in st.items), default=0) + 1
                db.add(ProjectGoalItem(set_id=st.id, seq=seq, kpi_id=None, kpi_text=EXTRA_GOAL_LABEL, weightage=weight, is_extra=True))
            else:
                extra.weightage = weight
        elif extra is not None and not (extra.goal_text or "").strip():
            db.delete(extra)
    db.flush()


# ── Quarter roll-out ─────────────────────────────────────────────────

def _next_of(period: Optional[ProjectGoalPeriodSettings], fallback_label: str) -> tuple[int, str, bool]:
    """(next_seq, next_period_label, crosses_year) for the roll-out button."""
    if period is None or not period.current_quarter_seq:
        return 1, (period.period_label if period else fallback_label), False
    if period.current_quarter_seq < QUARTER_SEQS[-1]:
        return period.current_quarter_seq + 1, period.period_label, False
    return 1, next_period_label(period.period_label), True


def _previous_of(db, period: Optional[ProjectGoalPeriodSettings]) -> Optional[str]:
    """Roll-back target: one quarter earlier than the current one. Q1 goes to
    Q4 of the previous year when that period exists; None at the very start."""
    if period is None or not period.current_quarter_seq:
        return None
    if period.current_quarter_seq > 1:
        return quarter_label(period.period_label, period.current_quarter_seq - 1)
    try:
        prev_label = previous_period_label(period.period_label)
    except ValueError:
        return None
    return quarter_label(prev_label, QUARTER_SEQS[-1]) if periods.period_by_label(db, period.org_id, prev_label) else None


def _cycle_status(db, org_id: int) -> CycleStatusOut:
    period = periods.active_period(db, org_id)
    fallback = _resolve_period(db, org_id, None)
    next_seq, next_plabel, crosses = _next_of(period, fallback)
    current = periods.current_label(period)
    return CycleStatusOut(
        period_label=period.period_label if period else fallback,
        current_seq=period.current_quarter_seq if period else None,
        current_label=current,
        next_seq=next_seq,
        next_label=quarter_label(next_plabel, next_seq),
        next_period_label=next_plabel,
        crosses_year=crosses,
        requires_typed_confirmation=crosses,
        previous_label=_previous_of(db, period),
        quarters=periods.period_out(db, period).quarters if period else [],
    )


def _copy_frameworks(db, org_id: int, from_label: str, to_label: str, actor_id: int) -> int:
    """Carry the framework rows of one period into the next (the goal themes
    do not change year to year unless the Admin edits them). Rows already
    present in the target period are left alone."""
    existing = {
        (fw.function_id, fw.level)
        for fw in db.query(GoalFramework.function_id, GoalFramework.level)
        .filter(GoalFramework.org_id == org_id, GoalFramework.period_label == to_label, GoalFramework.user_id.is_(None)).all()
    }
    copied = 0
    # Role columns only: personal frameworks stay with their year (16 Oct
    # 2026); the editor offers last year's when the Admin customises again.
    for fw in db.query(GoalFramework).filter(GoalFramework.org_id == org_id, GoalFramework.period_label == from_label, GoalFramework.user_id.is_(None)).all():
        if (fw.function_id, fw.level) in existing:
            continue
        clone = GoalFramework(
            org_id=org_id, function_id=fw.function_id, level=fw.level, period_label=to_label,
            title=fw.title, business_outcomes=fw.business_outcomes, functional_goals=fw.functional_goals,
            created_by_id=actor_id, extra_goal_weightage=fw.extra_goal_weightage,
        )
        db.add(clone)
        db.flush()
        for k in fw.kpis:
            db.add(GoalFrameworkKpi(framework_id=clone.id, seq=k.seq, text=k.text, weightage=k.weightage))
        copied += 1
    db.flush()
    return copied


def _activate_period(db, org_id: int, period_label: str, actor: User, template: Optional[ProjectGoalPeriodSettings]) -> ProjectGoalPeriodSettings:
    """Make `period_label` the review year. A brand-new year is created ALL
    CLOSED (goal entry off — the Admin opens it when the framework is ready),
    with the framework rows carried over from `template`'s year. Rolling back
    to an existing year keeps its saved configuration (Healthark PMS model).
    The year being left keeps `backfill_open` as it is, so its started
    quarters stay writable until the Admin closes that year."""
    row = periods.period_by_label(db, org_id, period_label)
    if row is None:
        row = ProjectGoalPeriodSettings(
            org_id=org_id, period_label=period_label, is_active=True, entry_open=False, backfill_open=True,
            weightages_visible=template.weightages_visible if template else True,
            extra_goal_enabled=template.extra_goal_enabled if template else False,
            updated_by_id=actor.id,
        )
        db.add(row)
        db.flush()
        if template is not None:
            _copy_frameworks(db, org_id, template.period_label, period_label, actor.id)
    db.query(ProjectGoalPeriodSettings).filter(
        ProjectGoalPeriodSettings.org_id == org_id, ProjectGoalPeriodSettings.period_label != period_label,
    ).update({ProjectGoalPeriodSettings.is_active: False})
    row.is_active = True
    row.updated_by_id = actor.id
    return row


def _move_to(db, actor: User, target_label: str, kind: str) -> CycleStatusOut:
    """Shared body of rollout / set / rollback: point the org at `target_label`,
    make sure the quarter rows up to it exist, log the move, announce it."""
    org_id = actor.org_id
    seq, plabel = parse_quarter_label(target_label)
    period = periods.active_period(db, org_id)
    from_label = periods.current_label(period)
    if from_label == target_label:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{quarter_display(target_label)} is already the current quarter.")

    new_year = period is None or period.period_label != plabel
    if new_year:
        period = _activate_period(db, org_id, plabel, actor, template=period)
    period.current_quarter_seq = seq
    period.updated_by_id = actor.id
    periods.ensure_quarter_rows(db, period, seq, actor.id)
    db.add(ProjectGoalCycleLog(org_id=org_id, from_label=from_label, to_label=target_label, kind=kind, actor_id=actor.id))
    db.commit()
    # One calendar, one roll-out (25 Sep 2026): annual goals and reviews
    # follow the quarter - Q1-Q2 are H1, Q3-Q4 are H2, a new goal year is
    # a new annual year. Refresh the cached label now so nobody has to wait
    # for the next settings read.
    settings_row = db.query(SystemSettings).filter(SystemSettings.org_id == org_id).first()
    annual_before = settings_row.active_cycle_name if settings_row else None
    annual_after = sync_annual_cycle(db, settings_row) if settings_row else None
    annual_note = (
        f" Annual goals and reviews are now in {year_display(annual_after)}."
        if annual_after and annual_after != annual_before else ""
    )

    # Announcement (bell only): every active user in the org.
    shown = quarter_display(target_label)
    if new_year:
        message = (f"Project Goals moved to {shown}. {plabel} is the new goal year — goal entry opens once the Admin "
                   f"releases it{f'; {from_label.split(chr(32), 1)[1]} stays open for backfill until it is closed' if from_label else ''}.")
    elif kind == "rollback":
        message = f"Project Goals moved back to {shown}. Quarters after it are closed again."
    else:
        message = (f"Project Goals moved to {shown}. Self-reviews and Miltenyi reviews for {shown} are open; "
                   f"earlier quarters of {plabel} stay open for backfill.")
    message += annual_note
    recipients = [uid for (uid,) in db.query(User.id).filter(User.org_id == org_id, User.is_deleted.is_(False)).all()]
    notify_many(
        db, org_id=org_id, recipient_ids=recipients, sender_id=actor.id,
        module="project_goal", entity_type="project_goal_cycle", entity_id=None,
        message=message, entity_url="/project-goals",
    )
    db.commit()
    return _cycle_status(db, org_id)


@router.get("/cycle", response_model=CycleStatusOut)
def cycle_status(db: DbSession, current_user: CurrentUser):
    _require_admin(current_user)
    return _cycle_status(db, current_user.org_id)


@router.post("/cycle/rollout", response_model=CycleStatusOut)
def cycle_rollout(payload: CycleRolloutRequest, db: DbSession, current_user: CurrentUser):
    """Advance one quarter. Q4 → Q1 of the next goal year: the new year is
    created all closed (frameworks carried over, goal entry off until the
    Admin opens it), the old year stops being the review year but stays open
    for backfill; the Admin must type the new year's label to confirm."""
    _require_admin(current_user)
    st = _cycle_status(db, current_user.org_id)
    if st.requires_typed_confirmation and (payload.confirmation or "").strip() != st.next_period_label:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Rolling out {quarter_display(st.next_label)} starts a new goal year. Type '{st.next_period_label}' to confirm.")
    return _move_to(db, current_user, st.next_label, "rollout")


@router.post("/cycle/set", response_model=CycleStatusOut)
def cycle_set(payload: CycleSetRequest, db: DbSession, current_user: CurrentUser):
    """Set the current quarter directly (first live quarter, corrections).
    Moving backwards closes the later quarters again; a label in another year
    activates (or creates) that period."""
    _require_admin(current_user)
    try:
        parse_quarter_label(payload.target_label)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use a quarter label such as 'Q2 CY 26-27'.")
    return _move_to(db, current_user, payload.target_label.strip(), "set")


@router.post("/cycle/rollback", response_model=CycleStatusOut)
def cycle_rollback(db: DbSession, current_user: CurrentUser):
    """Move one quarter back (Q1 goes to Q4 of the previous goal year)."""
    _require_admin(current_user)
    st = _cycle_status(db, current_user.org_id)
    if not st.previous_label:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="There is no earlier quarter to roll back to.")
    return _move_to(db, current_user, st.previous_label, "rollback")


@router.get("/cycle/log", response_model=list[CycleLogOut])
def cycle_log(db: DbSession, current_user: CurrentUser, limit: int = Query(default=20, ge=1, le=100)):
    _require_admin(current_user)
    rows = (
        db.query(ProjectGoalCycleLog)
        .options(joinedload(ProjectGoalCycleLog.actor))
        .filter(ProjectGoalCycleLog.org_id == current_user.org_id)
        .order_by(ProjectGoalCycleLog.id.desc())
        .limit(limit)
        .all()
    )
    return [CycleLogOut(id=r.id, from_label=r.from_label, to_label=r.to_label, kind=r.kind,
                        actor_name=r.actor.full_name if r.actor else None, created_at=r.created_at) for r in rows]


@router.patch("/quarters/{seq}", response_model=QuarterOut)
def update_quarter(seq: int, payload: QuarterUpdate, db: DbSession, current_user: CurrentUser, period: Optional[str] = Query(default=None)):
    """One quarter's switches: release (or hide) its final ratings to staff,
    open or close it for backfill — for the active year by default, or the
    year named by `period`. The current quarter cannot be closed."""
    _require_admin(current_user)
    period = periods.period_by_label(db, current_user.org_id, period) if period else periods.active_period(db, current_user.org_id)
    if period is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such Project Goals period.")
    quarter = periods.quarter_by_label(db, period, quarter_label(period.period_label, seq)) if seq in QUARTER_SEQS else None
    if quarter is None or not periods.has_started(period, quarter):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Q{seq} has not started in {period.period_label}.")
    if payload.ratings_visible is None and payload.backfill_open is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Nothing to change.")
    if payload.backfill_open is not None:
        if period.is_active and quarter.seq == period.current_quarter_seq and not payload.backfill_open:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                                detail=f"{quarter_display(quarter.cycle_label)} is the current quarter — the review window itself. Roll the quarter forward or back instead of closing it.")
        quarter.backfill_open = payload.backfill_open
    if payload.ratings_visible is not None:
        quarter.ratings_visible = payload.ratings_visible
    db.commit()
    db.refresh(quarter)
    return QuarterOut(seq=quarter.seq, cycle_label=quarter.cycle_label, ratings_visible=quarter.ratings_visible, backfill_open=quarter.backfill_open,
                      is_current=(period.is_active and quarter.seq == period.current_quarter_seq), opened_at=quarter.opened_at)
