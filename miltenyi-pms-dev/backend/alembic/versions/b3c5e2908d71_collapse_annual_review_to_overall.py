"""collapse_annual_review_to_overall

Drops the 8 per-competency self_desc_* and 8 matching mentor_comment_* text
columns in favour of a single self_overall_review + mentor_overall_review pair.
The 1–5 performance ratings (self / mentor / management / final) are untouched.

Dev DB only — all existing annual_reviews rows are cleared.

Revision ID: b3c5e2908d71
Revises: a9d4e7f38c11
Create Date: 2026-04-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b3c5e2908d71"
down_revision: Union[str, None] = "a9d4e7f38c11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


COMPETENCY_KEYS = (
    "task_ownership",
    "ownership_accountability",
    "client_deliverables",
    "communication_stakeholder",
    "project_management",
    "mentoring",
    "firm_growth",
    "competency_skills",
)


def upgrade() -> None:
    # Seed narratives are stamped with the new fields, so existing rows can't
    # survive the column drop — blow them away.
    op.execute("DELETE FROM annual_reviews")

    with op.batch_alter_table("annual_reviews") as batch:
        for k in COMPETENCY_KEYS:
            batch.drop_column(f"self_desc_{k}")
            batch.drop_column(f"mentor_comment_{k}")

        batch.add_column(sa.Column("self_overall_review", sa.Text(), nullable=True))
        batch.add_column(sa.Column("mentor_overall_review", sa.Text(), nullable=True))


def downgrade() -> None:
    op.execute("DELETE FROM annual_reviews")

    with op.batch_alter_table("annual_reviews") as batch:
        batch.drop_column("self_overall_review")
        batch.drop_column("mentor_overall_review")

        for k in COMPETENCY_KEYS:
            batch.add_column(sa.Column(f"self_desc_{k}", sa.Text(), nullable=True))
            batch.add_column(sa.Column(f"mentor_comment_{k}", sa.Text(), nullable=True))
