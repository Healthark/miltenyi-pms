"""add_system_settings_timezone

Adds a `timezone` column (IANA string, default "UTC") to system_settings.

Why: calendar-day decisions in the system (cycle rollover, FY-end
gates, assignment end_dates, goal/project completion days) were
previously tied to the server's clock — fine when the server and the
users share a timezone, but quietly off-by-one near midnight for any
deployment where the server is far from the user (e.g. UTC server,
India team). After this column exists, the `resolve_today(settings)`
helper in `cycle_utils` uses it to compute "today" in the org's local
calendar; instants (audit timestamps like created_at / completed_at)
continue to be stored as UTC via timestamptz columns and are unaffected.

Default is "UTC" so existing rows keep today's exact behavior until HR
flips the org to its actual zone (e.g. "Europe/Berlin", "Asia/Kolkata").
Bad / unknown timezone strings are tolerated at the read layer — the
helper falls back to UTC when ZoneInfo rejects a value, so no row can
brick the cycle-determination path with a typo.

Revision ID: d6e8a3b1c054
Revises: c4d9e5f8a712
Create Date: 2026-05-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "d6e8a3b1c054"
down_revision: Union[str, None] = "06cfd5f0d9e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("system_settings") as batch_op:
        batch_op.add_column(
            sa.Column(
                "timezone",
                sa.String(),
                nullable=False,
                server_default="UTC",
            )
        )


def downgrade() -> None:
    with op.batch_alter_table("system_settings") as batch_op:
        batch_op.drop_column("timezone")
