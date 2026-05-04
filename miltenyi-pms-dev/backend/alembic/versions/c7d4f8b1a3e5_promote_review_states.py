"""promote_review_states

Promotes the goal lifecycle from 4 to 8 states by treating each per-half
review milestone (H1 self → H1 mentor → H2 self → H2 mentor) as its own
``Goal.approval_status`` value. Also renames the ``submitted`` value to
``pending_approval`` to match the badge label.

This migration is **data-only** — the column type stays ``String`` so no
schema change is needed; we just rewrite values.

Upgrade does two passes:
  1. ``submitted`` → ``pending_approval`` (cosmetic rename).
  2. Every existing ``approved`` goal is advanced to whatever post-approval
     state its review-row presence already justifies, so the migration is
     a true no-op for history (the badge now renders the *real* state of
     each goal at the moment of upgrade).

Downgrade collapses the new states back to ``approved`` and renames
``pending_approval`` back to ``submitted``.

Revision ID: c7d4f8b1a3e5
Revises: b6e3a9d4c5f7
Create Date: 2026-04-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7d4f8b1a3e5"
down_revision: Union[str, None] = "b6e3a9d4c5f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()

    # 1. Cosmetic rename: 'submitted' → 'pending_approval'.
    bind.execute(sa.text(
        "UPDATE goals SET approval_status = 'pending_approval' "
        "WHERE approval_status = 'submitted'"
    ))

    # 2. Advance every still-'approved' goal to its furthest review milestone
    #    based on existing GoalSelfReview / GoalMentorReview row presence.
    #    Order matters — check from "most advanced" downward so the first
    #    matching CASE wins.
    bind.execute(sa.text("""
        UPDATE goals
        SET approval_status = CASE
            WHEN id IN (SELECT goal_id FROM goal_mentor_reviews WHERE cycle_half = 'H2')
                THEN 'h2_mentor_reviewed'
            WHEN id IN (SELECT goal_id FROM goal_self_reviews   WHERE cycle_half = 'H2')
                THEN 'h2_self_reviewed'
            WHEN id IN (SELECT goal_id FROM goal_mentor_reviews WHERE cycle_half = 'H1')
                THEN 'h1_mentor_reviewed'
            WHEN id IN (SELECT goal_id FROM goal_self_reviews   WHERE cycle_half = 'H1')
                THEN 'h1_self_reviewed'
            ELSE 'approved'
        END
        WHERE approval_status = 'approved'
    """))


def downgrade() -> None:
    bind = op.get_bind()
    # Collapse all 4 new post-approval states back to 'approved' — the
    # review rows still exist so no information is lost from the system,
    # only from the goal-level status field.
    bind.execute(sa.text("""
        UPDATE goals SET approval_status = 'approved'
        WHERE approval_status IN (
            'h1_self_reviewed',
            'h1_mentor_reviewed',
            'h2_self_reviewed',
            'h2_mentor_reviewed'
        )
    """))
    bind.execute(sa.text(
        "UPDATE goals SET approval_status = 'submitted' "
        "WHERE approval_status = 'pending_approval'"
    ))
