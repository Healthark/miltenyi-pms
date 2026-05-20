"""rename_staff_role_to_employee

Renames the `role` value "Staff" to "Employee" across the `users` table.

Why: product decided to standardise on "Employee" everywhere (UI labels,
code identifiers, DB values). The role enum, Pydantic patterns, seed
scripts, and every comparison have all flipped to "Employee" in the
same release; this migration walks existing rows.

Idempotent: the WHERE clause matches only rows still on the old value,
so re-running is a no-op.

Revision ID: e7f3b9c8a625
Revises: d6e8a3b1c054
Create Date: 2026-05-20
"""
from typing import Sequence, Union

from alembic import op


revision: str = "e7f3b9c8a625"
down_revision: Union[str, None] = "d6e8a3b1c054"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        UPDATE users
           SET role = 'Employee'
         WHERE role = 'Staff'
        """
    )


def downgrade() -> None:
    op.execute(
        """
        UPDATE users
           SET role = 'Staff'
         WHERE role = 'Employee'
        """
    )
