"""add_user_theme_preference

Adds the `theme_preference` column to `users`. Backs the per-user
light/dark UI toggle exposed in the Topbar.

The column is NOT NULL with a server default of "light" so existing
rows pick up a sensible value during the upgrade without a separate
backfill step.

Revision ID: e8b5c6a9d214
Revises: d3f7b8e2a45c
Create Date: 2026-05-13
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e8b5c6a9d214"
down_revision: Union[str, None] = "d3f7b8e2a45c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use batch_alter_table so this migration works on SQLite (dev) as well
    # as Postgres (prod) — SQLite can't add NOT NULL columns to existing
    # tables without a table rebuild.
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column(
                "theme_preference",
                sa.String(),
                nullable=False,
                server_default="light",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("theme_preference")
