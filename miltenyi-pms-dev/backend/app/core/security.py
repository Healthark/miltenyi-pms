from passlib.context import CryptContext

# Enterprise Standard: bcrypt hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_password_hash(password: str) -> str:
    """Converts a plain text password into a secure hash."""
    return pwd_context.hash(password)

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Checks if a provided password matches the hash in the DB."""
    return pwd_context.verify(plain_password, hashed_password)

# JWT Token Generation
from datetime import datetime, timedelta, timezone
from typing import Optional
from jose import jwt
from app.core.config import settings

ALGORITHM = "HS256"

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """Generates a secure JWT token for authenticated users."""
    
    # 1. Make a copy of the payload (user info) so we don't mutate the original
    to_encode = data.copy()
    
    # 2. Calculate expiration time
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
        
    # 3. Add the expiration timestamp to the payload
    to_encode.update({"exp": expire})
    
    # 4. Cryptographically sign the token using our SECRET_KEY
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=ALGORITHM)
    
    return encoded_jwt