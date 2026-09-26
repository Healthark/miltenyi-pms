"""
Daily digest send log — the idempotency guard behind the summary emails.

Grain: ONE ROW PER (recipient, digest type, calendar day). The unique index IS
the guard: the in-process scheduler and the Admin's "send now" button can both
fire on the same morning, and a restart can fire the scheduler twice; the second
insert collides and the second send is skipped rather than mailing everyone
again.

`sent_on` is a DATE for the same reason: "did this person already get today's
summary" is a question about the day, and comparing timestamps would let a
09:00 and a 09:01 run both succeed.

Ported from the Healthark PMS (26 Sep 2026, annual-parity part 3c).
"""

from sqlalchemy import (
    Boolean, Column, Date, DateTime, ForeignKey, Index, Integer, String
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from app.core.database import Base


#: Who the digest is addressed to, which decides what it contains.
DIGEST_MENTOR = "mentor_daily"
DIGEST_STAFF = "staff_daily"


class DailyDigestLog(Base):
    __tablename__ = "daily_digest_log"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)

    recipient_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    digest_type = Column(String, nullable=False)

    # The day this digest covers, in the org's timezone.
    sent_on = Column(Date, nullable=False)

    # How many summary rows the mail carried. Kept so a run can be inspected
    # after the fact without re-deriving the query against changed data.
    item_count = Column(Integer, nullable=False, default=0)

    # Reserved for a transport that reports failure back. Today the send is
    # best-effort and every row is written True.
    delivered = Column(Boolean, nullable=False, default=True, server_default="true")

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    __table_args__ = (
        Index(
            "uq_daily_digest_recipient_day",
            "org_id", "recipient_id", "digest_type", "sent_on",
            unique=True,
        ),
    )

    organization = relationship("Organization")
    recipient = relationship("User")
