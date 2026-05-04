"""
360 Feedback models — anonymous peer review.

Reviewer identity is NEVER persisted. Each review row carries a
HMAC-SHA256 hash of `(reviewer_id, target_id, fy_year)` that doubles as:
    1. The uniqueness key (one review per reviewer per target per FY).
    2. The "have I reviewed X?" lookup key — only the reviewer can
       reproduce the hash via their own JWT, so no one else can probe
       it.

The `worked_with` flag is a snapshot taken at submit time from the
reviewer/target's project_assignments. It does not update if either
party joins or leaves a project after the review is in.

Answers are key-based, not column-based — adding/removing a question
in `feedback_360.questions` is a code change with no migration.
"""

from sqlalchemy import (
    Column,
    Integer,
    SmallInteger,
    String,
    Boolean,
    DateTime,
    ForeignKey,
    CheckConstraint,
    UniqueConstraint,
    Index,
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.core.database import Base


class Feedback360Review(Base):
    __tablename__ = "feedback_360_reviews"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    target_user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # Cycle key — the integer fiscal-year start year (e.g. 2026 = FY26-27).
    # Independent of the half-yearly cadence used elsewhere.
    fy_year = Column(Integer, nullable=False)

    # HMAC-SHA256 of `f"{reviewer_id}|{target_id}|{fy_year}"` keyed by
    # FEEDBACK_HASH_SECRET. 64 hex chars exactly.
    reviewer_hash = Column(String(64), nullable=False)

    # Snapshotted at submit time from project_assignments. True iff the
    # reviewer and target share at least one project_id at the moment of
    # submission. See feedback_360_service.did_work_together().
    worked_with = Column(Boolean, nullable=False)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    target = relationship("User", foreign_keys=[target_user_id])
    answers = relationship(
        "Feedback360Answer",
        back_populates="review",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        # One review per (reviewer, target, FY). The reviewer_hash is a
        # function of those three inputs, so this also enforces "no
        # duplicate submissions" at the DB layer — no races possible.
        UniqueConstraint(
            "target_user_id",
            "fy_year",
            "reviewer_hash",
            name="uq_feedback_360_reviews_target_fy_hash",
        ),
        # Hot path: aggregate query for a single target in a single FY.
        Index(
            "ix_feedback_360_reviews_target_fy",
            "target_user_id",
            "fy_year",
        ),
        Index("ix_feedback_360_reviews_org", "org_id"),
    )


class Feedback360Answer(Base):
    __tablename__ = "feedback_360_answers"

    id = Column(Integer, primary_key=True, index=True)
    review_id = Column(
        Integer,
        ForeignKey("feedback_360_reviews.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Stable string key from app.feedback_360.questions.FEEDBACK_QUESTIONS.
    # Validated at submit time against VALID_QUESTION_KEYS — unknown keys
    # are rejected with 400.
    question_key = Column(String, nullable=False)

    # 1 = strongly disagree, 5 = strongly agree.
    rating = Column(SmallInteger, nullable=False)

    review = relationship("Feedback360Review", back_populates="answers")

    __table_args__ = (
        # One rating per question per review. Skipped questions = no row.
        UniqueConstraint(
            "review_id",
            "question_key",
            name="uq_feedback_360_answers_review_question",
        ),
        CheckConstraint(
            "rating >= 1 AND rating <= 5",
            name="ck_feedback_360_answers_rating_range",
        ),
        Index("ix_feedback_360_answers_review", "review_id"),
    )
