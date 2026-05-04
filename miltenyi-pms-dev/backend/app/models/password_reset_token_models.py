"""
PasswordResetToken — Token-Based Admin Password Reset.

When an admin clicks "Reset Password" on a user, the backend generates a
URL-safe random token, stores its SHA-256 hash here, and emails the
plaintext token (as part of a /reset-password?token=… link) to the user.
The user clicks the link, picks a new password, and the token is marked
used. The plaintext token is NEVER persisted — only its hash — so a DB
dump can't be replayed against the consume endpoint.

This table also doubles as the rate-limit ledger: counting recent rows by
user_id (target) or requested_by_id (admin) tells us whether to allow a
fresh reset.
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.core.database import Base


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id = Column(Integer, primary_key=True, index=True)

    # The user whose password is being reset.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    # The admin who triggered the reset. Used for per-admin rate limiting
    # and forensic attribution if abuse is suspected.
    requested_by_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # SHA-256 hex of the URL-safe random token. 64 chars exactly.
    token_hash = Column(String(64), nullable=False, unique=True)

    expires_at = Column(DateTime(timezone=True), nullable=False)
    # Null until the user successfully consumes the token. A used token is
    # never re-acceptable — even before its expiry.
    used_at = Column(DateTime(timezone=True), nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    user = relationship("User", foreign_keys=[user_id])
    requested_by = relationship("User", foreign_keys=[requested_by_id])

    __table_args__ = (
        # Hot path: rate-limit query "how many resets in the last hour for X?".
        Index("ix_password_reset_tokens_user_created", "user_id", "created_at"),
        Index(
            "ix_password_reset_tokens_admin_created",
            "requested_by_id",
            "created_at",
        ),
    )
