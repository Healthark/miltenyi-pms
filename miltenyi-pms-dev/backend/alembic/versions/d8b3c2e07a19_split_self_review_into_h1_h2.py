"""split_self_review_into_h1_h2

Replaces the single embedded self-review on `goals` with a dedicated
`goal_self_reviews` table keyed by (goal_id, cycle_half).  An employee
now reflects on an approved yearly goal twice — once for H1 and once
for H2 of the goal's fiscal year — each a one-shot submission.

Upgrade:
    - Create `goal_self_reviews` table with 8 competency text columns
      + cycle_half + submitted_at, UNIQUE (goal_id, cycle_half).
    - Drop the 9 embedded self-review columns from `goals`.

Downgrade:
    - Re-add the 9 columns on `goals`.
    - Drop `goal_self_reviews`.

Revision ID: d8b3c2e07a19
Revises: c7f1a5b92e04
Create Date: 2026-04-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d8b3c2e07a19"
down_revision: Union[str, None] = "c7f1a5b92e04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


EMBEDDED_COLUMNS = (
    "self_desc_task_execution",
    "self_desc_ownership",
    "self_desc_client_deliverables",
    "self_desc_communication",
    "self_desc_project_management",
    "self_desc_mentoring",
    "self_desc_firm_growth",
    "self_desc_competency_skills",
)


def upgrade() -> None:
    # ── Create goal_self_reviews ─────────────────────────────────────
    op.create_table(
        "goal_self_reviews",
        sa.Column("id", sa.Integer(), primary_key=True, index=True),
        sa.Column(
            "goal_id",
            sa.Integer(),
            sa.ForeignKey("goals.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "org_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column("cycle_half", sa.String(), nullable=False),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column("self_desc_task_execution",      sa.Text(), nullable=False),
        sa.Column("self_desc_ownership",           sa.Text(), nullable=False),
        sa.Column("self_desc_client_deliverables", sa.Text(), nullable=False),
        sa.Column("self_desc_communication",       sa.Text(), nullable=False),
        sa.Column("self_desc_project_management",  sa.Text(), nullable=False),
        sa.Column("self_desc_mentoring",           sa.Text(), nullable=False),
        sa.Column("self_desc_firm_growth",         sa.Text(), nullable=False),
        sa.Column("self_desc_competency_skills",   sa.Text(), nullable=False),
    )
    op.create_index(
        "ix_goal_self_review_unique",
        "goal_self_reviews",
        ["goal_id", "cycle_half"],
        unique=True,
    )

    # ── Drop the embedded single-shot self-review columns ────────────
    # batch_alter_table so it works on SQLite (column-drop needs rebuild).
    with op.batch_alter_table("goals") as batch_op:
        for col in EMBEDDED_COLUMNS:
            batch_op.drop_column(col)
        batch_op.drop_column("self_review_submitted_at")


def downgrade() -> None:
    with op.batch_alter_table("goals") as batch_op:
        batch_op.add_column(
            sa.Column("self_review_submitted_at", sa.DateTime(timezone=True), nullable=True)
        )
        for col in EMBEDDED_COLUMNS:
            batch_op.add_column(sa.Column(col, sa.Text(), nullable=True))

    op.drop_index("ix_goal_self_review_unique", table_name="goal_self_reviews")
    op.drop_table("goal_self_reviews")
