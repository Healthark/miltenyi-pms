"""project_lifecycle_and_assignment_history

Add per-project lifecycle (status / completed_at / completed_by) and
per-assignment soft-end (end_date / ended_by). Replace the unique
(org_id, project_id, user_id) index on project_assignments with a
non-unique one — uniqueness on the *active* row is now enforced at
the route layer, allowing the same (project, user) pair to have a
historical end-dated row alongside a new active one for re-joins.

Revision ID: d1a3c5e7f9b2
Revises: c9d2a4f1e8b7
Create Date: 2026-05-06
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d1a3c5e7f9b2"
down_revision: Union[str, None] = "c9d2a4f1e8b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── projects: add status / completed_at / completed_by ─────────────
    with op.batch_alter_table("projects") as batch_op:
        batch_op.add_column(
            sa.Column(
                "status",
                sa.String(),
                nullable=False,
                server_default="active",
            ),
        )
        batch_op.add_column(
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        )
        batch_op.add_column(
            sa.Column("completed_by_id", sa.Integer(), nullable=True),
        )
        batch_op.create_foreign_key(
            "fk_projects_completed_by_id_users",
            "users",
            ["completed_by_id"],
            ["id"],
        )

    # ── project_assignments: add end_date / ended_by ───────────────────
    # Then swap the UNIQUE index for a non-unique one so re-assignment
    # to the same project (after an end-dated stint) is legal.
    with op.batch_alter_table("project_assignments") as batch_op:
        batch_op.add_column(
            sa.Column("end_date", sa.Date(), nullable=True),
        )
        batch_op.add_column(
            sa.Column("ended_by_id", sa.Integer(), nullable=True),
        )
        batch_op.create_foreign_key(
            "fk_project_assignments_ended_by_id_users",
            "users",
            ["ended_by_id"],
            ["id"],
        )
        batch_op.drop_index("ix_project_assignments_org_proj_user")
        batch_op.create_index(
            "ix_project_assignments_org_proj_user",
            ["org_id", "project_id", "user_id"],
            unique=False,
        )


def downgrade() -> None:
    # ── project_assignments: drop end_date / ended_by, restore unique ──
    with op.batch_alter_table("project_assignments") as batch_op:
        batch_op.drop_index("ix_project_assignments_org_proj_user")
        batch_op.create_index(
            "ix_project_assignments_org_proj_user",
            ["org_id", "project_id", "user_id"],
            unique=True,
        )
        batch_op.drop_constraint(
            "fk_project_assignments_ended_by_id_users",
            type_="foreignkey",
        )
        batch_op.drop_column("ended_by_id")
        batch_op.drop_column("end_date")

    # ── projects: drop status / completed_at / completed_by ────────────
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_constraint(
            "fk_projects_completed_by_id_users",
            type_="foreignkey",
        )
        batch_op.drop_column("completed_by_id")
        batch_op.drop_column("completed_at")
        batch_op.drop_column("status")
