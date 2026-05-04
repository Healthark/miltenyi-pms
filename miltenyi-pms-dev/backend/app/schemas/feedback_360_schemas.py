"""
Pydantic shapes for the 360 Feedback API.

API responses NEVER include a `reviewer_id` field — the data simply
isn't tracked. Each row's only reviewer-tied artifact is the opaque
`reviewer_hash`, and even that isn't surfaced to the frontend.
"""

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


# ── Question registry ───────────────────────────────────────────────


class FeedbackQuestionResponse(BaseModel):
    key: str
    bucket: str
    text: str
    order: int


# ── Peer list (Give Feedback tab) ──────────────────────────────────


class FeedbackPeerResponse(BaseModel):
    """One row in the Give Feedback list. `has_submitted` is computed
    server-side via the requester's reviewer_hash — only the requester
    themselves can resolve it. `worked_with` is the system-inferred bit
    used to color the row in the UI. `received_count` is the total
    reviews this peer has received in the active FY (org-wide info,
    not reviewer-tied — safe to expose to all peers)."""
    user_id: int
    full_name: str
    designation_name: Optional[str] = None
    department_name: Optional[str] = None
    has_submitted: bool
    worked_with: bool
    received_count: int = 0


# ── Single peer + my own review (for the Give/Read-only page) ──────


class FeedbackTargetInfo(BaseModel):
    """Display info for a single peer, used by the give/read-only page."""
    user_id: int
    full_name: str
    designation_name: Optional[str] = None
    department_name: Optional[str] = None
    worked_with: bool


class FeedbackMyReviewResponse(BaseModel):
    """The requester's own review on a target, if any. `ratings` is null
    when the requester hasn't submitted yet (frontend renders the
    page in submit mode). When non-null, the page renders read-only
    with the slider thumbs at these positions."""
    target: FeedbackTargetInfo
    fy_year: int
    ratings: Optional[Dict[str, int]] = None


# ── Submission ──────────────────────────────────────────────────────


class FeedbackSubmitRequest(BaseModel):
    """Body for POST /feedback-360/reviews. Skipped questions are
    simply absent from `ratings`. Ratings must be 1..5 (validated in
    the route handler so the per-key error message can name the
    offending question key); at least one rating is required."""
    target_user_id: int
    ratings: Dict[str, int] = Field(default_factory=dict)


# ── Aggregate (My / Mentee / Org Feedback tabs) ─────────────────────


class FeedbackBucketAggregate(BaseModel):
    """Per-question aggregate for one of the two reviewer cohorts.
    `null` (i.e. None) when the cohort has fewer than the minimum
    number of reviewers required to render — anonymity guard.

    `min` / `max` drive the whisker line on the aggregate plot;
    `avg` is the dot on it."""
    count: int
    avg: float
    min: int
    max: int


class FeedbackQuestionAggregate(BaseModel):
    key: str
    bucket: str
    text: str
    order: int
    worked_with: Optional[FeedbackBucketAggregate] = None
    not_worked_with: Optional[FeedbackBucketAggregate] = None


class FeedbackAggregateResponse(BaseModel):
    target_user_id: int
    fy_year: int
    total_reviews: int
    min_reviewers_threshold: int
    questions: List[FeedbackQuestionAggregate]
