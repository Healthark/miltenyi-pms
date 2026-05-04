"""add_is_management

Adds a sub-role flag on the users table. When True, the user sees and can
act on the Management Review tab (override/finalize ratings). The flag is
always paired with role == "Admin" in application logic — it does not
stand on its own.

New column on `users`:
    is_management - Boolean, defaults to False.

Revision ID: f2a8b1c93e04
Revises: e1f7a9b3d5c2
Create Date: 2026-04-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f2a8b1c93e04"
down_revision: Union[str, None] = "e1f7a9b3d5c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "is_management",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "is_management")
