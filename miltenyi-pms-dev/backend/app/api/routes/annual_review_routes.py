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

from typing import List
from fastapi import APIRouter, HTTPException, status

from app.api.dependencies import DbSession, CurrentUser
from app.core.cycle_utils import extract_fy_label
from app.models.annual_review_models import AnnualReview, ReviewStatus
from app.models.system_settings_models import SystemSettings
from app.models.user_models import User
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
    if not settings or not settings.active_cycle_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active performance cycle configured. Contact your HR administrator.",
        )
    return settings


def _get_active_cycle(db: DbSession, org_id: int) -> str:
    """
    Annual reviews are always yearly regardless of the org's cadence, so we
    strip any H1/H2/Q1–Q4 prefix and return just the fiscal-year label
    (e.g. "H1 FY26" → "FY26"). This also enforces the one-review-per-year
    rule that the UI and unique index depend on.
    """
    return extract_fy_label(_get_settings(db, org_id).active_cycle_name)


def _require_admin(current_user: User) -> None:
    if current_user.role != "Admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can perform this action.",
        )


def _require_management(current_user: User) -> None:
    """Management sub-role — always paired with Admin. Gates the Management
    Review tab's read/write endpoints so that regular admins (HR ops) cannot
    set or override management ratings."""
    if current_user.role != "Admin" or not bool(current_user.is_management):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only management users can perform this action.",
        )


def _strip_private_ratings(review: AnnualReview, final_visible: bool) -> None:
    """
    Mutates `review` in-place to hide ratings an employee shouldn't see yet.

    User-side display rule: final_performance_rating in the response is
    synthesized as management_performance_rating ?? mentor_performance_rating
    — the stored final_performance_rating column (HR's legacy override path)
    is not surfaced. The fallback is still strictly gated by the per-row
    final_rating_enabled AND the org-wide visibility flag so unfinalized
    reviews never leak.

    Mentor draft text/rating are also stripped — the mentee should not
    see in-progress mentor work.
    """
    mgmt = review.management_performance_rating
    mentor = review.mentor_performance_rating
    review.mentor_performance_rating = None
    review.management_performance_rating = None
    review.mentor_overall_review_draft = None
    review.mentor_performance_rating_draft = None
    if review.final_rating_enabled and final_visible:
        review.final_performance_rating = mgmt if mgmt is not None else mentor
    else:
        review.final_performance_rating = None


# =====================================================================
# STAGE 1 — EMPLOYEE SELF-APPRAISAL
# =====================================================================

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
    cycle_name = _get_active_cycle(db, current_user.org_id)

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
        return existing

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
    return review


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
    cycle_name = _get_active_cycle(db, current_user.org_id)

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
    return review


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

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(review, field, value)

    db.commit()
    db.refresh(review)
    return review


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

    _strip_private_ratings(review, settings.annual_review_final_rating_visible)
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
    for r in reviews:
        _strip_private_ratings(r, settings.annual_review_final_rating_visible)
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
    Each row is enriched with employee_name / department / designation.
    Final ratings are nulled when the org-wide visibility flag is off so the
    Mentee Review tab can conditionally hide the Ratings column.
    """
    settings = _get_settings(db, current_user.org_id)
    reviews = (
        db.query(AnnualReview)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.mentor_id == current_user.id,
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
        base = AnnualReviewResponse.model_validate(r).model_dump()
        if not settings.annual_review_final_rating_visible:
            base["final_performance_rating"] = None
            base["management_performance_rating"] = None
        u = users.get(r.user_id)
        rows.append(MenteeAnnualReview(
            **base,
            employee_name=u.full_name if u else f"Employee #{r.user_id}",
            employee_email=u.email if u else None,
            department=u.department.name if u and u.department else None,
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
    All reviews in pending_management + completed for the active cycle,
    shaped into a simplified grid row. Management-only.
    """
    _require_management(current_user)
    cycle_name = _get_active_cycle(db, current_user.org_id)

    reviews = (
        db.query(AnnualReview)
        .filter(
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == cycle_name,
            AnnualReview.status.in_([
                ReviewStatus.PENDING_MANAGEMENT.value,
                ReviewStatus.COMPLETED.value,
            ]),
        )
        .order_by(AnnualReview.created_at.asc())
        .all()
    )

    # Preload employees + mentors in a single round-trip. Mentors come from
    # review.mentor_id (the one captured at self-review time) rather than
    # user.mentor_id to keep the grid consistent with the review snapshot.
    user_ids = {r.user_id for r in reviews}
    mentor_ids = {r.mentor_id for r in reviews if r.mentor_id is not None}
    all_ids = list(user_ids | mentor_ids)
    users_by_id = {
        u.id: u
        for u in db.query(User).filter(User.id.in_(all_ids)).all()
    } if all_ids else {}

    rows: list[CalibrationRow] = []
    for r in reviews:
        u = users_by_id.get(r.user_id)
        m = users_by_id.get(r.mentor_id) if r.mentor_id else None
        rows.append(CalibrationRow(
            review_id=r.id,
            user_id=r.user_id,
            employee_name=u.full_name if u else "Unknown",
            employee_email=u.email if u else None,
            mentor_name=m.full_name if m else None,
            department=u.department.name if u and u.department else None,
            designation=u.designation.name if u and u.designation else None,
            self_performance_rating=r.self_performance_rating,
            mentor_performance_rating=r.mentor_performance_rating,
            management_performance_rating=r.management_performance_rating,
            final_performance_rating=r.final_performance_rating,
            status=r.status,
            final_rating_enabled=r.final_rating_enabled,
        ))
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

    Sets (or updates) management_performance_rating and unlocks the per-row
    final_rating_enabled flag so the user-side fallback
    (management ?? mentor) becomes visible — still subject to the org-wide
    annual_review_final_rating_visible gate.

    Unlike /finalize, this does NOT require a final_performance_rating and
    does NOT transition status, so management can adjust ratings multiple
    times during calibration.
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

    review.management_performance_rating = payload.management_performance_rating
    review.final_rating_enabled = True

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
    is_admin = current_user.role == "Admin"

    if not (is_owner or is_mentor or is_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You do not have access to this review.",
        )

    if is_owner and not is_admin:
        _strip_private_ratings(review, settings.annual_review_final_rating_visible)

    return review
