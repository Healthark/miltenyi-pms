from typing import Annotated
from fastapi import Cookie, Depends, Header, HTTPException, status
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.models.user_models import User

# Reusable Database Session (same as we used in auth.py)
DbSession = Annotated[Session, Depends(get_db)]


def _extract_token(cookie_token: str | None, auth_header: str | None) -> str | None:
    """Prefer the HttpOnly cookie (production path). Fall back to the
    Authorization: Bearer header so Swagger UI's Authorize button still
    works for manual API exploration — the cookie path is what real browser
    clients use."""
    if cookie_token:
        return cookie_token
    if auth_header and auth_header.lower().startswith("bearer "):
        return auth_header.split(" ", 1)[1]
    return None


def get_current_user(
    db: DbSession,
    cookie_token: Annotated[
        str | None,
        Cookie(alias=settings.ACCESS_COOKIE_NAME),
    ] = None,
    authorization: Annotated[str | None, Header()] = None,
) -> User:
    """
    Intercepts the request, decodes the JWT, and returns the Database User object.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
    )

    token = _extract_token(cookie_token, authorization)
    if not token:
        raise credentials_exception

    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])

        user_id: int = payload.get("user_id")
        token_org_id: int | None = payload.get("org_id")
        if user_id is None:
            raise credentials_exception

    except JWTError:
        raise credentials_exception

    # 3. Look up the user in the database
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise credentials_exception

    # 4. Tenant fence — if the user has been moved to another org since the
    # token was issued, the old token should no longer authenticate them.
    if token_org_id is not None and token_org_id != user.org_id:
        raise credentials_exception

    # 5. The Last Line of Defense
    # What if a user was fired and soft-deleted 5 minutes ago, but their token
    # is still valid for another hour? We catch them here.
    if user.is_deleted:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated."
        )

    return user

# --- The Architect's Trick: The Golden Dependency ---
# Anytime you want to lock down an endpoint, you will simply add: `current_user: CurrentUser`
CurrentUser = Annotated[User, Depends(get_current_user)]