"""add_mentor_orphaned_at_and_log

Two changes for the mentor-transition cascade (Option C, full surface).
See docs/policies/mentor-transition-policy.md for the policy context.

1. `users.mentor_orphaned_at` — nullable timestamp. Set when this
   user's mentor was deactivated or role-changed away from Mentor and
   the cascade nulled their mentor_id; cleared on the next manual
   reassignment. Drives the new "Orphaned by Deactivation" bucket on
   the HR dashboard's MentorCoverageCard.

2. `mentor_reassignment_logs` table — append-only audit log. One row
   per moved entity (User, Goal, AnnualReview) on every reassignment
   / deactivation / role-change / backfill. See the model file for the
   full column rationale.

No data backfill in the migration itself. The companion script
`backend/scripts/backfill_mentor_state.py` handles existing-data
cleanup (dangling pointers, stamped/live mismatches) and runs
separately on each deploy that needs it. The migration is safe to
apply against orgs that have already been cleaned up — the new column
is nullable and the new table starts empty.

Revision ID: c2e8f4a9d316
Revises: b1d7e3f9c8a2
Create Date: 2026-06-02
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c2e8f4a9d316"
down_revision: Union[str, None] = "b1d7e3f9c8a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Add nullable column to users — batch_alter_table for SQLite
    # dev compat (matches the pattern from
    # e8b5c6a9d214_add_user_theme_preference + the recent
    # b1d7e3f9c8a2_add_user_password_changed_at).
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column(
                "mentor_orphaned_at",
                sa.DateTime(timezone=True),
                nullable=True,
            )
        )

    # 2. New audit-log table. Schema mirrors
    # app/models/mentor_reassignment_log_models.py; keep them in sync.
    op.create_table(
        "mentor_reassignment_logs",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "org_id",
            sa.Integer(),
            sa.ForeignKey("organizations.id"),
            nullable=False,
        ),
        sa.Column(
            "admin_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column(
            "employee_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=False,
        ),
        sa.Column("entity_type", sa.String(length=32), nullable=False),
        sa.Column("entity_id", sa.Integer(), nullable=True),
        sa.Column(
            "old_mentor_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column(
            "new_mentor_id",
            sa.Integer(),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("reason", sa.String(length=32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
    )

    # Indexes matching the model's __table_args__.
    op.create_index(
        "ix_mentor_reassign_log_employee_created",
        "mentor_reassignment_logs",
        ["employee_user_id", "created_at"],
    )
    op.create_index(
        "ix_mentor_reassign_log_old_mentor_created",
        "mentor_reassignment_logs",
        ["old_mentor_id", "created_at"],
    )
    op.create_index(
        "ix_mentor_reassign_log_new_mentor_created",
        "mentor_reassignment_logs",
        ["new_mentor_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_mentor_reassign_log_new_mentor_created",
        table_name="mentor_reassignment_logs",
    )
    op.drop_index(
        "ix_mentor_reassign_log_old_mentor_created",
        table_name="mentor_reassignment_logs",
    )
    op.drop_index(
        "ix_mentor_reassign_log_employee_created",
        table_name="mentor_reassignment_logs",
    )
    op.drop_table("mentor_reassignment_logs")

    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("mentor_orphaned_at")
