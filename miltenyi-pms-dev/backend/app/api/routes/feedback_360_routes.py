"""
360 Feedback Routes.

Endpoints (all under /api/v1/feedback-360, all authenticated):
    GET  /questions                  → registry (key, bucket, text, order)
    GET  /peers                      → org users with worked-with + has-submitted flags
    POST /reviews                    → submit a review (one per (reviewer, target, FY))
    GET  /aggregate/{target_user_id} → per-question worked-with / not-worked-with aggregate

Anonymity contract: `reviewer_id` is NEVER persisted. The submit
handler computes the HMAC hash, writes the row keyed by it, and drops
the id. API responses never include reviewer-identifying fields. See
app.services.feedback_360_service for the threat model.
"""

from typing import List

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import joinedload

from app.api.dependencies import CurrentUser, DbSession
from app.feedback_360.questions import FEEDBACK_QUESTIONS, VALID_QUESTION_KEYS
from app.models.feedback_360_models import Feedback360Answer, Feedback360Review
from app.models.user_models import User
from app.schemas.feedback_360_schemas import (
    FeedbackAggregateResponse,
    FeedbackBucketAggregate,
    FeedbackMyReviewResponse,
    FeedbackPeerResponse,
    FeedbackQuestionAggregate,
    FeedbackQuestionResponse,
    FeedbackSubmitRequest,
    FeedbackTargetInfo,
)
from app.services.feedback_360_service import (
    can_view_target,
    current_active_fy,
    did_work_together,
    reviewer_hash,
    shared_project_targets,
)

router = APIRouter()

# Anonymity guard: don't render the per-cohort aggregate until at least
# this many reviewers in that cohort have submitted. Below threshold
# keeps the cohort's bar hidden so a single rater can't be identified.
MIN_REVIEWERS_PER_COHORT = 3


# ── Static registry ─────────────────────────────────────────────────


@router.get("/questions", response_model=List[FeedbackQuestionResponse])
def list_questions(_: CurrentUser):
    """Return the hard-coded question list. Authenticated so we don't
    leak the question set to scrapers, even though there's nothing
    sensitive in it."""
    return [
        FeedbackQuestionResponse(
            key=q.key, bucket=q.bucket, text=q.text, order=q.order
        )
        for q in FEEDBACK_QUESTIONS
    ]


# ── Peer list (Give Feedback tab) ───────────────────────────────────


@router.get("/peers", response_model=List[FeedbackPeerResponse])
def list_peers(current_user: CurrentUser, db: DbSession):
    """List of org users the current user can submit reviews on. Each
    row carries `has_submitted` (already reviewed this FY?) and
    `worked_with` (system-inferred from project_assignments)."""
    fy_year = current_active_fy()

    # Active org users excluding self.
    peers = (
        db.query(User)
        .options(joinedload(User.designation), joinedload(User.department))
        .filter(
            User.org_id == current_user.org_id,
            User.id != current_user.id,
            User.is_deleted.is_(False),
        )
        .order_by(User.full_name)
        .all()
    )
    if not peers:
        return []

    # Batched worked-with lookup (one query for everyone).
    worked_with_set = shared_project_targets(
        db, current_user.id, current_user.org_id
    )

    # Batched has-submitted lookup. Compute the requester's hash for
    # each peer, then ask the DB which of those hashes already exist.
    hashes_by_peer: dict[str, int] = {
        reviewer_hash(current_user.id, p.id, fy_year): p.id for p in peers
    }
    submitted_hashes = {
        h
        for (h,) in db.query(Feedback360Review.reviewer_hash)
        .filter(
            Feedback360Review.org_id == current_user.org_id,
            Feedback360Review.fy_year == fy_year,
            Feedback360Review.reviewer_hash.in_(list(hashes_by_peer.keys())),
        )
        .all()
    }
    submitted_peer_ids = {hashes_by_peer[h] for h in submitted_hashes}

    # Batched received-review count per peer. Single grouped query —
    # no N+1. The count is org-wide info (no reviewer identity leaked),
    # so it's safe to expose for every requester.
    peer_ids = [p.id for p in peers]
    received_rows = (
        db.query(
            Feedback360Review.target_user_id,
            func.count(Feedback360Review.id),
        )
        .filter(
            Feedback360Review.org_id == current_user.org_id,
            Feedback360Review.fy_year == fy_year,
            Feedback360Review.target_user_id.in_(peer_ids),
        )
        .group_by(Feedback360Review.target_user_id)
        .all()
    ) if peer_ids else []
    received_count_by_peer: dict[int, int] = {
        int(pid): int(cnt) for pid, cnt in received_rows
    }

    return [
        FeedbackPeerResponse(
            user_id=p.id,
            full_name=p.full_name,
            designation_name=p.designation.name if p.designation else None,
            department_name=p.department.name if p.department else None,
            has_submitted=p.id in submitted_peer_ids,
            worked_with=p.id in worked_with_set,
            received_count=received_count_by_peer.get(p.id, 0),
        )
        for p in peers
    ]


# ── Single-peer info + my own review (for the Give/Read-only page) ─


@router.get(
    "/my-review/{target_user_id}",
    response_model=FeedbackMyReviewResponse,
)
def get_my_review(
    target_user_id: int,
    current_user: CurrentUser,
    db: DbSession,
):
    """Fetch the requester's own review on a target, if any. Resolves
    via the requester's reviewer_hash so anonymity is preserved —
    only the requester themselves can fetch their own review.

    Powers the new `/feedback/give/:id` page: when `ratings` is null,
    the page renders submit mode; when non-null, read-only mode."""
    if target_user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You can't fetch a self-review.",
        )

    target = (
        db.query(User)
        .options(joinedload(User.designation), joinedload(User.department))
        .filter(
            User.id == target_user_id,
            User.org_id == current_user.org_id,
            User.is_deleted.is_(False),
        )
        .first()
    )
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="That person isn't an active member of your organization.",
        )

    fy_year = current_active_fy()
    rev_hash = reviewer_hash(current_user.id, target.id, fy_year)
    worked = did_work_together(
        db, current_user.id, target.id, current_user.org_id
    )

    review = (
        db.query(Feedback360Review)
        .filter(
            Feedback360Review.target_user_id == target.id,
            Feedback360Review.fy_year == fy_year,
            Feedback360Review.reviewer_hash == rev_hash,
        )
        .first()
    )
    ratings: dict[str, int] | None = None
    if review is not None:
        rows = (
            db.query(Feedback360Answer.question_key, Feedback360Answer.rating)
            .filter(Feedback360Answer.review_id == review.id)
            .all()
        )
        ratings = {key: int(rating) for key, rating in rows}

    return FeedbackMyReviewResponse(
        target=FeedbackTargetInfo(
            user_id=target.id,
            full_name=target.full_name,
            designation_name=target.designation.name if target.designation else None,
            department_name=target.department.name if target.department else None,
            worked_with=worked,
        ),
        fy_year=fy_year,
        ratings=ratings,
    )


# ── Submit ──────────────────────────────────────────────────────────


@router.post("/reviews", status_code=status.HTTP_204_NO_CONTENT)
def submit_review(
    payload: FeedbackSubmitRequest,
    current_user: CurrentUser,
    db: DbSession,
):
    """Record a review. Validates target, ratings, and uniqueness;
    drops the reviewer's identity into a hash and walks away."""
    # 1. Self-review blocked.
    if payload.target_user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You can't submit feedback on yourself.",
        )

    # 2. Target must exist + be active in the same org.
    target = (
        db.query(User)
        .filter(
            User.id == payload.target_user_id,
            User.org_id == current_user.org_id,
            User.is_deleted.is_(False),
        )
        .first()
    )
    if target is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="That person isn't an active member of your organization.",
        )

    # 3. ≥1 rating required.
    if not payload.ratings:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one question must be rated to submit feedback.",
        )

    # 4. Reject unknown question keys (typos / stale frontend caches).
    unknown = set(payload.ratings.keys()) - VALID_QUESTION_KEYS
    if unknown:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown question key(s): {sorted(unknown)}",
        )

    # 5. Range-check every rating. The DB CHECK constraint catches
    # this too, but we surface a friendly error pre-flight.
    for key, rating in payload.ratings.items():
        if rating < 1 or rating > 5:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Rating for '{key}' must be between 1 and 5.",
            )

    # 6. Compute the anonymous identifiers.
    fy_year = current_active_fy()
    rev_hash = reviewer_hash(current_user.id, target.id, fy_year)
    worked_with = did_work_together(
        db, current_user.id, target.id, current_user.org_id
    )

    # 7. Insert the review + answers in a single transaction. The
    # UNIQUE(target_user_id, fy_year, reviewer_hash) constraint catches
    # duplicate submissions even under race conditions.
    review = Feedback360Review(
        org_id=current_user.org_id,
        target_user_id=target.id,
        fy_year=fy_year,
        reviewer_hash=rev_hash,
        worked_with=worked_with,
    )
    db.add(review)
    try:
        db.flush()  # surface the UNIQUE violation now (before answers)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="You've already submitted feedback on this person for this fiscal year.",
        )

    for question_key, rating in payload.ratings.items():
        db.add(
            Feedback360Answer(
                review_id=review.id,
                question_key=question_key,
                rating=int(rating),
            )
        )
    db.commit()
    return None


# ── Aggregate ───────────────────────────────────────────────────────


@router.get(
    "/aggregate/{target_user_id}",
    response_model=FeedbackAggregateResponse,
)
def get_aggregate(
    target_user_id: int,
    current_user: CurrentUser,
    db: DbSession,
):
    """Per-question aggregate for the given target. Permission: self,
    direct mentor, or Management. Below the per-cohort minimum reviewer
    threshold, the cohort is reported as `null` to protect single-
    reviewer identification."""
    if not can_view_target(current_user, target_user_id, db):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to view this person's feedback.",
        )

    fy_year = current_active_fy()

    # Total review count (across both cohorts, all questions).
    total_reviews = (
        db.query(func.count(Feedback360Review.id))
        .filter(
            Feedback360Review.target_user_id == target_user_id,
            Feedback360Review.fy_year == fy_year,
        )
        .scalar()
    ) or 0

    # Per-question, per-cohort count + avg + min + max in one grouped query.
    rows = (
        db.query(
            Feedback360Answer.question_key,
            Feedback360Review.worked_with,
            func.count(Feedback360Answer.id),
            func.avg(Feedback360Answer.rating),
            func.min(Feedback360Answer.rating),
            func.max(Feedback360Answer.rating),
        )
        .join(
            Feedback360Review,
            Feedback360Review.id == Feedback360Answer.review_id,
        )
        .filter(
            Feedback360Review.target_user_id == target_user_id,
            Feedback360Review.fy_year == fy_year,
        )
        .group_by(
            Feedback360Answer.question_key, Feedback360Review.worked_with
        )
        .all()
    )

    by_q: dict[str, dict[bool, FeedbackBucketAggregate]] = {}
    for question_key, ww, count, avg, mn, mx in rows:
        by_q.setdefault(question_key, {})[bool(ww)] = FeedbackBucketAggregate(
            count=int(count),
            avg=float(avg) if avg is not None else 0.0,
            min=int(mn) if mn is not None else 0,
            max=int(mx) if mx is not None else 0,
        )

    out: list[FeedbackQuestionAggregate] = []
    for q in FEEDBACK_QUESTIONS:
        cohorts = by_q.get(q.key, {})
        ww = cohorts.get(True)
        nw = cohorts.get(False)
        # Hide cohorts below the threshold.
        if ww is not None and ww.count < MIN_REVIEWERS_PER_COHORT:
            ww = None
        if nw is not None and nw.count < MIN_REVIEWERS_PER_COHORT:
            nw = None
        out.append(
            FeedbackQuestionAggregate(
                key=q.key,
                bucket=q.bucket,
                text=q.text,
                order=q.order,
                worked_with=ww,
                not_worked_with=nw,
            )
        )

    return FeedbackAggregateResponse(
        target_user_id=target_user_id,
        fy_year=fy_year,
        total_reviews=total_reviews,
        min_reviewers_threshold=MIN_REVIEWERS_PER_COHORT,
        questions=out,
    )
