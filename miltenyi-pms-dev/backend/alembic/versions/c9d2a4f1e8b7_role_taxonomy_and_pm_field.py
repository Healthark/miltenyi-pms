"""role_taxonomy_and_pm_field

Bring schema in line with the new role model:

  - Drop `users.is_management` (replaced by the expanded Role enum
    in user_models.py — HR_MyOrg / HR_Miltenyi cover what is_management
    used to gate).
  - Drop `projects.reports_to_id` (no longer used; the PM is the senior
    on the project, not a separate "reports-to" field).
  - Drop `project_assignments.evaluator_type` (the PM is no longer a
    project member; they live on `projects.pm_id`).
  - Add `projects.pm_id` (FK → users.id) — the project-level PM.

Notes:
  - Existing `users.role` data may be 'Admin' or 'Staff'. The Role enum
    values ("HR_MyOrg", "HR_Miltenyi", "Mentor", "PM", "Staff") are *new*.
    A separate data-migration step is responsible for repointing legacy
    role strings; this revision is schema-only.
  - SQLite cannot drop columns with a plain ALTER TABLE — the batch
    operation handles the table-rebuild dance behind the scenes.

Revision ID: c9d2a4f1e8b7
Revises: b8e7d2c4f1a9
Create Date: 2026-05-06
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c9d2a4f1e8b7"
down_revision: Union[str, None] = "b8e7d2c4f1a9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── users: drop is_management ──────────────────────────────────────
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("is_management")

    # ── projects: drop reports_to_id, add pm_id ────────────────────────
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_column("reports_to_id")
        batch_op.add_column(
            sa.Column("pm_id", sa.Integer(), nullable=True),
        )
        batch_op.create_foreign_key(
            "fk_projects_pm_id_users",
            "users",
            ["pm_id"],
            ["id"],
        )

    # ── project_assignments: drop evaluator_type ───────────────────────
    with op.batch_alter_table("project_assignments") as batch_op:
        batch_op.drop_column("evaluator_type")


def downgrade() -> None:
    # ── project_assignments: re-add evaluator_type ─────────────────────
    with op.batch_alter_table("project_assignments") as batch_op:
        batch_op.add_column(
            sa.Column("evaluator_type", sa.String(), nullable=True),
        )

    # ── projects: drop pm_id, re-add reports_to_id ─────────────────────
    with op.batch_alter_table("projects") as batch_op:
        batch_op.drop_constraint("fk_projects_pm_id_users", type_="foreignkey")
        batch_op.drop_column("pm_id")
        batch_op.add_column(
            sa.Column("reports_to_id", sa.Integer(), nullable=True),
        )
        batch_op.create_foreign_key(
            "fk_projects_reports_to_id_users",
            "users",
            ["reports_to_id"],
            ["id"],
        )

    # ── users: re-add is_management ────────────────────────────────────
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_management",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )
