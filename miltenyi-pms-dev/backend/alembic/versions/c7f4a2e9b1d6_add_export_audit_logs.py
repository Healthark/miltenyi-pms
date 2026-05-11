"""add_export_audit_logs

Adds the export_audit_logs table that records every successful HR_MyOrg
Excel export. The application logs who triggered the export, the data
type ("users" / "goals" / "annual_reviews" / "project_reviews" /
"combined"), how many rows were in the download, the FY scope if any,
and the timestamp.

Revision ID: c7f4a2e9b1d6
Revises: e4b8a6f2c3d1
Create Date: 2026-05-11
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c7f4a2e9b1d6"
down_revision: Union[str, None] = "e4b8a6f2c3d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "export_audit_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("data_type", sa.String(length=32), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("fy_scope", sa.String(length=64), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_export_audit_logs_id", "export_audit_logs", ["id"]
    )
    op.create_index(
        "ix_export_audit_logs_user_created",
        "export_audit_logs",
        ["user_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_export_audit_logs_user_created", "export_audit_logs"
    )
    op.drop_index("ix_export_audit_logs_id", "export_audit_logs")
    op.drop_table("export_audit_logs")
