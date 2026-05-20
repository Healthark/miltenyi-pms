"""drop_notifications_goal_id

Drops the back-compat `goal_id` column from `notifications`. Introduced
nullable in c5a8e2f9b704 as a transitional anchor so the existing
`/notifications/summary` reader could keep returning it in the response
shape during the cutover. Now that the model, schema, route mapping,
and frontend all read `entity_id` + `entity_url` + `module` instead,
the column has no remaining readers and can go.

Downgrade re-adds the column nullable (with the SET NULL FK from
c5a8e2f9b704) and backfills `goal_id = entity_id WHERE entity_type =
'goal'` so a roll-back is observationally identical to the c5a8e2f9b704
state. Rows written between this migration and a hypothetical downgrade
will populate correctly.

Revision ID: d7e3a9b8c216
Revises: c5a8e2f9b704
Create Date: 2026-05-19
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d7e3a9b8c216"
down_revision: Union[str, None] = "c5a8e2f9b704"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        # SQLite: batch-recreate the table without the column. The FK
        # constraint vanishes with the column.
        with op.batch_alter_table("notifications", schema=None, recreate="always") as batch:
            batch.drop_column("goal_id")
    else:
        # Postgres: drop the FK first (the named constraint we created
        # in c5a8e2f9b704), then the column.
        op.execute(
            "ALTER TABLE notifications "
            "DROP CONSTRAINT IF EXISTS fk_notifications_goal_id"
        )
        op.drop_column("notifications", "goal_id")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "sqlite":
        with op.batch_alter_table("notifications", schema=None, recreate="always") as batch:
            batch.add_column(sa.Column("goal_id", sa.Integer(), nullable=True))
            batch.create_foreign_key(
                "fk_notifications_goal_id",
                "goals",
                ["goal_id"],
                ["id"],
                ondelete="SET NULL",
            )
    else:
        op.add_column(
            "notifications",
            sa.Column("goal_id", sa.Integer(), nullable=True),
        )
        op.create_foreign_key(
            "fk_notifications_goal_id",
            "notifications",
            "goals",
            ["goal_id"],
            ["id"],
            ondelete="SET NULL",
        )

    # Backfill so the downgraded shape matches c5a8e2f9b704's invariant:
    # goal-module rows carry goal_id populated from entity_id.
    op.execute(
        "UPDATE notifications SET goal_id = entity_id "
        "WHERE entity_type = 'goal' AND entity_id IS NOT NULL"
    )
