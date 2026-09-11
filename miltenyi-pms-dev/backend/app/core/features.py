"""Server-side feature gate.

`Organization.enabled_features` (a JSON list such as ["dashboard", "goals",
"project_goals", ...]) has until now only driven the frontend: the sidebar
hides menu items and ProtectedRoute redirects. No endpoint checked it, so a
hidden feature stayed reachable by URL. This dependency closes that gap.

Usage — gate a whole router:

    router = APIRouter(dependencies=[Depends(require_feature("project_goals"))])

or a single route:

    @router.get("/x", dependencies=[Depends(require_feature("project_goals"))])

The check is deliberately cheap: one PK fetch of the caller's organisation.
Missing or malformed `enabled_features` is treated as "nothing enabled" so a
misconfigured org fails closed.
"""

from fastapi import Depends, HTTPException, status

from app.api.dependencies import CurrentUser, DbSession
from app.models.organization_models import Organization


def org_features(db, org_id: int) -> set[str]:
    org = db.query(Organization).filter(Organization.id == org_id).first()
    feats = org.enabled_features if org is not None else None
    if not isinstance(feats, list):
        return set()
    return {str(f) for f in feats}


def require_feature(feature: str):
    """Return a FastAPI dependency that 403s unless `feature` is enabled for
    the caller's organisation."""

    def _dependency(current_user: CurrentUser, db: DbSession) -> None:
        if feature not in org_features(db, current_user.org_id):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"The '{feature}' feature is not enabled for your organisation.",
            )

    return _dependency
