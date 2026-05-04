from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Index
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.core.database import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    org_id = Column(Integer, ForeignKey("organizations.id"), nullable=False)
    
    department_id = Column(Integer, ForeignKey("departments.id"), nullable=True)
    designation_id = Column(Integer, ForeignKey("designations.id"), nullable=True)
    
    employee_code = Column(String, nullable=False)
    full_name = Column(String, nullable=False)
    email = Column(String, nullable=False)
    phone = Column(String, nullable=True)
    
    role = Column(String, nullable=False) # Admin, Manager, Practitioner, Staff
    
    # Self-referencing Foreign Key for the Mentoring hierarchy
    mentor_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    
    avatar_url = Column(String, nullable=True)
    password_hash = Column(String, nullable=False)
    # Set to True when an admin reset this user's password to a temporary one.
    # The frontend gates the app until the user chooses a new password, and
    # the self-service change-password endpoint clears it on success.
    must_change_password = Column(Boolean, nullable=False, default=False, server_default="false")
    # Sub-role flag — always implies role == "Admin". Gates the Management Review tab
    # and the associated finalize/override actions. Set via seed.py for Founders + Amol;
    # in the UI, new-user creation does not expose this (admin-managed only).
    is_management = Column(Boolean, nullable=False, default=False, server_default="false")
    is_deleted = Column(Boolean, default=False)
    
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    # The Architect's Touch: Composite Indexes
    # Ensures John can be EMP-001 at Healthark, and Sarah can be EMP-001 at PartnerOrg without crashing.
    __table_args__ = (
        Index("ix_users_org_email", "org_id", "email", unique=True),
        Index("ix_users_org_empcode", "org_id", "employee_code", unique=True),
    )

    # Relationships (Allows us to easily fetch u.organization or u.department in Python)
    organization = relationship("Organization")
    department = relationship("Department")
    designation = relationship("Designation")
    mentor = relationship("User", remote_side=[id]) # Maps the mentor back to a User object