from sqlalchemy import Column, Integer, String, DateTime, JSON
from sqlalchemy.sql import func
from app.core.database import Base

class Organization(Base):
    __tablename__ = "organizations"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, nullable=False)
    domain = Column(String, nullable=True)
    
    # Architect Note: We use JSON here so we can easily store arrays 
    # like ["dashboard", "goals", "project_reviews"]
    enabled_features = Column(JSON, nullable=True) 
    
    # func.now() lets the database handle the exact timestamp
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())