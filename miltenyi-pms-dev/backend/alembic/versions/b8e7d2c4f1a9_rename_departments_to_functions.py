"""rename_departments_to_functions

Renames the ``departments`` reference table to ``functions`` and renames every
``department_id`` foreign-key column to ``function_id`` on ``users``,
``role_expectations`` and ``project_assignments``. Index and unique-constraint
names that mention the old term are renamed in lock-step.

Revision ID: b8e7d2c4f1a9
Revises: a3f7c2b9e108
Create Date: 2026-05-05
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b8e7d2c4f1a9"
down_revision: Union[str, None] = "a3f7c2b9e108"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Rename the table itself
    op.rename_table("departments", "functions")

    # 2. Rename column on users
    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column("department_id", new_column_name="function_id")

    # 3. Rename column on role_expectations + the composite index
    with op.batch_alter_table("role_expectations") as batch_op:
        batch_op.alter_column("department_id", new_column_name="function_id")
    op.execute(
        "ALTER INDEX IF EXISTS ix_role_exp_org_dept_desig "
        "RENAME TO ix_role_exp_org_func_desig"
    )

    # 4. Rename column on project_assignments
    with op.batch_alter_table("project_assignments") as batch_op:
        batch_op.alter_column("department_id", new_column_name="function_id")

    # 5. Rename index + unique constraint on the renamed table
    op.execute("ALTER INDEX IF EXISTS ix_departments_id RENAME TO ix_functions_id")
    op.execute(
        "ALTER TABLE functions RENAME CONSTRAINT uix_org_department_name "
        "TO uix_org_function_name"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE functions RENAME CONSTRAINT uix_org_function_name "
        "TO uix_org_department_name"
    )
    op.execute("ALTER INDEX IF EXISTS ix_functions_id RENAME TO ix_departments_id")

    with op.batch_alter_table("project_assignments") as batch_op:
        batch_op.alter_column("function_id", new_column_name="department_id")

    op.execute(
        "ALTER INDEX IF EXISTS ix_role_exp_org_func_desig "
        "RENAME TO ix_role_exp_org_dept_desig"
    )
    with op.batch_alter_table("role_expectations") as batch_op:
        batch_op.alter_column("function_id", new_column_name="department_id")

    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column("function_id", new_column_name="department_id")

    op.rename_table("functions", "departments")
