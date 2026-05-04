"""add_firm_growth_role_expectation

Adds an 8th competency column ``exp_firm_growth`` to ``role_expectations``.
Existing rows are left NULL — seed.py populates the column for the canonical
3 departments × 3 designations grid.

Revision ID: f4a5b8c1d2e9
Revises: e2d9f5c8a7b3
Create Date: 2026-04-26
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f4a5b8c1d2e9"
down_revision: Union[str, None] = "e2d9f5c8a7b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("role_expectations") as batch_op:
        batch_op.add_column(sa.Column("exp_firm_growth", sa.Text(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("role_expectations") as batch_op:
        batch_op.drop_column("exp_firm_growth")
