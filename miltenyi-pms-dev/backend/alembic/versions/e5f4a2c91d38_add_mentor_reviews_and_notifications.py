"""add_mentor_reviews_and_notifications

Adds two new tables:
  - goal_mentor_reviews: mentor's per-half assessment of a mentee's self-review
    (mirrors goal_self_reviews structure with 8 mentor_comment_* text columns)
  - goal_notifications: direct mentor-to-mentee notifications created via the
    Notify button in the Team Goals tab

Revision ID: e5f4a2c91d38
Revises: d8b3c2e07a19
Create Date: 2026-04-21
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e5f4a2c91d38"
down_revision: Union[str, None] = "d8b3c2e07a19"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "goal_mentor_reviews",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("goal_id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("cycle_half", sa.String(), nullable=False),
        sa.Column(
            "submitted_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.Column("mentor_comment_task_execution",      sa.Text(), nullable=False),
        sa.Column("mentor_comment_ownership",           sa.Text(), nullable=False),
        sa.Column("mentor_comment_client_deliverables", sa.Text(), nullable=False),
        sa.Column("mentor_comment_communication",       sa.Text(), nullable=False),
        sa.Column("mentor_comment_project_management",  sa.Text(), nullable=False),
        sa.Column("mentor_comment_mentoring",           sa.Text(), nullable=False),
        sa.Column("mentor_comment_firm_growth",         sa.Text(), nullable=False),
        sa.Column("mentor_comment_competency_skills",   sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["goal_id"], ["goals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"],  ["organizations.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_goal_mentor_reviews_id", "goal_mentor_reviews", ["id"])
    op.create_index(
        "ix_goal_mentor_review_unique",
        "goal_mentor_reviews",
        ["goal_id", "cycle_half"],
        unique=True,
    )

    op.create_table(
        "goal_notifications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id",       sa.Integer(), nullable=False),
        sa.Column("goal_id",      sa.Integer(), nullable=False),
        sa.Column("recipient_id", sa.Integer(), nullable=False),
        sa.Column("sender_id",    sa.Integer(), nullable=False),
        sa.Column("message",      sa.Text(),    nullable=False),
        sa.Column("is_read",      sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["goal_id"],      ["goals.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["org_id"],        ["organizations.id"]),
        sa.ForeignKeyConstraint(["recipient_id"],  ["users.id"]),
        sa.ForeignKeyConstraint(["sender_id"],     ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_goal_notifications_id", "goal_notifications", ["id"])
    op.create_index(
        "ix_goal_notifications_recipient_read",
        "goal_notifications",
        ["recipient_id", "is_read"],
    )


def downgrade() -> None:
    op.drop_index("ix_goal_notifications_recipient_read", "goal_notifications")
    op.drop_index("ix_goal_notifications_id", "goal_notifications")
    op.drop_table("goal_notifications")

    op.drop_index("ix_goal_mentor_review_unique", "goal_mentor_reviews")
    op.drop_index("ix_goal_mentor_reviews_id", "goal_mentor_reviews")
    op.drop_table("goal_mentor_reviews")
