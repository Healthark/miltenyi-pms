"""add_user_deleted_at

Adds a `deleted_at` timestamp column to the `users` table so soft-delete
events carry a date, not just a flag.

Why: FY-scoped exports (Users / Projects sheets in the combined HR
workbook) need to decide whether a deactivated user was around during a
given fiscal year. The pre-existing `is_deleted` boolean tells us they're
gone now but not when they left, which makes the "active during FY X"
question unanswerable. After this migration, the deactivation handler
stamps `deleted_at = now()` and reactivation clears it; exporters use
the column to honor the rule "include the user in FY X if they were
created on/before FY end AND not yet deactivated by FY start."

Backfill strategy:
- Existing `is_deleted = True` rows get `deleted_at = updated_at` (best
  proxy we have; `updated_at` is set on any column touch but on a row
  that's been deleted it's *probably* the deactivation timestamp).
- Rows with `is_deleted = True` AND `updated_at IS NULL` (rare; should
  only hit rows that have never been updated) fall back to `created_at`.
- Active rows (`is_deleted = False`) get `NULL` — they're alive.

Revision ID: c4d9e5f8a712
Revises: c5a8e2f9b704
Create Date: 2026-05-19
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c4d9e5f8a712"
# Rebased onto c5a8e2f9b704 (generalize_notifications) so the two
# migrations that originally branched from b2f9e4a7c081 form a single
# linear chain. The two are semantically independent (notifications
# table vs users.deleted_at column) so the rebase is safe.
down_revision: Union[str, None] = "c5a8e2f9b704"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True)
        )

    # Backfill existing soft-deleted users with their best-guess
    # deactivation time. Active users stay NULL.
    op.execute(
        """
        UPDATE users
           SET deleted_at = COALESCE(updated_at, created_at)
         WHERE is_deleted = TRUE
           AND deleted_at IS NULL
        """
    )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("deleted_at")
