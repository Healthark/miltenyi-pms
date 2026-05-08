"""add_cycle_window_override

Demo-only escape hatch on SystemSettings. When True, the date-based
H1/H2 review-window gate is skipped so stakeholders can fill both
halves' reviews back-to-back during a testing round. Defaults to
False everywhere so production behavior stays unchanged.

Revision ID: e4b8a6f2c3d1
Revises: d1a3c5e7f9b2
Create Date: 2026-05-08
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e4b8a6f2c3d1"
down_revision: Union[str, None] = "d1a3c5e7f9b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("system_settings") as batch_op:
        batch_op.add_column(
            sa.Column(
                "cycle_window_override",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )


def downgrade() -> None:
    with op.batch_alter_table("system_settings") as batch_op:
        batch_op.drop_column("cycle_window_override")
