"""add_annual_reviews_enabled

Adds the admin gate flag that controls whether the Annual Reviews module
is enabled org-wide. When False, the Annual Reviews page is hidden and
all submission endpoints are blocked.

New column on `system_settings`:
    annual_reviews_enabled — Admin gate; defaults to False (closed)

Revision ID: a1b2c3d4e5f6
Revises: f3a9d1c2b8e7
Create Date: 2026-04-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, None] = "e5f4a2c91d38"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "system_settings",
        sa.Column(
            "annual_reviews_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("system_settings", "annual_reviews_enabled")
