"""add_must_change_password

Adds a flag on the users table that marks accounts whose password was
reset by an admin. When True, the user is forced into the change-password
screen on their next authenticated request and cannot access other pages
until they set a password of their own.

New column on `users`:
    must_change_password - Boolean, defaults to False.

Revision ID: e1f7a9b3d5c2
Revises: b3c5e2908d71
Create Date: 2026-04-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e1f7a9b3d5c2"
down_revision: Union[str, None] = "b3c5e2908d71"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "users",
        sa.Column(
            "must_change_password",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("users", "must_change_password")
