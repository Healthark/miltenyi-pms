"""add_draft_state_to_review_surfaces

Adds backend storage for explicit "Save Draft" workflows on the long-form
submission surfaces. Three column additions across three tables:

  - ``goal_self_reviews.is_draft``    bool, default False
  - ``goal_mentor_reviews.is_draft``  bool, default False
  - ``annual_reviews.mentor_overall_review_draft``     text, nullable
  - ``annual_reviews.mentor_performance_rating_draft`` int, nullable

The goal-review tables get a row-level boolean because they have no other
status field — row-existence used to be the "submitted" signal. With
``is_draft=True`` rows are now possible and represent an in-progress
reflection that hasn't been finalised yet.

The ``annual_reviews`` table already has a ``status`` enum, but during
the mentor stage the row is in ``pending_mentor`` state — it would be
wrong to drop it back to ``draft`` (that's the mentee's stage). So the
mentor's draft text/rating get their own ``*_draft`` columns; submitting
copies them into the final columns and clears the drafts.

The fourth review surface — ``project_reviews.status`` — does not need a
schema change: the column is a plain ``String`` so adding ``"draft"`` to
``ProjectReviewStatus`` in Python is enough. The fifth surface
(``project_review_evaluators``) already has ``EvaluatorStatus.DRAFT`` in
its enum; only route logic changes are needed.

Revision ID: d8e2f4a73c91
Revises: c7d4f8b1a3e5
Create Date: 2026-04-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d8e2f4a73c91"
down_revision: Union[str, None] = "c7d4f8b1a3e5"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── Goal review tables: add is_draft flag ────────────────────────
    op.add_column(
        "goal_self_reviews",
        sa.Column(
            "is_draft",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )
    op.add_column(
        "goal_mentor_reviews",
        sa.Column(
            "is_draft",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )

    # ── Annual review: mentor-stage draft columns ────────────────────
    op.add_column(
        "annual_reviews",
        sa.Column("mentor_overall_review_draft", sa.Text(), nullable=True),
    )
    op.add_column(
        "annual_reviews",
        sa.Column("mentor_performance_rating_draft", sa.Integer(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("annual_reviews", "mentor_performance_rating_draft")
    op.drop_column("annual_reviews", "mentor_overall_review_draft")
    op.drop_column("goal_mentor_reviews", "is_draft")
    op.drop_column("goal_self_reviews", "is_draft")
