"""per-quarter backfill switch

Revision ID: f1d9a4c7e2b3
Revises: e5b8c3d0f2a7
Create Date: 2026-09-20

UAT feedback (Zaahid, 20 Sep 2026): the Admin can close an earlier quarter
for backfill on its own — `project_goal_quarters.backfill_open` (default
true). The current quarter of the active year is always open; a past year's
quarter is open while both the year's and the quarter's switch are on.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "f1d9a4c7e2b3"
down_revision = "e5b8c3d0f2a7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("project_goal_quarters") as batch:
        batch.add_column(sa.Column("backfill_open", sa.Boolean(), nullable=False, server_default=sa.true()))


def downgrade() -> None:
    with op.batch_alter_table("project_goal_quarters") as batch:
        batch.drop_column("backfill_open")
