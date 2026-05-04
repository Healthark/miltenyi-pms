"""add_password_reset_tokens

Adds the password_reset_tokens table that backs the new admin-initiated,
token-based password reset flow. Each admin reset issues a row with a
SHA-256 hash of a URL-safe random token; the user receives the plaintext
token via email as `/reset-password?token=…` and consumes it to pick a
new password. The same table doubles as the rate-limit ledger (counts
per user / per admin in a rolling window).

Revision ID: f6c8e2a01b94
Revises: d8e2f4a73c91
Create Date: 2026-04-28
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f6c8e2a01b94"
down_revision: Union[str, None] = "d8e2f4a73c91"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("requested_by_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["requested_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash", name="uq_password_reset_tokens_token_hash"),
    )
    op.create_index(
        "ix_password_reset_tokens_id", "password_reset_tokens", ["id"]
    )
    op.create_index(
        "ix_password_reset_tokens_user_created",
        "password_reset_tokens",
        ["user_id", "created_at"],
    )
    op.create_index(
        "ix_password_reset_tokens_admin_created",
        "password_reset_tokens",
        ["requested_by_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_password_reset_tokens_admin_created", "password_reset_tokens"
    )
    op.drop_index(
        "ix_password_reset_tokens_user_created", "password_reset_tokens"
    )
    op.drop_index("ix_password_reset_tokens_id", "password_reset_tokens")
    op.drop_table("password_reset_tokens")
