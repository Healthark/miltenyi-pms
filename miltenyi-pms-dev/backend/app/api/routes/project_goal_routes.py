"""
Project Goals Routes — one goal set per staff member per period (calendar
year), against the Miltenyi "Indicative Goal Themes" framework; one review per
QUARTER against those same goals.

    Staff
        GET  /project-goals/period                 one goal year + started quarters (any role; ?period=, default active)
        GET  /project-goals/periods                every goal year (the year selector; staff also see has_set)
        GET  /project-goals/me                     one goal year (?period=): framework · own set with every quarter's review · year list
        POST /project-goals/me                     create the draft set (items snapshot the KPIs)
        PUT  /project-goals/me/items               save goal texts (draft)
        POST /project-goals/me/submit              draft → submitted (records the offline agreement)
        PUT  /project-goals/me/self-review         save self texts + self rating for one quarter (draft)
        POST /project-goals/me/self-review/submit  submit one quarter's self-review
        POST /project-goals/me/acknowledge         read receipt on one quarter's final review

    Mentor (own mentees) · Admin (all)
        GET  /project-goals/team?period=&cycle=    queue rows for one year / quarter (default: active year, current quarter)
        GET  /project-goals/sets/{id}              full set
        GET  /project-goals/sets/{id}/log          change log
        POST /project-goals/sets/{id}/approve      submitted → approved (agreed offline) — once a year
        PUT  /project-goals/sets/{id}/review       one quarter: Miltenyi comments, secondary review, provenance, final rating (draft only)
        POST /project-goals/sets/{id}/review/submit  submit one quarter's review (Admin may force past a missing self-review)
        POST /project-goals/sets/{id}/unlock       Admin only, reason logged (goals, or one quarter's review)

The review window is the Admin-advanced current quarter (System Settings →
Project Goals): a quarter is writable while the period is active and its
seq is at or before the current one, so earlier quarters of the year stay
open for backfill and future quarters are closed. Nothing is tracked per
trial or project.

Security: CurrentUser (JWT) + the `project_goals` feature gate on the whole
router; every query is scoped to current_user.org_id; mentor actions require
`owner.mentor_id == current_user.id`; Admin reads everything and unlocks.

Notifications are in-app + email (`module="project_goal"`), written after
the primary commit. Every state change and every post-submission edit
writes a ProjectGoalChangeLog row with a before/after snapshot and the
quarter it concerns.
"""

import json
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from sqlalchemy.orm import joinedload

from app.api.dependencies import CurrentUser, DbSession
from app.core.features import require_feature
from app.models.project_goal_models import (
    EXTRA_GOAL_LABEL,
    FinalRatingBy,
    GoalFramework,
    ProjectGoalChangeLog,
    ProjectGoalItem,
    ProjectGoalPeriodSettings,
    ProjectGoalQuarter,
    ProjectGoalReview,
    ProjectGoalReviewItem,
    ProjectGoalSet,
    ProjectGoalSetStatus,
    parse_quarter_label,
    quarter_display,
)
from app.models.user_models import Role, User
from app.schemas.project_goal_schemas import (
    ApproveRequest,
    ChangeLogOut,
    CycleRef,
    FrameworkKpiOut,
    FrameworkRowOut,
    GoalItemOut,
    GoalItemsUpdate,
    GoalSetOut,
    MyProjectGoalsOut,
    PeriodBriefOut,
    PeriodSettingsOut,
    ReviewItemOut,
    ReviewOut,
    ReviewUpdate,
    SelfReviewUpdate,
    TeamRowOut,
    UnlockRequest,
)
from app.services import project_goal_periods as periods
from app.services.notification_service import notify

router = APIRouter(dependencies=[Depends(require_feature("project_goals"))])

S = ProjectGoalSetStatus


# ── Small helpers ────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _is_hr(user: User) -> bool:
    return user.role == Role.ADMIN.value


def _require_employee(user: User) -> None:
    if user.role != Role.STAFF.value:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only staff members have a project goal set.")


def _require_mentor_or_hr(user: User) -> None:
    if user.role not in (Role.MENTOR.value, Role.ADMIN.value):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only mentors and Admins can access team goal sets.")


def _require_period(db, org_id: int) -> ProjectGoalPeriodSettings:
    period = periods.active_period(db, org_id)
    if period is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active Project Goals period is configured. Ask the Admin.")
    return period


def _target_period(db, org_id: int, period_label: Optional[str]) -> ProjectGoalPeriodSettings:
    """The goal year a request names (`?period=`), else the active one."""
    if period_label:
        row = periods.period_by_label(db, org_id, period_label.strip())
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No Project Goals year called '{period_label}'.")
        return row
    return _require_period(db, org_id)


def _period_of_label(db, org_id: int, cycle_label: str) -> ProjectGoalPeriodSettings:
    """The goal year a quarter label belongs to ("Q3 CY 26-27" -> CY 26-27)."""
    try:
        _seq, plabel = parse_quarter_label(cycle_label)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"'{cycle_label}' is not a quarter label (expected e.g. 'Q3 CY 26-27').")
    row = periods.period_by_label(db, org_id, plabel)
    if row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No Project Goals year called '{plabel}'.")
    return row


def _framework_for(db, org_id: int, function_id: Optional[int], level: Optional[int], period_label: str) -> Optional[GoalFramework]:
    if function_id is None or level is None:
        return None
    return (
        db.query(GoalFramework)
        .filter(
            GoalFramework.org_id == org_id,
            GoalFramework.function_id == function_id,
            GoalFramework.level == level,
            GoalFramework.period_label == period_label,
        )
        .first()
    )


def _framework_missing_reason(user: User, framework: Optional[GoalFramework]) -> Optional[str]:
    if framework is not None:
        return None
    if user.function_id is None or user.function is None:
        return "No function is recorded on your profile."
    if user.designation is None or user.designation.career_level is None:
        return "Your designation has no framework level yet."
    return f"No {user.function.name} framework row exists for level {user.designation.career_level} in this period."


def _framework_out(fw: GoalFramework, show_weights: bool) -> FrameworkRowOut:
    return FrameworkRowOut(
        id=fw.id,
        function_id=fw.function_id,
        function_name=fw.function.name if fw.function else "",
        level=fw.level,
        period_label=fw.period_label,
        title=fw.title,
        business_outcomes=fw.business_outcomes,
        functional_goals=fw.functional_goals,
        kpis=[FrameworkKpiOut(id=k.id, seq=k.seq, text=k.text, weightage=k.weightage if show_weights else None) for k in fw.kpis],
    )


def _seq_of(cycle_label: str) -> int:
    try:
        return parse_quarter_label(cycle_label)[0]
    except ValueError:
        return 0


def _review_for(s: ProjectGoalSet, cycle_label: str) -> Optional[ProjectGoalReview]:
    for r in s.reviews:
        if r.cycle_label == cycle_label:
            return r
    return None


def _self_started(review: ProjectGoalReview) -> bool:
    return review.self_rating is not None or any((ri.self_text or "").strip() for ri in review.items)


def _review_started(review: ProjectGoalReview) -> bool:
    return review.final_rating is not None or any((ri.primary_comment or "").strip() or (ri.healthark_note or "").strip() for ri in review.items)


def _step(started: bool, is_draft: bool) -> str:
    if not is_draft:
        return "submitted"
    return "draft" if started else "not_started"


def _review_out(review: ProjectGoalReview, is_owner: bool, period: Optional[ProjectGoalPeriodSettings], quarter: Optional[ProjectGoalQuarter]) -> ReviewOut:
    """Per-quarter redaction: the staff member's self-review is private until
    submitted; the Miltenyi comments reach the staff member only once the
    review is submitted; the final rating additionally waits for the
    quarter's "ratings visible" switch. Mentors/Admins see everything."""
    review_public = not review.review_is_draft
    self_public = not review.self_is_draft
    ratings_released = bool(quarter and quarter.ratings_visible)
    hide_final = is_owner and (not review_public or not ratings_released)
    show_self = is_owner or self_public
    show_comments = (not is_owner) or review_public
    return ReviewOut(
        id=review.id, cycle_label=review.cycle_label, seq=_seq_of(review.cycle_label),
        writable=periods.is_writable(period, quarter),
        self_status=_step(_self_started(review), review.self_is_draft),
        review_status=_step(_review_started(review), review.review_is_draft),
        self_rating=review.self_rating if show_self else None,
        self_is_draft=review.self_is_draft, self_submitted_at=review.self_submitted_at,
        reviewer_id=review.reviewer_id, reviewer_name=review.reviewer.full_name if review.reviewer else None,
        entered_by_id=review.entered_by_id, entered_by_name=review.entered_by.full_name if review.entered_by else None,
        miltenyi_reviewer_name=review.miltenyi_reviewer_name if show_comments else None,
        source_received_on=review.source_received_on if not is_owner else None,
        final_rating=None if hide_final else review.final_rating,
        final_rating_hidden=hide_final and review.final_rating is not None,
        final_rating_by=review.final_rating_by,
        review_is_draft=review.review_is_draft,
        review_submitted_at=review.review_submitted_at,
        acknowledged_at=review.acknowledged_at,
        items=[
            ReviewItemOut(
                item_id=ri.item_id,
                self_text=ri.self_text if show_self else None,
                primary_comment=ri.primary_comment if show_comments else None,
                healthark_note=ri.healthark_note if show_comments else None,
            )
            for ri in review.items
        ],
    )


def _set_out(db, s: ProjectGoalSet, viewer: User, period: Optional[ProjectGoalPeriodSettings]) -> GoalSetOut:
    owner = s.owner
    is_owner = viewer.id == owner.id
    weights_visible = (period.weightages_visible if period else True) if is_owner else True

    # The set's own period may differ from the active one (an archived year);
    # quarter rows are looked up on the set's period so redaction stays right.
    set_period = period if (period and period.period_label == s.period_label) else periods.period_by_label(db, s.org_id, s.period_label)
    quarters = {q.seq: q for q in periods.quarters_for(db, set_period)} if set_period else {}

    reviews = sorted(s.reviews, key=lambda r: _seq_of(r.cycle_label))
    mentor = owner.mentor
    return GoalSetOut(
        id=s.id, user_id=owner.id, owner_name=owner.full_name, owner_email=owner.email,
        period_label=s.period_label, status=s.status,
        framework=_framework_out(s.framework, weights_visible) if s.framework else None,
        items=[
            GoalItemOut(id=it.id, seq=it.seq, kpi_text=it.kpi_text, weightage=it.weightage if weights_visible else None, goal_text=it.goal_text, is_extra=it.is_extra)
            for it in s.items
        ],
        reviews=[_review_out(r, is_owner, set_period, quarters.get(_seq_of(r.cycle_label))) for r in reviews],
        period=periods.period_out(db, set_period) if set_period else periods.period_out(db, period) if period else _empty_period(s.period_label),
        submitted_at=s.submitted_at, approved_at=s.approved_at,
        approved_by_name=s.approved_by.full_name if s.approved_by else None,
        approved_agreed_with=s.approved_agreed_with, approved_agreed_on=s.approved_agreed_on,
        approval_note=None if is_owner else s.approval_note,
        mentor_id=owner.mentor_id, mentor_name=mentor.full_name if mentor else None,
        miltenyi_reviewer_name=owner.miltenyi_reviewer_name,
    )


def _empty_period(period_label: str) -> PeriodSettingsOut:
    return PeriodSettingsOut(period_label=period_label, is_active=False, entry_open=False, weightages_visible=True)


def _snapshot(s: ProjectGoalSet, review: Optional[ProjectGoalReview] = None) -> dict:
    return {
        "status": s.status,
        "items": [{"seq": it.seq, "goal_text": it.goal_text} for it in s.items],
        "approval": {
            "approved_agreed_with": s.approved_agreed_with,
            "approved_agreed_on": str(s.approved_agreed_on) if s.approved_agreed_on else None,
            "approval_note": s.approval_note,
        },
        "review": None if review is None else {
            "cycle_label": review.cycle_label,
            "self_rating": review.self_rating,
            "self_is_draft": review.self_is_draft,
            "final_rating": review.final_rating,
            "final_rating_by": review.final_rating_by,
            "review_is_draft": review.review_is_draft,
            "miltenyi_reviewer_name": review.miltenyi_reviewer_name,
            "source_received_on": str(review.source_received_on) if review.source_received_on else None,
            "acknowledged_at": str(review.acknowledged_at) if review.acknowledged_at else None,
            "items": [
                {"item_id": ri.item_id, "self_text": ri.self_text, "primary_comment": ri.primary_comment, "healthark_note": ri.healthark_note}
                for ri in review.items
            ],
        },
    }


def _log(db, s: ProjectGoalSet, actor: User, action: str, before: Optional[dict] = None, after: Optional[dict] = None,
         reason: Optional[str] = None, cycle_label: Optional[str] = None) -> None:
    db.add(ProjectGoalChangeLog(
        org_id=s.org_id, set_id=s.id, actor_id=actor.id, action=action, cycle_label=cycle_label,
        before=json.dumps(before, default=str) if before is not None else None,
        after=json.dumps(after, default=str) if after is not None else None,
        reason=reason,
    ))


def _notify(db, *, s: ProjectGoalSet, recipient_id: Optional[int], sender: User, message: str,
            background_tasks: Optional[BackgroundTasks], subject: str, cycle_label: Optional[str] = None) -> None:
    """In-app row + email (when SMTP is configured). Deep-links to the set
    and, when given, pre-selects the quarter."""
    if recipient_id is None:
        return
    url = f"/project-goals?set_id={s.id}"
    if cycle_label:
        url += f"&cycle={quote(cycle_label)}"
    notify(
        db, org_id=s.org_id, recipient_id=recipient_id, sender_id=sender.id,
        module="project_goal", entity_type="project_goal_set", entity_id=s.id,
        message=message, entity_url=url,
        background_tasks=background_tasks, send_email=True, email_subject=subject,
    )


def _get_set(db, set_id: int, org_id: int) -> ProjectGoalSet:
    s = (
        db.query(ProjectGoalSet)
        .options(
            joinedload(ProjectGoalSet.owner).joinedload(User.mentor),
            joinedload(ProjectGoalSet.owner).joinedload(User.function),
            joinedload(ProjectGoalSet.owner).joinedload(User.designation),
            joinedload(ProjectGoalSet.framework).joinedload(GoalFramework.function),
            joinedload(ProjectGoalSet.approved_by),
            joinedload(ProjectGoalSet.reviews).joinedload(ProjectGoalReview.reviewer),
            joinedload(ProjectGoalSet.reviews).joinedload(ProjectGoalReview.entered_by),
        )
        .filter(ProjectGoalSet.id == set_id, ProjectGoalSet.org_id == org_id)
        .first()
    )
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Goal set not found.")
    return s


def _own_set(db, user: User, period_label: str) -> Optional[ProjectGoalSet]:
    return (
        db.query(ProjectGoalSet)
        .options(
            joinedload(ProjectGoalSet.framework).joinedload(GoalFramework.function),
            joinedload(ProjectGoalSet.approved_by),
            joinedload(ProjectGoalSet.reviews).joinedload(ProjectGoalReview.reviewer),
            joinedload(ProjectGoalSet.reviews).joinedload(ProjectGoalReview.entered_by),
        )
        .filter(ProjectGoalSet.org_id == user.org_id, ProjectGoalSet.user_id == user.id, ProjectGoalSet.period_label == period_label)
        .first()
    )


def _can_view(s: ProjectGoalSet, user: User) -> bool:
    return user.id == s.user_id or _is_hr(user) or (user.role == Role.MENTOR.value and s.owner.mentor_id == user.id)


def _require_reviewer(s: ProjectGoalSet, user: User) -> None:
    """Mentor of the owner, or Admin."""
    if _is_hr(user):
        return
    if user.role == Role.MENTOR.value and s.owner.mentor_id == user.id:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only this staff member's mentor (or an Admin) can do that.")


def _resolve_quarter(db, period: ProjectGoalPeriodSettings, cycle_label: str) -> ProjectGoalQuarter:
    """The quarter a request names, checked against `period` (the set's year).
    400 for a label of another year, 409 when the quarter has not started or
    the year is closed for backfill."""
    try:
        seq, plabel = parse_quarter_label(cycle_label)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"'{cycle_label}' is not a quarter label (expected e.g. 'Q3 {period.period_label}').")
    if plabel != period.period_label:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{quarter_display(cycle_label)} is not part of {period.period_label}.")
    quarter = periods.quarter_by_label(db, period, cycle_label)
    if not periods.has_started(period, quarter):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Q{seq} has not started yet. The Admin rolls quarters out in System Settings.")
    if not periods.is_writable(period, quarter):
        if not period.is_active and not period.backfill_open:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{period.period_label} is closed: its quarters are read-only unless the Admin reopens the year for backfill in System Settings.")
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{quarter_display(cycle_label)} is closed for backfill. The Admin can reopen it in System Settings.")
    return quarter


def _get_or_create_review(db, s: ProjectGoalSet, quarter: ProjectGoalQuarter) -> ProjectGoalReview:
    review = _review_for(s, quarter.cycle_label)
    if review is None:
        review = ProjectGoalReview(
            org_id=s.org_id, set_id=s.id, cycle_label=quarter.cycle_label,
            reviewer_id=s.owner.mentor_id, miltenyi_reviewer_name=s.owner.miltenyi_reviewer_name,
            final_rating_by=FinalRatingBy.MILTENYI.value,
        )
        db.add(review)
        db.flush()
        for it in s.items:
            db.add(ProjectGoalReviewItem(review_id=review.id, item_id=it.id))
        db.flush()
        db.refresh(review)
        s.reviews.append(review)
    return review


def _review_item_map(review: ProjectGoalReview) -> dict[int, ProjectGoalReviewItem]:
    return {ri.item_id: ri for ri in review.items}


def _reviews_started(s: ProjectGoalSet) -> list[str]:
    """Quarters whose self-review or review has been submitted — goals can no
    longer be unlocked once any exist."""
    return [r.cycle_label for r in s.reviews if not r.self_is_draft or not r.review_is_draft]


# ── Everyone in the org ──────────────────────────────────────────────

@router.get("/period", response_model=Optional[PeriodSettingsOut])
def period_info(db: DbSession, current_user: CurrentUser, period: Optional[str] = Query(default=None)):
    """One goal year with its started quarters — what the quarter selector
    needs. The active year by default, or the year named by `period`. Same
    payload for staff, mentors and Admins; null when no year is active."""
    row = periods.period_by_label(db, current_user.org_id, period.strip()) if period else periods.active_period(db, current_user.org_id)
    return periods.period_out(db, row) if row else None


@router.get("/periods", response_model=list[PeriodBriefOut])
def list_periods(db: DbSession, current_user: CurrentUser):
    """Every goal year, newest first — the year selector. Staff also learn
    which years they have a goal set for."""
    for_user = current_user.id if current_user.role == Role.STAFF.value else None
    return periods.period_briefs(db, current_user.org_id, for_user_id=for_user)


# ── Staff ────────────────────────────────────────────────────────────

@router.get("/me", response_model=MyProjectGoalsOut)
def my_project_goals(db: DbSession, current_user: CurrentUser, period: Optional[str] = Query(default=None, description="Goal year, e.g. 'CY 26-27'. Defaults to the active year.")):
    _require_employee(current_user)
    briefs = periods.period_briefs(db, current_user.org_id, for_user_id=current_user.id)
    if period:
        row = periods.period_by_label(db, current_user.org_id, period.strip())
        if row is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"No Project Goals year called '{period}'.")
    else:
        row = periods.active_period(db, current_user.org_id)
    if row is None:
        return MyProjectGoalsOut(period=None, periods=briefs, framework_missing_reason="No Project Goals period is open yet.")
    period = row

    level = current_user.designation.career_level if current_user.designation else None
    fw = _framework_for(db, current_user.org_id, current_user.function_id, level, period.period_label)
    s = _own_set(db, current_user, period.period_label)
    return MyProjectGoalsOut(
        period=periods.period_out(db, period),
        periods=briefs,
        framework=_framework_out(fw, period.weightages_visible) if fw else None,
        framework_missing_reason=_framework_missing_reason(current_user, fw),
        goal_set=_set_out(db, s, current_user, period) if s else None,
        mentor_name=current_user.mentor.full_name if current_user.mentor else None,
        miltenyi_reviewer_name=current_user.miltenyi_reviewer_name,
    )


@router.post("/me", response_model=GoalSetOut, status_code=status.HTTP_201_CREATED)
def create_my_set(db: DbSession, current_user: CurrentUser, period: Optional[str] = Query(default=None)):
    """Create the draft set for a goal year (the active one by default).
    Idempotent: returns the existing set if one is already there."""
    _require_employee(current_user)
    period = _target_period(db, current_user.org_id, period)
    existing = _own_set(db, current_user, period.period_label)
    if existing is not None:
        return _set_out(db, existing, current_user, period)
    if not period.entry_open:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Goal entry is closed for this period.")

    level = current_user.designation.career_level if current_user.designation else None
    fw = _framework_for(db, current_user.org_id, current_user.function_id, level, period.period_label)
    if fw is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_framework_missing_reason(current_user, None))

    s = ProjectGoalSet(org_id=current_user.org_id, user_id=current_user.id, period_label=period.period_label,
                       framework_id=fw.id, status=S.DRAFT.value)
    db.add(s)
    db.flush()
    for k in fw.kpis:
        db.add(ProjectGoalItem(set_id=s.id, seq=k.seq, kpi_id=k.id, kpi_text=k.text, weightage=k.weightage))
    if period.extra_goal_enabled:
        # The optional "Additional goals" row, last, with the year's weightage.
        db.add(ProjectGoalItem(set_id=s.id, seq=max((k.seq for k in fw.kpis), default=0) + 1, kpi_id=None,
                               kpi_text=EXTRA_GOAL_LABEL, weightage=period.extra_goal_weightage, is_extra=True))
    db.commit()
    return _set_out(db, _get_set(db, s.id, current_user.org_id), current_user, period)


@router.put("/me/items", response_model=GoalSetOut)
def save_my_goals(payload: GoalItemsUpdate, db: DbSession, current_user: CurrentUser, period: Optional[str] = Query(default=None)):
    _require_employee(current_user)
    period = _target_period(db, current_user.org_id, period)
    s = _own_set(db, current_user, period.period_label)
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Create your goal set first.")
    if s.status != S.DRAFT.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Goals are locked once submitted. Ask the Admin to unlock them.")
    if not period.entry_open:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Goal entry is closed for this period.")

    by_id = {it.id: it for it in s.items}
    for row in payload.items:
        it = by_id.get(row.item_id)
        if it is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Item {row.item_id} is not part of your goal set.")
        it.goal_text = row.goal_text.strip() or None
    db.commit()
    return _set_out(db, _get_set(db, s.id, current_user.org_id), current_user, period)


@router.post("/me/submit", response_model=GoalSetOut)
def submit_my_goals(db: DbSession, current_user: CurrentUser, background_tasks: BackgroundTasks, period: Optional[str] = Query(default=None)):
    _require_employee(current_user)
    period = _target_period(db, current_user.org_id, period)
    s = _own_set(db, current_user, period.period_label)
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Create your goal set first.")
    if s.status != S.DRAFT.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="This goal set has already been submitted.")
    if not period.entry_open:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Goal entry is closed for this period.")
    missing = [it.seq for it in s.items if not it.is_extra and not (it.goal_text or "").strip()]
    if missing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Every KPI needs a goal before submitting. Empty rows: {', '.join(map(str, missing))}.")

    before = _snapshot(s)
    s.status = S.SUBMITTED.value
    s.submitted_at = _now()
    _log(db, s, current_user, "submit", before, _snapshot(s))
    db.commit()
    s = _get_set(db, s.id, current_user.org_id)
    _notify(db, s=s, recipient_id=current_user.mentor_id, sender=current_user, background_tasks=background_tasks,
            subject=f"{current_user.full_name} submitted their {s.period_label} project goals",
            message=f"{current_user.full_name} submitted their {s.period_label} project goals. Confirm the offline agreement and mark them approved.")
    db.commit()
    return _set_out(db, s, current_user, period)


@router.put("/me/self-review", response_model=GoalSetOut)
def save_my_self_review(payload: SelfReviewUpdate, db: DbSession, current_user: CurrentUser):
    _require_employee(current_user)
    period = _period_of_label(db, current_user.org_id, payload.cycle_label)
    s = _own_set(db, current_user, period.period_label)
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No goal set for this period.")
    if s.status != S.APPROVED.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The self-review opens once the goals are approved.")
    quarter = _resolve_quarter(db, period, payload.cycle_label)

    s = _get_set(db, s.id, current_user.org_id)
    review = _get_or_create_review(db, s, quarter)
    if not review.self_is_draft:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Your {quarter_display(quarter.cycle_label)} self-review is already submitted.")
    rmap = _review_item_map(review)
    valid_ids = {it.id for it in s.items}
    for row in payload.items:
        if row.item_id not in valid_ids:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Item {row.item_id} is not part of your goal set.")
        ri = rmap.get(row.item_id)
        if ri is None:
            ri = ProjectGoalReviewItem(review_id=review.id, item_id=row.item_id)
            db.add(ri)
        ri.self_text = row.self_text.strip() or None
    review.self_rating = payload.self_rating
    db.commit()
    return _set_out(db, _get_set(db, s.id, current_user.org_id), current_user, period)


@router.post("/me/self-review/submit", response_model=GoalSetOut)
def submit_my_self_review(payload: CycleRef, db: DbSession, current_user: CurrentUser, background_tasks: BackgroundTasks):
    _require_employee(current_user)
    period = _period_of_label(db, current_user.org_id, payload.cycle_label)
    s = _own_set(db, current_user, period.period_label)
    if s is None or s.status != S.APPROVED.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The self-review can be submitted once the goals are approved.")
    quarter = _resolve_quarter(db, period, payload.cycle_label)
    s = _get_set(db, s.id, current_user.org_id)
    review = _review_for(s, quarter.cycle_label)
    if review is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Write your self-review before submitting.")
    if not review.self_is_draft:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Your {quarter_display(quarter.cycle_label)} self-review is already submitted.")
    rmap = _review_item_map(review)
    missing = [it.seq for it in s.items if not it.is_extra and not ((rmap.get(it.id).self_text if rmap.get(it.id) else "") or "").strip()]
    if missing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Every KPI needs a self-review. Empty rows: {', '.join(map(str, missing))}.")
    if review.self_rating is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Give your overall rating before submitting.")

    before = _snapshot(s, review)
    review.self_is_draft = False
    review.self_submitted_at = _now()
    _log(db, s, current_user, "self_submit", before, _snapshot(s, review), cycle_label=review.cycle_label)
    db.commit()
    label = quarter_display(review.cycle_label)
    _notify(db, s=s, recipient_id=current_user.mentor_id, sender=current_user, background_tasks=background_tasks, cycle_label=review.cycle_label,
            subject=f"{current_user.full_name} submitted their {label} self-review",
            message=f"{current_user.full_name} submitted their {label} self-review. Enter {s.owner.miltenyi_reviewer_name or 'the Miltenyi reviewer'}'s comments when they arrive.")
    db.commit()
    return _set_out(db, _get_set(db, s.id, current_user.org_id), current_user, period)


@router.post("/me/acknowledge", response_model=GoalSetOut)
def acknowledge_my_review(payload: CycleRef, db: DbSession, current_user: CurrentUser):
    _require_employee(current_user)
    period = _period_of_label(db, current_user.org_id, payload.cycle_label)
    s = _own_set(db, current_user, period.period_label)
    if s is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No goal set for this period.")
    s = _get_set(db, s.id, current_user.org_id)
    review = _review_for(s, payload.cycle_label)
    if review is None or review.review_is_draft:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="There is no submitted review to acknowledge for that quarter yet.")
    if review.acknowledged_at is None:
        review.acknowledged_at = _now()
        _log(db, s, current_user, "acknowledge", cycle_label=review.cycle_label)
        db.commit()
    return _set_out(db, _get_set(db, s.id, current_user.org_id), current_user, period)


# ── Mentor / Admin ───────────────────────────────────────────────────

@router.get("/team", response_model=list[TeamRowOut])
def team_goal_sets(
    db: DbSession,
    current_user: CurrentUser,
    cycle: Optional[str] = Query(default=None, description="Quarter label, e.g. 'Q3 CY 26-27'. Defaults to the year's current quarter."),
    period: Optional[str] = Query(default=None, description="Goal year, e.g. 'CY 26-27'. Defaults to the active year."),
):
    """Mentor: own mentees. Admin: every staff member. Goals column for the
    selected year; review columns for the selected quarter of that year."""
    _require_mentor_or_hr(current_user)
    if period:
        period = periods.period_by_label(db, current_user.org_id, period.strip())
        if period is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No such Project Goals year.")
    else:
        period = periods.active_period(db, current_user.org_id)

    cycle_label: Optional[str] = None
    if period is not None:
        cycle_label = cycle or periods.current_label(period)
        if cycle_label is not None:
            try:
                seq, plabel = parse_quarter_label(cycle_label)
            except ValueError:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"'{cycle_label}' is not a quarter label.")
            if plabel != period.period_label or (period.current_quarter_seq or 0) < seq:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{quarter_display(cycle_label)} is not a started quarter of {period.period_label}.")

    q = (
        db.query(User)
        .options(joinedload(User.function), joinedload(User.designation), joinedload(User.mentor))
        .filter(User.org_id == current_user.org_id, User.role == Role.STAFF.value, User.is_deleted.is_(False))
    )
    if not _is_hr(current_user):
        q = q.filter(User.mentor_id == current_user.id)
    employees = q.order_by(User.full_name).all()
    ids = [u.id for u in employees]

    sets_by_user: dict[int, ProjectGoalSet] = {}
    if period and ids:
        for s in (
            db.query(ProjectGoalSet)
            .options(joinedload(ProjectGoalSet.reviews))
            .filter(ProjectGoalSet.org_id == current_user.org_id, ProjectGoalSet.period_label == period.period_label, ProjectGoalSet.user_id.in_(ids))
            .all()
        ):
            sets_by_user[s.user_id] = s

    frameworks: dict[tuple[int, int], GoalFramework] = {}
    if period:
        for fw in db.query(GoalFramework).filter(GoalFramework.org_id == current_user.org_id, GoalFramework.period_label == period.period_label).all():
            frameworks[(fw.function_id, fw.level)] = fw

    rows: list[TeamRowOut] = []
    for u in employees:
        level = u.designation.career_level if u.designation else None
        fw = frameworks.get((u.function_id, level)) if (u.function_id and level) else None
        s = sets_by_user.get(u.id)
        review = _review_for(s, cycle_label) if (s and cycle_label) else None
        rows.append(TeamRowOut(
            set_id=s.id if s else None, user_id=u.id, full_name=u.full_name, email=u.email,
            function_name=u.function.name if u.function else None,
            designation_name=u.designation.name if u.designation else None,
            level=level, framework_title=fw.title if fw else None, has_framework=fw is not None,
            goals_status=s.status if s else "not_started",
            cycle_label=cycle_label,
            self_status=_step(_self_started(review), review.self_is_draft) if review else "not_started",
            review_status=_step(_review_started(review), review.review_is_draft) if review else "not_started",
            self_rating=review.self_rating if (review and not review.self_is_draft) else None,
            final_rating=review.final_rating if (review and not review.review_is_draft) else None,
            self_submitted_at=review.self_submitted_at if review else None,
            review_submitted_at=review.review_submitted_at if review else None,
            acknowledged_at=review.acknowledged_at if review else None,
            mentor_id=u.mentor_id, mentor_name=u.mentor.full_name if u.mentor else None,
            miltenyi_reviewer_name=u.miltenyi_reviewer_name,
        ))
    return rows


@router.get("/sets/{set_id}", response_model=GoalSetOut)
def get_goal_set(set_id: int, db: DbSession, current_user: CurrentUser):
    s = _get_set(db, set_id, current_user.org_id)
    if not _can_view(s, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You cannot view this goal set.")
    return _set_out(db, s, current_user, periods.active_period(db, current_user.org_id))


@router.get("/sets/{set_id}/log", response_model=list[ChangeLogOut])
def goal_set_log(set_id: int, db: DbSession, current_user: CurrentUser):
    s = _get_set(db, set_id, current_user.org_id)
    _require_reviewer(s, current_user)
    logs = (
        db.query(ProjectGoalChangeLog)
        .options(joinedload(ProjectGoalChangeLog.actor))
        .filter(ProjectGoalChangeLog.set_id == s.id)
        .order_by(ProjectGoalChangeLog.id.desc())
        .all()
    )
    return [ChangeLogOut(id=l.id, action=l.action, cycle_label=l.cycle_label, actor_id=l.actor_id,
                         actor_name=l.actor.full_name if l.actor else None,
                         reason=l.reason, before=l.before, after=l.after, created_at=l.created_at) for l in logs]


@router.post("/sets/{set_id}/approve", response_model=GoalSetOut)
def approve_goal_set(set_id: int, payload: ApproveRequest, db: DbSession, current_user: CurrentUser, background_tasks: BackgroundTasks):
    """Record the approval agreed offline with the Miltenyi reviewer. Locks the
    Goal column for the year."""
    s = _get_set(db, set_id, current_user.org_id)
    _require_reviewer(s, current_user)
    if s.status != S.SUBMITTED.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only a submitted goal set can be marked approved.")

    before = _snapshot(s)
    s.status = S.APPROVED.value
    s.approved_at = _now()
    s.approved_by_id = current_user.id
    s.approved_agreed_with = payload.agreed_with.strip()
    s.approved_agreed_on = payload.agreed_on
    s.approval_note = (payload.note or "").strip() or None
    _log(db, s, current_user, "approve", before, _snapshot(s))
    db.commit()
    _notify(db, s=s, recipient_id=s.user_id, sender=current_user, background_tasks=background_tasks,
            subject=f"Your {s.period_label} project goals are approved",
            message=f"Your {s.period_label} project goals were marked approved (agreed with {s.approved_agreed_with}). They are locked for the year; quarterly self-reviews run against them.")
    db.commit()
    return _set_out(db, _get_set(db, s.id, current_user.org_id), current_user, periods.active_period(db, current_user.org_id))


@router.put("/sets/{set_id}/review", response_model=GoalSetOut)
def save_review(set_id: int, payload: ReviewUpdate, db: DbSession, current_user: CurrentUser):
    """Save one quarter's Miltenyi comments (transcribed), the mentor's optional
    secondary review, provenance and final rating — as a draft. A submitted
    review is final: it cannot be edited; the Admin unlocks it instead."""
    s = _get_set(db, set_id, current_user.org_id)
    _require_reviewer(s, current_user)
    if s.status != S.APPROVED.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The review can be entered once the goals are approved.")
    period = periods.period_by_label(db, s.org_id, s.period_label)
    if period is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"This goal set belongs to {s.period_label}, which has no configuration.")
    quarter = _resolve_quarter(db, period, payload.cycle_label)

    review = _get_or_create_review(db, s, quarter)
    if not review.review_is_draft:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                            detail=f"The {quarter_display(quarter.cycle_label)} review is already submitted and cannot be edited. Ask the Admin to unlock it if it needs a correction.")

    rmap = _review_item_map(review)
    valid_ids = {it.id for it in s.items}
    for row in payload.items:
        if row.item_id not in valid_ids:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Item {row.item_id} is not part of this goal set.")
        ri = rmap.get(row.item_id)
        if ri is None:
            ri = ProjectGoalReviewItem(review_id=review.id, item_id=row.item_id)
            db.add(ri)
        ri.primary_comment = row.primary_comment.strip() or None
        ri.healthark_note = row.healthark_note.strip() or None
    review.reviewer_id = s.owner.mentor_id or current_user.id
    review.entered_by_id = current_user.id
    review.miltenyi_reviewer_name = (payload.miltenyi_reviewer_name or "").strip() or review.miltenyi_reviewer_name or s.owner.miltenyi_reviewer_name
    review.source_received_on = payload.source_received_on
    review.final_rating = payload.final_rating
    review.final_rating_by = payload.final_rating_by
    db.commit()
    return _set_out(db, _get_set(db, s.id, current_user.org_id), current_user, period)


@router.post("/sets/{set_id}/review/submit", response_model=GoalSetOut)
def submit_review(
    set_id: int,
    payload: CycleRef,
    db: DbSession,
    current_user: CurrentUser,
    background_tasks: BackgroundTasks,
    force: bool = Query(default=False, description="Admin only: submit even though the staff member has not self-reviewed this quarter."),
):
    s = _get_set(db, set_id, current_user.org_id)
    _require_reviewer(s, current_user)
    if s.status != S.APPROVED.value:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="The review can be submitted once the goals are approved.")
    period = periods.period_by_label(db, s.org_id, s.period_label)
    if period is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"This goal set belongs to {s.period_label}, which has no configuration.")
    quarter = _resolve_quarter(db, period, payload.cycle_label)
    label = quarter_display(quarter.cycle_label)

    review = _review_for(s, quarter.cycle_label)
    if review is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Enter the review before submitting.")
    if not review.review_is_draft:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"The {label} review is already submitted. Use the edit path.")
    forced = False
    if review.self_is_draft:
        if not (force and _is_hr(current_user)):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"{s.owner.full_name} has not submitted a {label} self-review. An Admin can override with force=true.")
        forced = True
    rmap = _review_item_map(review)
    missing = [it.seq for it in s.items if not it.is_extra and not ((rmap.get(it.id).primary_comment if rmap.get(it.id) else "") or "").strip()]
    if missing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Every KPI needs the Miltenyi reviewer's comment. Empty rows: {', '.join(map(str, missing))}.")
    if review.final_rating is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Give the final rating before submitting.")

    before = _snapshot(s, review)
    review.review_is_draft = False
    review.review_submitted_at = _now()
    review.entered_by_id = current_user.id
    _log(db, s, current_user, "review_submit", before, _snapshot(s, review), cycle_label=review.cycle_label,
         reason="forced past missing self-review" if forced else None)
    db.commit()
    _notify(db, s=s, recipient_id=s.user_id, sender=current_user, background_tasks=background_tasks, cycle_label=review.cycle_label,
            subject=f"Your {label} project goals review is in",
            message=f"{review.miltenyi_reviewer_name or 'Your Miltenyi reviewer'}'s {label} comments on your project goals are in, entered by {current_user.full_name}.")
    db.commit()
    return _set_out(db, _get_set(db, s.id, current_user.org_id), current_user, period)


@router.post("/sets/{set_id}/unlock", response_model=GoalSetOut)
def unlock_goal_set(set_id: int, payload: UnlockRequest, db: DbSession, current_user: CurrentUser, background_tasks: BackgroundTasks):
    """Admin only. `goals`: submitted/approved → draft (clears the approval
    record) — refused once any quarter's self-review or review has been
    submitted. `review`: one quarter's submitted review back to draft (its
    read receipt is cleared; the self-review is kept). Logged with the
    reason; staff member and mentor are notified."""
    if not _is_hr(current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only an Admin can unlock a goal set.")
    s = _get_set(db, set_id, current_user.org_id)

    if payload.target == "goals":
        if s.status not in (S.SUBMITTED.value, S.APPROVED.value):
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Goals can be unlocked while the set is submitted or approved.")
        started = _reviews_started(s)
        if started:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT,
                                detail=f"Reviews have already been submitted against these goals ({', '.join(quarter_display(c) for c in started)}). Unlock the quarter's review instead.")
        before = _snapshot(s)
        s.status = S.DRAFT.value
        s.submitted_at = None
        s.approved_at = None
        s.approved_by_id = None
        s.approved_agreed_with = None
        s.approved_agreed_on = None
        s.approval_note = None
        _log(db, s, current_user, "unlock", before, _snapshot(s), reason=payload.reason)
        what = f"{s.period_label} goals"
        cycle_label = None
    else:
        review = _review_for(s, payload.cycle_label or "")
        if review is None or review.review_is_draft:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only a submitted review can be unlocked.")
        before = _snapshot(s, review)
        review.review_is_draft = True
        review.review_submitted_at = None
        review.acknowledged_at = None
        _log(db, s, current_user, "unlock", before, _snapshot(s, review), reason=payload.reason, cycle_label=review.cycle_label)
        what = f"{quarter_display(review.cycle_label)} review"
        cycle_label = review.cycle_label

    db.commit()
    msg = f"The Admin unlocked the {what} on {s.owner.full_name}'s project goals: {payload.reason}"
    subject = f"Project goals unlocked: {what}"
    _notify(db, s=s, recipient_id=s.user_id, sender=current_user, message=msg, background_tasks=background_tasks, subject=subject, cycle_label=cycle_label)
    _notify(db, s=s, recipient_id=s.owner.mentor_id, sender=current_user, message=msg, background_tasks=background_tasks, subject=subject, cycle_label=cycle_label)
    db.commit()
    return _set_out(db, _get_set(db, s.id, current_user.org_id), current_user, periods.active_period(db, current_user.org_id))
