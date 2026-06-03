"""
Goal Routes — Core Objective Tracking.

Endpoints:
    GET    /api/v1/goals/           → List goals (own or team)
    GET    /api/v1/goals/{id}       → Get single goal details
    POST   /api/v1/goals/           → Create new goal
    PATCH  /api/v1/goals/{id}       → Update goal details
    DELETE /api/v1/goals/{id}       → Delete a goal

Workflow Actions:
    PATCH  /api/v1/goals/{id}/submit  → Submit draft for approval
    PATCH  /api/v1/goals/{id}/approve → Manager approves/rejects

Security Layers Applied:
    Layer 1 — Authentication:   CurrentUser dependency (JWT validation)
    Layer 2 — Tenant Isolation: All queries strictly filter by current_user.org_id
    Layer 3 — Role Awareness:   Relationship checks for team/mentee actions
    Layer 4 — Ownership:        Users can only edit their own goals; Mentors can edit mentee goals
    Layer 5 — Gate Checks:      Annual goals respect the annual_goals_edit_enabled flag
"""

from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import List, Literal, Optional
from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import or_
from sqlalchemy.orm import aliased, joinedload

from app.api.dependencies import DbSession, CurrentUser
from app.models.goal_models import Goal, ApprovalStatus, GoalType, POST_APPROVAL_STATES
from app.services.notification_service import notify
from app.models.goal_self_review_models import GoalSelfReview, SelfReviewCycleHalf
from app.models.goal_mentor_review_models import GoalMentorReview
from app.models.reference_models import Function, Designation
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User, Role
from app.schemas.goal_schemas import (
    GoalCreate,
    GoalUpdate,
    GoalResponse,
    GoalApprovalUpdate,
    GoalBulkApproveRequest,
    GoalBulkApproveResult,
    GoalBulkApproveFailure,
    GoalNotifyRequest,
    GoalSelfReviewSubmit,
    GoalSelfReviewDraft,
    GoalMentorReviewSubmit,
    GoalMentorReviewDraft,
    TeamGoalResponse,
)
from app.schemas.pagination import Paginated
from app.core.cycle_utils import (
    _fy_label_of_goal,
    cycles_before,
    get_goal_cycle_name,
    get_year_override,
    is_review_window_open,
    resolve_now,
    resolve_today,
)
from app.core.user_filters import active_user_ids_query

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────

def _get_goal_with_relations(db: DbSession, goal_id: int, org_id: int) -> Goal:
    """Fetch a goal with eagerly loaded manager, scoped to the org."""
    goal = (
        db.query(Goal)
        .options(joinedload(Goal.manager))
        .filter(Goal.id == goal_id, Goal.org_id == org_id)
        .first()
    )
    if not goal:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Goal not found or you don't have access to it.",
        )
    return goal


def _get_settings(db: DbSession, org_id: int) -> SystemSettings:
    """Fetch org settings, raising 500 if not yet initialized."""
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == org_id
    ).first()
    if not settings:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="System settings have not been initialized for this organization.",
        )
    return settings


def _assert_half_cadence(cycle_half: SelfReviewCycleHalf) -> None:
    """Reject Q1..Q4 cycle codes for goal reviews.

    Goal review cadence is uniformly half-yearly (H1 / H2) regardless of
    the org's `cycle_type`. Quarterly applies to project reviews only.
    The SelfReviewCycleHalf enum still includes Q1..Q4 for backwards
    compatibility with persisted rows from the previous cycle-coupled
    model — but we don't accept new Q-prefixed submissions.
    """
    if not cycle_half.value.startswith("H"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Goal reviews are filed half-yearly (H1 or H2). Quarterly "
                "cycles are only used for project reviews."
            ),
        )


def _self_reviewed_state(cycle_code: str) -> str:
    """`{cycle}_self_reviewed` ApprovalStatus value: "h1" → "h1_self_reviewed"."""
    return f"{cycle_code.lower()}_self_reviewed"


def _mentor_reviewed_state(cycle_code: str) -> str:
    """`{cycle}_mentor_reviewed` ApprovalStatus value."""
    return f"{cycle_code.lower()}_mentor_reviewed"


def _self_review_allowed_states(cycle_code: str) -> set[str]:
    """States from which submitting (or drafting) a self-review for
    `cycle_code` is permitted.

    Always includes APPROVED. Plus, for every prior cycle in the same
    cadence, both its self_reviewed and mentor_reviewed states (so a goal
    can skip ahead — e.g. an org that missed Q2 entirely can still file
    Q3 from the q1_mentor_reviewed state)."""
    allowed = {ApprovalStatus.APPROVED.value}
    for prior in cycles_before(cycle_code):
        allowed.add(_self_reviewed_state(prior))
        allowed.add(_mentor_reviewed_state(prior))
    return allowed


def _assert_annual_gate_open(
    db: DbSession,
    org_id: int,
    fy_label: str | None,
) -> None:
    """Raise 403 when the annual-goal edit window is closed for `fy_label`.

    Per-FY semantics: the override row for the goal's FY decides
    whether annual-goal create/edit is permitted. Missing row =
    default-deny so HR has to open the year explicitly.
    """
    if not fy_label:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not determine the fiscal year for this annual goal.",
        )
    override = get_year_override(db, org_id, fy_label)
    if override is None or not override.annual_goals_edit_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Annual goal submissions for {fy_label} are currently closed. "
                f"Please wait for the Admin to open the submission window."
            ),
        )


def _goal_fy_year(goal: Goal) -> Optional[int]:
    """Extract the 4-digit fiscal start year from `goal.cycle_name`.

    Goals are stamped at creation with the FY span ("FY26-27" → 2026).
    Legacy "H1 2026" / "H2 2026" stamping is also tolerated for any rows
    that predate the FY-only convention. Returns None when the goal has
    no cycle_name or no recognisable year token.
    """
    if not goal.cycle_name:
        return None
    for token in goal.cycle_name.upper().split():
        # FY span: "FY26-27" → 2026, "FY2026-27" → 2026.
        if token.startswith("FY"):
            head = token[2:].split("-", 1)[0]
            if head.isdigit():
                if len(head) == 2:
                    return 2000 + int(head)
                if len(head) == 4:
                    return int(head)
        # Legacy bare 4-digit year token (e.g. "H1 2026").
        if token.isdigit() and len(token) == 4:
            return int(token)
    return None


# =====================================================================
# CORE CRUD OPERATIONS
# =====================================================================

@router.get("/", response_model=List[GoalResponse])
def list_goals(
    db: DbSession,
    current_user: CurrentUser,
    goal_type: Optional[str] = None,
):
    """
    List the caller's own goals.

    This endpoint is strictly scoped to `Goal.user_id == current_user.id`.
    Mentee goals — even for a mentor — are NOT returned here; use
    GET /goals/team for that view.  Keeping the two endpoints disjoint
    makes it impossible to accidentally mix ownership in the "My Goals" UI.

    Filtering:
        goal_type=annual   — only annual goals
        goal_type=regular  — only regular goals
        (omit goal_type)   — all goals regardless of type
    """
    query = (
        db.query(Goal)
        .options(joinedload(Goal.manager))
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.user_id == current_user.id,
        )
    )

    if goal_type:
        query = query.filter(Goal.goal_type == goal_type)

    return query.order_by(Goal.created_at.desc()).all()


@router.post("/", response_model=GoalResponse, status_code=status.HTTP_201_CREATED)
def create_goal(
    goal_in: GoalCreate,
    db: DbSession,
    current_user: CurrentUser,
    user_id: Optional[int] = None,
):
    """
    Create a new goal.

    For annual goals (goal_type="annual"):
        - annual_goals_edit_enabled must be True (Admin gate)
        - cycle_name is auto-stamped from the active_cycle_name in settings,
          stripped to the bare FY label ("H1 FY26" → "FY26").  This makes the
          goal permanently queryable by fiscal year even after the cycle rotates.

    For regular goals:
        - No gate check; follows existing project-cycle submission rules.
    """
    # ── Authorization: creating on behalf of another user ─────────────
    if user_id and user_id != current_user.id:
        target_user = db.query(User).filter(
            User.id == user_id, User.org_id == current_user.org_id
        ).first()
        if not target_user:
            raise HTTPException(status_code=404, detail="Target user not found.")

        if current_user.role != "HR_MyOrg" and target_user.mentor_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not authorized to create goals for this user.",
            )
        target_user_id = user_id
        target_manager_id = target_user.mentor_id
    else:
        target_user_id = current_user.id
        target_manager_id = current_user.mentor_id

    # Goals require mentor approval, so a user with no mentor (e.g. CEO/founders)
    # cannot create goals — they would get stuck at the approve step forever.
    if target_manager_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Cannot create goals for a user who has no mentor assigned. "
                "Goals require mentor approval — contact an admin to assign a mentor first."
            ),
        )

    # Even if mentor_id is set, the FK can point at a soft-deleted user when
    # admin deactivates a mentor without reassigning their mentees. That
    # routes approval to a dead account — block here with the same message.
    mentor_is_live = db.query(User.id).filter(
        User.id == target_manager_id,
        User.is_deleted == False,  # noqa: E712
    ).first() is not None
    if not mentor_is_live:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "The assigned mentor is no longer active. "
                "Contact an admin to reassign a mentor before creating goals."
            ),
        )

    # ── Gate check + cycle stamping for annual goals ───────────────────
    cycle_name: Optional[str] = None
    if goal_in.goal_type == GoalType.ANNUAL:
        # Stamp the FY cycle at creation time ("FY26-27") from the
        # org's local "now" (timezone-aware). Critical near midnight on
        # a fiscal-year boundary: a user in IST creating a goal at
        # 01:00 IST on April 1 should land in FY27-28, not the server's
        # UTC-still-March-31 answer. Derived first so the gate check
        # below uses the goal's own FY — not a stale active_cycle_name.
        settings = db.query(SystemSettings).filter(
            SystemSettings.org_id == current_user.org_id
        ).first()
        cycle_name = get_goal_cycle_name(resolve_now(settings))
        _assert_annual_gate_open(db, current_user.org_id, cycle_name)

    # ── Build the Goal record ──────────────────────────────────────────
    new_goal = Goal(
        org_id=current_user.org_id,
        user_id=target_user_id,
        manager_id=target_manager_id,
        title=goal_in.title,
        description=goal_in.description,
        attachment_url=goal_in.attachment_url,
        goal_type=goal_in.goal_type.value,
        cycle_name=cycle_name,
        start_date=goal_in.start_date,
        due_date=goal_in.due_date,
        approval_status=ApprovalStatus.DRAFT.value,
    )
    db.add(new_goal)
    db.commit()
    return _get_goal_with_relations(db, new_goal.id, current_user.org_id)


@router.get("/team", response_model=List[TeamGoalResponse])
def list_team_goals(
    db: DbSession,
    current_user: CurrentUser,
    goal_type: Optional[str] = None,
):
    """
    Return annual goals for all of the current user's direct mentees.

    This is the exclusive data source for the Team Goals tab.  Only the
    assigned mentor sees a mentee's goals — there is no Admin bypass.
    If an Admin is also someone's assigned mentor they see those goals;
    otherwise they see nothing here (Admin role ≠ approval authority).
    """
    mentees = db.query(User).filter(
        User.mentor_id == current_user.id,
        User.org_id == current_user.org_id,
        User.is_deleted == False,  # noqa: E712
    ).all()

    if not mentees:
        return []

    mentee_ids = [u.id for u in mentees]

    query = (
        db.query(Goal)
        .options(
            # eager-load the owner + their function/designation so we can
            # inject those onto each row for the mentor-review modal to match
            # the right RoleExpectation without a follow-up request.
            joinedload(Goal.owner).joinedload(User.function),
            joinedload(Goal.owner).joinedload(User.designation),
            joinedload(Goal.manager),
        )
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.user_id.in_(mentee_ids),
            # A mentee's DRAFT is private work; it becomes visible to the
            # mentor only after the mentee requests approval (SUBMITTED).
            Goal.approval_status != ApprovalStatus.DRAFT.value,
        )
    )

    if goal_type:
        query = query.filter(Goal.goal_type == goal_type)

    goals = query.order_by(Goal.created_at.desc()).all()

    # Inject owner_name + owner_function_name + owner_designation_name onto
    # each ORM object so TeamGoalResponse.from_attributes can read them as
    # plain attributes (Pydantic from_attributes mode).
    for g in goals:
        g.owner_name = g.owner.full_name if g.owner else "Unknown"
        g.owner_function_name = (
            g.owner.function.name if g.owner and g.owner.function else None
        )
        g.owner_designation_name = (
            g.owner.designation.name if g.owner and g.owner.designation else None
        )

    return goals


@dataclass
class _AllGoalsFilters:
    """Server-side filter set for GET /goals/all (PR #44, doc 27).

    Split into two groups that get applied in different places:

      Goal-level — narrow which goals match before grouping. Applied
        BOTH to the EXISTS subquery (so a user only appears as a parent
        when they have ≥1 matching goal) AND to the per-page goals
        fetch (so the user's group only contains matching goals).
        Dimensions: fy_year, mentor.

      User-level — narrow which parents we paginate. Applied on the
        users query directly. Dimensions: employee, function,
        designation.

    The split is what makes "filter, then group" work atomically: each
    matching parent only carries their matching goals, and the
    paginated count reflects unique parents with ≥1 match.
    """
    # Goal-level
    fy_year: Optional[int] = None
    mentor: Optional[str] = None
    # ApprovalStatus enum value, or the special "approved" sentinel
    # which expands to POST_APPROVAL_STATES on the server (so HR's
    # "Approved" filter shows APPROVED + every h1/h2/q1..q4 reviewed
    # row, not just the bare APPROVED state).
    approval_status: Optional[str] = None
    # User-level
    employee: Optional[str] = None
    function_name: Optional[str] = None
    designation_name: Optional[str] = None


# ── Sort column map for GET /goals/all (PR #48, doc 31) ─────────────
# Mirrors the frontend's AllGoalsSortBy literal-union. Direct
# user-attribute columns only; derived columns (latest_fy_year,
# latest_manager_name) are deferred — see doc 31 Part 2 for the
# correlated-MAX-subquery sketch.
_ALL_GOALS_SORT_COLUMNS = {
    "owner_name": User.full_name,
    "function_name": Function.name,
    "designation_name": Designation.name,
}


def _apply_goal_level_filters(query, filters: _AllGoalsFilters):
    """Add Goal-level WHERE clauses (fy_year, mentor) to a query that
    already selects from Goal. Helper used by both the EXISTS subquery
    (finding parents) and the page's goals fetch (returning matches).

    `fy_year` filters on Goal.cycle_name via two LIKE patterns:
      - 'FY{yy}%' — matches modern formats "FY26", "FY26-27", "FY2026"
        (FY-prefix with the 2-digit year as the first numeric segment).
      - '%{year}%' — matches legacy "H1 2026" / "H2 2026" rows where
        the full year appears as a free-standing token.

    Both branches are necessary because the schema's `fy_year` computed
    property (`goal_schemas.py:fy_year`) accepts both forms. We mirror
    its acceptance set here on the server to keep the wire param
    consistent with what the frontend dropdown options were derived
    from. Mild perf cost from the `%2026%` unanchored LIKE, but the
    dataset is small enough that the planner falls back to a scan
    either way.

    `mentor` filters on the goal's assigned manager name. Requires an
    aliased User join because Goal.user_id (owner) and Goal.manager_id
    (mentor) both point at the User table — the legacy joinedload(
    Goal.manager) doesn't help here because it's eager-loading the
    attribute, not joining for WHERE-clause purposes.
    """
    if filters.fy_year is not None:
        yy = filters.fy_year % 100
        query = query.filter(
            or_(
                Goal.cycle_name.like(f"FY{yy:02d}%"),
                Goal.cycle_name.like(f"%{filters.fy_year}%"),
            )
        )
    if filters.mentor:
        ManagerAlias = aliased(User)
        query = query.join(
            ManagerAlias, ManagerAlias.id == Goal.manager_id
        ).filter(ManagerAlias.full_name == filters.mentor)
    if filters.approval_status:
        # "approved" expands to the whole post-approval segment (APPROVED
        # itself plus every h1 / h2 / q1..q4 self / mentor reviewed
        # state). Any other value is a direct equality match on the
        # ApprovalStatus enum. Draft is never reachable here because the
        # outer query already filters DRAFT out — HR's All Goals tab
        # intentionally hides draft mentee work.
        if filters.approval_status == ApprovalStatus.APPROVED.value:
            query = query.filter(Goal.approval_status.in_(POST_APPROVAL_STATES))
        else:
            query = query.filter(Goal.approval_status == filters.approval_status)
    return query


@router.get("/all", response_model=Paginated[TeamGoalResponse])
def list_all_goals(
    db: DbSession,
    current_user: CurrentUser,
    limit: int = Query(
        50,
        ge=1,
        le=200,
        description=(
            "Maximum EMPLOYEES to return on this page. Server-clamped to "
            "1..200. Note: the unit is employees, not goal rows — see "
            "the pagination strategy in the docstring."
        ),
    ),
    offset: int = Query(
        0,
        ge=0,
        description="Employees to skip before this page. 0 for the first page.",
    ),
    # ── Server-side filters (PR #44, doc 27) ─────────────────────────
    # See `_AllGoalsFilters` dataclass for the goal-level vs user-level
    # split and where each dimension is applied.
    fy_year: Optional[int] = Query(
        None,
        description=(
            "Fiscal-year integer (2026, 2025, …). Matches Goal.cycle_name "
            "against both modern 'FY26' / 'FY26-27' / 'FY2026' formats "
            "and legacy 'H1 2026' / 'H2 2026' formats."
        ),
    ),
    mentor: Optional[str] = Query(
        None,
        description=(
            "Exact match on the goal's assigned manager (mentor) "
            "full_name. Goal.manager_id is a separate FK to users from "
            "Goal.user_id (the owner)."
        ),
    ),
    employee: Optional[str] = Query(
        None,
        description="Exact match on the goal owner's full_name.",
    ),
    function_: Optional[str] = Query(
        None,
        alias="function",
        description="Exact match on the goal owner's Function name.",
    ),
    designation: Optional[str] = Query(
        None,
        description="Exact match on the goal owner's Designation name.",
    ),
    approval_status: Optional[str] = Query(
        None,
        description=(
            "ApprovalStatus enum value (e.g. 'pending_approval', "
            "'changes_requested') for direct equality, OR the special "
            "value 'approved' which expands to the post-approval segment "
            "(APPROVED + all h1/h2/q1..q4 reviewed states). "
            "'draft' is rejected — HR's All Goals view never surfaces "
            "draft mentee work."
        ),
    ),
    # ── Server-side sort (PR #48, doc 31) ─────────────────────────────
    # Sort the USER list (the parent pagination axis). Derived columns
    # like "latest_fy_year" / "latest_manager_name" would require
    # correlated MAX-style subqueries — deferred to a future PR, see
    # doc 31 Part 2 for the sketch.
    sort_by: Optional[
        Literal["owner_name", "function_name", "designation_name"]
    ] = Query(
        None,
        description=(
            "Primary sort over the paginated USER list. Direct user-"
            "attribute columns only; derived-from-goals columns "
            "(latest_fy_year, latest_manager_name) are deferred."
        ),
    ),
    sort_dir: Literal["asc", "desc"] = Query(
        "asc",
        description="Sort direction. Default 'asc'.",
    ),
):
    """HR_MyOrg-only: paginated annual goals across the org, every cycle.

    Powers the view-only "All Goals" tab on the AnnualGoals page. Excludes
    DRAFT goals — those are the employee's private work-in-progress and
    not yet visible to anyone else (matching the /team endpoint's rule).
    Reuses the TeamGoalResponse shape so the table can render owner +
    function + designation columns without extra lookups.

    ── Pagination strategy: "list of parents" + server filters ─────────
    The AnnualGoals "All Goals" tab GROUPS goals by employee — each
    expandable row is one employee + N matching goals. Naively
    paginating by goal row would split a single employee's group across
    pages, breaking the UI. Instead we paginate by EMPLOYEE (the
    parent), then ship every MATCHING goal for that page's employees
    in one batched fetch.

    Filter / page sequence:
      1. EXISTS subquery: distinct user IDs that have ≥ 1 non-DRAFT
         goal matching the **goal-level filters** (fy_year, mentor).
         User-level filters (employee, function, designation) are
         additionally applied on `users_q` directly.
      2. `total` = count of those user IDs (NOT the goal-row count).
         Same semantics as PR #37 (doc 20) — but the universe is now
         narrowed by the active filter set.
      3. Order users by full_name (stable, alphabetical), OFFSET/LIMIT
         that list.
      4. Fetch all goals MATCHING THE GOAL-LEVEL FILTERS for the
         page's user IDs, with the existing eager-load options. So a
         user filtered to fy_year=2026 only shows their 2026 goals
         in the group, not their 2025 ones — matches what the
         frontend's legacy client-side filter did.

    The filter set is captured in `_AllGoalsFilters` and the goal-level
    portion is applied via `_apply_goal_level_filters(query, filters)`
    in both step 1 and step 4. User-level filters apply only in step 1.

    Why offset/limit and not cursor: same rationale as PR #36 — slow
    churn, simple `useInfiniteQuery` recipe.

    Returns `Paginated[TeamGoalResponse]` where `items` carries goal
    rows (not user rows) and `total` is the FILTERED employee count.
    """
    if current_user.role != Role.HR_MYORG.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the Healthark HR can view all goals.",
        )

    filters = _AllGoalsFilters(
        fy_year=fy_year,
        mentor=mentor,
        approval_status=approval_status,
        employee=employee,
        function_name=function_,
        designation_name=designation,
    )

    # ── Step 1: distinct user IDs with ≥ 1 non-DRAFT goal matching the
    # goal-level filter set. The EXISTS subquery keeps us from joining
    # Goal at the outer level (the join would multiply user rows by
    # goal count before DISTINCT). Apply goal-level filters INSIDE the
    # subquery so the existence check is filter-aware.
    has_goal_subq_q = (
        db.query(Goal.user_id)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.approval_status != ApprovalStatus.DRAFT.value,
            Goal.user_id == User.id,
        )
    )
    has_goal_subq_q = _apply_goal_level_filters(has_goal_subq_q, filters)
    has_goal_subq = has_goal_subq_q.exists()

    # Exclude deactivated users from HR's "All Goals" pagination —
    # historical detail views still resolve by id, but ghost rows
    # for deleted employees should not appear in the listing.
    users_q = (
        db.query(User)
        .filter(
            User.org_id == current_user.org_id,
            User.is_deleted == False,  # noqa: E712
        )
        .filter(has_goal_subq)
    )

    # User-level filters narrow which PARENTS we paginate. Sort dims
    # can also need the Function/Designation joins even if no filter
    # references them — same compose-with-sort logic from doc 30 Part 3.
    needs_function_join = bool(filters.function_name) or sort_by == "function_name"
    needs_designation_join = (
        bool(filters.designation_name) or sort_by == "designation_name"
    )

    if filters.employee:
        users_q = users_q.filter(User.full_name == filters.employee)
    if needs_function_join:
        users_q = users_q.join(Function, Function.id == User.function_id)
        if filters.function_name:
            users_q = users_q.filter(Function.name == filters.function_name)
    if needs_designation_join:
        users_q = users_q.join(
            Designation, Designation.id == User.designation_id
        )
        if filters.designation_name:
            users_q = users_q.filter(Designation.name == filters.designation_name)

    # ORDER BY. Default sort: full_name asc (alphabetical). User-picked
    # primary replaces it; `User.id.asc()` tiebreaker survives the
    # swap, same pattern as doc 30 Part 2.
    if sort_by is None:
        users_q = users_q.order_by(User.full_name.asc(), User.id.asc())
    else:
        sort_column = _ALL_GOALS_SORT_COLUMNS[sort_by]
        primary = sort_column.asc() if sort_dir == "asc" else sort_column.desc()
        users_q = users_q.order_by(primary, User.id.asc())

    # ── Step 2: count for the response's `total`. Single COUNT(*) over
    # the same filter; pairs with `has_more` arithmetic below. The unit
    # is FILTERED EMPLOYEES, not goal rows — see docstring.
    total_users = users_q.with_entities(User.id).count()

    # ── Step 3: page through the user list.
    page_users = users_q.offset(offset).limit(limit).all()
    page_user_ids = [u.id for u in page_users]

    # ── Step 4: fetch every NON-DRAFT, FILTER-MATCHING goal for those
    # users in one batched query. The goal-level filters are re-applied
    # here so the page only contains matching goals (a user filtered to
    # fy_year=2026 must NOT also get their 2025 goals back).
    if page_user_ids:
        goals_q = (
            db.query(Goal)
            .options(
                joinedload(Goal.owner).joinedload(User.function),
                joinedload(Goal.owner).joinedload(User.designation),
                joinedload(Goal.manager),
            )
            .filter(
                Goal.org_id == current_user.org_id,
                Goal.approval_status != ApprovalStatus.DRAFT.value,
                Goal.user_id.in_(page_user_ids),
            )
        )
        goals_q = _apply_goal_level_filters(goals_q, filters)
        goals = goals_q.order_by(Goal.created_at.desc()).all()
        # Re-order to match Step 3's user pagination (PR #48, doc 31).
        # SQL ordered goals by created_at desc; Python's stable sort
        # by user-index preserves that within-group ordering while
        # making groups appear in the same order step 3 paginated
        # users. Without this, the frontend's `buildAllGoalsGroups`
        # would assemble groups in "most-recent-goal-first" order
        # regardless of the user pagination's sort_by — a regression
        # vs the legacy client-side sort the previous PR's
        # introduced.
        user_order = {u.id: i for i, u in enumerate(page_users)}
        goals.sort(key=lambda g: user_order.get(g.user_id, len(page_users)))
    else:
        goals = []

    for g in goals:
        g.owner_name = g.owner.full_name if g.owner else "Unknown"
        g.owner_function_name = (
            g.owner.function.name if g.owner and g.owner.function else None
        )
        g.owner_designation_name = (
            g.owner.designation.name if g.owner and g.owner.designation else None
        )

    # `has_more` is computed in the EMPLOYEE unit — the next page exists
    # iff we haven't yet streamed every goal-owning employee in the org.
    # Mirrors the "stop when the parent cursor exhausts" pattern in the
    # frontend's `getNextPageParam`.
    return Paginated[TeamGoalResponse](
        items=goals,
        total=total_users,
        limit=limit,
        offset=offset,
        has_more=(offset + len(page_users)) < total_users,
    )


@router.get("/all/distinct-years", response_model=List[int])
def list_distinct_goal_years(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Distinct fiscal years that have at least one annual goal in this org.

    Powers the Year filter dropdown on the AnnualGoals HR "All Goals" tab.
    Without this endpoint, the dropdown options would derive from the
    server-filtered visible rows — picking any year shrinks the data,
    which would shrink the dropdown to only the selected year and lock
    HR out of changing their selection.

    Parses `Goal.cycle_name` ("FY26-27", legacy "FY26", "H1 2026", etc.)
    to the 4-digit start year using the same logic as
    `GoalResponse.fy_year`. Returns sorted descending (newest first).
    """
    if current_user.role != Role.HR_MYORG.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the Healthark HR can list distinct goal years.",
        )

    # Restrict to active users so HR's filter dropdown doesn't surface
    # a cycle that only exists on deactivated employees' rows — they'd
    # never see any matching rows after picking that year.
    cycle_rows = (
        db.query(Goal.cycle_name)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.goal_type == GoalType.ANNUAL.value,
            Goal.cycle_name.isnot(None),
            Goal.user_id.in_(active_user_ids_query(db, current_user.org_id)),
        )
        .distinct()
        .all()
    )

    years: set[int] = set()
    for (cycle_name,) in cycle_rows:
        if not cycle_name:
            continue
        for token in cycle_name.upper().split():
            if token.startswith("FY"):
                head = token[2:].split("-", 1)[0]
                if head.isdigit():
                    if len(head) == 2:
                        years.add(2000 + int(head))
                    elif len(head) == 4:
                        years.add(int(head))
                break
            if token.isdigit() and len(token) == 4:
                years.add(int(token))
                break

    return sorted(years, reverse=True)


@router.get("/{goal_id}", response_model=GoalResponse)
def get_goal(
    goal_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Get a single goal by ID, including its half-cycle review history.
    Access restricted to the owner, their mentor, or org Admins.
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    is_manager = current_user.role == "HR_MyOrg" or (
        goal_owner and goal_owner.mentor_id == current_user.id
    )
    is_owner = goal.user_id == current_user.id

    if not (is_owner or is_manager):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to view this goal.",
        )

    return goal


@router.patch("/{goal_id}", response_model=GoalResponse)
def update_goal(
    goal_id: int,
    goal_in: GoalUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Update a goal's properties.

    Additional gate for annual goals (employees only):
        annual_goals_edit_enabled must be True.  Mentors and Admins bypass
        this check — they can always leave feedback and adjust metadata.

    Resets approval_status from CHANGES_REQUESTED → DRAFT when the employee
    edits, so they can re-submit for another review cycle.
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    is_manager = current_user.role == "HR_MyOrg" or (
        goal_owner and goal_owner.mentor_id == current_user.id
    )
    is_owner = goal.user_id == current_user.id

    if not (is_owner or is_manager):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have permission to edit this goal.",
        )

    # Approved or post-approval goals (anything in the H1/H2 review segment)
    # are locked for employees; managers can still update them.
    if goal.approval_status in POST_APPROVAL_STATES and not is_manager:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Approved goals cannot be edited. Contact your mentor.",
        )

    # Gate check: employees cannot edit annual goals when the window is closed.
    # Managers bypass this — they need access to leave feedback at any time.
    if goal.goal_type == GoalType.ANNUAL.value and not is_manager:
        _assert_annual_gate_open(
            db, current_user.org_id, _fy_label_of_goal(goal)
        )

    update_data = goal_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(goal, field, value)

    # Reset to draft when an employee edits a changes_requested goal so they
    # can go through the submit → approve flow again.
    if is_owner and goal.approval_status == ApprovalStatus.CHANGES_REQUESTED.value:
        goal.approval_status = ApprovalStatus.DRAFT.value

    db.commit()
    return _get_goal_with_relations(db, goal.id, current_user.org_id)


@router.delete("/{goal_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_goal(
    goal_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Permanently delete a goal.

    Employees can only delete their own DRAFT goals.
    Annual-goal employees additionally need annual_goals_edit_enabled = True.
    Mentors and Admins can delete any goal regardless of state or gate.
    """
    goal = db.query(Goal).filter(
        Goal.id == goal_id, Goal.org_id == current_user.org_id
    ).first()
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found.")

    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    is_manager = current_user.role == "HR_MyOrg" or (
        goal_owner and goal_owner.mentor_id == current_user.id
    )
    is_owner = goal.user_id == current_user.id

    if not (is_owner or is_manager):
        raise HTTPException(status_code=403, detail="Permission denied.")

    if is_owner and not is_manager:
        if goal.approval_status != ApprovalStatus.DRAFT.value:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot delete a goal that has already been submitted for approval.",
            )
        # Gate check for annual goal deletion (same window logic as create/edit).
        if goal.goal_type == GoalType.ANNUAL.value:
            _assert_annual_gate_open(
                db, current_user.org_id, _fy_label_of_goal(goal)
            )

    db.delete(goal)
    db.commit()
    return None


# =====================================================================
# WORKFLOW OPERATIONS (Submit & Approve)
# =====================================================================

@router.patch("/{goal_id}/submit", response_model=GoalResponse)
def submit_goal(
    goal_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Move a goal from DRAFT → SUBMITTED.

    Intentionally has no gate check for annual_goals_edit_enabled:
    a user who completed their goal before the window closed should
    still be able to submit it for mentor review.
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    is_manager = current_user.role == "HR_MyOrg" or (
        goal_owner and goal_owner.mentor_id == current_user.id
    )
    is_owner = goal.user_id == current_user.id

    if not (is_owner or is_manager):
        raise HTTPException(status_code=403, detail="Permission denied.")

    # Defense-in-depth: if the goal owner's mentor was unassigned after the
    # draft was created, block submission — no one can approve it otherwise.
    if not goal_owner or goal_owner.mentor_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Cannot submit a goal for a user who has no mentor assigned. "
                "Goals require mentor approval — contact an admin to assign a mentor first."
            ),
        )

    if goal.approval_status != ApprovalStatus.DRAFT.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only draft goals can be submitted.",
        )

    goal.approval_status = ApprovalStatus.PENDING_APPROVAL.value
    db.commit()

    notify(
        db,
        org_id=current_user.org_id,
        recipient_id=goal_owner.mentor_id,
        sender_id=current_user.id,
        module="goal",
        entity_type="goal",
        entity_id=goal.id,
        message=f"{goal_owner.full_name} submitted a goal for your approval.",
        entity_url=f"/annual-goals?goal_id={goal.id}",
    )
    db.commit()

    return _get_goal_with_relations(db, goal.id, current_user.org_id)


@router.patch("/{goal_id}/approve", response_model=GoalResponse)
def approve_goal(
    goal_id: int,
    approval_in: GoalApprovalUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Mentor/Admin approves or rejects a submitted goal.

    When approved:
        - approval_status → APPROVED
        - approved_at     → current UTC timestamp
          This timestamp enables future period-based filtering:
          e.g. "goals approved during H1 FY26" for dashboards and reports.

    When changes are requested:
        - approval_status → CHANGES_REQUESTED
        - manager_feedback is set with the mentor's comments
        - approved_at remains None (goal was never approved)
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    # Only the goal owner's assigned mentor may approve or reject.
    # Admin role does NOT grant approval authority — Admins manage system
    # settings, not individual goal reviews.  If an Admin is also the
    # assigned mentor for this user they can still approve via that relationship.
    if not goal_owner or goal_owner.mentor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Only the assigned mentor can approve or request changes on this goal. "
                "Contact the goal owner's mentor."
            ),
        )

    if goal.approval_status != ApprovalStatus.PENDING_APPROVAL.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Goal is not currently awaiting approval.",
        )

    goal.approval_status = approval_in.approval_status.value
    goal.manager_feedback = approval_in.feedback

    # Stamp the approval timestamp only on the APPROVED transition.
    # CHANGES_REQUESTED leaves approved_at as None — the goal was not approved.
    if approval_in.approval_status == ApprovalStatus.APPROVED:
        goal.approved_at = datetime.now(timezone.utc)

    db.commit()

    if approval_in.approval_status == ApprovalStatus.APPROVED:
        notify(
            db,
            org_id=current_user.org_id,
            recipient_id=goal.user_id,
            sender_id=current_user.id,
            module="goal",
            entity_type="goal",
            entity_id=goal.id,
            message="Your goal was approved.",
            entity_url=f"/annual-goals?goal_id={goal.id}",
        )
    else:
        # CHANGES_REQUESTED — include a feedback snippet so the recipient
        # knows what to act on without opening the goal first.
        feedback_snippet = (approval_in.feedback or "").strip()
        if len(feedback_snippet) > 200:
            feedback_snippet = feedback_snippet[:200] + "…"
        message = (
            f"Changes requested on your goal: {feedback_snippet}"
            if feedback_snippet
            else "Your mentor requested changes on your goal."
        )
        notify(
            db,
            org_id=current_user.org_id,
            recipient_id=goal.user_id,
            sender_id=current_user.id,
            module="goal",
            entity_type="goal",
            entity_id=goal.id,
            message=message,
            entity_url=f"/annual-goals?goal_id={goal.id}",
        )
    db.commit()

    return _get_goal_with_relations(db, goal.id, current_user.org_id)


@router.post("/bulk-approve", response_model=GoalBulkApproveResult)
def bulk_approve_goals(
    payload: GoalBulkApproveRequest,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Mentor-side bulk approval. Loads the requested goals (org-scoped),
    validates each one independently against the same rules as the single-
    goal /approve endpoint (mentor must own the relationship; goal must be
    PENDING_APPROVAL), and approves the valid set in a single transaction.

    Returns a per-goal outcome rather than failing the whole batch — so the
    UI can show "approved 8 of 10" when a goal slips state between modal
    open and submit (e.g. another tab approved it first, or the mentee
    edited it back to draft).
    """
    requested_ids = list(dict.fromkeys(payload.goal_ids))  # de-dup, preserve order

    goals = (
        db.query(Goal)
        .filter(Goal.id.in_(requested_ids), Goal.org_id == current_user.org_id)
        .all()
    )
    by_id = {g.id: g for g in goals}

    # Pre-fetch all owners in one query so we can do mentor-relationship
    # checks without N round-trips.
    owner_ids = {g.user_id for g in goals}
    owners = db.query(User).filter(User.id.in_(owner_ids)).all() if owner_ids else []
    owner_by_id = {u.id: u for u in owners}

    approved_ids: list[int] = []
    failures: list[GoalBulkApproveFailure] = []
    now = datetime.now(timezone.utc)

    for goal_id in requested_ids:
        goal = by_id.get(goal_id)
        if goal is None:
            failures.append(GoalBulkApproveFailure(
                goal_id=goal_id,
                reason="Goal not found or not in your organization.",
            ))
            continue

        owner = owner_by_id.get(goal.user_id)
        if owner is None or owner.mentor_id != current_user.id:
            failures.append(GoalBulkApproveFailure(
                goal_id=goal_id,
                reason="You are not the assigned mentor for this goal's owner.",
            ))
            continue

        if goal.approval_status != ApprovalStatus.PENDING_APPROVAL.value:
            failures.append(GoalBulkApproveFailure(
                goal_id=goal_id,
                reason="Goal is not currently awaiting approval.",
            ))
            continue

        goal.approval_status = ApprovalStatus.APPROVED.value
        goal.manager_feedback = None
        goal.approved_at = now
        approved_ids.append(goal_id)

    db.commit()

    # One notification per approved goal (recipient = goal owner). We don't
    # coalesce per-recipient at the model layer; if a mentee gets 5 goals
    # approved at once they see 5 rows, which mirrors the lifecycle truth.
    # The frontend can group on render later if it gets noisy.
    for goal_id in approved_ids:
        goal = by_id[goal_id]
        notify(
            db,
            org_id=current_user.org_id,
            recipient_id=goal.user_id,
            sender_id=current_user.id,
            module="goal",
            entity_type="goal",
            entity_id=goal.id,
            message="Your goal was approved.",
            entity_url=f"/annual-goals?goal_id={goal.id}",
        )
    if approved_ids:
        db.commit()

    return GoalBulkApproveResult(approved_ids=approved_ids, failures=failures)


@router.post("/{goal_id}/notify", status_code=status.HTTP_204_NO_CONTENT)
def notify_goal_owner(
    goal_id: int,
    payload: GoalNotifyRequest,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Mentor sends a free-text notification to the owner of a goal they
    mentor. Surfaced from the Team Goals tab's "Notify" button on each
    row. The message lands in the topbar bell as an in-app notification.

    Auth: caller must be the goal owner's assigned mentor. Admin role
    alone is not enough — mirrors the /approve relationship check.
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    if not goal_owner or goal_owner.mentor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the assigned mentor can notify this goal's owner.",
        )

    notify(
        db,
        org_id=current_user.org_id,
        recipient_id=goal_owner.id,
        sender_id=current_user.id,
        module="goal",
        entity_type="goal",
        entity_id=goal.id,
        message=payload.message,
        entity_url=f"/annual-goals?goal_id={goal.id}",
    )
    db.commit()
    return None


@router.patch(
    "/{goal_id}/self-review/{cycle_half}",
    response_model=GoalResponse,
)
def submit_goal_self_review(
    goal_id: int,
    cycle_half: SelfReviewCycleHalf,
    payload: GoalSelfReviewSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Owner submits their self-review on an APPROVED goal for ONE half
    of the fiscal year (H1 or H2). Advances the goal's approval_status
    to H1_SELF_REVIEWED or H2_SELF_REVIEWED.

    Gates:
        - Only the goal owner may submit.
        - State machine: H1 self requires status APPROVED.
                         H2 self requires status in {APPROVED, H1_SELF_REVIEWED,
                                                     H1_MENTOR_REVIEWED}.
        - Time window: today must be in the (cycle_half, goal.fy_year)
          window — see cycle_utils.is_review_window_open. H1 reviews can
          be backfilled during H2 of the same FY; H2 cannot be pre-empted;
          neither can cross a fiscal-year boundary.
        - One-shot per (goal_id, cycle_half) — DB unique index is the
          final guard; the state machine prevents the case in normal flow.

    On success the updated goal is returned with the full self_reviews
    list (so the frontend can re-render both H1 and H2 rows).
    """
    _assert_half_cadence(cycle_half)
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)

    if goal.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the goal owner can submit a self-review.",
        )

    # Status gate — which states are allowed to *start* this transition?
    half = cycle_half.value
    allowed_states = _self_review_allowed_states(half)
    if goal.approval_status not in allowed_states:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Self-review for {half} cannot be submitted from the "
                f"current state ({goal.approval_status})."
            ),
        )

    # Time-window gate — which calendar moment allows this submission?
    settings = _get_settings(db, current_user.org_id)
    fy_year = _goal_fy_year(goal)
    if fy_year is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Goal has no fiscal year on record; cannot submit reviews.",
        )
    if not is_review_window_open(
        half, fy_year, resolve_today(settings), settings.fiscal_start_month,
        override=settings.cycle_window_override,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"The review window for {half} FY{fy_year % 100:02d}-"
                f"{(fy_year + 1) % 100:02d} is not currently open."
            ),
        )

    # If a draft row already exists for this half, promote it to submitted
    # (clear is_draft, overwrite text). If a non-draft row exists, the
    # state machine should have caught it — defensive belt-and-suspenders.
    existing = next(
        (sr for sr in goal.self_reviews if sr.cycle_half == half),
        None,
    )
    if existing is not None and not existing.is_draft:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Self-review for {half} has already been submitted for this goal.",
        )

    if existing is not None:
        # Promote draft → submitted.
        existing.self_overall_review = payload.self_overall_review
        existing.is_draft = False
    else:
        review = GoalSelfReview(
            goal_id=goal.id,
            org_id=current_user.org_id,
            cycle_half=half,
            self_overall_review=payload.self_overall_review,
            is_draft=False,
        )
        db.add(review)
    # Advance the goal's lifecycle state.
    goal.approval_status = _self_reviewed_state(half)
    db.commit()

    # Owner is the sender; mentor is the recipient. In-app only — email
    # for every half-cycle self-review across a mentor's whole team would
    # be too noisy.
    owner = db.query(User).filter(User.id == goal.user_id).first()
    if owner and owner.mentor_id:
        notify(
            db,
            org_id=current_user.org_id,
            recipient_id=owner.mentor_id,
            sender_id=current_user.id,
            module="goal",
            entity_type="goal",
            entity_id=goal.id,
            message=f"{owner.full_name} submitted a {half} self-review.",
            entity_url=f"/annual-goals?goal_id={goal.id}",
        )
        db.commit()

    return _get_goal_with_relations(db, goal.id, current_user.org_id)


@router.patch(
    "/{goal_id}/self-review/{cycle_half}/draft",
    response_model=GoalResponse,
)
def save_goal_self_review_draft(
    goal_id: int,
    cycle_half: SelfReviewCycleHalf,
    payload: GoalSelfReviewDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Owner saves an in-progress self-review without submitting. Same auth +
    state + time-window gates as the submit endpoint, but the row is
    written with ``is_draft=True`` and the goal's ``approval_status`` is
    NOT advanced. Reopening the form re-uses the draft. The Submit
    endpoint clears ``is_draft`` and advances state.
    """
    _assert_half_cadence(cycle_half)
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)

    if goal.user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the goal owner can save a self-review draft.",
        )

    half = cycle_half.value
    allowed_states = _self_review_allowed_states(half)
    if goal.approval_status not in allowed_states:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Self-review for {half} cannot be drafted from the current "
                f"state ({goal.approval_status})."
            ),
        )

    settings = _get_settings(db, current_user.org_id)
    fy_year = _goal_fy_year(goal)
    if fy_year is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Goal has no fiscal year on record; cannot draft reviews.",
        )
    if not is_review_window_open(
        half, fy_year, resolve_today(settings), settings.fiscal_start_month,
        override=settings.cycle_window_override,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"The review window for {half} FY{fy_year % 100:02d}-"
                f"{(fy_year + 1) % 100:02d} is not currently open."
            ),
        )

    existing = next(
        (sr for sr in goal.self_reviews if sr.cycle_half == half),
        None,
    )
    if existing is not None and not existing.is_draft:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Self-review for {half} has already been submitted; drafts "
                f"can no longer be saved."
            ),
        )

    if existing is not None:
        existing.self_overall_review = payload.self_overall_review
        existing.is_draft = True
    else:
        draft = GoalSelfReview(
            goal_id=goal.id,
            org_id=current_user.org_id,
            cycle_half=half,
            self_overall_review=payload.self_overall_review,
            is_draft=True,
        )
        db.add(draft)
    db.commit()
    return _get_goal_with_relations(db, goal.id, current_user.org_id)


@router.patch(
    "/{goal_id}/mentor-review/{cycle_half}",
    response_model=GoalResponse,
)
def submit_goal_mentor_review(
    goal_id: int,
    cycle_half: SelfReviewCycleHalf,
    payload: GoalMentorReviewSubmit,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Mentor submits their review of a mentee's self-review for one half.
    Advances the goal's approval_status to H1_MENTOR_REVIEWED or
    H2_MENTOR_REVIEWED.

    Gates:
        - Caller must be the goal owner's assigned mentor.
        - State machine: H1 mentor requires status H1_SELF_REVIEWED.
                         H2 mentor requires status H2_SELF_REVIEWED.
          (The state machine implies the mentee has self-reviewed first;
          the explicit row check below is a defensive belt-and-suspenders.)
        - Time window: today must be in the (cycle_half, goal.fy_year)
          window — same rule as self-review.
        - One-shot per (goal_id, cycle_half) — DB unique index is the
          final guard.
    """
    _assert_half_cadence(cycle_half)
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    if not goal_owner or goal_owner.mentor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the assigned mentor can submit a mentor review.",
        )

    half = cycle_half.value
    required_state = _self_reviewed_state(half)
    if goal.approval_status != required_state:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Mentor review for {half} cannot be submitted from the "
                f"current state ({goal.approval_status}). The mentee must "
                f"submit their {half} self-review first."
            ),
        )

    # Time-window gate.
    settings = _get_settings(db, current_user.org_id)
    fy_year = _goal_fy_year(goal)
    if fy_year is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Goal has no fiscal year on record; cannot submit reviews.",
        )
    if not is_review_window_open(
        half, fy_year, resolve_today(settings), settings.fiscal_start_month,
        override=settings.cycle_window_override,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"The review window for {half} FY{fy_year % 100:02d}-"
                f"{(fy_year + 1) % 100:02d} is not currently open."
            ),
        )

    # Defensive checks — state machine should make these unreachable.
    # The mentee's row must exist AND be submitted (not a draft) before
    # the mentor can submit their review.
    mentee_review = next(
        (sr for sr in goal.self_reviews if sr.cycle_half == half and not sr.is_draft),
        None,
    )
    if mentee_review is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"The mentee has not yet submitted their self-review for {half}.",
        )
    existing = next(
        (mr for mr in goal.mentor_reviews if mr.cycle_half == half),
        None,
    )
    if existing is not None and not existing.is_draft:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Mentor review for {half} has already been submitted.",
        )

    if existing is not None:
        # Promote draft → submitted.
        existing.mentor_overall_review = payload.mentor_overall_review
        existing.is_draft = False
    else:
        mentor_review = GoalMentorReview(
            goal_id=goal.id,
            org_id=current_user.org_id,
            cycle_half=half,
            mentor_overall_review=payload.mentor_overall_review,
            is_draft=False,
        )
        db.add(mentor_review)
    # Advance the goal's lifecycle state.
    goal.approval_status = _mentor_reviewed_state(half)
    db.commit()

    # Mentor is the sender; mentee is the recipient. In-app only —
    # mentor reviews land alongside the existing in-product review
    # surface; an email per goal per half would be too chatty.
    notify(
        db,
        org_id=current_user.org_id,
        recipient_id=goal.user_id,
        sender_id=current_user.id,
        module="goal",
        entity_type="goal",
        entity_id=goal.id,
        message=f"Your mentor submitted their {half} review.",
        entity_url=f"/annual-goals?goal_id={goal.id}",
    )
    db.commit()

    return _get_goal_with_relations(db, goal.id, current_user.org_id)


@router.patch(
    "/{goal_id}/mentor-review/{cycle_half}/draft",
    response_model=GoalResponse,
)
def save_goal_mentor_review_draft(
    goal_id: int,
    cycle_half: SelfReviewCycleHalf,
    payload: GoalMentorReviewDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Mentor saves an in-progress mentor review without submitting. Same
    auth + state + time-window gates as the submit endpoint, but the row
    is written with ``is_draft=True`` and the goal's ``approval_status``
    is NOT advanced.
    """
    _assert_half_cadence(cycle_half)
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    if not goal_owner or goal_owner.mentor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the assigned mentor can save a mentor-review draft.",
        )

    half = cycle_half.value
    required_state = _self_reviewed_state(half)
    if goal.approval_status != required_state:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Mentor review for {half} cannot be drafted from the current "
                f"state ({goal.approval_status}). The mentee must submit their "
                f"{half} self-review first."
            ),
        )

    settings = _get_settings(db, current_user.org_id)
    fy_year = _goal_fy_year(goal)
    if fy_year is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Goal has no fiscal year on record; cannot draft reviews.",
        )
    if not is_review_window_open(
        half, fy_year, resolve_today(settings), settings.fiscal_start_month,
        override=settings.cycle_window_override,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"The review window for {half} FY{fy_year % 100:02d}-"
                f"{(fy_year + 1) % 100:02d} is not currently open."
            ),
        )

    mentee_review = next(
        (sr for sr in goal.self_reviews if sr.cycle_half == half and not sr.is_draft),
        None,
    )
    if mentee_review is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"The mentee has not yet submitted their self-review for {half}.",
        )

    existing = next(
        (mr for mr in goal.mentor_reviews if mr.cycle_half == half),
        None,
    )
    if existing is not None and not existing.is_draft:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Mentor review for {half} has already been submitted; drafts "
                f"can no longer be saved."
            ),
        )

    if existing is not None:
        existing.mentor_overall_review = payload.mentor_overall_review
        existing.is_draft = True
    else:
        draft = GoalMentorReview(
            goal_id=goal.id,
            org_id=current_user.org_id,
            cycle_half=half,
            mentor_overall_review=payload.mentor_overall_review,
            is_draft=True,
        )
        db.add(draft)
    db.commit()
    return _get_goal_with_relations(db, goal.id, current_user.org_id)


