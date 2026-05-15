"""
Project Review Routes — PM-Centric Evaluation (Revised).

No self-review. The PM writes the evaluation directly for each team member.

Endpoints:
    ── Employee ──
    GET   /project-reviews/mine                    → My assigned projects with review status
    GET   /project-reviews/{id}                    → View single review (after PM evaluates)

    ── PM (Primary Evaluator) ──
    GET   /project-reviews/pm-queue                → Team members awaiting evaluation
    GET   /project-reviews/role-expectations        → Reference data for evaluation
    POST  /project-reviews/{user_id}/evaluate       → Submit PM evaluation for a team member

    ── Secondary Evaluator ──
    GET   /project-reviews/secondary-queue          → Reviews pending secondary feedback
    POST  /project-reviews/{review_id}/secondary    → Submit secondary impact statement

    ── Admin ──
    GET   /project-reviews/management               → Per-project completion overview for active cycle
    GET   /project-reviews/all                      → All reviews for the org (flat list)
"""

from dataclasses import dataclass, field
from typing import Iterable, List, Literal, Optional
from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy.orm import aliased, joinedload

from app.api.dependencies import DbSession, CurrentUser
from app.core.cycle_utils import (
    cycle_date_range,
    parse_cycle_name,
    get_current_cycle_info,
    resolve_today,
)
from app.models.project_models import (
    Project, ProjectAssignment, PROJECT_STATUS_COMPLETED,
)
from app.models.project_review_models import (
    ProjectReview, ProjectReviewStatus,
    ProjectReviewEvaluator, EvaluatorStatus,
)
from app.models.system_settings_models import SystemSettings, CycleType
from app.models.user_models import User, ADMIN_ROLES
from app.models.reference_models import Function, Designation
from app.models.role_expectation_models import RoleExpectation
from app.schemas.project_review_schemas import (
    PMEvaluationSubmit, PMEvaluationDraft,
    SecondaryEvalSubmit, SecondaryEvalDraft,
    ProjectReviewResponse, SecondaryEvalResponse,
    MyProjectCard, PMPendingReviewCard,
    RoleExpectationResponse,
    AdminMemberReviewRow, AdminProjectSummary,
)
from app.schemas.pagination import Paginated

router = APIRouter()


# ── Module-level User alias for the "project PM" join (PR #48, doc 31)
# Stable, named alias so both filter and sort can reference the same
# join target. Two User joins coexist in `/project-reviews/all` when
# both employee and pm filters/sorts are active:
#   - `User`           — the review subject (ProjectReview.user_id)
#   - `_ProjectPMUser` — the project's PM (Project.pm_id)
# Without a module-level alias the sort-column map (below) couldn't
# reference the PM column — local `aliased()` calls would compile to a
# fresh alias per request.
_ProjectPMUser = aliased(User, name="pm_user")


# ── Sort column map for GET /project-reviews/all (PR #48, doc 31) ───
# Mirrors the frontend's ReadOnlySortKey literal-union exactly.
_PROJECT_REVIEWS_SORT_COLUMNS = {
    "project_name": Project.name,
    "employee_name": User.full_name,
    "pm_name": _ProjectPMUser.full_name,
    "cycle": ProjectReview.cycle,
    "status": ProjectReview.status,
    "performance_group": ProjectReview.performance_group,
}


# ── Helpers ──────────────────────────────────────────────────────────

_DRAFT_COMMENT_FIELDS = (
    "comment_task_execution",
    "comment_ownership",
    "comment_project_management",
    "comment_client_deliverables",
    "comment_communication",
    "comment_mentoring",
    "comment_competency_skills",
)


def _pm_review_has_draft_content(review: ProjectReview) -> bool:
    """True iff the PM has typed anything into this review row.

    Distinguishes a saved draft from the empty placeholder rows that
    seed.py / the queue pre-creates for upcoming cycles. A row counts as
    a draft if any of: rating selected, impact statement filled, or any
    per-competency comment present (after stripping whitespace).
    """
    if review.performance_group:
        return True
    if review.impact_statement and review.impact_statement.strip():
        return True
    for f in _DRAFT_COMMENT_FIELDS:
        v = getattr(review, f, None)
        if v and v.strip():
            return True
    return False


def _compute_active_cycle_name(settings: SystemSettings) -> str:
    """Derive the canonical active cycle name from settings + today.

    Reads the date through `resolve_today` so a simulated_today shifts
    cycles. The stored `active_cycle_name` column is treated as a cache
    populated on settings save; this function always returns a fresh
    value so it can't stale between admin saves.
    """
    return get_current_cycle_info(
        resolve_today(settings),
        CycleType(settings.cycle_type),
        settings.fiscal_start_month,
    )


def _get_active_cycle(db: DbSession, org_id: int) -> str:
    """Return the org's canonical active cycle name, computed fresh."""
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == org_id
    ).first()

    if not settings:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active performance cycle configured.",
        )

    return _compute_active_cycle_name(settings)


def _get_fiscal_start_month(db: DbSession, org_id: int) -> int:
    """Return the org's fiscal_start_month (default 4 if settings missing)."""
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == org_id
    ).first()
    return settings.fiscal_start_month if settings else 4


def _get_settings_row(db: DbSession, org_id: int) -> Optional[SystemSettings]:
    """Return the org's SystemSettings row, or None if not yet configured.

    Used by rating-visibility gating so batch endpoints can look settings
    up once and pass to each response builder rather than querying per row.
    """
    return db.query(SystemSettings).filter(
        SystemSettings.org_id == org_id
    ).first()


def _redacted_rating(
    review: ProjectReview,
    viewer: User,
    settings: Optional[SystemSettings],
    active_cycle_name: Optional[str] = None,
) -> Optional[int]:
    """Decide whether `viewer` is allowed to see `review.performance_group`.

    Returns the rating when any of these holds:
      - The review is from a **past cycle**. Once a cycle has rolled
        over the org-wide hide-toggle no longer applies — historical
        ratings must stay visible regardless of the flag.
      - The org-wide `project_ratings_visible` flag is True, OR
      - The viewer is HR (HR_MyOrg / HR_Miltenyi — HR sees ratings any
        time, that's the point of the override), OR
      - The viewer authored the rating themselves (a PM looking at their
        own submitted reviews should always see what they entered).

    Otherwise returns None so the API payload genuinely doesn't contain
    the rating — the frontend's hide-toggle was previously the only gate,
    which a curious user could bypass via DevTools.

    `active_cycle_name` should be the canonical "right now" cycle string
    (e.g. `"Q1 FY26-27"`). Callers can compute it once per request via
    `_compute_active_cycle_name(settings)` and pass it to every review.
    """
    is_current_cycle = (
        active_cycle_name is not None and review.cycle == active_cycle_name
    )
    if not is_current_cycle:
        # Past (or future-via-override) cycle — toggle never applies.
        return review.performance_group

    flag_on = bool(settings and settings.project_ratings_visible)
    is_admin = viewer.role in ADMIN_ROLES
    is_reviewer = review.reviewer_id == viewer.id
    if flag_on or is_admin or is_reviewer:
        return review.performance_group
    return None


def _assignment_active_for_cycle(
    assignment: ProjectAssignment,
    cycle_name: str,
    fiscal_start_month: int,
) -> bool:
    """Did this assignment's stint overlap the cycle's review window?

    True iff:
        assigned_date is on or before cycle_end, AND
        end_date is NULL or on or after cycle_start.

    For annual orgs (no cycle code in the name), this is permissive —
    we have no review window to enforce, so assignment-state-at-now is
    the only signal.
    """
    parsed = parse_cycle_name(cycle_name)
    if parsed is None:
        # Annual cadence: no per-cycle window to check. Anyone whose
        # assignment isn't entirely in the future and isn't already
        # ended counts as active.
        return assignment.end_date is None
    code, fy = parsed
    cycle_start, cycle_end = cycle_date_range(code, fy, fiscal_start_month)
    if assignment.assigned_date and assignment.assigned_date > cycle_end:
        return False
    if assignment.end_date and assignment.end_date < cycle_start:
        return False
    return True


@dataclass
class ReviewBatchDeps:
    """Pre-fetched lookup maps shared by every `_build_review_response`
    call in a batch endpoint. Replaces the per-row queries the helper
    used to issue.

    Construction is `_prefetch_review_dependencies(reviews, db)` —
    callers do it ONCE per request before the per-row loop.

    Why a dataclass instead of four loose dicts: keeps the helper's
    signature stable as we add more lookups, and the type system can
    catch "you passed users where projects was expected" mistakes.
    Also gives the doc/code a single name to refer to — "the deps
    bundle" — which is genuinely useful when explaining the pattern.

    Maps are `dict[int, User]` / `dict[int, Project]` so a missing key
    is a clean "row references a deleted entity" case the helper
    handles with the same `"Unknown"` / `"???"` fallbacks the legacy
    code used.
    """

    users_by_id: dict[int, User] = field(default_factory=dict)
    projects_by_id: dict[int, Project] = field(default_factory=dict)


def _prefetch_review_dependencies(
    reviews: Iterable[ProjectReview],
    db: DbSession,
) -> ReviewBatchDeps:
    """Build the lookup maps for a batch of reviews in 2 SQL queries.

    Before this helper, `_build_review_response(r)` issued up to 5
    queries per row (employee + reviewer + project + project.pm + per
    secondary-evaluation evaluator). For N reviews that's `≥ 5N`
    round-trips — the textbook N+1.

    Strategy: collect every entity ID referenced by the batch, then
    fetch each entity type in ONE batched query.

    Queries emitted:
      1. `SELECT * FROM users WHERE id IN (…employee_ids, reviewer_ids,
         pm_ids, secondary_evaluator_ids…)`
      2. `SELECT * FROM projects WHERE id IN (…project_ids…)`

    That's `2` queries regardless of `N`. The legacy `5N` shrinks to
    `2` constant; the savings dominate even more as `N` grows. For
    the new paginated `/all` endpoint (doc 22) at `limit=50`, this
    drops `≥ 250` round-trips per page to `≤ 2`.

    Notes:
    - We don't joinedload `Project.pm` because we need PMs in the same
      `users_by_id` bucket the helper reads from anyway, and the
      collected `pm_ids` go into the User query directly. Saves one
      duplicate query path.
    - Empty input is fine — both queries short-circuit on an empty IN
      list (we guard explicitly to avoid the SQL syntax oddity).
    - `secondary_evaluations` is the SQLAlchemy relationship; it's
      loaded lazily here, but FastAPI's response-shaping already
      iterates it inside `_build_review_response`, so the lazy load
      fires on first access during the batch loop. If profiling shows
      this is the next bottleneck, we'd add `joinedload(
      ProjectReview.secondary_evaluations)` to the page-fetch queries
      upstream (a one-liner). Out of scope here.
    """
    reviews_list = list(reviews)
    if not reviews_list:
        return ReviewBatchDeps()

    project_ids = {r.project_id for r in reviews_list if r.project_id is not None}
    user_ids: set[int] = set()
    for r in reviews_list:
        if r.user_id is not None:
            user_ids.add(r.user_id)
        if r.reviewer_id is not None:
            user_ids.add(r.reviewer_id)
        for ev in r.secondary_evaluations:
            if ev.evaluator_id is not None:
                user_ids.add(ev.evaluator_id)

    projects_by_id: dict[int, Project] = {}
    if project_ids:
        projects_by_id = {
            p.id: p
            for p in db.query(Project).filter(Project.id.in_(project_ids)).all()
        }
        # Now that we've got the projects, fold in their PM ids — must
        # happen BEFORE the user fetch so PMs land in the same batch.
        for p in projects_by_id.values():
            if p.pm_id is not None:
                user_ids.add(p.pm_id)

    users_by_id: dict[int, User] = {}
    if user_ids:
        users_by_id = {
            u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()
        }

    return ReviewBatchDeps(
        users_by_id=users_by_id,
        projects_by_id=projects_by_id,
    )


def _build_review_response(
    review: ProjectReview,
    db: DbSession,
    viewer: User,
    settings: Optional[SystemSettings] = None,
    deps: Optional[ReviewBatchDeps] = None,
) -> ProjectReviewResponse:
    """
    Convert a ProjectReview ORM row to its API response shape.

    `viewer` drives two visibility decisions:
      1. In-progress secondary-evaluator drafts are included only for
         their own author — other viewers (PM, mentor, mentee, admin)
         only see submitted impact statements.
      2. `performance_group` is redacted (returned as None) when the
         org-wide project_ratings_visible flag is off AND the viewer is
         not HR AND the viewer didn't author the rating themselves.

    `settings` is optional — batch callers should pre-fetch the row once
    and pass it in to avoid N+1 queries; single-response callers can
    omit and let this helper fetch it.

    `deps` is optional. When provided (by `_prefetch_review_dependencies`),
    the helper reads employee / reviewer / project / pm / secondary
    evaluator entities from the pre-fetched maps instead of issuing
    per-row queries. Single-row callers (`POST /evaluate`, `GET /{id}`,
    etc.) leave it `None` — the legacy per-row path runs and is fine
    at constant cost. Batch callers MUST pass it to avoid the N+1.
    """
    if settings is None:
        settings = _get_settings_row(db, viewer.org_id)
    active_cycle = _compute_active_cycle_name(settings) if settings else None
    viewer_user_id = viewer.id

    # ── Employee / reviewer / project / PM lookups ──
    # Two paths: with `deps` we read from pre-fetched maps (cheap
    # dict.get); without it we issue per-row queries (legacy path,
    # used by single-row callers where the constant cost is fine).
    if deps is not None:
        employee = deps.users_by_id.get(review.user_id) if review.user_id else None
        reviewer = (
            deps.users_by_id.get(review.reviewer_id)
            if review.reviewer_id else None
        )
        project = (
            deps.projects_by_id.get(review.project_id)
            if review.project_id else None
        )
        pm_user = (
            deps.users_by_id.get(project.pm_id)
            if project and project.pm_id else None
        )
    else:
        employee = db.query(User).filter(User.id == review.user_id).first()
        reviewer = db.query(User).filter(User.id == review.reviewer_id).first() if review.reviewer_id else None
        project = db.query(Project).filter(Project.id == review.project_id).first()
        # The project's currently-assigned PM. Distinct from `reviewer` because
        # `reviewer_id` is only stamped when a review is submitted, but the PM
        # exists on the project from creation. Read-only views (Mentor / HR /
        # Staff "My Reviews") need this so a pending row can still show the PM.
        pm_user = (
            db.query(User).filter(User.id == project.pm_id).first()
            if project and project.pm_id else None
        )

    secondary_responses: list[SecondaryEvalResponse] = []
    for ev in review.secondary_evaluations:
        # Always include submitted; include drafts only for their author.
        if (
            ev.status == EvaluatorStatus.SUBMITTED.value
            or (
                ev.status == EvaluatorStatus.DRAFT.value
                and viewer_user_id is not None
                and ev.evaluator_id == viewer_user_id
            )
        ):
            if deps is not None:
                ev_user = deps.users_by_id.get(ev.evaluator_id) if ev.evaluator_id else None
            else:
                ev_user = db.query(User).filter(User.id == ev.evaluator_id).first()
            secondary_responses.append(SecondaryEvalResponse(
                id=ev.id,
                evaluator_id=ev.evaluator_id,
                evaluator_name=ev_user.full_name if ev_user else "Unknown",
                impact_statement=ev.impact_statement,
                status=ev.status,
                created_at=ev.created_at,
            ))

    return ProjectReviewResponse(
        id=review.id,
        org_id=review.org_id,
        user_id=review.user_id,
        project_id=review.project_id,
        reviewer_id=review.reviewer_id,
        cycle=review.cycle,
        status=review.status,
        employee_name=employee.full_name if employee else "Unknown",
        reviewer_name=reviewer.full_name if reviewer else None,
        pm_name=pm_user.full_name if pm_user else None,
        project_name=project.name if project else "Unknown",
        project_code=project.project_code if project else "???",
        comment_task_execution=review.comment_task_execution,
        comment_ownership=review.comment_ownership,
        comment_project_management=review.comment_project_management,
        comment_client_deliverables=review.comment_client_deliverables,
        comment_communication=review.comment_communication,
        comment_mentoring=review.comment_mentoring,
        comment_competency_skills=review.comment_competency_skills,
        performance_group=_redacted_rating(review, viewer, settings, active_cycle),
        impact_statement=review.impact_statement,
        secondary_evaluations=secondary_responses,
        created_at=review.created_at,
        updated_at=review.updated_at,
    )


# =====================================================================
# EMPLOYEE ENDPOINTS
# =====================================================================

@router.get("/mine", response_model=List[MyProjectCard])
def get_my_projects(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    List all projects the current user is assigned to, with review status
    across ALL cycles. Returns one card per (project, cycle). For the
    current cycle a 'pending' card is added if no review exists yet —
    but only when the assignment is currently active and the project is
    not completed. Removed-from-project users still see their past
    reviews; they just don't get fresh placeholders.

    Across stints (re-joined the same project later), each
    ProjectAssignment row contributes its own pending placeholder for
    the active cycle if it overlaps that window.
    """
    current_cycle = _get_active_cycle(db, current_user.org_id)
    fiscal_start = _get_fiscal_start_month(db, current_user.org_id)
    settings_row = _get_settings_row(db, current_user.org_id)

    assignments = (
        db.query(ProjectAssignment)
        .join(Project, ProjectAssignment.project_id == Project.id)
        .filter(
            ProjectAssignment.org_id == current_user.org_id,
            ProjectAssignment.user_id == current_user.id,
            Project.is_deleted == False,  # noqa: E712
        )
        .all()
    )

    cards: list[MyProjectCard] = []
    # Reviews are independent of assignment rows (they FK directly to
    # user_id + project_id), so we only emit each existing review once
    # per project — even if the user has multiple stints on it.
    seen_review_ids: set[int] = set()

    for a in assignments:
        project = db.query(Project).filter(Project.id == a.project_id).first()
        if not project:
            continue

        func_obj = db.query(Function).filter(Function.id == a.function_id).first() if a.function_id else None

        # PM lives on the project, not in assignments
        pm_user = (
            db.query(User).filter(User.id == project.pm_id).first()
            if project.pm_id else None
        )

        # Get ALL reviews for this user on this project (across all cycles).
        reviews = db.query(ProjectReview).filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.user_id == current_user.id,
            ProjectReview.project_id == a.project_id,
        ).all()

        for review in reviews:
            if review.id in seen_review_ids:
                continue
            seen_review_ids.add(review.id)
            cards.append(MyProjectCard(
                review_id=review.id,
                project_id=project.id,
                project_name=project.name,
                project_code=project.project_code,
                project_start_date=project.start_date,
                project_expected_end_date=project.expected_end_date,
                assigned_date=a.assigned_date,
                assignment_role=a.assignment_role,
                function_name=func_obj.name if func_obj else None,
                review_status=review.status,
                performance_group=_redacted_rating(
                    review, current_user, settings_row, current_cycle,
                ),
                pm_name=pm_user.full_name if pm_user else None,
                cycle=review.cycle,
            ))

        # Active-cycle placeholder only when:
        #   - the project is still active (not completed), AND
        #   - this assignment is currently active (end_date IS NULL), AND
        #   - this assignment overlaps the current cycle's window, AND
        #   - no review row exists yet for this (user, project, current_cycle).
        if project.status == PROJECT_STATUS_COMPLETED:
            continue
        if a.end_date is not None:
            continue
        if not _assignment_active_for_cycle(a, current_cycle, fiscal_start):
            continue
        already_has_review = any(r.cycle == current_cycle for r in reviews)
        if already_has_review:
            continue

        cards.append(MyProjectCard(
            review_id=None,
            project_id=project.id,
            project_name=project.name,
            project_code=project.project_code,
            project_start_date=project.start_date,
            project_expected_end_date=project.expected_end_date,
            assigned_date=a.assigned_date,
            assignment_role=a.assignment_role,
            function_name=func_obj.name if func_obj else None,
            review_status="pending",
            pm_name=pm_user.full_name if pm_user else None,
            cycle=current_cycle,
        ))

    return cards


# =====================================================================
# PM (PRIMARY EVALUATOR) ENDPOINTS
# =====================================================================

@router.get("/pm-queue", response_model=List[PMPendingReviewCard])
def get_pm_evaluation_queue(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    List all team members on projects where the current user is PM, across
    ALL cycles. For each (team_member, project) pair we emit one card per
    existing ProjectReview row (any cycle) plus a placeholder card for the
    active cycle when no review has been created for it yet.

    The frontend defaults its Cycle filter to the active cycle, so by default
    the page shows the same data it always did; switching the filter exposes
    historical evaluations the PM may want to edit or review.
    """
    active_cycle = _get_active_cycle(db, current_user.org_id)
    fiscal_start = _get_fiscal_start_month(db, current_user.org_id)
    settings_row = _get_settings_row(db, current_user.org_id)

    # Find projects where current user is the PM (project-level FK).
    # Skip completed projects — past reviews remain editable through the
    # admin All Reviews surface, but the PM's queue should only show
    # projects that are still operational.
    pm_projects = (
        db.query(Project)
        .filter(
            Project.org_id == current_user.org_id,
            Project.pm_id == current_user.id,
            Project.is_deleted == False,  # noqa: E712
            Project.status != PROJECT_STATUS_COMPLETED,
        )
        .all()
    )

    if not pm_projects:
        return []

    cards: list[PMPendingReviewCard] = []

    for project in pm_projects:
        # All assignment rows for this project — including end-dated ones,
        # because the PM may still need to write up the cycle a person was
        # removed in. We filter the placeholder logic per-row below.
        team_assignments = (
            db.query(ProjectAssignment)
            .filter(
                ProjectAssignment.project_id == project.id,
                ProjectAssignment.org_id == current_user.org_id,
            )
            .all()
        )

        seen_review_ids: set[int] = set()

        for ta in team_assignments:
            user = db.query(User).filter(User.id == ta.user_id).first()
            if not user or user.is_deleted:
                continue

            func_obj = db.query(Function).filter(Function.id == ta.function_id).first() if ta.function_id else None
            desig = db.query(Designation).filter(Designation.id == user.designation_id).first() if user.designation_id else None

            # All ProjectReview rows for this (team_member, project) across cycles
            reviews = (
                db.query(ProjectReview)
                .filter(
                    ProjectReview.org_id == current_user.org_id,
                    ProjectReview.user_id == ta.user_id,
                    ProjectReview.project_id == project.id,
                    ProjectReview.is_deleted == False,  # noqa: E712
                )
                .order_by(ProjectReview.created_at.desc())
                .all()
            )
            cycles_with_review = {r.cycle for r in reviews}

            # One card per existing review (any cycle). Reviews are FK'd to
            # (user, project) — independent of which assignment stint, so we
            # de-dup by review.id across stints.
            for review in reviews:
                if review.id in seen_review_ids:
                    continue
                seen_review_ids.add(review.id)
                cards.append(PMPendingReviewCard(
                    review_id=review.id,
                    project_id=project.id,
                    project_name=project.name,
                    project_code=project.project_code,
                    user_id=ta.user_id,
                    employee_name=user.full_name,
                    assignment_role=ta.assignment_role,
                    function_name=func_obj.name if func_obj else None,
                    designation_name=desig.name if desig else None,
                    assigned_date=ta.assigned_date,
                    review_status=review.status,
                    performance_group=_redacted_rating(
                        review, current_user, settings_row, active_cycle,
                    ),
                    cycle=review.cycle,
                    has_draft_content=_pm_review_has_draft_content(review),
                ))

            # Placeholder for the active cycle is generated only when:
            #   - this assignment row is currently active (end_date IS NULL),
            #     so the person is still on the project today; AND
            #   - this assignment overlapped the active cycle's window; AND
            #   - no review row exists yet for that cycle.
            #
            # End-dated assignments contribute to the PM queue *only* through
            # their existing review rows above — letting the PM finish a
            # partial-period review without creating brand new ones.
            if ta.end_date is None \
               and _assignment_active_for_cycle(ta, active_cycle, fiscal_start) \
               and active_cycle not in cycles_with_review:
                cards.append(PMPendingReviewCard(
                    review_id=None,
                    project_id=project.id,
                    project_name=project.name,
                    project_code=project.project_code,
                    user_id=ta.user_id,
                    employee_name=user.full_name,
                    assignment_role=ta.assignment_role,
                    function_name=func_obj.name if func_obj else None,
                    designation_name=desig.name if desig else None,
                    assigned_date=ta.assigned_date,
                    review_status=None,
                    performance_group=None,
                    cycle=active_cycle,
                    has_draft_content=False,
                ))

    return cards


@router.get("/role-expectations", response_model=List[RoleExpectationResponse])
def get_role_expectations(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Return all role expectations for the org.
    PM uses this as reference while evaluating team members.
    """
    expectations = (
        db.query(RoleExpectation)
        .filter(RoleExpectation.org_id == current_user.org_id)
        .all()
    )

    results: list[RoleExpectationResponse] = []
    for exp in expectations:
        func_obj = db.query(Function).filter(Function.id == exp.function_id).first()
        desig = db.query(Designation).filter(Designation.id == exp.designation_id).first()
        results.append(RoleExpectationResponse(
            id=exp.id,
            function_name=func_obj.name if func_obj else "Unknown",
            designation_name=desig.name if desig else "Unknown",
            exp_task_execution=exp.exp_task_execution,
            exp_ownership=exp.exp_ownership,
            exp_project_management=exp.exp_project_management,
            exp_client_deliverables=exp.exp_client_deliverables,
            exp_communication=exp.exp_communication,
            exp_mentoring=exp.exp_mentoring,
            exp_firm_growth=exp.exp_firm_growth,
            exp_competency_skills=exp.exp_competency_skills,
        ))

    return results


@router.post("/{project_id}/evaluate/{user_id}", response_model=ProjectReviewResponse, status_code=status.HTTP_201_CREATED)
def submit_pm_evaluation(
    project_id: int,
    user_id: int,
    payload: PMEvaluationSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    PM submits evaluation for a specific team member on a specific project.

    Creates the ProjectReview row if it doesn't exist, fills in the
    7 competency comments + performance group + impact, and sets
    status to 'reviewed'. The employee can now see the evaluation.
    """
    cycle = _get_active_cycle(db, current_user.org_id)
    fiscal_start = _get_fiscal_start_month(db, current_user.org_id)

    # Verify caller is the PM for this project (project-level field).
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project or project.pm_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Project Manager for this project.",
        )

    # Verify the target user has at least one assignment row for this
    # project (active or historical). Multiple rows are possible across
    # re-joins; any one is enough to anchor a review.
    user_assignments = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.user_id == user_id,
    ).all()

    if not user_assignments:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This employee is not assigned to this project.",
        )

    # Can't evaluate yourself
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot evaluate yourself.",
        )

    # Find any existing review row for this (employee, project, cycle).
    # PENDING and DRAFT are both promotable to REVIEWED; only an existing
    # REVIEWED row is a true 409.
    review = db.query(ProjectReview).filter(
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.user_id == user_id,
        ProjectReview.project_id == project_id,
        ProjectReview.cycle == cycle,
    ).first()

    if review and review.status == ProjectReviewStatus.REVIEWED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This employee has already been evaluated for this project this cycle.",
        )

    # Lifecycle gate: refuse to *create* a new review row when the
    # project is completed or no stint covered this cycle. Editing an
    # already-existing draft / pending row is always allowed (so the PM
    # can finish a partial-period review for someone who was removed
    # mid-cycle, and HR can backfill via the PM after completion).
    if review is None:
        if project.status == PROJECT_STATUS_COMPLETED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot create new reviews on a completed project.",
            )
        any_overlap = any(
            _assignment_active_for_cycle(a, cycle, fiscal_start)
            for a in user_assignments
        )
        if not any_overlap:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This employee was not on the project during this cycle.",
            )

    if review:
        # Promote PENDING / DRAFT row to REVIEWED.
        review.reviewer_id = current_user.id
        review.status = ProjectReviewStatus.REVIEWED.value
        review.comment_task_execution = payload.comment_task_execution
        review.comment_ownership = payload.comment_ownership
        review.comment_project_management = payload.comment_project_management
        review.comment_client_deliverables = payload.comment_client_deliverables
        review.comment_communication = payload.comment_communication
        review.comment_mentoring = payload.comment_mentoring
        review.comment_competency_skills = payload.comment_competency_skills
        review.performance_group = payload.performance_group.value
        review.impact_statement = payload.impact_statement
    else:
        review = ProjectReview(
            org_id=current_user.org_id,
            user_id=user_id,
            project_id=project_id,
            reviewer_id=current_user.id,
            cycle=cycle,
            status=ProjectReviewStatus.REVIEWED.value,
            comment_task_execution=payload.comment_task_execution,
            comment_ownership=payload.comment_ownership,
            comment_project_management=payload.comment_project_management,
            comment_client_deliverables=payload.comment_client_deliverables,
            comment_communication=payload.comment_communication,
            comment_mentoring=payload.comment_mentoring,
            comment_competency_skills=payload.comment_competency_skills,
            performance_group=payload.performance_group.value,
            impact_statement=payload.impact_statement,
        )
        db.add(review)

    db.commit()
    db.refresh(review)

    return _build_review_response(review, db, viewer=current_user)


@router.patch("/{project_id}/evaluate/{user_id}/draft", response_model=ProjectReviewResponse)
def save_pm_evaluation_draft(
    project_id: int,
    user_id: int,
    payload: PMEvaluationDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    PM saves an in-progress evaluation as a DRAFT. Same auth gates as the
    submit endpoint, but the row's status is set to DRAFT and the PM can
    keep editing. Submit (POST /evaluate) promotes DRAFT → REVIEWED.

    All fields in the payload are optional — a half-typed evaluation can
    be parked and resumed later. Fields not present on the payload are
    left as-is on the row.
    """
    cycle = _get_active_cycle(db, current_user.org_id)
    fiscal_start = _get_fiscal_start_month(db, current_user.org_id)

    # Same role gate as submit (PM lives on the project, not in assignments).
    project = db.query(Project).filter(
        Project.id == project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project or project.pm_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Project Manager for this project.",
        )

    user_assignments = db.query(ProjectAssignment).filter(
        ProjectAssignment.org_id == current_user.org_id,
        ProjectAssignment.project_id == project_id,
        ProjectAssignment.user_id == user_id,
    ).all()
    if not user_assignments:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="This employee is not assigned to this project.",
        )
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot evaluate yourself.",
        )

    review = db.query(ProjectReview).filter(
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.user_id == user_id,
        ProjectReview.project_id == project_id,
        ProjectReview.cycle == cycle,
    ).first()

    if review and review.status == ProjectReviewStatus.REVIEWED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "This employee has already been evaluated; drafts can no "
                "longer be saved."
            ),
        )

    # Same lifecycle gate as submit_pm_evaluation: don't allow new draft
    # rows on completed projects or for cycles a stint didn't cover.
    if review is None:
        if project.status == PROJECT_STATUS_COMPLETED:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Cannot create new reviews on a completed project.",
            )
        any_overlap = any(
            _assignment_active_for_cycle(a, cycle, fiscal_start)
            for a in user_assignments
        )
        if not any_overlap:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="This employee was not on the project during this cycle.",
            )

    if not review:
        review = ProjectReview(
            org_id=current_user.org_id,
            user_id=user_id,
            project_id=project_id,
            reviewer_id=current_user.id,
            cycle=cycle,
            status=ProjectReviewStatus.DRAFT.value,
        )
        db.add(review)
    else:
        review.reviewer_id = current_user.id
        review.status = ProjectReviewStatus.DRAFT.value

    # Apply only the fields the client included (partial save).
    data = payload.model_dump(exclude_unset=True)
    for field, value in data.items():
        if field == "performance_group" and value is not None:
            # Pydantic model gives us the enum; persist the string value.
            setattr(review, field, value.value if hasattr(value, "value") else value)
        else:
            setattr(review, field, value)

    db.commit()
    db.refresh(review)
    return _build_review_response(review, db, viewer=current_user)


# =====================================================================
# SECONDARY EVALUATOR ENDPOINTS
# =====================================================================

@router.get("/secondary-queue", response_model=List[ProjectReviewResponse])
def get_secondary_evaluation_queue(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    List PM-reviewed reviews on projects where the current user is a
    Secondary evaluator, across ALL cycles. The frontend defaults its
    Cycle filter to the active cycle, so default UX is unchanged; the
    filter exposes historical entries the secondary may want to edit.

    Only `status == reviewed` rows are returned — secondaries write
    impact AFTER the PM has evaluated.
    """
    # Secondary evaluator is now a project-level field (Project.secondary_evaluator_id),
    # not a per-member ProjectAssignment row.
    secondary_projects = (
        db.query(Project.id)
        .filter(
            Project.org_id == current_user.org_id,
            Project.secondary_evaluator_id == current_user.id,
            Project.is_deleted == False,  # noqa: E712
        )
        .all()
    )

    if not secondary_projects:
        return []

    project_ids = [pid for (pid,) in secondary_projects]

    reviews = (
        db.query(ProjectReview)
        # Eager-load secondary_evaluations on the page-fetch query so
        # `_prefetch_review_dependencies` doesn't trigger N lazy loads
        # when it iterates `r.secondary_evaluations` to collect
        # evaluator ids. Without this, doc 24's helper still emitted
        # N extra round-trips per request; the joinedload collapses
        # them into the parent SELECT via a LEFT JOIN. See doc 25.
        .options(joinedload(ProjectReview.secondary_evaluations))
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.project_id.in_(project_ids),
            ProjectReview.status == ProjectReviewStatus.REVIEWED.value,
            ProjectReview.user_id != current_user.id,
            ProjectReview.is_deleted == False,  # noqa: E712
        )
        .order_by(ProjectReview.created_at.desc())
        .all()
    )

    # Pre-fetch the batch's entity dependencies (users + projects) in
    # 2 SQL queries instead of letting `_build_review_response` issue
    # 5 per row. See doc 24 for the pattern.
    settings_row = _get_settings_row(db, current_user.org_id)
    deps = _prefetch_review_dependencies(reviews, db)
    return [
        _build_review_response(r, db, viewer=current_user, settings=settings_row, deps=deps)
        for r in reviews
    ]


# =====================================================================
# MENTOR ENDPOINTS (read-only view of mentees' project reviews)
# =====================================================================

@router.get("/mentees", response_model=List[ProjectReviewResponse])
def get_mentees_project_reviews(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    List every ProjectReview row where the reviewee is one of the
    caller's direct mentees, across ALL cycles. View-only — mentors
    can read but not submit / edit project reviews.

    Returns both pending and reviewed rows so the mentor can see the
    full picture (including which evaluations are still outstanding).
    Pending rows have null PM comments + null performance_group; the
    frontend renders them as "Pending PM evaluation".
    """
    mentee_ids = [
        uid for (uid,) in db.query(User.id).filter(
            User.mentor_id == current_user.id,
            User.org_id == current_user.org_id,
            User.is_deleted == False,  # noqa: E712
        ).all()
    ]

    if not mentee_ids:
        return []

    reviews = (
        db.query(ProjectReview)
        # Eager-load secondary_evaluations — see /secondary-queue above
        # for the rationale; the prefetch helper iterates this
        # relationship and we don't want N lazy loads.
        .options(joinedload(ProjectReview.secondary_evaluations))
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.user_id.in_(mentee_ids),
            ProjectReview.is_deleted == False,  # noqa: E712
        )
        .order_by(
            ProjectReview.cycle.desc(),
            ProjectReview.created_at.desc(),
        )
        .all()
    )

    # Pre-fetch the batch's entity dependencies in 2 queries — see doc 24.
    settings_row = _get_settings_row(db, current_user.org_id)
    deps = _prefetch_review_dependencies(reviews, db)
    return [
        _build_review_response(r, db, viewer=current_user, settings=settings_row, deps=deps)
        for r in reviews
    ]


@router.post("/{review_id}/secondary", response_model=SecondaryEvalResponse, status_code=status.HTTP_201_CREATED)
def submit_secondary_evaluation(
    review_id: int,
    payload: SecondaryEvalSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """Secondary evaluator submits impact statement."""
    review = db.query(ProjectReview).filter(
        ProjectReview.id == review_id,
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.status == ProjectReviewStatus.REVIEWED.value,
    ).first()

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reviewed project review not found.",
        )

    # Verify caller is the project's Secondary evaluator (project-level field).
    project = db.query(Project).filter(
        Project.id == review.project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()

    if not project or project.secondary_evaluator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Secondary evaluator for this project.",
        )

    if review.user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot evaluate yourself.",
        )

    existing = db.query(ProjectReviewEvaluator).filter(
        ProjectReviewEvaluator.project_review_id == review.id,
        ProjectReviewEvaluator.evaluator_id == current_user.id,
    ).first()

    if existing and existing.status == EvaluatorStatus.SUBMITTED.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You have already submitted your evaluation for this review.",
        )

    if existing is not None:
        # Promote draft → submitted.
        existing.status = EvaluatorStatus.SUBMITTED.value
        existing.impact_statement = payload.impact_statement
        evaluator = existing
    else:
        evaluator = ProjectReviewEvaluator(
            org_id=current_user.org_id,
            project_review_id=review.id,
            evaluator_id=current_user.id,
            evaluator_type="Secondary",
            status=EvaluatorStatus.SUBMITTED.value,
            impact_statement=payload.impact_statement,
        )
        db.add(evaluator)
    db.commit()
    db.refresh(evaluator)

    ev_user = db.query(User).filter(User.id == evaluator.evaluator_id).first()
    return SecondaryEvalResponse(
        id=evaluator.id,
        evaluator_id=evaluator.evaluator_id,
        evaluator_name=ev_user.full_name if ev_user else "Unknown",
        impact_statement=evaluator.impact_statement,
        status=evaluator.status,
        created_at=evaluator.created_at,
    )


@router.patch("/{review_id}/secondary/draft", response_model=SecondaryEvalResponse)
def save_secondary_draft(
    review_id: int,
    payload: SecondaryEvalDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Secondary evaluator saves an in-progress impact statement as DRAFT.
    The row uses ``EvaluatorStatus.DRAFT`` so the PM, mentor, and mentee
    don't see it until the evaluator submits via POST /secondary.
    """
    review = db.query(ProjectReview).filter(
        ProjectReview.id == review_id,
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.status == ProjectReviewStatus.REVIEWED.value,
    ).first()
    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reviewed project review not found.",
        )

    project = db.query(Project).filter(
        Project.id == review.project_id,
        Project.org_id == current_user.org_id,
        Project.is_deleted == False,  # noqa: E712
    ).first()
    if not project or project.secondary_evaluator_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the Secondary evaluator for this project.",
        )
    if review.user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot evaluate yourself.",
        )

    existing = db.query(ProjectReviewEvaluator).filter(
        ProjectReviewEvaluator.project_review_id == review.id,
        ProjectReviewEvaluator.evaluator_id == current_user.id,
    ).first()
    if existing and existing.status == EvaluatorStatus.SUBMITTED.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Your impact statement has already been submitted; drafts "
                "can no longer be saved."
            ),
        )

    if existing is not None:
        if payload.impact_statement is not None:
            existing.impact_statement = payload.impact_statement
        existing.status = EvaluatorStatus.DRAFT.value
        evaluator = existing
    else:
        evaluator = ProjectReviewEvaluator(
            org_id=current_user.org_id,
            project_review_id=review.id,
            evaluator_id=current_user.id,
            evaluator_type="Secondary",
            status=EvaluatorStatus.DRAFT.value,
            impact_statement=payload.impact_statement,
        )
        db.add(evaluator)
    db.commit()
    db.refresh(evaluator)

    ev_user = db.query(User).filter(User.id == evaluator.evaluator_id).first()
    return SecondaryEvalResponse(
        id=evaluator.id,
        evaluator_id=evaluator.evaluator_id,
        evaluator_name=ev_user.full_name if ev_user else "Unknown",
        impact_statement=evaluator.impact_statement,
        status=evaluator.status,
        created_at=evaluator.created_at,
    )


@router.put("/{review_id}/secondary", response_model=SecondaryEvalResponse)
def update_secondary_evaluation(
    review_id: int,
    payload: SecondaryEvalSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """Secondary evaluator updates their previously submitted impact statement."""
    review = db.query(ProjectReview).filter(
        ProjectReview.id == review_id,
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.status == ProjectReviewStatus.REVIEWED.value,
    ).first()

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Reviewed project review not found.",
        )

    existing = db.query(ProjectReviewEvaluator).filter(
        ProjectReviewEvaluator.project_review_id == review.id,
        ProjectReviewEvaluator.evaluator_id == current_user.id,
    ).first()

    if not existing:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No existing secondary evaluation found to update.",
        )

    existing.impact_statement = payload.impact_statement
    db.commit()
    db.refresh(existing)

    ev_user = db.query(User).filter(User.id == existing.evaluator_id).first()
    return SecondaryEvalResponse(
        id=existing.id,
        evaluator_id=existing.evaluator_id,
        evaluator_name=ev_user.full_name if ev_user else "Unknown",
        impact_statement=existing.impact_statement,
        status=existing.status,
        created_at=existing.created_at,
    )


# =====================================================================
# ADMIN OVERVIEW
# =====================================================================

@router.get("/all", response_model=Paginated[ProjectReviewResponse])
def get_all_reviews(
    db: DbSession,
    current_user: CurrentUser,
    limit: int = Query(
        50,
        ge=1,
        le=200,
        description=(
            "Maximum reviews to return on this page. Server-clamped to "
            "1..200 to bound payload + DB work."
        ),
    ),
    offset: int = Query(
        0,
        ge=0,
        description="Reviews to skip before this page. 0 for the first page.",
    ),
    # ── Server-side filters (PR #45, doc 28) ─────────────────────────
    # Each filter narrows the universe BEFORE pagination, so `total`
    # reports the count of matching reviews and Load More pages through
    # only those. All filters apply with AND. Exact-match equality
    # everywhere (matches the frontend combobox/select UI which commits
    # exact values; substring search would be a future PR).
    cycle: Optional[str] = Query(
        None,
        description="Exact match on review.cycle (e.g. 'Q1 FY26-27').",
    ),
    status_: Optional[str] = Query(
        None,
        alias="status",
        description=(
            "Exact match on review.status. ProjectReviewStatus values "
            "are 'pending' / 'reviewed' — the frontend's '4-stage' "
            "status mapping is computed client-side from extra signals."
        ),
    ),
    pm: Optional[str] = Query(
        None,
        description=(
            "Exact match on the Project's assigned PM full_name. "
            "Distinct from the reviewer (PM_id is set at project "
            "creation; reviewer_id only stamped on submit). Joins User "
            "via an aliased manager join so it doesn't collide with "
            "the employee filter's User join."
        ),
    ),
    employee: Optional[str] = Query(
        None,
        description="Exact match on the review subject's full_name.",
    ),
    project: Optional[str] = Query(
        None,
        description="Exact match on Project.name.",
    ),
    # ── Server-side sort (PR #48, doc 31) ─────────────────────────────
    sort_by: Optional[
        Literal[
            "project_name",
            "employee_name",
            "pm_name",
            "cycle",
            "status",
            "performance_group",
        ]
    ] = Query(
        None,
        description=(
            "Primary sort column. Mirrors the frontend's "
            "ReadOnlySortKey enum. Sort dimensions that need joins "
            "(project_name, employee_name, pm_name) trigger those "
            "joins even without an active filter."
        ),
    ),
    sort_dir: Literal["asc", "desc"] = Query(
        "asc",
        description="Sort direction. Default 'asc'.",
    ),
):
    """HR-only: paginated project reviews across the org, every cycle.

    Both HR_MyOrg and HR_Miltenyi may read this — Miltenyi HR explicitly
    has visibility into project reviews per the role spec. Returns every
    cycle so the frontend can render a full read-only history with a
    cycle filter; pagination caps how many rows are streamed per request.

    Pagination + filtering (PR #45, doc 28): each filter narrows the
    universe BEFORE pagination, so `total` is the count of rows
    matching ALL active filters and Load More pages through what
    matches. The frontend bakes the filter set into the queryKey, so
    each filter combination gets its own cache entry.

    Pagination convention: standard offset/limit with `Paginated[T]` wire
    shape (doc 19). Pair with `useInfiniteQuery` on the frontend; each
    row corresponds to exactly one ProjectReview (no parent/child split
    like /goals/all, doc 20). `total` and `items.length` are the same
    unit — review-row count.

    Existing ORDER BY (cycle DESC, created_at DESC) already provides a
    stable order for OFFSET/LIMIT. We add `id.desc()` as a tiebreaker
    so two rows created in the same second don't reorder across pages.
    """
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only HR users can view all reviews.",
        )

    # Filtered base query — shared by COUNT and the windowed fetch so the
    # `total` field always matches the page's universe.
    base_q = db.query(ProjectReview).filter(
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.is_deleted == False,  # noqa: E712
    )

    # ── Apply filters + figure out which joins sort also needs ────────
    # Joins compose filter ∪ sort needs — sorting by `pm_name` requires
    # the Project + PMUser joins even with no `pm` filter. Same doc-30
    # Part 3 pattern.
    if cycle:
        base_q = base_q.filter(ProjectReview.cycle == cycle)
    if status_:
        base_q = base_q.filter(ProjectReview.status == status_)

    needs_project_join = bool(pm or project) or sort_by in ("project_name", "pm_name")
    needs_pm_user_join = bool(pm) or sort_by == "pm_name"
    needs_employee_join = bool(employee) or sort_by == "employee_name"

    if needs_project_join:
        base_q = base_q.join(Project, Project.id == ProjectReview.project_id)
        if project:
            base_q = base_q.filter(Project.name == project)
        if needs_pm_user_join:
            # Module-level `_ProjectPMUser` alias (see top of file)
            # disambiguates the second User join. Same pattern as doc 27
            # (Goal.user_id vs Goal.manager_id).
            base_q = base_q.join(
                _ProjectPMUser, _ProjectPMUser.id == Project.pm_id
            )
            if pm:
                base_q = base_q.filter(_ProjectPMUser.full_name == pm)

    if needs_employee_join:
        # The employee filter targets the review subject (the person
        # being reviewed), not the reviewer. `ProjectReview.user_id` is
        # the subject; reviewer_id is the PM/secondary who wrote it.
        base_q = base_q.join(User, User.id == ProjectReview.user_id)
        if employee:
            base_q = base_q.filter(User.full_name == employee)

    # Total of matching reviews — single COUNT(*) over an indexed filter.
    # The savings vs the legacy "fetch all + len()" pattern dominate at
    # HR scale (1000+ reviews shrinking to 50 per page).
    total = base_q.with_entities(ProjectReview.id).count()

    # ORDER BY — default (cycle DESC, created_at DESC) when no user-
    # picked sort; user sort replaces the default and the id.desc()
    # tiebreaker survives (doc 30 Part 2).
    if sort_by is None:
        order_clauses = [
            ProjectReview.cycle.desc(),
            ProjectReview.created_at.desc(),
            ProjectReview.id.desc(),
        ]
    else:
        sort_column = _PROJECT_REVIEWS_SORT_COLUMNS[sort_by]
        primary = sort_column.asc() if sort_dir == "asc" else sort_column.desc()
        order_clauses = [primary, ProjectReview.id.desc()]

    reviews = (
        base_q
        # Eager-load secondary_evaluations ONLY on the windowed fetch —
        # the `base_q` is also reused for the COUNT(*) above, where an
        # eager-load would be wasted work. See doc 25 for why the
        # joinedload belongs here and not on base_q.
        .options(joinedload(ProjectReview.secondary_evaluations))
        .order_by(*order_clauses)
        .offset(offset)
        .limit(limit)
        .all()
    )

    # Settings is read once per request, threaded into every
    # _build_review_response call so the visibility-gate check doesn't
    # re-query. `deps` carries pre-fetched user + project maps so the
    # helper's per-row queries (employee / reviewer / project / pm /
    # secondary-eval evaluator) all become dict lookups instead.
    # Together: each request issues a fixed handful of queries
    # regardless of page size. See doc 24 for the pattern.
    settings_row = _get_settings_row(db, current_user.org_id)
    deps = _prefetch_review_dependencies(reviews, db)
    items = [
        _build_review_response(r, db, viewer=current_user, settings=settings_row, deps=deps)
        for r in reviews
    ]

    return Paginated[ProjectReviewResponse](
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + len(items)) < total,
    )


# =====================================================================
# ADMIN MANAGEMENT VIEW
# =====================================================================

@router.get("/management", response_model=List[AdminProjectSummary])
def get_management_overview(
    db: DbSession,
    current_user: CurrentUser,
    cycle: Optional[str] = None,
):
    """
    Admin: per-project review completion overview for the active cycle.

    Returns one AdminProjectSummary per project that has non-PM members,
    each containing per-member review status. Uses eager loading to avoid
    N+1 queries — all project/assignment/user/function data is fetched
    in a single query, and a review_map dict provides O(1) lookups.
    """
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="HR only.",
        )

    active_cycle = _get_active_cycle(db, current_user.org_id)
    resolved_cycle = cycle if cycle else active_cycle
    settings_row = _get_settings_row(db, current_user.org_id)

    # Single query: projects + assignments + users + functions
    projects = (
        db.query(Project)
        .options(
            joinedload(Project.assignments).joinedload(ProjectAssignment.user),
            joinedload(Project.assignments).joinedload(ProjectAssignment.function),
            joinedload(Project.pm),
        )
        .filter(
            Project.org_id == current_user.org_id,
            Project.is_deleted == False,  # noqa: E712
        )
        .all()
    )

    # All reviews for this org + cycle in one query → O(1) dict lookup
    all_reviews = (
        db.query(ProjectReview)
        .filter(
            ProjectReview.org_id == current_user.org_id,
            ProjectReview.cycle == resolved_cycle,
        )
        .all()
    )
    review_map: dict[tuple[int, int], ProjectReview] = {
        (r.project_id, r.user_id): r for r in all_reviews
    }

    summaries: list[AdminProjectSummary] = []

    for project in projects:
        members: list[AdminMemberReviewRow] = []
        reviewed_count = 0
        pm_name: str | None = project.pm.full_name if project.pm else None

        for a in project.assignments:
            if not a.user or a.user.is_deleted:
                continue

            review = review_map.get((project.id, a.user_id))
            review_status = review.status if review else "not_started"

            if review_status == ProjectReviewStatus.REVIEWED.value:
                reviewed_count += 1

            members.append(AdminMemberReviewRow(
                review_id=review.id if review else None,
                user_id=a.user_id,
                employee_name=a.user.full_name,
                assignment_role=a.assignment_role,
                function_name=a.function.name if a.function else None,
                review_status=review_status,
                performance_group=_redacted_rating(
                    review, current_user, settings_row, active_cycle,
                ) if review else None,
            ))

        if members:
            summaries.append(AdminProjectSummary(
                project_id=project.id,
                project_name=project.name,
                project_code=project.project_code,
                pm_name=pm_name,
                total_members=len(members),
                reviewed_count=reviewed_count,
                members=members,
            ))

    return summaries


# =====================================================================
# SINGLE REVIEW — GET + PUT (must be LAST — catch-all paths)
# =====================================================================

@router.put("/{review_id}", response_model=ProjectReviewResponse)
def update_review(
    review_id: int,
    payload: PMEvaluationSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    PM (or Admin) edits an already-submitted review.

    Authorization: ONLY the PM who originally wrote the review
    (review.reviewer_id == current_user.id) or an Admin may update it.
    The employee who was reviewed cannot edit it.
    """
    review = db.query(ProjectReview).filter(
        ProjectReview.id == review_id,
        ProjectReview.org_id == current_user.org_id,
    ).first()

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review not found.",
        )

    is_admin = current_user.role == "HR_MyOrg"  # HR_Miltenyi is read-only on reviews
    is_reviewer = review.reviewer_id == current_user.id

    if not (is_reviewer or is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the PM who submitted this review (or Healthark HR) may edit it.",
        )

    review.comment_task_execution = payload.comment_task_execution
    review.comment_ownership = payload.comment_ownership
    review.comment_project_management = payload.comment_project_management
    review.comment_client_deliverables = payload.comment_client_deliverables
    review.comment_communication = payload.comment_communication
    review.comment_mentoring = payload.comment_mentoring
    review.comment_competency_skills = payload.comment_competency_skills
    review.impact_statement = payload.impact_statement
    review.performance_group = payload.performance_group.value

    db.commit()
    db.refresh(review)

    return _build_review_response(review, db, viewer=current_user)


@router.get("/{review_id}", response_model=ProjectReviewResponse)
def get_review(
    review_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Get a single review. Access control:
    - Employee sees their own review (only after PM evaluates)
    - PM sees any review they wrote
    - Secondary sees reviews on their projects
    - Mentor sees reviews of their direct mentees (view-only)
    - HR (either) sees everything
    """
    review = db.query(ProjectReview).filter(
        ProjectReview.id == review_id,
        ProjectReview.org_id == current_user.org_id,
    ).first()

    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Review not found.",
        )

    # Both HR roles may read any review (Miltenyi HR has explicit project-review visibility).
    is_admin = current_user.role in ADMIN_ROLES
    is_owner = review.user_id == current_user.id
    # `reviewer_id` is only set once the PM submits the review — on
    # PENDING rows it stays NULL. The canonical PM authority is
    # `Project.pm_id` (project-level field), and Secondary evaluator
    # is similarly `Project.secondary_evaluator_id`. Without these
    # checks a PM clicking "Evaluate" on a fresh pending review would
    # be 403'd because none of the per-row identity checks match
    # them yet.
    is_reviewer = review.reviewer_id == current_user.id
    project = (
        db.query(Project).filter(Project.id == review.project_id).first()
    )
    is_project_pm = project is not None and project.pm_id == current_user.id
    is_project_secondary = (
        project is not None
        and project.secondary_evaluator_id == current_user.id
    )

    # Check if caller is assigned to same project
    is_on_project = db.query(ProjectAssignment).filter(
        ProjectAssignment.project_id == review.project_id,
        ProjectAssignment.user_id == current_user.id,
        ProjectAssignment.org_id == current_user.org_id,
    ).first() is not None

    # Check if caller is the mentor of the reviewee (view-only access).
    owner = db.query(User).filter(User.id == review.user_id).first()
    is_mentor_of_owner = owner is not None and owner.mentor_id == current_user.id

    if not (
        is_owner
        or is_reviewer
        or is_project_pm
        or is_project_secondary
        or is_on_project
        or is_admin
        or is_mentor_of_owner
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this review.",
        )

    # Employee can only see their review after PM has evaluated
    if is_owner and not is_admin and review.status != ProjectReviewStatus.REVIEWED.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Your review has not been completed yet.",
        )

    return _build_review_response(review, db, viewer=current_user)