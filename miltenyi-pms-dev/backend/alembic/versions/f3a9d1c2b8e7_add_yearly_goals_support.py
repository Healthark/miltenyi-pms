"""add_yearly_goals_support

Adds the columns needed to distinguish yearly goals from regular goals,
track which fiscal year they belong to, record their attachment URLs, and
timestamp exactly when a goal was approved.  Also adds the admin gate flag
that controls whether yearly goal creation/editing is open.

New columns on `goals`:
    goal_type      — "regular" (default) or "yearly"
    cycle_name     — bare FY label stamped at creation, e.g. "FY26"
    attachment_url — optional Google Drive / external URL
    approved_at    — timestamp set the moment a goal is approved

New column on `system_settings`:
    yearly_goals_edit_enabled — Admin gate; defaults to False (closed)

New index on `goals`:
    ix_goals_org_type_cycle (org_id, goal_type, cycle_name)
    Supports future filtered queries like "all FY26 yearly goals for this org"
    without a full table scan.

Revision ID: f3a9d1c2b8e7
Revises: 9c28aac63a56
Create Date: 2026-04-17
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f3a9d1c2b8e7"
down_revision: Union[str, None] = "9c28aac63a56"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── goals table ──────────────────────────────────────────────────
    op.add_column(
        "goals",
        sa.Column(
            "goal_type",
            sa.String(),
            nullable=False,
            server_default="regular",
        ),
    )
    op.add_column(
        "goals",
        sa.Column("cycle_name", sa.String(), nullable=True),
    )
    op.add_column(
        "goals",
        sa.Column("attachment_url", sa.String(), nullable=True),
    )
    op.add_column(
        "goals",
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
    )

    # Composite index for filtering goals by org + type + fiscal year.
    # Keeps queries like "all FY26 yearly goals" fast even as the table grows.
    op.create_index(
        "ix_goals_org_type_cycle",
        "goals",
        ["org_id", "goal_type", "cycle_name"],
    )

    # ── system_settings table ────────────────────────────────────────
    op.add_column(
        "system_settings",
        sa.Column(
            "yearly_goals_edit_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.false(),
        ),
    )


def downgrade() -> None:
    op.drop_column("system_settings", "yearly_goals_edit_enabled")

    op.drop_index("ix_goals_org_type_cycle", table_name="goals")
    op.drop_column("goals", "approved_at")
    op.drop_column("goals", "attachment_url")
    op.drop_column("goals", "cycle_name")
    op.drop_column("goals", "goal_type")
