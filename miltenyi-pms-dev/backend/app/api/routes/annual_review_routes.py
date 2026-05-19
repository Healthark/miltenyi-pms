"""
AnnualReview Routes — The 3-Stage Appraisal Workflow.

Endpoints:
    ── Stage 1: Employee ──
    POST  /annual-reviews/self              → Create + submit self-appraisal
    PATCH /annual-reviews/{id}/draft        → Save draft (partial, no status change)
    GET   /annual-reviews/mine              → Active-cycle review (404 if none)
    GET   /annual-reviews/mine/history      → All reviews owned by current user

    ── Stage 2: Mentor ──
    GET   /annual-reviews/mentees           → Reviews for mentor's direct mentees
    PATCH /annual-reviews/{id}/mentor-eval  → Submit mentor evaluation

    ── Stage 3: Management ──
    GET   /annual-reviews/calibration            → Calibration grid (all org reviews)
    PATCH /annual-reviews/{id}/management-rating → Set/override management rating inline

    ── Shared ──
    GET   /annual-reviews/{id}              → Get single review by ID

Security Layers:
    Layer 1 — Authentication:     CurrentUser dependency
    Layer 2 — Tenant Isolation:   All queries filter by org_id
    Layer 3 — Role Authorization: Admin endpoints gated
    Layer 4 — Ownership:          Stage-specific identity checks
    Layer 5 — Visibility Gate:    final_performance_rating is hidden from the
                                   employee unless BOTH the per-row
                                   final_rating_enabled AND the org-wide
                                   annual_review_final_rating_visible flags
                                   are True.
"""

from typing import List, Literal, Optional
from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import and_, or_
from sqlalchemy.orm import aliased, joinedload

from app.api.dependencies import DbSession, CurrentUser
from app.services.notification_service import notify
from app.core.cycle_utils import (
    _fy_label_of_review,
    ensure_year_override_row,
    extract_fy_label,
    get_current_cycle_info,
    get_year_override,
    resolve_today,
)
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.reference_models import Function, Designation
from app.models.system_settings_models import SystemSettings, CycleType
from app.models.user_models import User, Role
from app.schemas.annual_review_schemas import (
    SelfAppraisalCreate,
    SelfAppraisalDraft,
    MentorEvalUpdate,
    MentorEvalDraft,
    ManagementRatingUpdate,
    AnnualReviewResponse,
    CalibrationRow,
    MenteeAnnualReview,
)
from app.schemas.pagination import Paginated
router = APIRouter()


# ── Module-level mentor User alias (PR #48, doc 31) ──────────────────
# Stable alias so /calibration's sort-column map below can reference
# the mentor join without re-aliasing per request. /calibration's
# base query is User; mentor is `User.mentor_id` → a second join into
# `users`. Doc 27 introduced the aliased() pattern for the same shape.
_CalibrationMentor = aliased(User, name="cal_mentor_user")


# ── Sort column map for GET /annual-reviews/all (PR #47, doc 30) ─────
# Mirrors the frontend's `AllReviewsSortKey` literal-union exactly.
# Module-level so we don't reconstruct it per request. Function /
# Designation entries are stable references to the reference-table
# columns; the route's conditional-join logic guarantees the relevant
# join is present before ORDER BY tries to read them.
_ALL_REVIEWS_SORT_COLUMNS = {
    "employee_name": User.full_name,
    "function": Function.name,
    "designation": Designation.name,
    "cycle_name": AnnualReview.cycle_name,
    "status": AnnualReview.status,
    "self_performance_rating": AnnualReview.self_performance_rating,
    "mentor_performance_rating": AnnualReview.mentor_performance_rating,
    "final_performance_rating": AnnualReview.final_performance_rating,
}


# ── Sort column map for GET /annual-reviews/calibration (PR #48, doc 31)
# Mirrors the frontend's `SortKey` literal-union in ManagementReview.tsx.
# Status sorts lexically here — the frontend's lifecycle-weight ordering
# (Not Started → Completed) was a CLIENT-side concern and doesn't carry
# over. Most users sorting by status want the same group together
# anyway, which lexical ordering achieves. Documented in doc 31 Part 3.
_CALIBRATION_SORT_COLUMNS = {
    "employee_name": User.full_name,
    "employee_email": User.email,
    "mentor_name": _CalibrationMentor.full_name,
    "function": Function.name,
    "designation": Designation.name,
    "status": AnnualReview.status,
    "self_performance_rating": AnnualReview.self_performance_rating,
    "mentor_performance_rating": AnnualReview.mentor_performance_rating,
    "management_performance_rating": AnnualReview.management_performance_rating,
}


# ── Sort column map for GET /annual-reviews/mentees (PR #48, doc 31) ─
# Mirrors the frontend's `SortKey` literal-union in TeamReviewTab.tsx.
_MENTEE_REVIEWS_SORT_COLUMNS = {
    "employee_name": User.full_name,
    "cycle_name": AnnualReview.cycle_name,
    "status": AnnualReview.status,
    "self_performance_rating": AnnualReview.self_performance_rating,
    "mentor_performance_rating": AnnualReview.mentor_performance_rating,
    "management_performance_rating": AnnualReview.management_performance_rating,
}


# ── Helpers ──────────────────────────────────────────────────────────

def _get_settings(db: DbSession, org_id: int) -> SystemSettings:
    settings = db.query(SystemSettings).filter(
        SystemSettings.org_id == org_id
    ).first()
    if not settings:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active performance cycle configured. Contact your HR administrator.",
        )
    return settings


def _compute_active_cycle_name(settings: SystemSettings) -> str:
    """Compute the canonical active cycle name from settings + today.

    Reads the date through `resolve_today` so a simulated_today shifts
    cycles. Doesn't read `settings.active_cycle_name` — that column is
    treated as a cache populated on settings save; we compute fresh on
    every call so the value can't stale between saves.
    """
    return get_current_cycle_info(
        resolve_today(settings),
        CycleType(settings.cycle_type),
        settings.fiscal_start_month,
    )


def _active_fy_label(settings: SystemSettings) -> str:
    """Return the bare FY token (e.g. "FY26-27") derived from the
    freshly-computed active cycle. Used by both the read-side scoping in
    `_strip_private_ratings` and the one-review-per-year rule on writes.
    """
    return extract_fy_label(_compute_active_cycle_name(settings))


def _get_active_cycle(db: DbSession, org_id: int) -> str:
    """
    Annual reviews are always yearly regardless of the org's cadence, so we
    strip any H1/H2/Q1–Q4 prefix and return just the fiscal-year label
    (e.g. "H1 FY26" → "FY26"). This also enforces the one-review-per-year
    rule that the UI and unique index depend on.
    """
    return _active_fy_label(_get_settings(db, org_id))


def _require_hr_myorg(current_user: User) -> None:
    """HR_MyOrg-only gate. Used by the management-review override endpoints
    that finalize/adjust ratings — Miltenyi HR has no business in annual
    reviews because annual reviews are a MyOrg/Mentor concern."""
    if current_user.role != "HR_MyOrg":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the Healthark HR can perform this action.",
        )


def _require_management(current_user: User) -> None:
    """Alias kept for callers that previously required management override —
    in the new role model this is exactly HR_MyOrg."""
    _require_hr_myorg(current_user)


def _require_submissions_open(
    db: DbSession,
    org_id: int,
    fy_label: str | None,
) -> None:
    """Reject state-changing annual review endpoints when HR has paused
    submissions for the relevant fiscal year. Read-side endpoints stay
    unaffected so staff, mentors, and HR can still inspect what already
    exists. The frontend surfaces this state as a banner on the
    AnnualReviews page; here we enforce it so a bypassed UI can't slip
    a write past us.

    `fy_label` is the FY that the write is intended to land in — for a
    new self-review that's the active FY (computed via `_active_fy_label`);
    for an edit it's `_fy_label_of_review(review)`.

    Default-deny on missing override row: HR must configure the year
    explicitly. The error names the FY so the admin knows where to look.
    """
    if not fy_label:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Could not determine the fiscal year for this review.",
        )
    override = get_year_override(db, org_id, fy_label)
    if override is None or not override.annual_reviews_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                f"Annual review submissions for {fy_label} are paused. "
                f"Contact your administrator."
            ),
        )


def _strip_private_ratings(
    db: DbSession,
    org_id: int,
    review: AnnualReview,
    active_fy_label: str | None = None,
) -> None:
    """
    Mutates `review` in-place to hide ratings an employee shouldn't see yet.

    User-side display rule: final_performance_rating in the response is
    synthesized as management_performance_rating ?? mentor_performance_rating
    — the stored final_performance_rating column (HR's legacy override path)
    is not surfaced.

    Cycle-scoping: the `annual_review_final_rating_visible` flag is
    looked up per-FY on `SystemSettingsYearOverride`. Only the CURRENT
    fiscal year's review is gated by the flag. Past FY reviews always
    show the synthesized final rating when `final_rating_enabled` is
    true on the row, regardless of any flag — otherwise flipping the
    flag off would retroactively blackout shipped years.

    Mentor draft text/rating are always stripped (cycle-independent) —
    the mentee should not see in-progress mentor work.
    """
    mgmt = review.management_performance_rating
    mentor = review.mentor_performance_rating
    review.mentor_performance_rating = None
    review.management_performance_rating = None
    review.mentor_overall_review_draft = None
    review.mentor_performance_rating_draft = None

    is_current_fy = (
        active_fy_label is not None and review.cycle_name == active_fy_label
    )
    # Past FYs always pass through (the override flag never blackouts
    # shipped years). For the current FY, look up the per-year flag —
    # missing row defaults to False (hidden) since the year hasn't been
    # explicitly opened.
    if is_current_fy:
        override = get_year_override(db, org_id, _fy_label_of_review(review))
        effective_visible = bool(
            override and override.annual_review_final_rating_visible
        )
    else:
        effective_visible = True

    if review.final_rating_enabled and effective_visible:
        review.final_performance_rating = mgmt if mgmt is not None else mentor
    else:
        review.final_performance_rating = None


# =====================================================================
# STAGE 1 — EMPLOYEE SELF-APPRAISAL
# =====================================================================

def _attach_mentor_name(review: AnnualReview, db: DbSession) -> AnnualReview:
    """Populate the transient `mentor_name` field on a single AnnualReview.

    `mentor_name` is a denormalised display field on the response schema —
    not stored on the row. Every mutation endpoint that returns a single
    review should call this so the frontend's optimistic upsert into the
    My Reviews list keeps the Mentor column populated (otherwise the
    field flickers to "—" after a save and only reappears on refresh
    when /mine/history reloads the list)."""
    if review.mentor_id is not None:
        mentor = db.query(User).filter(User.id == review.mentor_id).first()
        review.mentor_name = mentor.full_name if mentor else None
    else:
        review.mentor_name = None
    return review


@router.post("/self", response_model=AnnualReviewResponse, status_code=status.HTTP_201_CREATED)
def create_self_appraisal(
    payload: SelfAppraisalCreate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Submit the employee's self-appraisal. If a draft row already exists for
    the user/cycle, promote it to PENDING_MENTOR with the submitted payload.
    Otherwise create a new row directly in PENDING_MENTOR.

    cycle_name is stamped from SystemSettings — the employee cannot pick.
    """
    settings = _get_settings(db, current_user.org_id)
    cycle_name = _active_fy_label(settings)
    _require_submissions_open(db, current_user.org_id, cycle_name)

    existing = db.query(AnnualReview).filter(
        AnnualReview.org_id == current_user.org_id,
        AnnualReview.user_id == current_user.id,
        AnnualReview.cycle_name == cycle_name,
    ).first()
    if existing and existing.status != ReviewStatus.DRAFT.value:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You have already submitted a self-review for {cycle_name}.",
        )

    if existing is not None:
        # Promote draft → submitted.
        existing.self_overall_review = payload.self_overall_review
        existing.self_performance_rating = payload.self_performance_rating
        existing.status = ReviewStatus.PENDING_MENTOR.value
        db.commit()
        db.refresh(existing)
        _notify_self_appraisal_submitted(db, existing, current_user, cycle_name)
        return _attach_mentor_name(existing, db)

    mentor_id = current_user.mentor_id
    review = AnnualReview(
        org_id=current_user.org_id,
        user_id=current_user.id,
        mentor_id=mentor_id,
        cycle_name=cycle_name,
        status=ReviewStatus.PENDING_MENTOR.value,
        self_overall_review=payload.self_overall_review,
        self_performance_rating=payload.self_performance_rating,
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    _notify_self_appraisal_submitted(db, review, current_user, cycle_name)
    return _attach_mentor_name(review, db)


def _notify_self_appraisal_submitted(
    db, review: AnnualReview, current_user: User, cycle_name: str,
) -> None:
    """Notify the mentor that their mentee submitted a self-appraisal.
    In-app only — review-cycle events are too frequent for email.
    No-op if the review has no mentor (early-cycle data quirks)."""
    if not review.mentor_id:
        return
    notify(
        db,
        org_id=current_user.org_id,
        recipient_id=review.mentor_id,
        sender_id=current_user.id,
        module="annual_review",
        entity_type="annual_review",
        entity_id=review.id,
        message=f"{current_user.full_name} submitted their {cycle_name} self-appraisal.",
        entity_url=f"/annual-reviews?review_id={review.id}",
    )
    db.commit()


@router.post("/self/draft", response_model=AnnualReviewResponse, status_code=status.HTTP_201_CREATED)
def create_self_appraisal_draft(
    payload: SelfAppraisalDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Create a new annual self-appraisal in DRAFT state. The employee can
    revisit it via PATCH /draft and submit later via POST /self.

    409 if a row already exists for the user/cycle (use the PATCH /draft
    endpoint to update an existing draft).
    """
    settings = _get_settings(db, current_user.org_id)
    cycle_name = _active_fy_label(settings)
    _require_submissions_open(db, current_user.org_id, cycle_name)

    existing = db.query(AnnualReview).filter(
        AnnualReview.org_id == current_user.org_id,
        AnnualReview.user_id == current_user.id,
        AnnualReview.cycle_name == cycle_name,
    ).first()
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"A review for {cycle_name} already exists; use PATCH /draft "
                f"to update an in-progress draft."
            ),
        )

    review = AnnualReview(
        org_id=current_user.org_id,
        user_id=current_user.id,
        mentor_id=current_user.mentor_id,
        cycle_name=cycle_name,
        status=ReviewStatus.DRAFT.value,
        self_overall_review=payload.self_overall_review,
        self_performance_rating=payload.self_performance_rating,
    )
    db.add(review)
    db.commit()
    db.refresh(review)
    return _attach_mentor_name(review, db)


@router.patch("/{review_id}/draft", response_model=AnnualReviewResponse)
def save_draft(
    review_id: int,
    payload: SelfAppraisalDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """Save a partial draft. Only works while status is DRAFT."""
    review = db.query(AnnualReview).filter(
        AnnualReview.id == review_id,
        AnnualReview.org_id == current_user.org_id,
        AnnualReview.user_id == current_user.id,
    ).first()
    if not review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found.")
    if review.status != ReviewStatus.DRAFT.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only draft reviews can be edited.",
        )
    _require_submissions_open(
        db, current_user.org_id, _fy_label_of_review(review)
    )

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(review, field, value)

    db.commit()
    db.refresh(review)
    return _attach_mentor_name(review, db)


@router.get("/mine", response_model=AnnualReviewResponse)
def get_my_review(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Current user's review for the active cycle. 404 if not started yet.
    Ratings are filtered per the visibility rules above.
    """
    settings = _get_settings(db, current_user.org_id)
    cycle_name = extract_fy_label(settings.active_cycle_name)
    review = db.query(AnnualReview).filter(
        AnnualReview.org_id == current_user.org_id,
        AnnualReview.user_id == current_user.id,
        AnnualReview.cycle_name == cycle_name,
    ).first()
    if not review:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No annual review found for the current cycle.",
        )

    _strip_private_ratings(
        db,
        current_user.org_id,
        review,
        _active_fy_label(settings),
    )
    return review


@router.get("/mine/history", response_model=List[AnnualReviewResponse])
def get_my_review_history(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    All annual reviews owned by the current user, sorted newest-first.
    Used by the "My Review" tab to show past cycles alongside the current one.
    Ratings are filtered per visibility rules.

    `mentor_name` is resolved per row (a Staff member may have a
    different mentor across different cycles), so the table can render
    the Mentor column directly without an extra round-trip.
    """
    settings = _get_settings(db, current_user.org_id)
    reviews = (
        db.query(AnnualReview)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.user_id == current_user.id,
        )
        .order_by(AnnualReview.created_at.desc())
        .all()
    )

    # Batch-resolve mentor names so each row carries its historical
    # mentor (could differ year-over-year if the Staff was reassigned).
    mentor_ids = {r.mentor_id for r in reviews if r.mentor_id is not None}
    mentor_name_by_id: dict[int, str] = {}
    if mentor_ids:
        for m in db.query(User).filter(User.id.in_(mentor_ids)).all():
            mentor_name_by_id[m.id] = m.full_name

    active_fy = _active_fy_label(settings)
    for r in reviews:
        _strip_private_ratings(db, current_user.org_id, r, active_fy)
        r.mentor_name = (
            mentor_name_by_id.get(r.mentor_id) if r.mentor_id is not None else None
        )
    return reviews


@router.get("/all", response_model=Paginated[AnnualReviewResponse])
def get_all_annual_reviews(
    db: DbSession,
    current_user: CurrentUser,
    limit: int = Query(
        50,
        ge=1,
        le=200,
        description=(
            "Maximum rows to return on this page. Server-clamped to "
            "1..200 to bound payload + DB work."
        ),
    ),
    offset: int = Query(
        0,
        ge=0,
        description="Rows to skip before this page. 0 for the first page.",
    ),
    # ── Server-side filters (PR #43, doc 26) ─────────────────────────
    # Each filter narrows the universe BEFORE pagination, so `total`
    # reports the count of matching rows and Load More pages through
    # only those. Filters apply with AND semantics — passing multiple
    # narrows further. All filters are exact-match equality (matches
    # the frontend's combobox/select UI which commits exact values).
    # Substring search is a future PR.
    cycle: Optional[str] = Query(
        None,
        description="Exact match on review.cycle_name (e.g. 'Q1 FY26-27').",
    ),
    # `status` and `function` collide with the imported `status` module
    # and the Python builtin `function` type. Use Python-side `_`
    # suffixes and `alias=` to keep the wire-name clean.
    status_: Optional[str] = Query(
        None,
        alias="status",
        description="Exact match on review.status (one of the ReviewStatus values).",
    ),
    function_: Optional[str] = Query(
        None,
        alias="function",
        description=(
            "Exact match on the employee's Function name. Joins to "
            "User → Function so a reference-table relationship is "
            "traversed; no per-row queries."
        ),
    ),
    designation: Optional[str] = Query(
        None,
        description="Exact match on the employee's Designation name.",
    ),
    employee: Optional[str] = Query(
        None,
        description=(
            "Exact match on the employee's full_name. The frontend's "
            "typeable combobox commits exact values, so equality is "
            "correct here. Substring search would be a future PR."
        ),
    ),
    # ── Server-side sort (PR #47, doc 30) ─────────────────────────────
    # Frontend SORT_CONFIG keys map 1:1 to these literal values. When
    # `sort_by` is None, fall back to the default ordering (cycle_name
    # DESC, created_at DESC). The id.desc() tiebreaker ALWAYS stays as
    # the final ORDER BY clause — see doc 30 Part 2 for why it survives
    # under any primary sort.
    sort_by: Optional[
        Literal[
            "employee_name",
            "function",
            "designation",
            "cycle_name",
            "status",
            "self_performance_rating",
            "mentor_performance_rating",
            "final_performance_rating",
        ]
    ] = Query(
        None,
        description=(
            "Primary sort column. Mirrors the frontend's "
            "AllReviewsSortKey enum. `function` / `designation` / "
            "`employee_name` require joining the User row + the "
            "respective reference table; those joins are added "
            "conditionally on either filter or sort referencing them."
        ),
    ),
    sort_dir: Literal["asc", "desc"] = Query(
        "asc",
        description="Sort direction. Default 'asc'.",
    ),
):
    """HR_MyOrg-only: paginated annual reviews across the org, every cycle.

    Powers the view-only "All Reviews" tab on the AnnualReviews page.
    HR_MyOrg is the management role, so private ratings are NOT stripped —
    they need to see the full picture for calibration / auditing.

    Pagination + filtering: the frontend bakes the filter set into the
    TanStack Query queryKey, so each filter combination gets its own
    cache entry. Changing a filter triggers a new paginated fetch from
    scratch (offset resets to 0). See doc 26.

    Returns `Paginated[AnnualReviewResponse]` where `total` is the count
    of rows matching ALL active filters (not the org-wide count).
    `has_more` indicates whether more pages of the FILTERED universe
    exist — Load More on a filtered view pages through what matches,
    not the whole org.

    Filter semantics:
      • All filters apply with AND. Missing filters mean "no narrowing".
      • All filters are exact-match equality.
      • user-attribute filters (function/designation/employee) require
        a JOIN to User; the join is added conditionally so unfiltered
        requests stay fast.

    Why offset/limit and not cursor: the underlying data is mostly
    stable within a calibration window (rows are appended at low
    velocity). Cursor-based pagination's robustness against churn
    isn't worth its added complexity here. Documented in doc 19.

    Resolves `employee_name` and `mentor_name` for THIS PAGE in two
    batched lookups (no N+1). Total count is a single COUNT(*) over
    the filtered base query.
    """
    _require_hr_myorg(current_user)

    # Filtered base query — shared between the count() and the windowed
    # fetch so the totals match exactly what the windowed rows are
    # drawn from. Build this once, reuse twice.
    base_q = db.query(AnnualReview).filter(
        AnnualReview.org_id == current_user.org_id
    )

    # ── Apply filters + figure out which joins sort also needs ────────
    # Direct columns (cycle_name, status) hit AnnualReview without a
    # join. User-attribute filters require a User join; the reference-
    # table joins (Function / Designation) layer on top. Sort can ALSO
    # need any of these joins independent of whether the user filtered
    # on them — e.g. "no filters, sort by function" still needs the
    # Function join. Compute needs-joins from filter ∪ sort.
    if cycle:
        base_q = base_q.filter(AnnualReview.cycle_name == cycle)
    if status_:
        base_q = base_q.filter(AnnualReview.status == status_)

    needs_user_join = bool(function_ or designation or employee) or sort_by in (
        "function",
        "designation",
        "employee_name",
    )
    needs_function_join = bool(function_) or sort_by == "function"
    needs_designation_join = bool(designation) or sort_by == "designation"

    if needs_user_join:
        # INNER JOIN is correct here: every AnnualReview has a non-null
        # user_id (FK constraint), so the join never drops legitimate
        # rows. The user-attribute filters then narrow further.
        base_q = base_q.join(User, User.id == AnnualReview.user_id)
        if employee:
            base_q = base_q.filter(User.full_name == employee)
        if needs_function_join:
            # Joining via the FK to the Function reference table. We
            # could use User.function.has(...) which emits an EXISTS
            # subquery; an explicit join is more readable and has the
            # same plan in Postgres. Join unconditionally if either a
            # filter or sort references function.
            base_q = base_q.join(Function, Function.id == User.function_id)
            if function_:
                base_q = base_q.filter(Function.name == function_)
        if needs_designation_join:
            base_q = base_q.join(
                Designation, Designation.id == User.designation_id
            )
            if designation:
                base_q = base_q.filter(Designation.name == designation)

    # Total count of matching rows. Used both for the response's
    # `total` field and for the `has_more` flag.
    total = base_q.count()

    # ── ORDER BY ─────────────────────────────────────────────────────
    # When `sort_by` is supplied, it becomes the primary sort and the
    # default (cycle_name DESC, created_at DESC) is dropped. The
    # id.desc() tiebreaker ALWAYS stays as the last clause — see doc
    # 30 Part 2 for the OFFSET/LIMIT stability rationale.
    if sort_by is None:
        order_clauses = [
            AnnualReview.cycle_name.desc(),
            AnnualReview.created_at.desc(),
            AnnualReview.id.desc(),
        ]
    else:
        sort_column = _ALL_REVIEWS_SORT_COLUMNS[sort_by]
        primary = sort_column.asc() if sort_dir == "asc" else sort_column.desc()
        order_clauses = [
            primary,
            # Tiebreaker survives the primary-sort swap. Required to
            # keep OFFSET/LIMIT stable across pages when two rows share
            # the same `sort_by` value — see doc 22's discussion of the
            # tiebreaker footgun.
            AnnualReview.id.desc(),
        ]

    reviews = (
        base_q.order_by(*order_clauses)
        .offset(offset)
        .limit(limit)
        .all()
    )

    user_ids = {r.user_id for r in reviews}
    user_ids.update(r.mentor_id for r in reviews if r.mentor_id is not None)
    name_by_id: dict[int, str] = {}
    # Function + designation are only needed for the *employee* (review.user_id),
    # not for mentors. Loaded once via a batched user fetch with eager joins
    # so the table can render with no per-row queries. Bounded by `limit`
    # (max 200) now, was previously unbounded for an HR with thousands of
    # reviews.
    employee_meta: dict[int, tuple[Optional[str], Optional[str]]] = {}
    if user_ids:
        users = (
            db.query(User)
            .options(joinedload(User.function), joinedload(User.designation))
            .filter(User.id.in_(user_ids))
            .all()
        )
        for u in users:
            name_by_id[u.id] = u.full_name
            employee_meta[u.id] = (
                u.function.name if u.function else None,
                u.designation.name if u.designation else None,
            )

    for r in reviews:
        r.employee_name = name_by_id.get(r.user_id)
        r.mentor_name = (
            name_by_id.get(r.mentor_id) if r.mentor_id is not None else None
        )
        meta = employee_meta.get(r.user_id, (None, None))
        r.function = meta[0]
        r.designation = meta[1]
        # Backfill rows rated before set_management_rating started persisting
        # final_performance_rating. Mirrors the user-side synthesis in
        # _strip_private_ratings so the "All Reviews" Final column matches
        # what the rated employee sees.
        if r.final_performance_rating is None and r.final_rating_enabled:
            r.final_performance_rating = (
                r.management_performance_rating
                if r.management_performance_rating is not None
                else r.mentor_performance_rating
            )

    return Paginated[AnnualReviewResponse](
        items=reviews,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + len(reviews)) < total,
    )


# =====================================================================
# STAGE 2 — MENTOR EVALUATION
# =====================================================================

@router.get("/mentees", response_model=Paginated[MenteeAnnualReview])
def get_mentee_reviews(
    db: DbSession,
    current_user: CurrentUser,
    limit: int = Query(
        50,
        ge=1,
        le=200,
        description=(
            "Maximum reviews to return on this page. Server-clamped to "
            "1..200. Most mentors will see all their mentees' reviews on "
            "one page; the parameter exists for consistency with the "
            "other paginated endpoints and to bound payload for "
            "long-tenured mentors who accumulate years of history."
        ),
    ),
    offset: int = Query(
        0,
        ge=0,
        description="Reviews to skip before this page. 0 for the first page.",
    ),
    # ── Server-side filters (PR #46, doc 29) ─────────────────────────
    fy_year: Optional[int] = Query(
        None,
        description=(
            "Fiscal-year integer (2026, 2025, …). Matches review."
            "cycle_name against modern 'FY26'-style and legacy "
            "'H1 2026'-style formats via the same LIKE-OR pattern "
            "used by /goals/all (doc 27 Part 3)."
        ),
    ),
    status_: Optional[str] = Query(
        None,
        alias="status",
        description="Exact match on review.status.",
    ),
    mentee: Optional[str] = Query(
        None,
        description="Exact match on the mentee's (review.user_id's) full_name.",
    ),
    search: Optional[str] = Query(
        None,
        description=(
            "Substring search (ILIKE) on the mentee's full_name. "
            "Single-column because the TeamReviewTab's search input "
            "only narrows by name. Frontend debounces input (doc 29 "
            "Part 4)."
        ),
    ),
    # ── Server-side sort (PR #48, doc 31) ─────────────────────────────
    sort_by: Optional[
        Literal[
            "employee_name",
            "cycle_name",
            "status",
            "self_performance_rating",
            "mentor_performance_rating",
            "management_performance_rating",
        ]
    ] = Query(
        None,
        description="Primary sort column. Mirrors the frontend SortKey enum.",
    ),
    sort_dir: Literal["asc", "desc"] = Query(
        "asc",
        description="Sort direction. Default 'asc'.",
    ),
):
    """
    Paginated reviews for the current user's direct mentees across every
    cycle/status. Each row is enriched with employee_name / function /
    designation. Final ratings are nulled when the org-wide visibility
    flag is off so the Mentee Review tab can conditionally hide the
    Ratings column.

    Resolution is by *current* mentor relationship (User.mentor_id), not by
    the mentor_id snapshot on the review row. The snapshot is still used as
    the gate for *submitting* an evaluation (a different mentor can read but
    not submit) — but for listing purposes we want to match what the
    My Mentees surface shows so historical / pre-migration rows with a
    NULL mentor_id are still visible.

    Pagination convention: standard offset/limit with `Paginated[T]` wire
    shape (doc 19). The unit is review rows (one per review), same as
    PR #36 + PR #39 — no parent/child split. At mentor scale, most
    callers will see one page (the default limit of 50 covers a
    mentor with 50 review rows across all cycles); paginating anyway
    is a **consistency play** so every HR/mentor list endpoint behaves
    identically. See doc 23 for the discussion.

    Stable ORDER BY uses `created_at DESC, id DESC` — same tiebreaker
    pattern as doc 21/22.
    """
    settings = _get_settings(db, current_user.org_id)

    mentee_ids = [
        uid for (uid,) in db.query(User.id).filter(
            User.mentor_id == current_user.id,
            User.org_id == current_user.org_id,
            User.is_deleted == False,  # noqa: E712
        ).all()
    ]
    if not mentee_ids:
        return Paginated[MenteeAnnualReview](
            items=[],
            total=0,
            limit=limit,
            offset=offset,
            has_more=False,
        )

    # Filtered base query — shared by COUNT and the windowed fetch so the
    # `total` matches the exact universe the page is drawn from.
    base_q = db.query(AnnualReview).filter(
        AnnualReview.org_id == current_user.org_id,
        AnnualReview.user_id.in_(mentee_ids),
    )

    # ── Apply filters ─────────────────────────────────────────────
    # Year filter mirrors the LIKE-OR pattern from /goals/all (doc 27
    # Part 3). Status is a direct column. Mentee + search both target
    # User.full_name; join User lazily.
    if fy_year is not None:
        yy = fy_year % 100
        base_q = base_q.filter(
            or_(
                AnnualReview.cycle_name.like(f"FY{yy:02d}%"),
                AnnualReview.cycle_name.like(f"%{fy_year}%"),
            )
        )
    if status_:
        base_q = base_q.filter(AnnualReview.status == status_)
    # User join needed if mentee filter, search, or sort_by employee_name.
    if mentee or search or sort_by == "employee_name":
        base_q = base_q.join(User, User.id == AnnualReview.user_id)
        if mentee:
            base_q = base_q.filter(User.full_name == mentee)
        if search:
            base_q = base_q.filter(User.full_name.ilike(f"%{search}%"))

    total = base_q.with_entities(AnnualReview.id).count()

    # ORDER BY. Default: created_at desc (newest first). User sort
    # replaces the default; `AnnualReview.id.desc()` tiebreaker
    # survives (doc 30 Part 2).
    if sort_by is None:
        order_clauses = [
            AnnualReview.created_at.desc(),
            AnnualReview.id.desc(),
        ]
    else:
        sort_column = _MENTEE_REVIEWS_SORT_COLUMNS[sort_by]
        primary = sort_column.asc() if sort_dir == "asc" else sort_column.desc()
        order_clauses = [primary, AnnualReview.id.desc()]

    reviews = (
        base_q
        .order_by(*order_clauses)
        .offset(offset)
        .limit(limit)
        .all()
    )

    user_ids = [r.user_id for r in reviews]
    users = {
        u.id: u
        for u in db.query(User).filter(User.id.in_(user_ids)).all()
    } if user_ids else {}

    # Resolve the current FY once, and look up its visibility override
    # in a single query. Past-FY rows ignore the toggle (we never
    # retroactively blackout shipped years).
    active_fy = _active_fy_label(settings)
    current_fy_override = get_year_override(db, current_user.org_id, active_fy)
    current_fy_visible = bool(
        current_fy_override and current_fy_override.annual_review_final_rating_visible
    )

    rows: list[MenteeAnnualReview] = []
    for r in reviews:
        # Backfill rows rated before set_management_rating started persisting
        # final_performance_rating. Mirrors the user-side synthesis in
        # _strip_private_ratings so mentor mentee cards show the published
        # final rating instead of a blank.
        if r.final_performance_rating is None and r.final_rating_enabled:
            r.final_performance_rating = (
                r.management_performance_rating
                if r.management_performance_rating is not None
                else r.mentor_performance_rating
            )
        # Drop any name/org fields the parent already populated as None — we
        # provide our own resolved values below, and otherwise Python
        # complains about duplicate kwargs when spreading `base`.
        base = AnnualReviewResponse.model_validate(r).model_dump(
            exclude={"employee_name", "mentor_name", "function", "designation"},
        )
        is_current_fy_row = r.cycle_name == active_fy
        if is_current_fy_row and not current_fy_visible:
            base["final_performance_rating"] = None
            base["management_performance_rating"] = None
        u = users.get(r.user_id)
        rows.append(MenteeAnnualReview(
            **base,
            employee_name=u.full_name if u else f"Employee #{r.user_id}",
            employee_email=u.email if u else None,
            function=u.function.name if u and u.function else None,
            designation=u.designation.name if u and u.designation else None,
        ))

    return Paginated[MenteeAnnualReview](
        items=rows,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + len(rows)) < total,
    )


@router.patch("/{review_id}/mentor-eval", response_model=AnnualReviewResponse)
def submit_mentor_evaluation(
    review_id: int,
    payload: MentorEvalUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Mentor submits their evaluation. Status: PENDING_MENTOR → PENDING_MANAGEMENT.
    Any saved mentor draft is cleared; the submitted payload becomes final."""
    review = db.query(AnnualReview).filter(
        AnnualReview.id == review_id,
        AnnualReview.org_id == current_user.org_id,
    ).first()
    if not review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found.")
    if review.status != ReviewStatus.PENDING_MENTOR.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This review is not in the mentor evaluation stage.",
        )
    _require_submissions_open(
        db, current_user.org_id, _fy_label_of_review(review)
    )
    if review.mentor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the assigned mentor for this review.",
        )

    review.mentor_overall_review = payload.mentor_overall_review
    review.mentor_performance_rating = payload.mentor_performance_rating
    # Clear any draft scratchpad — the final cols are now authoritative.
    review.mentor_overall_review_draft = None
    review.mentor_performance_rating_draft = None

    review.status = ReviewStatus.PENDING_MANAGEMENT.value

    db.commit()
    db.refresh(review)

    notify(
        db,
        org_id=current_user.org_id,
        recipient_id=review.user_id,
        sender_id=current_user.id,
        module="annual_review",
        entity_type="annual_review",
        entity_id=review.id,
        message=f"Your mentor submitted their evaluation for {review.cycle_name}.",
        entity_url=f"/annual-reviews?review_id={review.id}",
    )
    db.commit()

    return review


@router.patch("/{review_id}/mentor-draft", response_model=AnnualReviewResponse)
def save_mentor_draft(
    review_id: int,
    payload: MentorEvalDraft,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Mentor saves an in-progress evaluation without submitting. Writes only
    the *_draft columns; the row's `status` stays PENDING_MENTOR so the
    mentee never sees premature mentor content. The Submit endpoint
    (PATCH /mentor-eval) clears these and advances status.
    """
    review = db.query(AnnualReview).filter(
        AnnualReview.id == review_id,
        AnnualReview.org_id == current_user.org_id,
    ).first()
    if not review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found.")
    if review.status != ReviewStatus.PENDING_MENTOR.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This review is not in the mentor evaluation stage.",
        )
    _require_submissions_open(
        db, current_user.org_id, _fy_label_of_review(review)
    )
    if review.mentor_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the assigned mentor for this review.",
        )

    # Apply only fields the client included so partial saves don't wipe
    # work the mentor previously stored.
    data = payload.model_dump(exclude_unset=True)
    if "mentor_overall_review" in data:
        review.mentor_overall_review_draft = data["mentor_overall_review"]
    if "mentor_performance_rating" in data:
        review.mentor_performance_rating_draft = data["mentor_performance_rating"]

    db.commit()
    db.refresh(review)
    return review


# =====================================================================
# STAGE 3 — MANAGEMENT CALIBRATION & FINALIZATION
# =====================================================================

@router.get("/calibration", response_model=Paginated[CalibrationRow])
def get_calibration_grid(
    db: DbSession,
    current_user: CurrentUser,
    limit: int = Query(
        50,
        ge=1,
        le=200,
        description=(
            "Maximum staff users to return on this page. Server-clamped "
            "to 1..200 to bound payload + DB work."
        ),
    ),
    offset: int = Query(
        0,
        ge=0,
        description="Staff users to skip before this page. 0 for the first page.",
    ),
    # ── Server-side filters (PR #46, doc 29) ─────────────────────────
    # All exact-match equality except `search` which is substring (ILIKE).
    function_: Optional[str] = Query(
        None,
        alias="function",
        description="Exact match on the Staff user's Function name.",
    ),
    designation: Optional[str] = Query(
        None,
        description="Exact match on the Staff user's Designation name.",
    ),
    mentor: Optional[str] = Query(
        None,
        description=(
            "Exact match on the user's LIVE mentor full_name (User.mentor "
            "relationship). The frontend's `mentor_name` column prefers "
            "the snapshotted review.mentor_id when a review exists — the "
            "two diverge if a mentor changed mid-cycle. Documented in "
            "doc 29 Part 3."
        ),
    ),
    status_: Optional[str] = Query(
        None,
        alias="status",
        description=(
            "Filter by review status. `not_started` matches users with "
            "no AnnualReview in the active cycle (via NOT EXISTS); other "
            "values match users whose review has that status (via "
            "EXISTS)."
        ),
    ),
    search: Optional[str] = Query(
        None,
        description=(
            "Substring search (ILIKE) across User.full_name AND "
            "User.email. Frontend debounces input before passing it to "
            "the queryKey to avoid a request per keystroke (doc 29 Part 4)."
        ),
    ),
    # ── Server-side sort (PR #48, doc 31) ─────────────────────────────
    sort_by: Optional[
        Literal[
            "employee_name",
            "employee_email",
            "mentor_name",
            "function",
            "designation",
            "status",
            "self_performance_rating",
            "mentor_performance_rating",
            "management_performance_rating",
        ]
    ] = Query(
        None,
        description=(
            "Primary sort column. Review-derived dimensions (status, "
            "ratings) require an OUTER JOIN to AnnualReview which is "
            "added lazily — users with no active-cycle review row sort "
            "as NULL (DB default: NULLS LAST asc / NULLS FIRST desc on "
            "Postgres)."
        ),
    ),
    sort_dir: Literal["asc", "desc"] = Query(
        "asc",
        description="Sort direction. Default 'asc'.",
    ),
):
    """
    Paginated calibration grid for the active cycle. Management-only.

    Every active Staff user in the org appears as one row, LEFT-joined
    against their AnnualReview for the active cycle. Staff who haven't
    created a review yet still appear with status="not_started" and
    null ratings — the frontend gates per-row actions per stage.

    ── Pagination strategy: paginate the user (the row identity) ──────
    Each calibration row corresponds to exactly one Staff user; reviews
    are 0-or-1 per user in the active cycle. So the "list-of-parents"
    pattern from PR #37 (doc 20) degenerates here: `total` equals the
    Staff-user count AND `items.length` equals the user count for the
    page. The two-step pattern still applies — we paginate users via
    OFFSET/LIMIT in SQL (so sorting + paging is consistent with the DB
    instead of Python-side) and then batch-fetch reviews + mentors for
    just the page's user IDs.

    ── Server-side filters (PR #46, doc 29) ─────────────────────────
    Each filter narrows the user universe BEFORE pagination, so `total`
    is the count of users matching ALL filters. Five dimensions:
    function, designation, mentor (user-attribute), status (review-
    attribute via EXISTS), search (substring across name + email).

    Sort moves into SQL — `User.full_name.asc()` — because OFFSET/LIMIT
    only makes sense over a stable order.

    Returns `Paginated[CalibrationRow]` (the standard wire shape from
    PR #36).
    """
    _require_management(current_user)
    cycle_name = _get_active_cycle(db, current_user.org_id)

    # Filtered base query, ordered by full_name so OFFSET/LIMIT is
    # deterministic. The eager-load options are applied via the page
    # fetch below (eager loads on a count() are wasted work).
    base_q = db.query(User).filter(
        User.org_id == current_user.org_id,
        User.role == Role.STAFF.value,
        User.is_deleted == False,  # noqa: E712
    )

    # ── Apply filters + figure out which joins sort also needs ──────
    # User-attribute joins compose filter ∪ sort needs (doc 30 Part 3).
    # Sorting by mentor_name, status, or any rating column requires
    # joins that no current filter alone would have triggered.
    review_sort_keys = (
        "status",
        "self_performance_rating",
        "mentor_performance_rating",
        "management_performance_rating",
    )
    needs_function_join = bool(function_) or sort_by == "function"
    needs_designation_join = bool(designation) or sort_by == "designation"
    needs_mentor_join = bool(mentor) or sort_by == "mentor_name"
    # OUTER join to AnnualReview for sort that reads review columns —
    # users without an active-cycle review get NULL (sorts last on ASC,
    # first on DESC; that's Postgres default and matches what a user
    # expects when sorting by "rating" in a grid where some rows are
    # blank).
    needs_review_join = sort_by in review_sort_keys

    if needs_function_join:
        base_q = base_q.join(Function, Function.id == User.function_id)
        if function_:
            base_q = base_q.filter(Function.name == function_)
    if needs_designation_join:
        base_q = base_q.join(Designation, Designation.id == User.designation_id)
        if designation:
            base_q = base_q.filter(Designation.name == designation)
    if needs_mentor_join:
        base_q = base_q.join(
            _CalibrationMentor, _CalibrationMentor.id == User.mentor_id
        )
        if mentor:
            base_q = base_q.filter(_CalibrationMentor.full_name == mentor)
    if needs_review_join:
        base_q = base_q.outerjoin(
            AnnualReview,
            and_(
                AnnualReview.user_id == User.id,
                AnnualReview.org_id == current_user.org_id,
                AnnualReview.cycle_name == cycle_name,
            ),
        )

    if status_:
        review_exists = (
            db.query(AnnualReview.id)
            .filter(
                AnnualReview.user_id == User.id,
                AnnualReview.org_id == current_user.org_id,
                AnnualReview.cycle_name == cycle_name,
            )
        )
        if status_ == ReviewStatus.NOT_STARTED.value:
            # "Not started" = no AnnualReview row for this user in the
            # active cycle. NOT EXISTS is the correct semantic.
            base_q = base_q.filter(~review_exists.exists())
        else:
            # Any other status = a review with that status exists. The
            # frontend's status column reads `review.status` for users
            # who have one, so this is symmetric.
            review_exists = review_exists.filter(AnnualReview.status == status_)
            base_q = base_q.filter(review_exists.exists())
    if search:
        pattern = f"%{search}%"
        base_q = base_q.filter(
            or_(
                User.full_name.ilike(pattern),
                User.email.ilike(pattern),
            )
        )

    # Total of matching users — pairs with `has_more` below.
    total_users = base_q.with_entities(User.id).count()

    # ORDER BY. Default: full_name asc. User-picked primary replaces
    # default and the `User.id.asc()` tiebreaker survives (doc 30 Part 2).
    if sort_by is None:
        order_clauses = [User.full_name.asc(), User.id.asc()]
    else:
        sort_column = _CALIBRATION_SORT_COLUMNS[sort_by]
        primary = sort_column.asc() if sort_dir == "asc" else sort_column.desc()
        order_clauses = [primary, User.id.asc()]

    page_users = (
        base_q
        .options(
            joinedload(User.function),
            joinedload(User.designation),
        )
        .order_by(*order_clauses)
        .offset(offset)
        .limit(limit)
        .all()
    )

    if not page_users:
        return Paginated[CalibrationRow](
            items=[],
            total=total_users,
            limit=limit,
            offset=offset,
            has_more=False,
        )

    page_user_ids = [u.id for u in page_users]

    # Reviews for just THIS page's users. Bounded by `limit`, so the
    # filter list is at most 200 entries — well within Postgres's
    # in-list comfort zone.
    reviews = (
        db.query(AnnualReview)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == cycle_name,
            AnnualReview.user_id.in_(page_user_ids),
        )
        .all()
    )
    reviews_by_user = {r.user_id: r for r in reviews}

    # Resolve mentor names in a single round-trip. For users with a
    # review, prefer the snapshotted review.mentor_id (so the grid stays
    # consistent with the review). For users without a review, fall back
    # to the live User.mentor_id assignment. Both are scoped to the
    # page's users, so the mentor fetch is similarly bounded.
    mentor_ids: set[int] = set()
    for u in page_users:
        review = reviews_by_user.get(u.id)
        snapshot_id = review.mentor_id if review else None
        live_id = u.mentor_id
        if snapshot_id is not None:
            mentor_ids.add(snapshot_id)
        elif live_id is not None:
            mentor_ids.add(live_id)
    mentors_by_id = {
        m.id: m
        for m in db.query(User).filter(User.id.in_(list(mentor_ids))).all()
    } if mentor_ids else {}

    rows: list[CalibrationRow] = []
    for u in page_users:
        review = reviews_by_user.get(u.id)
        if review is not None:
            mentor = (
                mentors_by_id.get(review.mentor_id)
                if review.mentor_id is not None
                else None
            )
            rows.append(CalibrationRow(
                review_id=review.id,
                user_id=u.id,
                employee_name=u.full_name,
                employee_email=u.email,
                mentor_name=mentor.full_name if mentor else None,
                function=u.function.name if u.function else None,
                designation=u.designation.name if u.designation else None,
                self_performance_rating=review.self_performance_rating,
                mentor_performance_rating=review.mentor_performance_rating,
                management_performance_rating=review.management_performance_rating,
                final_performance_rating=review.final_performance_rating,
                status=review.status,
                final_rating_enabled=review.final_rating_enabled,
            ))
        else:
            mentor = (
                mentors_by_id.get(u.mentor_id)
                if u.mentor_id is not None
                else None
            )
            rows.append(CalibrationRow(
                review_id=None,
                user_id=u.id,
                employee_name=u.full_name,
                employee_email=u.email,
                mentor_name=mentor.full_name if mentor else None,
                function=u.function.name if u.function else None,
                designation=u.designation.name if u.designation else None,
                self_performance_rating=None,
                mentor_performance_rating=None,
                management_performance_rating=None,
                final_performance_rating=None,
                status=ReviewStatus.NOT_STARTED.value,
                final_rating_enabled=False,
            ))

    # No Python sort here — SQL ORDER BY already ordered the page.
    return Paginated[CalibrationRow](
        items=rows,
        total=total_users,
        limit=limit,
        offset=offset,
        has_more=(offset + len(rows)) < total_users,
    )


@router.patch("/{review_id}/management-rating", response_model=AnnualReviewResponse)
def set_management_rating(
    review_id: int,
    payload: ManagementRatingUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Management-only inline action from the Management Review tab.

    Sets (or updates) management_performance_rating, unlocks the per-row
    final_rating_enabled flag so the user-side fallback
    (management ?? mentor) becomes visible — still subject to the org-wide
    annual_review_final_rating_visible gate — and transitions the row to
    COMPLETED. Further edits remain allowed because the input gate also
    accepts COMPLETED, so management can recalibrate the rating without
    rolling the status back.
    """
    _require_management(current_user)

    review = db.query(AnnualReview).filter(
        AnnualReview.id == review_id,
        AnnualReview.org_id == current_user.org_id,
    ).first()
    if not review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found.")
    if review.status not in (
        ReviewStatus.PENDING_MANAGEMENT.value,
        ReviewStatus.COMPLETED.value,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Management rating can only be set after mentor evaluation is submitted.",
        )
    _require_submissions_open(
        db, current_user.org_id, _fy_label_of_review(review)
    )

    # Detect whether this is the first-time finalize (PENDING_MANAGEMENT →
    # COMPLETED) versus a recalibration (COMPLETED → COMPLETED). Only the
    # first-time transition pings the employee; subsequent rating tweaks
    # don't re-notify so admins can recalibrate without spamming.
    was_pending = review.status == ReviewStatus.PENDING_MANAGEMENT.value

    review.management_performance_rating = payload.management_performance_rating
    # Persist the synthesized final so HR_MyOrg's `/all` view, mentor mentee
    # cards, and the Excel export all read a populated value. Matches the
    # user-side synthesis in `_strip_private_ratings` (management ?? mentor),
    # keeping the DB the single source of truth instead of relying on every
    # read path to recompute it.
    review.final_performance_rating = payload.management_performance_rating
    review.final_rating_enabled = True
    review.status = ReviewStatus.COMPLETED.value

    db.commit()
    db.refresh(review)

    if was_pending:
        notify(
            db,
            org_id=current_user.org_id,
            recipient_id=review.user_id,
            sender_id=current_user.id,
            module="annual_review",
            entity_type="annual_review",
            entity_id=review.id,
            message=f"Your final {review.cycle_name} rating is now available.",
            entity_url=f"/annual-reviews?review_id={review.id}",
        )
        db.commit()

    return review


# =====================================================================
# SHARED — Single Review Lookup
# =====================================================================

@router.get("/{review_id}", response_model=AnnualReviewResponse)
def get_review(
    review_id: int,
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Single review by ID. Access control:
    - Employees can see their own review (with visibility rules applied)
    - Mentors can see reviews assigned to them
    - Admins can see any review in their org
    """
    settings = _get_settings(db, current_user.org_id)
    review = db.query(AnnualReview).filter(
        AnnualReview.id == review_id,
        AnnualReview.org_id == current_user.org_id,
    ).first()
    if not review:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Review not found.")

    is_owner = review.user_id == current_user.id
    is_mentor = review.mentor_id == current_user.id
    is_admin = current_user.role == "HR_MyOrg"

    if not (is_owner or is_mentor or is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this review.",
        )

    if is_owner and not is_admin:
        _strip_private_ratings(
            db,
            current_user.org_id,
            review,
            _active_fy_label(settings),
        )

    return review
