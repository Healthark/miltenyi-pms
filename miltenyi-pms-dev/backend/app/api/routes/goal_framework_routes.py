"""
Goal Framework Routes (Admin) — the Miltenyi "Indicative Goal Themes"
content behind Project Goals, the staff mapping view, the period switches and
the quarter roll-out. Mounted at /api/v1/admin/goal-frameworks.

    GET    /                         matrix for a period: every function with its designations (by level) and rows
    POST   /                         add one role/level row ("Add Function" in the UI) with its KPIs
    PUT    /{row_id}                 replace title, paragraphs and KPI list (weights must total 100)
    DELETE /{row_id}                 remove a row nobody has a goal set against
    PATCH  /designations/{id}        set a designation's career level (and its function)
    GET    /mapping                  Staff · Function · Designation · Level · Reviewer (Mentor) · Miltenyi reviewer · Status
    GET    /settings                 period switches + started quarters (active period by default)
    PATCH  /settings                 upsert the yearly switches; is_active=True deactivates the others
    GET    /cycle                    what the quarter roll-out card shows: current, next, roll-back target
    POST   /cycle/rollout            advance to the next quarter (Q4 → Q1 of the next year; typed confirmation)
    POST   /cycle/set                set the current quarter by label (forward or back; may start a new year)
    POST   /cycle/rollback           return to the quarter before the last move
    GET    /cycle/log                recent roll-out / set / roll-back entries
    PATCH  /quarters/{seq}           per-quarter "ratings visible to staff"

The current quarter is the review window (Healthark PMS model): quarters at
or before it are writable, later ones are closed. Every move is logged and
announced in-app to every active user.

Guards: CurrentUser + the `project_goals` feature gate on the router; every
route additionally requires role Admin.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import joinedload

from app.api.dependencies import CurrentUser, DbSession
from app.core.features import require_feature
from app.models.project_goal_models import (
    QUARTER_SEQS,
    GoalFramework,
    GoalFrameworkKpi,
    ProjectGoalCycleLog,
    ProjectGoalPeriodSettings,
    ProjectGoalSet,
    next_period_label,
    parse_quarter_label,
    quarter_display,
    quarter_label,
)
from app.models.reference_models import Designation, Function
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
    PeriodSettingsOut,
    PeriodSettingsUpdate,
    QuarterOut,
    QuarterUpdate,
)
from app.services import project_goal_periods as periods
from app.services.notification_service import notify_many

router = APIRouter(dependencies=[Depends(require_feature("project_goals"))])

LEVEL_LABEL = {1: "Entry", 2: "Mid", 3: "Senior", 4: "Lead"}
DEFAULT_PERIOD = periods.DEFAULT_PERIOD


def _require_admin(user: User) -> None:
    if user.role != Role.ADMIN.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only an Admin can manage the goal framework.")


def _active_period_label(db, org_id: int) -> Optional[str]:
    row = periods.active_period(db, org_id)
    return row.period_label if row else None


def _resolve_period(db, org_id: int, period: Optional[str]) -> str:
    return period or _active_period_label(db, org_id) or DEFAULT_PERIOD


def _row_out(fw: GoalFramework) -> FrameworkRowOut:
    return FrameworkRowOut(
        id=fw.id, function_id=fw.function_id, function_name=fw.function.name if fw.function else "",
        level=fw.level, period_label=fw.period_label, title=fw.title,
        business_outcomes=fw.business_outcomes, functional_goals=fw.functional_goals,
        kpis=[FrameworkKpiOut(id=k.id, seq=k.seq, text=k.text, weightage=k.weightage) for k in fw.kpis],
    )


def _get_row(db, row_id: int, org_id: int) -> GoalFramework:
    fw = (
        db.query(GoalFramework)
        .options(joinedload(GoalFramework.function))
        .filter(GoalFramework.id == row_id, GoalFramework.org_id == org_id)
        .first()
    )
    if fw is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Framework row not found.")
    return fw


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
        .filter(GoalFramework.org_id == current_user.org_id, GoalFramework.period_label == period_label)
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
    period_label = _resolve_period(db, current_user.org_id, payload.period_label)
    clash = (
        db.query(GoalFramework)
        .filter(GoalFramework.org_id == current_user.org_id, GoalFramework.function_id == fn.id,
                GoalFramework.level == payload.level, GoalFramework.period_label == period_label)
        .first()
    )
    if clash is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{fn.name} already has a level {payload.level} row for {period_label}. Edit it in the matrix.")

    fw = GoalFramework(
        org_id=current_user.org_id, function_id=fn.id, level=payload.level, period_label=period_label,
        title=payload.title.strip(), business_outcomes=payload.business_outcomes.strip(),
        functional_goals=payload.functional_goals.strip(), created_by_id=current_user.id,
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
    fw.title = payload.title.strip()
    fw.business_outcomes = payload.business_outcomes.strip()
    fw.functional_goals = payload.functional_goals.strip()

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
    db.commit()
    db.expire_all()
    return _row_out(_get_row(db, fw.id, current_user.org_id))


@router.delete("/{row_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_row(row_id: int, db: DbSession, current_user: CurrentUser):
    _require_admin(current_user)
    fw = _get_row(db, row_id, current_user.org_id)
    in_use = db.query(ProjectGoalSet).filter(ProjectGoalSet.framework_id == fw.id).count()
    if in_use:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{in_use} goal set(s) were created from this row; it cannot be deleted.")
    db.delete(fw)
    db.commit()
    return None


# ── Designations → levels ────────────────────────────────────────────

@router.patch("/designations/{designation_id}", response_model=DesignationBriefOut)
def set_designation_level(designation_id: int, payload: DesignationLevelUpdate, db: DbSession, current_user: CurrentUser):
    _require_admin(current_user)
    d = db.query(Designation).filter(Designation.id == designation_id, Designation.org_id == current_user.org_id).first()
    if d is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Designation not found.")
    d.career_level = payload.career_level
    d.career_level_label = LEVEL_LABEL[payload.career_level]
    db.commit()
    db.refresh(d)
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
        .filter(GoalFramework.org_id == current_user.org_id, GoalFramework.period_label == period_label)
        .all()
    }
    out: list[MappingRowOut] = []
    for u in employees:
        level = u.designation.career_level if u.designation else None
        if u.function_id is None:
            st = "no_function"
        elif level is None:
            st = "no_designation"
        elif (u.function_id, level) in defined:
            st = "mapped"
        else:
            st = "no_framework"
        out.append(MappingRowOut(
            user_id=u.id, full_name=u.full_name, email=u.email,
            function_id=u.function_id, function_name=u.function.name if u.function else None,
            designation_id=u.designation_id, designation_name=u.designation.name if u.designation else None,
            level=level, level_label=LEVEL_LABEL.get(level) if level else None,
            mentor_id=u.mentor_id, mentor_name=u.mentor.full_name if u.mentor else None,
            miltenyi_reviewer_name=u.miltenyi_reviewer_name, status=st,
        ))
    return out


# ── Period switches ──────────────────────────────────────────────────

@router.get("/settings", response_model=PeriodSettingsOut)
def get_period_settings(db: DbSession, current_user: CurrentUser, period: Optional[str] = Query(default=None)):
    _require_admin(current_user)
    period_label = _resolve_period(db, current_user.org_id, period)
    row = periods.period_by_label(db, current_user.org_id, period_label)
    if row is None:
        # Not persisted yet: report the defaults the PATCH would create.
        return PeriodSettingsOut(period_label=period_label, is_active=False, entry_open=True, weightages_visible=True)
    return periods.period_out(db, row)


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
    if data.get("is_active"):
        db.query(ProjectGoalPeriodSettings).filter(
            ProjectGoalPeriodSettings.org_id == current_user.org_id,
            ProjectGoalPeriodSettings.period_label != period_label,
        ).update({ProjectGoalPeriodSettings.is_active: False})
    db.commit()
    db.refresh(row)
    return periods.period_out(db, row)


# ── Quarter roll-out ─────────────────────────────────────────────────

def _latest_log(db, org_id: int) -> Optional[ProjectGoalCycleLog]:
    return (
        db.query(ProjectGoalCycleLog)
        .filter(ProjectGoalCycleLog.org_id == org_id)
        .order_by(ProjectGoalCycleLog.id.desc())
        .first()
    )


def _next_of(period: Optional[ProjectGoalPeriodSettings], fallback_label: str) -> tuple[int, str, bool]:
    """(next_seq, next_period_label, crosses_year) for the roll-out button."""
    if period is None or not period.current_quarter_seq:
        return 1, (period.period_label if period else fallback_label), False
    if period.current_quarter_seq < QUARTER_SEQS[-1]:
        return period.current_quarter_seq + 1, period.period_label, False
    return 1, next_period_label(period.period_label), True


def _cycle_status(db, org_id: int) -> CycleStatusOut:
    period = periods.active_period(db, org_id)
    fallback = _resolve_period(db, org_id, None)
    next_seq, next_plabel, crosses = _next_of(period, fallback)
    last = _latest_log(db, org_id)
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
        previous_label=(last.from_label if (last and last.from_label and last.from_label != current) else None),
        quarters=periods.period_out(db, period).quarters if period else [],
    )


def _copy_frameworks(db, org_id: int, from_label: str, to_label: str, actor_id: int) -> int:
    """Carry the framework rows of one period into the next (the goal themes
    do not change year to year unless the Admin edits them). Rows already
    present in the target period are left alone."""
    existing = {
        (fw.function_id, fw.level)
        for fw in db.query(GoalFramework.function_id, GoalFramework.level)
        .filter(GoalFramework.org_id == org_id, GoalFramework.period_label == to_label).all()
    }
    copied = 0
    for fw in db.query(GoalFramework).filter(GoalFramework.org_id == org_id, GoalFramework.period_label == from_label).all():
        if (fw.function_id, fw.level) in existing:
            continue
        clone = GoalFramework(
            org_id=org_id, function_id=fw.function_id, level=fw.level, period_label=to_label,
            title=fw.title, business_outcomes=fw.business_outcomes, functional_goals=fw.functional_goals,
            created_by_id=actor_id,
        )
        db.add(clone)
        db.flush()
        for k in fw.kpis:
            db.add(GoalFrameworkKpi(framework_id=clone.id, seq=k.seq, text=k.text, weightage=k.weightage))
        copied += 1
    db.flush()
    return copied


def _activate_period(db, org_id: int, period_label: str, actor: User, template: Optional[ProjectGoalPeriodSettings]) -> ProjectGoalPeriodSettings:
    """Make `period_label` the active period, creating its row (and copying
    the frameworks from `template`'s period) when it does not exist yet."""
    row = periods.period_by_label(db, org_id, period_label)
    if row is None:
        row = ProjectGoalPeriodSettings(
            org_id=org_id, period_label=period_label, is_active=True, entry_open=True,
            weightages_visible=template.weightages_visible if template else True, updated_by_id=actor.id,
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

    # Announcement (bell only): every active user in the org.
    shown = quarter_display(target_label)
    if new_year:
        message = (f"Project Goals moved to {shown}. {plabel} is the new goal year: staff set their goals for the year, "
                   f"mentors record the approvals, and quarterly reviews start with Q1.")
    elif kind == "rollback":
        message = f"Project Goals moved back to {shown}. Quarters after it are closed again."
    else:
        message = (f"Project Goals moved to {shown}. Self-reviews and Miltenyi reviews for {shown} are open; "
                   f"earlier quarters of {plabel} stay open for backfill.")
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
    """Advance one quarter. Q4 → Q1 of the next calendar year: a new period is
    created (frameworks carried over, goal entry open) and the old one is
    deactivated, so the Admin must type the new period label to confirm."""
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
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Use a quarter label such as 'Q2 CY 2026'.")
    return _move_to(db, current_user, payload.target_label.strip(), "set")


@router.post("/cycle/rollback", response_model=CycleStatusOut)
def cycle_rollback(db: DbSession, current_user: CurrentUser):
    """Return to the quarter that was current before the last move."""
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
def update_quarter(seq: int, payload: QuarterUpdate, db: DbSession, current_user: CurrentUser):
    """Release (or hide again) one quarter's final ratings to staff."""
    _require_admin(current_user)
    period = periods.active_period(db, current_user.org_id)
    if period is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active Project Goals period.")
    quarter = periods.quarter_by_label(db, period, quarter_label(period.period_label, seq)) if seq in QUARTER_SEQS else None
    if quarter is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Q{seq} has not started in {period.period_label}.")
    quarter.ratings_visible = payload.ratings_visible
    db.commit()
    db.refresh(quarter)
    return QuarterOut(seq=quarter.seq, cycle_label=quarter.cycle_label, ratings_visible=quarter.ratings_visible,
                      is_current=(quarter.seq == period.current_quarter_seq), opened_at=quarter.opened_at)
