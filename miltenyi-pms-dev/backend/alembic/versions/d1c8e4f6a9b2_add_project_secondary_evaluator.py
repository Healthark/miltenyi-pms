"""add_project_secondary_evaluator

Promotes Secondary evaluator from a per-member ProjectAssignment row to a
single project-level FK column. After this migration, every project has at
most one Secondary evaluator (held in ``projects.secondary_evaluator_id``);
``project_assignments.evaluator_type`` is "Primary" or NULL only.

Data migration:
    For each project with at least one ProjectAssignment row whose
    ``evaluator_type = 'Secondary'``, copy the OLDEST such assignment's
    ``user_id`` into ``projects.secondary_evaluator_id``. Then clear the
    ``evaluator_type`` on every previously-Secondary assignment so those
    users remain regular project members but are no longer flagged.

Existing ``ProjectReviewEvaluator`` rows (review-time impact statements)
are left untouched — historical data is preserved.

Revision ID: d1c8e4f6a9b2
Revises: f2a8b1c93e04
Create Date: 2026-04-25
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d1c8e4f6a9b2"
down_revision: Union[str, None] = "f2a8b1c93e04"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add the new column. Nullable — projects can exist without a
    #    secondary evaluator. No FK constraint name needed for SQLite
    #    batch mode; alembic handles it.
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(
            sa.Column("secondary_evaluator_id", sa.Integer(), nullable=True)
        )
        batch_op.create_foreign_key(
            "fk_projects_secondary_evaluator_id_users",
            "users",
            ["secondary_evaluator_id"],
            ["id"],
        )

    # 2. Backfill: for each project, take the oldest Secondary assignment
    #    (lowest assignment id) and copy its user_id onto the project.
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE projects
            SET secondary_evaluator_id = (
                SELECT pa.user_id
                FROM project_assignments pa
                WHERE pa.project_id = projects.id
                  AND pa.evaluator_type = 'Secondary'
                ORDER BY pa.id ASC
                LIMIT 1
            )
            WHERE EXISTS (
                SELECT 1
                FROM project_assignments pa
                WHERE pa.project_id = projects.id
                  AND pa.evaluator_type = 'Secondary'
            )
            """
        )
    )

    # 3. Clear evaluator_type on every previously-Secondary assignment so
    #    those users stay as regular members but lose the Secondary flag.
    bind.execute(
        sa.text(
            "UPDATE project_assignments SET evaluator_type = NULL "
            "WHERE evaluator_type = 'Secondary'"
        )
    )


def downgrade() -> None:
    # Best-effort restore: turn each project's secondary_evaluator_id back
    # into a Secondary ProjectAssignment row (creating one if the user has
    # no existing assignment on the project). Then drop the column.
    bind = op.get_bind()
    bind.execute(
        sa.text(
            """
            UPDATE project_assignments
            SET evaluator_type = 'Secondary'
            WHERE id IN (
                SELECT pa.id
                FROM project_assignments pa
                JOIN projects p ON p.id = pa.project_id
                WHERE p.secondary_evaluator_id IS NOT NULL
                  AND pa.user_id = p.secondary_evaluator_id
            )
            """
        )
    )

    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_constraint(
            "fk_projects_secondary_evaluator_id_users", type_="foreignkey"
        )
        batch_op.drop_column("secondary_evaluator_id")
