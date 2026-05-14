"""add_simulated_today

Adds the `simulated_today` column to `system_settings`. Powers the
demo / QA date-simulation feature: when this date is set, all
cycle-determination and review-window logic uses it instead of the
real wall date.

Gated by the `ALLOW_DATE_SIMULATION` env flag — production should
leave that flag off, which makes the PATCH endpoint reject any
non-null write to this column.

Revision ID: f9c2d7a5b831
Revises: e8b5c6a9d214
Create Date: 2026-05-14
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f9c2d7a5b831"
down_revision: Union[str, None] = "e8b5c6a9d214"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # batch_alter_table works on both SQLite (dev) and Postgres (prod).
    # Nullable column — null means "no simulation, use the real clock".
    with op.batch_alter_table("system_settings") as batch_op:
        batch_op.add_column(
            sa.Column("simulated_today", sa.Date(), nullable=True)
        )


def downgrade() -> None:
    with op.batch_alter_table("system_settings") as batch_op:
        batch_op.drop_column("simulated_today")
