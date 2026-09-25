"""
Goal Framework Routes (Admin) — the Miltenyi "Indicative Goal Themes"
content behind Project Goals, the staff mapping view, the period switches and
the quarter roll-out. Mounted at /api/v1/admin/goal-frameworks.

    GET    /                         matrix for a period: every function with its designations (by level) and rows
    POST   /                         add one role/level row ("Add Function" in the UI) with its KPIs
    PUT    /{row_id}                 replace title, paragraphs and KPI list (weights must total 100)
    DELETE /{row_id}                 remove a row nobody has a goal set against
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

Guards: CurrentUser + the `project_goals` feature gate on the router; every
route additionally requires role Admin.
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
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
    ProjectGoalCycleLog,
    ProjectGoalPeriodSettings,
    ProjectGoalReview,
    ProjectGoalSet,
    next_period_label,
    parse_quarter_label,
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
    PeriodPreflightOut,
    PeriodSettingsOut,
    PeriodSettingsUpdate,
    QuarterOut,
    QuarterPreflightOut,
    QuarterUpdate,
)
from app.services import project_goal_periods as periods
from app.services.notification_service import notify_many

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
    if not 1 <= payload.level <= MAX_LEVEL:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Levels run 1 to {MAX_LEVEL}.")
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
        .filter(GoalFramework.org_id == current_user.org_id, GoalFramework.period_label == period_label)
        .all()
    }
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
        elif (u.function_id, level) in defined:
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
    if "extra_goal_enabled" in data or "extra_goal_weightage" in data:
        # Draft sets follow the year's setting; submitted sets keep their snapshot.
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
    """Keep the DRAFT sets of a year in step with its "Additional goals" row:
    add the row when the Admin enables it, update its weightage, drop it again
    when disabled and still empty. Submitted / approved sets keep their snapshot."""
    from app.models.project_goal_models import EXTRA_GOAL_LABEL, ProjectGoalItem
    drafts = db.query(ProjectGoalSet).filter(
        ProjectGoalSet.org_id == period.org_id, ProjectGoalSet.period_label == period.period_label, ProjectGoalSet.status == "draft",
    ).all()
    for st in drafts:
        extra = next((it for it in st.items if it.is_extra), None)
        if period.extra_goal_enabled:
            if extra is None:
                seq = max((it.seq for it in st.items), default=0) + 1
                db.add(ProjectGoalItem(set_id=st.id, seq=seq, kpi_id=None, kpi_text=EXTRA_GOAL_LABEL, weightage=period.extra_goal_weightage, is_extra=True))
            else:
                extra.weightage = period.extra_goal_weightage
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
            extra_goal_weightage=template.extra_goal_weightage if template else 10,
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
