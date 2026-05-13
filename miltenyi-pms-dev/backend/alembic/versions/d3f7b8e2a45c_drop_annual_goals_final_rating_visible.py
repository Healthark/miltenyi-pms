"""drop_annual_goals_final_rating_visible

Drops the `annual_goals_final_rating_visible` column from `system_settings`.

The toggle was surfaced in the Admin Panel's System Settings tab but was
never consumed anywhere in the code — no gating logic read the flag, so
flipping it had no effect. Removing the UI toggle along with the column
to keep the schema honest about what's actually load-bearing.

Final rating visibility on annual reviews is governed by
`annual_review_final_rating_visible` (a separate column), which IS read by
`_strip_private_ratings` in `annual_review_routes.py`.

Revision ID: d3f7b8e2a45c
Revises: c7f4a2e9b1d6
Create Date: 2026-05-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d3f7b8e2a45c"
down_revision: Union[str, None] = "c7f4a2e9b1d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use batch_alter_table so this migration works on SQLite (dev) as well
    # as Postgres (prod) — SQLite can't drop columns without a table rebuild.
    with op.batch_alter_table("system_settings") as batch_op:
        batch_op.drop_column("annual_goals_final_rating_visible")


def downgrade() -> None:
    with op.batch_alter_table("system_settings") as batch_op:
        batch_op.add_column(
            sa.Column(
                "annual_goals_final_rating_visible",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )
