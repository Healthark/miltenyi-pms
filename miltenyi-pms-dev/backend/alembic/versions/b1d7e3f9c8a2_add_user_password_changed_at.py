"""add_user_password_changed_at

Adds the `password_changed_at` column to `users`. Backs JWT session
revocation: tokens carry a `pwd_iat` claim equal to this timestamp at
issue time, and validation rejects tokens whose claim is stale (i.e.
the password was changed after the token was issued).

Backfill strategy: NOT NULL via two-step (add nullable → UPDATE → set
NOT NULL won't work cleanly on SQLite with batch_alter_table, so we
keep the column NULLABLE in the schema and backfill every existing
row to NOW(). The application code reads the column unconditionally
and assumes it's set; the migration's UPDATE ensures that invariant
holds for every pre-existing row. New rows always set the column at
insert (create_user / change_password / reset_password).

Strict rollout: the backfill timestamp is NOW() rather than the
existing `users.created_at`. Effect: every JWT issued before this
deploy carries a `pwd_iat` lower than the new column value and gets
rejected on the next request, forcing a one-time re-login across the
org. We picked strict (per user decision) over a gentler grace
window — the security benefit of immediate revocation outweighs the
one-time UX cost.

Revision ID: b1d7e3f9c8a2
Revises: a4c8d2e91b35
Create Date: 2026-06-01
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b1d7e3f9c8a2"
down_revision: Union[str, None] = "a4c8d2e91b35"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Use batch_alter_table so this migration works on SQLite (dev) as
    # well as Postgres (prod) — SQLite can't add columns to existing
    # tables without a rebuild.
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column(
                "password_changed_at",
                sa.DateTime(timezone=True),
                nullable=True,
            )
        )

    # Backfill: every existing row gets the current timestamp. Effect
    # is to invalidate every JWT issued before this deploy (the JWT's
    # `pwd_iat` claim will be lower than the new column value, so
    # validation rejects the token). One-time re-login across the org;
    # acceptable cost for the security guarantee.
    op.execute(
        "UPDATE users "
        "SET password_changed_at = CURRENT_TIMESTAMP "
        "WHERE password_changed_at IS NULL"
    )


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_column("password_changed_at")
