"""
ExportAuditLog — append-only ledger of HR_MyOrg Excel exports.

The export feature lets HR_MyOrg download Users / Annual Goals / Annual
Reviews / Project Reviews as .xlsx files, plus a combined 4-sheet
workbook. Every successful download writes one row here so that
compliance can answer "who exported what, when" without trawling
server logs.

Schema is intentionally narrow: who, what kind, how many rows, what FY
scope (null = "all time" — the per-tab buttons), and when. No file is
persisted; the audit lives only as metadata.
"""

from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship

from app.core.database import Base


class ExportAuditLog(Base):
    __tablename__ = "export_audit_logs"

    id = Column(Integer, primary_key=True, index=True)

    # Who triggered the export. HR_MyOrg only at the route layer today;
    # column is FK so admin audit views can join on user.
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)

    # One of: "users", "goals", "annual_reviews", "project_reviews", "combined".
    # Plain string so we can add new export kinds without a migration.
    data_type = Column(String(32), nullable=False)

    # Row count in the downloaded sheet (or summed across sheets for combined).
    row_count = Column(Integer, nullable=False)

    # Comma-separated FY start-years (e.g. "2025,2026") for the centralised
    # exports page; null when HR used a per-tab "Export Excel" button
    # (those always dump everything authorised, no FY narrowing).
    fy_scope = Column(String(64), nullable=True)

    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    user = relationship("User", foreign_keys=[user_id])

    __table_args__ = (
        # Hot path: "show me my recent exports" / "show all org exports
        # in the last 30 days". Index on (user_id, created_at) covers both.
        Index("ix_export_audit_logs_user_created", "user_id", "created_at"),
    )
