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

from datetime import date, datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from sqlalchemy.orm import joinedload

from app.api.dependencies import DbSession, CurrentUser
from app.models.goal_models import Goal, ApprovalStatus, GoalType, POST_APPROVAL_STATES
from app.models.goal_criteria_models import GoalCriterion
from app.models.goal_self_review_models import GoalSelfReview, SelfReviewCycleHalf
from app.models.goal_mentor_review_models import GoalMentorReview
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
from app.schemas.goal_schemas import (
    GoalCreate,
    GoalUpdate,
    GoalResponse,
    GoalApprovalUpdate,
    GoalBulkApproveRequest,
    GoalBulkApproveResult,
    GoalBulkApproveFailure,
    GoalSelfReviewSubmit,
    GoalSelfReviewDraft,
    GoalMentorReviewSubmit,
    GoalMentorReviewDraft,
    TeamGoalResponse,
)
from app.core.cycle_utils import (
    cycles_before,
    get_goal_cycle_name,
    is_review_window_open,
)

router = APIRouter()


# ── Helpers ──────────────────────────────────────────────────────────

def _get_goal_with_relations(db: DbSession, goal_id: int, org_id: int) -> Goal:
    """Fetch a goal with eagerly loaded criteria + manager, scoped to the org."""
    goal = (
        db.query(Goal)
        .options(joinedload(Goal.criteria), joinedload(Goal.manager))
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


def _assert_annual_gate_open(settings: SystemSettings) -> None:
    """Raise 403 when the annual-goal edit window is closed."""
    if not settings.annual_goals_edit_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Annual goal submissions are currently closed. "
                "Please wait for the Admin to open the next submission window."
            ),
        )


def _goal_fy_year(goal: Goal) -> Optional[int]:
    """Extract the 4-digit fiscal start year from `goal.cycle_name`.

    Goal cycle names are stamped at creation as "H1 2026" / "H2 2025"
    (4-digit year, no FY prefix — see get_goal_cycle_name). Returns None
    when the goal predates this stamping or has no cycle_name.
    """
    if not goal.cycle_name:
        return None
    for token in goal.cycle_name.split():
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
        .options(joinedload(Goal.manager), joinedload(Goal.criteria))
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

        if current_user.role != "Admin" and target_user.mentor_id != current_user.id:
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
        settings = _get_settings(db, current_user.org_id)
        _assert_annual_gate_open(settings)
        # Stamp the half-yearly cycle at creation time ("H1 2026", "H2 2025").
        # Derived from the wall-clock UTC time so it's always accurate regardless
        # of which active_cycle_name the admin has set.
        cycle_name = get_goal_cycle_name(datetime.now(timezone.utc))

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
    db.flush()  # Generates new_goal.id required by criteria FK

    if goal_in.criteria:
        criteria_objects = [
            GoalCriterion(
                goal_id=new_goal.id,
                org_id=current_user.org_id,
                title=c.title,
                sort_order=i,
            )
            for i, c in enumerate(goal_in.criteria)
        ]
        db.add_all(criteria_objects)

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
            # eager-load the owner + their department/designation so we can
            # inject those onto each row for the mentor-review modal to match
            # the right RoleExpectation without a follow-up request.
            joinedload(Goal.owner).joinedload(User.department),
            joinedload(Goal.owner).joinedload(User.designation),
            joinedload(Goal.manager),
            joinedload(Goal.criteria),
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

    # Inject owner_name + owner_department_name + owner_designation_name onto
    # each ORM object so TeamGoalResponse.from_attributes can read them as
    # plain attributes (Pydantic from_attributes mode).
    for g in goals:
        g.owner_name = g.owner.full_name if g.owner else "Unknown"
        g.owner_department_name = (
            g.owner.department.name if g.owner and g.owner.department else None
        )
        g.owner_designation_name = (
            g.owner.designation.name if g.owner and g.owner.designation else None
        )

    return goals


@router.get("/{goal_id}", response_model=GoalResponse)
def get_goal(
    goal_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Get a single goal by ID, including its nested criteria.
    Access restricted to the owner, their mentor, or org Admins.
    """
    goal = _get_goal_with_relations(db, goal_id, current_user.org_id)
    goal_owner = db.query(User).filter(User.id == goal.user_id).first()

    is_manager = current_user.role == "Admin" or (
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

    is_manager = current_user.role == "Admin" or (
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
        settings = _get_settings(db, current_user.org_id)
        _assert_annual_gate_open(settings)

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

    is_manager = current_user.role == "Admin" or (
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
            settings = _get_settings(db, current_user.org_id)
            _assert_annual_gate_open(settings)

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

    is_manager = current_user.role == "Admin" or (
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
    return GoalBulkApproveResult(approved_ids=approved_ids, failures=failures)


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
    if not is_review_window_open(half, fy_year, date.today(), settings.fiscal_start_month):
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
    if not is_review_window_open(half, fy_year, date.today(), settings.fiscal_start_month):
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
    if not is_review_window_open(half, fy_year, date.today(), settings.fiscal_start_month):
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
    if not is_review_window_open(half, fy_year, date.today(), settings.fiscal_start_month):
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


