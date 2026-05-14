"""add_user_last_seen_cycle

Adds the `last_seen_cycle` column to `users`. Powers the dashboard's
dismissible "cycle rolled over" banner — when the column diverges from
the org's current active cycle, the user sees the banner; dismissing
stamps the column to the current cycle.

Nullable on purpose: existing users have never dismissed anything, so
they'll see the banner the first time they open the dashboard after
this migration runs. That's the intended behaviour.

Revision ID: a4e7b8c3d105
Revises: f9c2d7a5b831
Create Date: 2026-05-14
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a4e7b8c3d105"
down_revision: Union[str, None] = "f9c2d7a5b831"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(sa.Column("last_seen_cycle", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("last_seen_cycle")
