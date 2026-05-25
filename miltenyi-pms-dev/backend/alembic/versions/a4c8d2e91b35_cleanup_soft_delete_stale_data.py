"""cleanup_soft_delete_stale_data

One-time backfill / cleanup of rows that survived from before the
soft-delete consistency fix. Two categories:

1. `notifications` rows addressed to users who are currently
   soft-deleted. Before the fix, `notification_service.notify()` did not
   short-circuit when the recipient was deactivated, so the table
   accumulated rows that the recipient can never read (their JWT is
   blocked on every request). These rows confuse testers and surface
   ghost entries the moment a user is reactivated.

2. `projects.pm_id` and `projects.secondary_evaluator_id` columns that
   still reference a now-deactivated user. Before the fix,
   `admin_routes.deactivate_user` did not cascade these FKs, so any
   project whose PM/evaluator was deactivated before today keeps a
   pointer to that dead row. The new `_resolve_user_name` defensive
   filter hides the name in the UI but the underlying data is dirty —
   this migration cleans it up so the DB matches the new invariants.

This is a data-only migration — no schema changes. It is idempotent:
running it on a fresh DB (where the buggy code never wrote anything)
matches zero rows and is a no-op.

Revision ID: a4c8d2e91b35
Revises: f7c4a9e2b5d1
Create Date: 2026-05-25
"""
from typing import Sequence, Union

from alembic import op


revision: str = "a4c8d2e91b35"
down_revision: Union[str, None] = "f7c4a9e2b5d1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Drop notification rows addressed to deactivated users ──
    # The recipient's JWT is blocked on login, so these rows are
    # unreadable; keeping them around just inflates the table and risks
    # a flood on reactivation. We use DELETE rather than soft-delete
    # because `notifications` has no is_deleted column — and the new
    # `notify()` will never write rows in this shape again.
    op.execute(
        """
        DELETE FROM notifications
         WHERE recipient_id IN (
             SELECT id FROM users WHERE is_deleted = TRUE
         )
        """
    )

    # ── 2. Null Project FKs that point at soft-deleted users ──
    # Mirrors the cascade in admin_routes.deactivate_user. After this,
    # any project whose PM or secondary evaluator was deactivated
    # before today shows up correctly as "unassigned" in HR's project
    # list, employee My-Projects cards, and the management overview.
    op.execute(
        """
        UPDATE projects
           SET pm_id = NULL
         WHERE pm_id IN (
             SELECT id FROM users WHERE is_deleted = TRUE
         )
        """
    )
    op.execute(
        """
        UPDATE projects
           SET secondary_evaluator_id = NULL
         WHERE secondary_evaluator_id IN (
             SELECT id FROM users WHERE is_deleted = TRUE
         )
        """
    )


def downgrade() -> None:
    # No-op. The deleted notification rows are unrecoverable (we did not
    # snapshot them), and the nulled FK columns previously pointed at
    # deactivated users — reverting them would require remembering the
    # old IDs, which we did not capture. Downgrade leaves the DB in the
    # cleaned-up state, which is harmless: the new code paths handle
    # both cleaned and uncleaned data correctly.
    pass
