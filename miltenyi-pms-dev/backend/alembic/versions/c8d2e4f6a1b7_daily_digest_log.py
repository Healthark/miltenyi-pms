"""daily digest send log (summary emails)

Revision ID: c8d2e4f6a1b7
Revises: b7c4d1e9f2a3
Create Date: 2026-09-26

Item 22 of the annual audit (Zaahid, 26 Sep 2026): one summary email per
person per weekday morning, sent by an in-process job. This table is the
idempotency guard — the unique index on (org_id, recipient_id, digest_type,
sent_on) means a second run on the same day sends nothing.

Purely additive.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = "c8d2e4f6a1b7"
down_revision = "b7c4d1e9f2a3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "daily_digest_log",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("org_id", sa.Integer(), nullable=False),
        sa.Column("recipient_id", sa.Integer(), nullable=False),
        sa.Column("digest_type", sa.String(), nullable=False),
        sa.Column("sent_on", sa.Date(), nullable=False),
        sa.Column("item_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("delivered", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["org_id"], ["organizations.id"]),
        sa.ForeignKeyConstraint(["recipient_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_daily_digest_log_id"), "daily_digest_log", ["id"], unique=False)
    op.create_index(
        "uq_daily_digest_recipient_day",
        "daily_digest_log",
        ["org_id", "recipient_id", "digest_type", "sent_on"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("uq_daily_digest_recipient_day", table_name="daily_digest_log")
    op.drop_index(op.f("ix_daily_digest_log_id"), table_name="daily_digest_log")
    op.drop_table("daily_digest_log")
