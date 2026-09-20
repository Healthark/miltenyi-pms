from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.sql import func
from app.core.database import Base

# Designation levels run 1..MAX_LEVEL (free integers, UAT feedback 17 Sep
# 2026). Only the four GCC levels carry a band name.
MAX_LEVEL = 12
LEVEL_LABEL = {1: "Entry", 2: "Mid", 3: "Senior", 4: "Lead"}


def career_level_label(level):
    """Band name for a level, or None outside the GCC 1..4 range."""
    return LEVEL_LABEL.get(level) if level is not None else None

# Designation levels run 1..MAX_LEVEL (free integers, UAT feedback 17 Sep
# 2026). Only the four GCC levels carry a band name.
MAX_LEVEL = 12
LEVEL_LABEL = {1: "Entry", 2: "Mid", 3: "Senior", 4: "Lead"}


def career_level_label(level):
    """Band name for a level, or None outside the GCC 1..4 range."""
    return LEVEL_LABEL.get(level) if level is not None else None

class Function(Base):
    __tablename__ = "functions"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    name = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # This prevents two "Oncology" functions from existing in the same organization
    __table_args__ = (
        UniqueConstraint('org_id', 'name', name='uix_org_function_name'),
    )

class Designation(Base):
    __tablename__ = "designations"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    name = Column(String, nullable=False)
    level = Column(Integer, default=1)  # Legacy hierarchical sort key (1..5); kept for back-compat.

    # GCC career-path mapping. Multiple designations (titles) can share the same
    # career_level — e.g. both "Senior Regulatory Affairs Associate" and
    # "Regulatory Affairs Specialist" sit at career_level=2 ("Mid"). The
    # role_expectations table is keyed by (function_id, career_level), so this
    # column is what links a user's designation to their expectations row.
    # Nullable so legacy / non-GCC designations stay valid.
    career_level = Column(Integer, nullable=True)            # 1..MAX_LEVEL; 1..4 are the GCC bands
    career_level_label = Column(String, nullable=True)       # "Entry" / "Mid" / "Senior" / "Lead" for 1..4, else NULL

    # The function (department) this title belongs to. Nullable so legacy
    # titles stay valid; the GCC seed sets it for every title, and the
    # Project Goals framework editor groups designations under each level
    # column by it.
    function_id = Column(Integer, ForeignKey("functions.id"), nullable=True)

    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint('org_id', 'name', name='uix_org_designation_name'),
    )
