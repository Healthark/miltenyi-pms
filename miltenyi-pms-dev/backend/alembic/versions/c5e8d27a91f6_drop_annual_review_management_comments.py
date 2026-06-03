"""drop_annual_review_management_comments

The `annual_reviews.management_comments` column was orphaned —
defined on the model but never wired into any Pydantic schema, route,
or UI. HR's calibration comments live on the per-row evaluation surface
(management_performance_rating + final_performance_rating); the
free-text comment channel was never built out. Cut the column.

Downgrade re-adds the column as nullable Text so the schema can be
restored if the column is ever wanted back.

Revision ID: c5e8d27a91f6
Revises: b8c19fa3d420
Create Date: 2026-06-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c5e8d27a91f6"
down_revision: Union[str, None] = "b8c19fa3d420"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # batch_alter_table for SQLite dev compat — same pattern as the
    # other recent column changes (mentor_orphaned_at,
    # pm_orphaned_at).
    with op.batch_alter_table("annual_reviews") as batch_op:
        batch_op.drop_column("management_comments")


def downgrade() -> None:
    with op.batch_alter_table("annual_reviews") as batch_op:
        batch_op.add_column(sa.Column("management_comments", sa.Text(), nullable=True))
