"""
user_filters — shared SQLAlchemy filter helpers for soft-deleted users.

Soft-deleting a user is a pure flag flip (admin_routes.deactivate_user
sets `is_deleted = True` + stamps `deleted_at`). There is intentionally
no cascade — that preserves audit trails on the goal / review / project
tables — but it means every aggregation surface that joins on User must
explicitly exclude deactivated rows or it surfaces ghost data.

`active_user_ids_query` returns a SQLAlchemy Query of live user IDs in
one org, suitable to pass directly to `.in_(...)` on any ownership
column (`Goal.user_id`, `AnnualReview.user_id`,
`ProjectReview.user_id`, etc.).

Example:
    from app.core.user_filters import active_user_ids_query

    rows = (
        db.query(Goal)
        .filter(
            Goal.org_id == org_id,
            Goal.user_id.in_(active_user_ids_query(db, org_id)),
        )
        .all()
    )

Centralising it here keeps the semantics identical across HR's
dashboard, the "All X" listings, and the cycle-distinct dropdowns —
otherwise one surface fixes the ghost while another keeps showing it.

There are two intentional exceptions where you DO want deleted users
to surface and should NOT call this helper:
  1. `admin_routes.list_users` — the admin table renders a "deactivated"
     badge so HR can reactivate or audit history.
  2. Historical detail views accessed by a specific id — a deleted
     user's goal / review can still be opened directly (FK lookup),
     which is correct for audit purposes.
"""

from sqlalchemy.orm import Query, Session

from app.models.user_models import User


def active_user_ids_query(db: Session, org_id: int) -> Query:
    """Return a Query over `User.id` for live users in this org.

    Pass the result straight into `.in_(...)` — SQLAlchemy inlines it
    as a correlated subquery so there is no extra round-trip.
    """
    return (
        db.query(User.id)
        .filter(
            User.org_id == org_id,
            User.is_deleted == False,  # noqa: E712 — SQLAlchemy needs ==
        )
    )
