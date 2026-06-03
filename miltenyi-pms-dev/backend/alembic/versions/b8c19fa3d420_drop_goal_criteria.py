"""drop_goal_criteria

Retire the goal-criteria feature. Employees now create goals and the
mentor evaluates them at H1 + H2 via the existing GoalSelfReview /
GoalMentorReview rows — the per-criterion checklist that previously
sat under each goal is gone.

The frontend has been calling `addCriterion` / `updateCriterion`
endpoints that never existed on the backend (silently 404ing), so
the per-criterion checkbox surface has been dead in production. This
migration drops the table + indexes; the model file + schemas + UI
were removed in the same PR.

Downgrade recreates the table + indexes with the same shape as the
original create (3c88fdd7d5ea_full_schema_v2.py:195-212). It does
NOT restore any data — those rows are gone for good.

Revision ID: b8c19fa3d420
Revises: a3f2c8b51e74
Create Date: 2026-06-03
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b8c19fa3d420"
down_revision: Union[str, None] = "a3f2c8b51e74"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Drop indexes before the table — Postgres tolerates either order
    # but SQLite (dev) is stricter. The composite index name matches
    # the create site verbatim.
    op.drop_index("ix_goal_criteria_id", table_name="goal_criteria")
    op.drop_index("ix_goal_criteria_goal_org", table_name="goal_criteria")
    op.drop_table("goal_criteria")


def downgrade() -> None:
    # Mirror the original create exactly so re-running upgrade after a
    # downgrade lands on the same shape.
    op.create_table(
        "goal_criteria",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("goal_id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("sort_order", sa.Integer(), nullable=True),
        sa.Column("is_completed", sa.Boolean(), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("proof_comments", sa.Text(), nullable=True),
        sa.Column("proof_attachment_count", sa.Integer(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=True,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["goal_id"], ["goals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_goal_criteria_goal_org",
        "goal_criteria",
        ["goal_id", "org_id"],
        unique=False,
    )
    op.create_index(
        "ix_goal_criteria_id",
        "goal_criteria",
        ["id"],
        unique=False,
    )
