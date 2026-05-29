"""
Dashboard Routes — The Landing Page's Data Feed.

Endpoint:
    GET /api/v1/dashboard/summary  →  Any authenticated user

Returns aggregated widget data in a single round-trip. The payload is
*role-additive*: Personal fields are always populated; Mentor fields
fall to zero when the caller has no direct mentees. The frontend gates
which widgets to render — we don't try to be clever here.

Personal layer:
    - Annual goal counts by approval state, plus criteria-driven completion %
    - Active cycle name (for the ActiveCycleWidget)
    - Caller's own AnnualReview for the active FY (id + status, or None)
    - Caller's pending project reviews as primary or secondary evaluator

Mentor layer (filled iff direct mentees exist):
    - Mentee count (drives the My Mentees tile)

Security Layers Applied:
    Layer 1 — Authentication:   CurrentUser dependency (JWT validation)
    Layer 2 — Tenant Isolation: All queries filter by current_user.org_id
    Layer 3 — Role Awareness:   Mentor counts gated on has_mentees (computed live)
    Layer 4 — Ownership:        Personal counts scoped to current_user.id
"""

from datetime import datetime, timezone
from typing import Annotated, Optional

from sqlalchemy import func, Integer, cast
from sqlalchemy.orm import joinedload
from fastapi import APIRouter, Query

from app.api.dependencies import DbSession, CurrentUser
from app.api.routes.admin_routes import _require_hr_any
from app.models.system_settings_models import SystemSettings
from app.models.goal_models import Goal, GoalType, ApprovalStatus, POST_APPROVAL_STATES
from app.models.goal_criteria_models import GoalCriterion
from app.models.user_models import User, Role
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.project_review_models import (
    ProjectReview,
    ProjectReviewEvaluator,
    ProjectReviewStatus,
    EvaluatorStatus,
)
from app.models.project_models import Project
from app.core.cycle_utils import extract_fy_label, extract_fy_year
from app.core.user_filters import active_user_ids_query
from app.schemas.dashboard_schemas import (
    AnnualReviewFunnel,
    DashboardSummary,
    DraftAnnualReviewUser,
    GoalApprovalFunnel,
    HeadcountByRole,
    HeadcountSummary,
    HrDashboardSummary,
    MentorCoverage,
    MentorLoad,
    MissingAnnualReviewUser,
    MissingAnnualReviewsSummary,
    ProjectReviewCompletion,
    StalledGoal,
    StalledGoalsSummary,
    UnmentoredEmployee,
)


# How many top-loaded mentors to surface in the mentor-coverage widget.
# Five fits comfortably in the card without scrolling for typical orgs.
_TOP_MENTORS_LIMIT = 5


# A goal in `pending_approval` is considered stalled after this many
# days without movement. Stays a constant for now; if the threshold
# proves arbitrary in practice we'll surface it on system settings.
_STALL_THRESHOLD_DAYS = 7

router = APIRouter()


@router.get("/summary", response_model=DashboardSummary)
def get_dashboard_summary(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return aggregated counts for all dashboard widgets in one shot.
    """
    # ── Active Cycle ─────────────────────────────────────────────────
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == current_user.org_id
    ).first()

    active_cycle = settings.active_cycle_name if settings else None
    # Annual reviews are tagged to the bare FY token regardless of the org's
    # half-yearly/quarterly cadence — mirror what annual_review_routes does.
    active_fy = extract_fy_label(active_cycle) if active_cycle else None

    # ── Annual Goal Counts by Approval State (single GROUP BY) ───────
    approval_rows = (
        db.query(Goal.approval_status, func.count(Goal.id))
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.user_id == current_user.id,
            Goal.goal_type == GoalType.ANNUAL.value,
        )
        .group_by(Goal.approval_status)
        .all()
    )
    counts: dict[str, int] = dict(approval_rows)

    draft_goals             = counts.get(ApprovalStatus.DRAFT.value, 0)
    submitted_goals         = counts.get(ApprovalStatus.PENDING_APPROVAL.value, 0)
    # Roll the 4 post-approval review states under the "approved" bucket so
    # the dashboard widget keeps rendering a single consolidated count.
    approved_goals          = sum(counts.get(s, 0) for s in POST_APPROVAL_STATES)
    changes_requested_goals = counts.get(ApprovalStatus.CHANGES_REQUESTED.value, 0)
    total_goals             = sum(counts.values())

    # ── Criteria-driven completion across approved annual goals ─────
    # Progress is no longer an employee-controlled field — it falls out
    # of (completed criteria / total criteria).  We average this over the
    # caller's approved annual goals, because draft/submitted goals don't
    # have meaningful progress yet.
    criteria_totals = (
        db.query(
            func.count(GoalCriterion.id).label("total"),
            func.sum(cast(GoalCriterion.is_completed, Integer)).label("done"),
        )
        .join(Goal, Goal.id == GoalCriterion.goal_id)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.user_id == current_user.id,
            Goal.goal_type == GoalType.ANNUAL.value,
            Goal.approval_status.in_(POST_APPROVAL_STATES),
        )
        .one()
    )
    total_criteria = int(criteria_totals.total or 0)
    done_criteria  = int(criteria_totals.done or 0)
    completion_percent = (
        round((done_criteria / total_criteria) * 100) if total_criteria > 0 else 0
    )

    # ── My Annual Review (current FY) ────────────────────────────────
    # One row per (org, user, cycle_name) is enforced by unique index, so the
    # first() lookup is exact. Fields stay None when no row exists — the
    # widget treats that as "not started" and shows the start CTA.
    annual_review_id: int | None = None
    annual_review_status: str | None = None
    annual_review_cycle: str | None = None
    if active_fy is not None:
        ar = (
            db.query(AnnualReview)
            .filter(
                AnnualReview.org_id == current_user.org_id,
                AnnualReview.user_id == current_user.id,
                AnnualReview.cycle_name == active_fy,
            )
            .first()
        )
        if ar is not None:
            annual_review_id = ar.id
            annual_review_status = ar.status
            annual_review_cycle = ar.cycle_name
        else:
            # No row yet, but we still want the widget to know which FY it
            # is offering to fill, so it can label the start CTA.
            annual_review_cycle = active_fy

    # ── Project Reviews where caller is an evaluator ─────────────────
    # Primary: caller is the project's PM. Status sits at PENDING (cycle just
    # opened) or DRAFT (PM saved partial work) until they submit → REVIEWED.
    #
    # We JOIN to Project and filter by `Project.pm_id` rather than the
    # tempting-but-wrong `ProjectReview.reviewer_id`. `reviewer_id` is
    # the column the system stamps when the PM SAVES or SUBMITTS the
    # row — it is NULL on every freshly-pending row (which is exactly
    # what we want to count). Filtering on `reviewer_id == current_user.id`
    # excluded every pending-but-untouched row and made the widget
    # falsely declare "all caught up" while the /pm-queue endpoint
    # (which correctly uses `Project.pm_id`) showed 4+ pending cards.
    # Excluding deleted/completed projects mirrors the queue endpoint's
    # behaviour at project_review_routes.py:625-634.
    project_reviews_pending_primary: int = (
        db.query(func.count(ProjectReview.id))
        .join(Project, Project.id == ProjectReview.project_id)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            Project.pm_id == current_user.id,
            ProjectReview.is_deleted == False,  # noqa: E712
            Project.is_deleted == False,  # noqa: E712
            ProjectReview.status.in_(
                [ProjectReviewStatus.PENDING.value, ProjectReviewStatus.DRAFT.value]
            ),
        )
        .scalar()
    ) or 0

    # Secondary: caller has a per-review impact statement that's still in DRAFT.
    # Note: a Secondary slot with no row yet is created lazily when the cycle
    # opens, so DRAFT is the canonical "owed" state.
    project_reviews_pending_secondary: int = (
        db.query(func.count(ProjectReviewEvaluator.id))
        .filter(
            ProjectReviewEvaluator.org_id == current_user.org_id,
            ProjectReviewEvaluator.evaluator_id == current_user.id,
            ProjectReviewEvaluator.status == EvaluatorStatus.DRAFT.value,
        )
        .scalar()
    ) or 0

    # ── Mentor: mentee count (drives the My Mentees tile) ────────────
    mentee_count = (
        db.query(func.count(User.id))
        .filter(
            User.mentor_id == current_user.id,
            User.org_id == current_user.org_id,
            User.is_deleted == False,  # noqa: E712
        )
        .scalar()
    ) or 0

    return DashboardSummary(
        total_goals=total_goals,
        draft_goals=draft_goals,
        submitted_goals=submitted_goals,
        approved_goals=approved_goals,
        changes_requested_goals=changes_requested_goals,
        completion_percent=completion_percent,
        active_cycle=active_cycle,
        annual_review_id=annual_review_id,
        annual_review_status=annual_review_status,
        annual_review_cycle=annual_review_cycle,
        project_reviews_pending_primary=project_reviews_pending_primary,
        project_reviews_pending_secondary=project_reviews_pending_secondary,
        mentee_count=mentee_count,
    )


# ── HR org-wide dashboard ─────────────────────────────────────────────

@router.get("/hr-summary", response_model=HrDashboardSummary)
def get_hr_dashboard_summary(
    db: DbSession,
    current_user: CurrentUser,
    fy: Annotated[Optional[int], Query()] = None,
):
    """
    Aggregated HR dashboard payload — one GET, every widget fed at once.

    Both HR roles (HR_MyOrg + HR_Miltenyi) can call this; gated by
    `_require_hr_any`. The `fy` query parameter (4-digit fiscal start
    year) is accepted today but only consumed by cycle-bound widgets
    that will be added in later iterations — the headcount widget is a
    point-in-time org snapshot and ignores it.

    Tenant isolation: every aggregate filters by `current_user.org_id`.
    """
    _require_hr_any(current_user)

    # ── Available FYs — derived from actual data, not a fixed window ──
    # Take the union of FYs that have any annual review or annual goal
    # row in this org, then include the active FY too so the picker
    # always offers the current cycle (even if no rows exist yet).
    settings = (
        db.query(SystemSettings)
        .filter(SystemSettings.org_id == current_user.org_id)
        .first()
    )
    cycle_names: set[str] = set()
    cycle_names.update(
        row[0]
        for row in (
            db.query(AnnualReview.cycle_name)
            .filter(AnnualReview.org_id == current_user.org_id)
            .distinct()
            .all()
        )
        if row[0]
    )
    cycle_names.update(
        row[0]
        for row in (
            db.query(Goal.cycle_name)
            .filter(
                Goal.org_id == current_user.org_id,
                Goal.goal_type == GoalType.ANNUAL.value,
            )
            .distinct()
            .all()
        )
        if row[0]
    )
    if settings and settings.active_cycle_name:
        cycle_names.add(settings.active_cycle_name)

    available_fys: list[int] = sorted(
        {
            year
            for year in (extract_fy_year(name) for name in cycle_names)
            if year is not None
        },
        reverse=True,
    )

    # ── Headcount: total active + by-role breakdown ───────────────────
    # Single GROUP BY scoped to the caller's org, skipping soft-deleted
    # rows. Roles outside the 5-value taxonomy (shouldn't exist but cheap
    # to guard) fall through silently.
    #
    # HR_Miltenyi viewers see the Miltenyi-only slice: Healthark's
    # Mentor and HR_MyOrg users are excluded from the counts entirely,
    # so `total_active` and `by_role.hr` reflect only the Miltenyi
    # population. The Mentor bucket falls to zero and is dropped from
    # the donut/legend on the frontend.
    role_query = (
        db.query(User.role, func.count(User.id))
        .filter(
            User.org_id == current_user.org_id,
            User.is_deleted == False,  # noqa: E712
        )
    )
    if current_user.role == Role.HR_MILTENYI.value:
        role_query = role_query.filter(
            User.role.notin_([Role.MENTOR.value, Role.HR_MYORG.value])
        )
    role_rows = role_query.group_by(User.role).all()
    role_counts: dict[str, int] = dict(role_rows)

    headcount = HeadcountSummary(
        total_active=sum(role_counts.values()),
        by_role=HeadcountByRole(
            employee=role_counts.get(Role.EMPLOYEE.value, 0),
            mentor=role_counts.get(Role.MENTOR.value, 0),
            pm=role_counts.get(Role.PM.value, 0),
            # HR chip is HR_MyOrg + HR_Miltenyi combined for HR_MyOrg
            # viewers. For HR_Miltenyi viewers the HR_MyOrg row was
            # filtered out above, so this sum collapses to just the
            # HR_Miltenyi count (themselves and their HR peers).
            hr=(
                role_counts.get(Role.HR_MYORG.value, 0)
                + role_counts.get(Role.HR_MILTENYI.value, 0)
            ),
        ),
    )

    # ── Annual Review funnel ──────────────────────────────────────────
    # Resolve the FY scope: explicit `fy` query param wins, else fall
    # back to the active FY from settings. If neither resolves we still
    # return an empty funnel so the widget can render its "no data yet"
    # state without the caller having to special-case None.
    resolved_fy = fy
    if resolved_fy is None and settings and settings.active_cycle_name:
        resolved_fy = extract_fy_year(settings.active_cycle_name)

    review_funnel = AnnualReviewFunnel(fy_year=resolved_fy)
    if resolved_fy is not None:
        # Fetch (status, cycle_name) pairs for the org and bucket in
        # Python — cycle_name format varies ("FY26", "FY26-27") so a
        # SQL prefix match would either miss rows or over-match. Annual-
        # review volume is low (one row per user per FY), so a full
        # in-memory pass is cheap.
        # Filter out rows owned by deactivated employees — they shouldn't
        # count toward HR's funnel buckets (no one will action them).
        org_review_rows = (
            db.query(AnnualReview.status, AnnualReview.cycle_name)
            .filter(
                AnnualReview.org_id == current_user.org_id,
                AnnualReview.user_id.in_(
                    active_user_ids_query(db, current_user.org_id)
                ),
            )
            .all()
        )
        status_counts: dict[str, int] = {}
        for status_value, cycle_name in org_review_rows:
            if extract_fy_year(cycle_name) != resolved_fy:
                continue
            status_counts[status_value] = status_counts.get(status_value, 0) + 1

        review_funnel = AnnualReviewFunnel(
            fy_year=resolved_fy,
            draft=status_counts.get(ReviewStatus.DRAFT.value, 0),
            pending_mentor=status_counts.get(ReviewStatus.PENDING_MENTOR.value, 0),
            pending_management=status_counts.get(
                ReviewStatus.PENDING_MANAGEMENT.value, 0
            ),
            completed=status_counts.get(ReviewStatus.COMPLETED.value, 0),
            total=sum(status_counts.values()),
        )

    # ── Goal approval funnel ──────────────────────────────────────────
    # Same FY resolution as the review funnel above. Drafts are private
    # mentee work — never surfaced to HR. We bucket the remaining rows
    # into three visible stages: pending_approval, changes_requested,
    # and approved (where "approved" rolls up the literal APPROVED state
    # plus every post-approval review state so the funnel stays a clean
    # three-stage view).
    goal_funnel = GoalApprovalFunnel(fy_year=resolved_fy)
    if resolved_fy is not None:
        # Same active-user gate as the annual-review funnel above — keeps
        # the goal counts consistent with the chase lists below.
        org_goal_rows = (
            db.query(Goal.approval_status, Goal.cycle_name)
            .filter(
                Goal.org_id == current_user.org_id,
                Goal.goal_type == GoalType.ANNUAL.value,
                Goal.approval_status != ApprovalStatus.DRAFT.value,
                Goal.user_id.in_(active_user_ids_query(db, current_user.org_id)),
            )
            .all()
        )
        goal_status_counts: dict[str, int] = {}
        for status_value, cycle_name in org_goal_rows:
            if extract_fy_year(cycle_name) != resolved_fy:
                continue
            goal_status_counts[status_value] = (
                goal_status_counts.get(status_value, 0) + 1
            )

        approved_count = sum(
            goal_status_counts.get(s, 0) for s in POST_APPROVAL_STATES
        )
        pending_count = goal_status_counts.get(
            ApprovalStatus.PENDING_APPROVAL.value, 0
        )
        changes_requested_count = goal_status_counts.get(
            ApprovalStatus.CHANGES_REQUESTED.value, 0
        )

        goal_funnel = GoalApprovalFunnel(
            fy_year=resolved_fy,
            pending_approval=pending_count,
            changes_requested=changes_requested_count,
            approved=approved_count,
            total=pending_count + changes_requested_count + approved_count,
        )

    # ── Project review completion ─────────────────────────────────────
    # Aggregated across every cycle within the selected FY (H1+H2 for
    # half-yearly orgs, Q1..Q4 for quarterly). Soft-deleted reviews are
    # excluded — they represent assignments that were ended before the
    # cycle closed and the row stayed around for audit but isn't part
    # of the active completion picture.
    project_review_completion = ProjectReviewCompletion(fy_year=resolved_fy)
    if resolved_fy is not None:
        # Active-user gate matches the goal/review funnels — a project
        # review whose employee was deactivated mid-cycle shouldn't
        # contribute to HR's "pending PM" counter.
        org_pr_rows = (
            db.query(ProjectReview.status, ProjectReview.cycle)
            .filter(
                ProjectReview.org_id == current_user.org_id,
                ProjectReview.is_deleted == False,  # noqa: E712
                ProjectReview.user_id.in_(
                    active_user_ids_query(db, current_user.org_id)
                ),
            )
            .all()
        )
        pr_status_counts: dict[str, int] = {}
        for status_value, cycle_label in org_pr_rows:
            if extract_fy_year(cycle_label) != resolved_fy:
                continue
            pr_status_counts[status_value] = (
                pr_status_counts.get(status_value, 0) + 1
            )

        pending_count = pr_status_counts.get(ProjectReviewStatus.PENDING.value, 0)
        draft_count = pr_status_counts.get(ProjectReviewStatus.DRAFT.value, 0)
        reviewed_count = pr_status_counts.get(ProjectReviewStatus.REVIEWED.value, 0)

        project_review_completion = ProjectReviewCompletion(
            fy_year=resolved_fy,
            pending=pending_count,
            draft=draft_count,
            reviewed=reviewed_count,
            total=pending_count + draft_count + reviewed_count,
        )

    # ── Annual Reviews chase list — two buckets ───────────────────────
    # Bucket A (`users`):  Employees with NO AnnualReview row at all
    #                      for the resolved FY ("not started").
    # Bucket B (`drafts`): Employees with an AnnualReview row whose
    #                      status is still 'draft' (opened the form but
    #                      never submitted to their mentor).
    #
    # Drafts were previously lumped under "started" by the dashboard,
    # which made the card show a misleading "Every Employee has started"
    # message when employees were stuck mid-form. They're now their own
    # bucket so HR can chase those rows specifically.
    #
    # PMs / Mentors / HR are never rated in this system, so they're
    # excluded from the "expected to have a review" denominator.
    missing_reviews = MissingAnnualReviewsSummary(fy_year=resolved_fy)
    if resolved_fy is not None:
        # Fetch all AR rows for the org once, then partition in Python.
        # Each pair = (user_id, cycle_name, status, review_id).
        ar_rows = (
            db.query(
                AnnualReview.user_id,
                AnnualReview.cycle_name,
                AnnualReview.status,
                AnnualReview.id,
            )
            .filter(AnnualReview.org_id == current_user.org_id)
            .all()
        )
        # Employees who have ANY row for this FY (filters them out of
        # the "not started" bucket). Map of user_id → review_id for
        # users whose row is in draft (powers the drafts deep-link).
        reviewed_user_ids: set[int] = set()
        draft_review_by_user: dict[int, int] = {}
        for user_id, cycle_name, ar_status, review_id in ar_rows:
            if extract_fy_year(cycle_name) != resolved_fy:
                continue
            reviewed_user_ids.add(user_id)
            if ar_status == ReviewStatus.DRAFT.value:
                draft_review_by_user[user_id] = review_id

        # Pull every active Employee in the org with their relations
        # eager-loaded. We'll split into the two buckets in Python.
        all_employees = (
            db.query(User)
            .options(
                joinedload(User.function),
                joinedload(User.designation),
                joinedload(User.mentor),
            )
            .filter(
                User.org_id == current_user.org_id,
                User.role == Role.EMPLOYEE.value,
                User.is_deleted == False,  # noqa: E712
            )
            .order_by(User.full_name.asc())
            .all()
        )
        missing_staff = [u for u in all_employees if u.id not in reviewed_user_ids]
        draft_staff = [u for u in all_employees if u.id in draft_review_by_user]

        missing_reviews = MissingAnnualReviewsSummary(
            fy_year=resolved_fy,
            count=len(missing_staff),
            users=[
                MissingAnnualReviewUser(
                    user_id=u.id,
                    full_name=u.full_name,
                    function_name=u.function.name if u.function else None,
                    designation_name=(
                        u.designation.name if u.designation else None
                    ),
                    mentor_name=u.mentor.full_name if u.mentor else None,
                )
                for u in missing_staff
            ],
            draft_count=len(draft_staff),
            drafts=[
                DraftAnnualReviewUser(
                    user_id=u.id,
                    review_id=draft_review_by_user[u.id],
                    full_name=u.full_name,
                    function_name=u.function.name if u.function else None,
                    designation_name=(
                        u.designation.name if u.designation else None
                    ),
                    mentor_name=u.mentor.full_name if u.mentor else None,
                )
                for u in draft_staff
            ],
        )

    # ── Stalled goal approvals — mentor-nudge chase list ──────────────
    # Annual goals stuck in PENDING_APPROVAL longer than the threshold
    # for the resolved FY. Once submitted the employee can't edit, so
    # `updated_at` is effectively the submission timestamp (falling
    # back to `created_at` for rows that haven't been touched since
    # insert — onupdate doesn't fire then). Sorted oldest-first so the
    # most-stalled goals surface at the top of the list.
    stalled_goals = StalledGoalsSummary(
        fy_year=resolved_fy, threshold_days=_STALL_THRESHOLD_DAYS
    )
    if resolved_fy is not None:
        now_utc = datetime.now(timezone.utc)
        # Skip stalled goals whose owner was deactivated — the mentor
        # cannot approve a goal for a dead account and HR should not be
        # nudged to chase them. Historical detail views still resolve
        # by id (admin reactivate flow).
        pending_goals = (
            db.query(Goal)
            .options(joinedload(Goal.owner), joinedload(Goal.manager))
            .filter(
                Goal.org_id == current_user.org_id,
                Goal.goal_type == GoalType.ANNUAL.value,
                Goal.approval_status == ApprovalStatus.PENDING_APPROVAL.value,
                Goal.user_id.in_(active_user_ids_query(db, current_user.org_id)),
            )
            .all()
        )

        stalled_rows: list[tuple[Goal, int]] = []
        for g in pending_goals:
            if extract_fy_year(g.cycle_name) != resolved_fy:
                continue
            ts = g.updated_at or g.created_at
            if ts is None:
                continue
            # SQLite hands back naive datetimes; treat as UTC so the
            # subtraction stays timezone-aware everywhere.
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            days_waiting = (now_utc - ts).days
            if days_waiting >= _STALL_THRESHOLD_DAYS:
                stalled_rows.append((g, days_waiting))

        stalled_rows.sort(key=lambda pair: pair[1], reverse=True)

        stalled_goals = StalledGoalsSummary(
            fy_year=resolved_fy,
            threshold_days=_STALL_THRESHOLD_DAYS,
            count=len(stalled_rows),
            goals=[
                StalledGoal(
                    goal_id=g.id,
                    title=g.title,
                    owner_name=g.owner.full_name if g.owner else "—",
                    mentor_name=g.manager.full_name if g.manager else None,
                    days_waiting=days,
                )
                for g, days in stalled_rows
            ],
        )

    # ── Mentor coverage — pairing health snapshot ─────────────────────
    # Two insights bundled together: unmentored Employees (operationally
    # blocked from goals/reviews) and the most-loaded mentors (so HR
    # can spot overload before assigning new Employees).
    # Not FY-scoped — this is a "right now" picture of the org.

    # Fetch all active Employees with their mentor relationship eager-loaded
    # so we can check (a) mentor exists, (b) mentor isn't deactivated.
    all_staff = (
        db.query(User)
        .options(
            joinedload(User.function),
            joinedload(User.designation),
            joinedload(User.mentor),
        )
        .filter(
            User.org_id == current_user.org_id,
            User.role == Role.EMPLOYEE.value,
            User.is_deleted == False,  # noqa: E712
        )
        .order_by(User.full_name.asc())
        .all()
    )

    unmentored = [
        UnmentoredEmployee(
            user_id=s.id,
            full_name=s.full_name,
            function_name=s.function.name if s.function else None,
            designation_name=s.designation.name if s.designation else None,
        )
        for s in all_staff
        if s.mentor_id is None or s.mentor is None or s.mentor.is_deleted
    ]

    # Active mentee counts per mentor — only counts Employees whose mentor
    # is still active (so a dangling FK to a deactivated mentor doesn't
    # inflate anyone's load).
    mentee_count_rows = (
        db.query(User.mentor_id, func.count(User.id))
        .filter(
            User.org_id == current_user.org_id,
            User.role == Role.EMPLOYEE.value,
            User.is_deleted == False,  # noqa: E712
            User.mentor_id.isnot(None),
        )
        .group_by(User.mentor_id)
        .all()
    )
    counts_by_mentor: dict[int, int] = dict(mentee_count_rows)
    if counts_by_mentor:
        active_mentor_rows = (
            db.query(User.id, User.full_name)
            .filter(
                User.id.in_(counts_by_mentor.keys()),
                User.is_deleted == False,  # noqa: E712
            )
            .all()
        )
        top_mentors = sorted(
            (
                MentorLoad(
                    mentor_id=mid,
                    full_name=name,
                    mentee_count=counts_by_mentor[mid],
                )
                for mid, name in active_mentor_rows
            ),
            key=lambda m: (-m.mentee_count, m.full_name.lower()),
        )[:_TOP_MENTORS_LIMIT]
    else:
        top_mentors = []

    mentor_coverage = MentorCoverage(
        unmentored_employees=unmentored,
        top_mentors=top_mentors,
    )

    return HrDashboardSummary(
        headcount=headcount,
        annual_review_funnel=review_funnel,
        goal_approval_funnel=goal_funnel,
        project_review_completion=project_review_completion,
        missing_annual_reviews=missing_reviews,
        stalled_goals=stalled_goals,
        mentor_coverage=mentor_coverage,
        available_fys=available_fys,
    )
