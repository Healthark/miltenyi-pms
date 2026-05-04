"""add_feedback_360

Adds the two tables backing the 360 Feedback module:
    - feedback_360_reviews   one row per (reviewer, target, FY)
    - feedback_360_answers   one row per (review, question)

Reviewer identity is intentionally NOT stored. The `reviewer_hash`
column on `feedback_360_reviews` is an HMAC-SHA256 of
`(reviewer_id, target_id, fy_year)` keyed by the deployment-wide
`FEEDBACK_HASH_SECRET`. That hash is the uniqueness key (one review
per reviewer per target per FY) and the only way the service can
later answer "have I already reviewed X?" — only the reviewer can
reproduce their own hash via their JWT.

Revision ID: a3f7c2b9e108
Revises: f6c8e2a01b94
Create Date: 2026-05-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a3f7c2b9e108"
down_revision: Union[str, None] = "f6c8e2a01b94"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "feedback_360_reviews",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("target_user_id", sa.Integer(), nullable=False),
        sa.Column("fy_year", sa.Integer(), nullable=False),
        sa.Column("reviewer_hash", sa.String(length=64), nullable=False),
        sa.Column("worked_with", sa.Boolean(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["target_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "target_user_id",
            "fy_year",
            "reviewer_hash",
            name="uq_feedback_360_reviews_target_fy_hash",
        ),
    )
    op.create_index(
        "ix_feedback_360_reviews_id", "feedback_360_reviews", ["id"]
    )
    op.create_index(
        "ix_feedback_360_reviews_target_fy",
        "feedback_360_reviews",
        ["target_user_id", "fy_year"],
    )
    op.create_index(
        "ix_feedback_360_reviews_org", "feedback_360_reviews", ["org_id"]
    )

    op.create_table(
        "feedback_360_answers",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("review_id", sa.Integer(), nullable=False),
        sa.Column("question_key", sa.String(), nullable=False),
        sa.Column("rating", sa.SmallInteger(), nullable=False),
        sa.ForeignKeyConstraint(
            ["review_id"], ["feedback_360_reviews.id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "review_id",
            "question_key",
            name="uq_feedback_360_answers_review_question",
        ),
        sa.CheckConstraint(
            "rating >= 1 AND rating <= 5",
            name="ck_feedback_360_answers_rating_range",
        ),
    )
    op.create_index(
        "ix_feedback_360_answers_id", "feedback_360_answers", ["id"]
    )
    op.create_index(
        "ix_feedback_360_answers_review",
        "feedback_360_answers",
        ["review_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_feedback_360_answers_review", "feedback_360_answers")
    op.drop_index("ix_feedback_360_answers_id", "feedback_360_answers")
    op.drop_table("feedback_360_answers")

    op.drop_index("ix_feedback_360_reviews_org", "feedback_360_reviews")
    op.drop_index(
        "ix_feedback_360_reviews_target_fy", "feedback_360_reviews"
    )
    op.drop_index("ix_feedback_360_reviews_id", "feedback_360_reviews")
    op.drop_table("feedback_360_reviews")
