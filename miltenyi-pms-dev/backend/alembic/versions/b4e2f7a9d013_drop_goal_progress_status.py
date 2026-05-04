"""drop_goal_progress_status

Drops the employee-controlled `status` column from `goals`.

Progress on a goal is now tracked entirely through the criteria
completion state (`goal_criteria.is_completed`) — there is no longer
a separate "pending / in_progress / completed / cancelled" dimension.
This removes the double-source-of-truth between goal.status and the
criteria checklist.

Revision ID: b4e2f7a9d013
Revises: f3a9d1c2b8e7
Create Date: 2026-04-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b4e2f7a9d013"
down_revision: Union[str, None] = "f3a9d1c2b8e7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use batch_alter_table so this migration works on SQLite (dev) as well
    # as Postgres (prod) — SQLite can't drop columns without a table rebuild.
    with op.batch_alter_table("goals") as batch_op:
        batch_op.drop_column("status")


def downgrade() -> None:
    with op.batch_alter_table("goals") as batch_op:
        batch_op.add_column(
            sa.Column(
                "status",
                sa.String(),
                nullable=False,
                server_default="pending",
            )
        )
