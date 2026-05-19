"""generalize_notifications

Generalizes the `goal_notifications` table introduced in e5f4a2c91d38 into
a polymorphic `notifications` table that can carry events from any module
(goals, annual reviews, project reviews, admin, projects).

Schema changes:
  - Rename `goal_notifications` → `notifications`
  - `goal_id` becomes nullable; FK cascade flipped from CASCADE → SET NULL.
    Cascade no longer fits once the table holds non-goal rows.
  - Add `module`, `entity_type` (NOT NULL), `entity_id`, `entity_url`.
  - Backfill existing rows with module='goal', entity_type='goal',
    entity_id=goal_id.
  - Replace the (recipient_id, is_read) index with one that also includes
    created_at so the topbar read can short-circuit on the descending
    fetch.

`goal_id` is intentionally kept nullable rather than dropped — the
existing `/notifications/summary` reader still returns it in the response
shape, and we want one release of overlap before the frontend's
`UserNotificationItem.goal_id?` flip lands everywhere. A follow-up
migration drops the column.

Revision ID: c5a8e2f9b704
Revises: b2f9e4a7c081
Create Date: 2026-05-19
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "c5a8e2f9b704"
down_revision: Union[str, None] = "b2f9e4a7c081"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── 1. Rename the table ──────────────────────────────────────────
    op.rename_table("goal_notifications", "notifications")

    # ── 2. Add the new polymorphic columns ───────────────────────────
    # server_default on module/entity_type so the NOT NULL succeeds on
    # rows that exist already; we drop the default after backfill so new
    # inserts must specify these columns explicitly.
    with op.batch_alter_table("notifications", schema=None) as batch:
        batch.add_column(sa.Column("module",      sa.String(length=32),  nullable=False, server_default="goal"))
        batch.add_column(sa.Column("entity_type", sa.String(length=32),  nullable=False, server_default="goal"))
        batch.add_column(sa.Column("entity_id",   sa.Integer(),          nullable=True))
        batch.add_column(sa.Column("entity_url",  sa.String(length=512), nullable=True))

    # ── 3. Backfill entity_id from existing goal_id values ───────────
    op.execute("UPDATE notifications SET entity_id = goal_id WHERE entity_id IS NULL")

    # ── 4. Drop server defaults so future inserts must specify them ──
    with op.batch_alter_table("notifications", schema=None) as batch:
        batch.alter_column("module",      existing_type=sa.String(length=32), server_default=None)
        batch.alter_column("entity_type", existing_type=sa.String(length=32), server_default=None)

    # ── 5. Loosen goal_id: nullable + SET NULL on parent delete ──────
    # Done in a separate batch with recreate=always so SQLite (dev) can
    # rebuild the table without tripping over the auto-named FK from
    # e5f4a2c91d38. Postgres takes the explicit drop_constraint path.
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("notifications", schema=None, recreate="always") as batch:
            batch.alter_column("goal_id", existing_type=sa.Integer(), nullable=True)
            batch.create_foreign_key(
                "fk_notifications_goal_id",
                "goals",
                ["goal_id"],
                ["id"],
                ondelete="SET NULL",
            )
    else:
        # Postgres: the original FK was auto-named `<table>_<col>_fkey`,
        # which survives `rename_table` on Postgres (the constraint name
        # is not auto-rewritten). Drop it by that legacy name, then
        # recreate with the desired semantics.
        op.execute(
            "ALTER TABLE notifications "
            "DROP CONSTRAINT IF EXISTS goal_notifications_goal_id_fkey"
        )
        op.alter_column(
            "notifications",
            "goal_id",
            existing_type=sa.Integer(),
            nullable=True,
        )
        op.create_foreign_key(
            "fk_notifications_goal_id",
            "notifications",
            "goals",
            ["goal_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # ── 6. Indexes ───────────────────────────────────────────────────
    # The legacy indexes from e5f4a2c91d38 reference the old table name
    # in their identifier on some dialects; drop defensively then create
    # the new composite index.
    op.execute("DROP INDEX IF EXISTS ix_goal_notifications_recipient_read")
    op.execute("DROP INDEX IF EXISTS ix_goal_notifications_id")
    op.create_index(
        "ix_notifications_recipient_unread_created",
        "notifications",
        ["recipient_id", "is_read", "created_at"],
    )
    op.create_index("ix_notifications_id", "notifications", ["id"])


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_notifications_recipient_unread_created")
    op.execute("DROP INDEX IF EXISTS ix_notifications_id")

    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("notifications", schema=None, recreate="always") as batch:
            batch.drop_constraint("fk_notifications_goal_id", type_="foreignkey")
            batch.alter_column("goal_id", existing_type=sa.Integer(), nullable=False)
            batch.create_foreign_key(
                "goal_notifications_goal_id_fkey",
                "goals",
                ["goal_id"],
                ["id"],
                ondelete="CASCADE",
            )
    else:
        op.execute(
            "ALTER TABLE notifications "
            "DROP CONSTRAINT IF EXISTS fk_notifications_goal_id"
        )
        op.alter_column(
            "notifications",
            "goal_id",
            existing_type=sa.Integer(),
            nullable=False,
        )
        op.create_foreign_key(
            "goal_notifications_goal_id_fkey",
            "notifications",
            "goals",
            ["goal_id"],
            ["id"],
            ondelete="CASCADE",
        )

    with op.batch_alter_table("notifications", schema=None) as batch:
        batch.drop_column("entity_url")
        batch.drop_column("entity_id")
        batch.drop_column("entity_type")
        batch.drop_column("module")

    op.rename_table("notifications", "goal_notifications")
    op.create_index(
        "ix_goal_notifications_recipient_read",
        "goal_notifications",
        ["recipient_id", "is_read"],
    )
    op.create_index("ix_goal_notifications_id", "goal_notifications", ["id"])
