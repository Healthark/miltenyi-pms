"""rework_annual_review_fields

Destructive reshape of the annual_reviews table to match the new 8-competency
self + mentor evaluation structure, and swap star ratings (5=best) for
performance ratings (1=best) consistent with project reviews. Also adds a
system_settings flag that controls whether annual-review final ratings are
visible in mentor/mentee views.

Dev DB only — all existing annual_reviews rows are dropped.

Revision ID: a9d4e7f38c11
Revises: a1b2c3d4e5f6
Create Date: 2026-04-22
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "a9d4e7f38c11"
down_revision: Union[str, None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The 8 new competency keys. Both self_desc_* and mentor_comment_* columns
# use this identical key set so the two sides remain structurally aligned.
NEW_KEYS = [
    "task_ownership",
    "ownership_accountability",
    "client_deliverables",
    "communication_stakeholder",
    "project_management",
    "mentoring",
    "firm_growth",
    "competency_skills",
]

OLD_KEYS = [
    "ownership",
    "productivity",
    "communication",
    "leadership",
    "adaptability",
    "time_management",
]


def upgrade() -> None:
    # Wipe existing rows — field set is changing, seed data is the source of truth.
    op.execute("DELETE FROM annual_reviews")

    with op.batch_alter_table("annual_reviews") as batch:
        for k in OLD_KEYS:
            batch.drop_column(f"self_desc_{k}")
            batch.drop_column(f"mentor_comment_{k}")
        batch.drop_column("self_stars")
        batch.drop_column("mentor_stars")
        batch.drop_column("management_stars")
        batch.drop_column("final_stars")

        for k in NEW_KEYS:
            batch.add_column(sa.Column(f"self_desc_{k}", sa.Text(), nullable=True))
            batch.add_column(sa.Column(f"mentor_comment_{k}", sa.Text(), nullable=True))

        batch.add_column(sa.Column("self_performance_rating", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("mentor_performance_rating", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("management_performance_rating", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("final_performance_rating", sa.Integer(), nullable=True))

    with op.batch_alter_table("system_settings") as batch:
        batch.add_column(
            sa.Column(
                "annual_review_final_rating_visible",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade() -> None:
    op.execute("DELETE FROM annual_reviews")

    with op.batch_alter_table("system_settings") as batch:
        batch.drop_column("annual_review_final_rating_visible")

    with op.batch_alter_table("annual_reviews") as batch:
        batch.drop_column("self_performance_rating")
        batch.drop_column("mentor_performance_rating")
        batch.drop_column("management_performance_rating")
        batch.drop_column("final_performance_rating")

        for k in NEW_KEYS:
            batch.drop_column(f"self_desc_{k}")
            batch.drop_column(f"mentor_comment_{k}")

        for k in OLD_KEYS:
            batch.add_column(sa.Column(f"self_desc_{k}", sa.Text(), nullable=True))
            batch.add_column(sa.Column(f"mentor_comment_{k}", sa.Text(), nullable=True))
        batch.add_column(sa.Column("self_stars", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("mentor_stars", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("management_stars", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("final_stars", sa.Integer(), nullable=True))
