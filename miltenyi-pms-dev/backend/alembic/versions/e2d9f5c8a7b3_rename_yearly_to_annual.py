"""rename_yearly_to_annual

Renames the user-facing "Yearly Goals" feature to "Annual Goals" everywhere it
shows up in the database:

    - ``system_settings.yearly_goals_edit_enabled``
        →  ``system_settings.annual_goals_edit_enabled``
    - ``system_settings.yearly_goals_final_rating_visible``
        →  ``system_settings.annual_goals_final_rating_visible``
    - ``goals.goal_type`` rows with value ``'yearly'`` are updated to ``'annual'``.

The composite index ``ix_goals_org_type_cycle`` is column-name based, so it is
left untouched. ``ProjectReviewEvaluator.evaluator_type='Secondary'`` and
``CycleType.HALF_YEARLY`` are unrelated and untouched.

Revision ID: e2d9f5c8a7b3
Revises: d1c8e4f6a9b2
Create Date: 2026-04-25
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e2d9f5c8a7b3"
down_revision: Union[str, None] = "d1c8e4f6a9b2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Rename the two system_settings columns. SQLite needs batch_alter_table.
    with op.batch_alter_table("system_settings") as batch_op:
        batch_op.alter_column(
            "yearly_goals_edit_enabled",
            new_column_name="annual_goals_edit_enabled",
        )
        batch_op.alter_column(
            "yearly_goals_final_rating_visible",
            new_column_name="annual_goals_final_rating_visible",
        )

    # 2. Convert in-flight enum-value data on the goals table.
    op.execute(
        sa.text("UPDATE goals SET goal_type = 'annual' WHERE goal_type = 'yearly'")
    )


def downgrade() -> None:
    # Reverse data update first so the rename below operates on a column that
    # still has any 'yearly' rows the caller may have re-added since upgrade.
    op.execute(
        sa.text("UPDATE goals SET goal_type = 'yearly' WHERE goal_type = 'annual'")
    )

    with op.batch_alter_table("system_settings") as batch_op:
        batch_op.alter_column(
            "annual_goals_edit_enabled",
            new_column_name="yearly_goals_edit_enabled",
        )
        batch_op.alter_column(
            "annual_goals_final_rating_visible",
            new_column_name="yearly_goals_final_rating_visible",
        )
