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

from typing import List, Optional
from fastapi import APIRouter, HTTPException, status
from sqlalchemy.orm import joinedload

from app.api.dependencies import DbSession, CurrentUser
from app.core.cycle_utils import (
    extract_fy_label,
    get_current_cycle_info,
    resolve_today,
)
from app.models.annual_review_models import AnnualReview, ReviewStatus
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
router = APIRouter()


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


def _require_submissions_open(settings: SystemSettings) -> None:
    """Reject state-changing annual review endpoints when HR has paused
    submissions org-wide. Read-side endpoints stay unaffected so staff,
    mentors, and HR can still inspect what already exists. The frontend
    surfaces this state as a banner on the AnnualReviews page; here we
    enforce it so a bypassed UI can't slip a write past us.
    """
    if not settings.annual_reviews_enabled:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=(
                "Annual review submissions are paused. "
                "Contact your administrator."
            ),
        )


def _strip_private_ratings(
    review: AnnualReview,
    final_visible: bool,
    active_fy_label: str | None = None,
) -> None:
    """
    Mutates `review` in-place to hide ratings an employee shouldn't see yet.

    User-side display rule: final_performance_rating in the response is
    synthesized as management_performance_rating ?? mentor_performance_rating
    — the stored final_performance_rating column (HR's legacy override path)
    is not surfaced.

    Cycle-scoping: `final_visible` (the org-wide
    `annual_review_final_rating_visible` flag) only applies to the CURRENT
    fiscal year's review. Past FY reviews always show the synthesized
    final rating when `final_rating_enabled` is true on the row,
    regardless of the org flag — otherwise flipping the flag off would
    retroactively blackout shipped years.

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
    # Past FYs ignore the org flag; only the per-row publish gate counts.
    effective_visible = final_visible if is_current_fy else True

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
    _require_submissions_open(settings)
    cycle_name = _active_fy_label(settings)

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
    return _attach_mentor_name(review, db)


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
    _require_submissions_open(settings)
    cycle_name = _active_fy_label(settings)

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
    _require_submissions_open(_get_settings(db, current_user.org_id))
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
        review,
        settings.annual_review_final_rating_visible,
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
        _strip_private_ratings(
            r, settings.annual_review_final_rating_visible, active_fy
        )
        r.mentor_name = (
            mentor_name_by_id.get(r.mentor_id) if r.mentor_id is not None else None
        )
    return reviews


@router.get("/all", response_model=List[AnnualReviewResponse])
def get_all_annual_reviews(
    db: DbSession,
    current_user: CurrentUser,
):
    """HR_MyOrg-only: every annual review across the org, every cycle.

    Powers the view-only "All Reviews" tab on the AnnualReviews page.
    HR_MyOrg is the management role, so private ratings are NOT stripped —
    they need to see the full picture for calibration / auditing.

    Resolves `employee_name` and `mentor_name` per row in two batched
    lookups (no N+1) so the table can render directly.
    """
    _require_hr_myorg(current_user)
    reviews = (
        db.query(AnnualReview)
        .filter(AnnualReview.org_id == current_user.org_id)
        .order_by(
            AnnualReview.cycle_name.desc(),
            AnnualReview.created_at.desc(),
        )
        .all()
    )

    user_ids = {r.user_id for r in reviews}
    user_ids.update(r.mentor_id for r in reviews if r.mentor_id is not None)
    name_by_id: dict[int, str] = {}
    # Function + designation are only needed for the *employee* (review.user_id),
    # not for mentors. Loaded once via a batched user fetch with eager joins
    # so the table can render with no per-row queries.
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

    return reviews


# =====================================================================
# STAGE 2 — MENTOR EVALUATION
# =====================================================================

@router.get("/mentees", response_model=List[MenteeAnnualReview])
def get_mentee_reviews(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    All reviews for the current user's direct mentees across every cycle/status.
    Each row is enriched with employee_name / function / designation.
    Final ratings are nulled when the org-wide visibility flag is off so the
    Mentee Review tab can conditionally hide the Ratings column.

    Resolution is by *current* mentor relationship (User.mentor_id), not by
    the mentor_id snapshot on the review row. The snapshot is still used as
    the gate for *submitting* an evaluation (a different mentor can read but
    not submit) — but for listing purposes we want to match what the
    My Mentees surface shows so historical / pre-migration rows with a
    NULL mentor_id are still visible.
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
        return []

    reviews = (
        db.query(AnnualReview)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.user_id.in_(mentee_ids),
        )
        .order_by(AnnualReview.created_at.desc())
        .all()
    )

    user_ids = [r.user_id for r in reviews]
    users = {
        u.id: u
        for u in db.query(User).filter(User.id.in_(user_ids)).all()
    } if user_ids else {}

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
        # Drop any name fields the parent already populated as None — we
        # provide our own resolved `employee_name` below, and otherwise
        # Python complains about duplicate kwargs when spreading `base`.
        base = AnnualReviewResponse.model_validate(r).model_dump(
            exclude={"employee_name", "mentor_name"},
        )
        if not settings.annual_review_final_rating_visible:
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
    return rows


@router.patch("/{review_id}/mentor-eval", response_model=AnnualReviewResponse)
def submit_mentor_evaluation(
    review_id: int,
    payload: MentorEvalUpdate,
    db: DbSession,
    current_user: CurrentUser,
):
    """Mentor submits their evaluation. Status: PENDING_MENTOR → PENDING_MANAGEMENT.
    Any saved mentor draft is cleared; the submitted payload becomes final."""
    _require_submissions_open(_get_settings(db, current_user.org_id))
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
    _require_submissions_open(_get_settings(db, current_user.org_id))
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

@router.get("/calibration", response_model=List[CalibrationRow])
def get_calibration_grid(
    db: DbSession,
    current_user: CurrentUser,
):
    """
    Every active Staff user in the org for the active cycle, LEFT-joined
    against their AnnualReview row. Staff who haven't created a review
    yet appear with status="not_started" and null ratings; the frontend
    gates actions per stage. Management-only.
    """
    _require_management(current_user)
    cycle_name = _get_active_cycle(db, current_user.org_id)

    staff_users = (
        db.query(User)
        .options(
            joinedload(User.function),
            joinedload(User.designation),
        )
        .filter(
            User.org_id == current_user.org_id,
            User.role == Role.STAFF.value,
            User.is_deleted == False,  # noqa: E712
        )
        .all()
    )
    if not staff_users:
        return []

    staff_ids = [u.id for u in staff_users]
    reviews = (
        db.query(AnnualReview)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == cycle_name,
            AnnualReview.user_id.in_(staff_ids),
        )
        .all()
    )
    reviews_by_user = {r.user_id: r for r in reviews}

    # Resolve mentor names in a single round-trip. For users with a
    # review, prefer the snapshotted review.mentor_id (so the grid stays
    # consistent with the review). For users without a review, fall back
    # to the live User.mentor_id assignment.
    mentor_ids: set[int] = set()
    for u in staff_users:
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
    for u in staff_users:
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

    rows.sort(key=lambda r: r.employee_name.lower())
    return rows


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
    _require_submissions_open(_get_settings(db, current_user.org_id))

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
        _strip_private_ratings(review, settings.annual_review_final_rating_visible)

    return review
