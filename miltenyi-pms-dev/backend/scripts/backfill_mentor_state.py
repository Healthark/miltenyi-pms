"""One-shot backfill for the mentor-transition cascade.

See docs/policies/mentor-transition-policy.md for the full policy
context.

Brings existing data into line with the cascade rules introduced in
admin_routes.update_user + deactivate_user. Two cleanup passes:

  1. Dangling User.mentor_id pointers — find active users whose
     mentor_id points at a soft-deleted user (pre-cascade legacy
     state). For each, null the pointer, stamp mentor_orphaned_at,
     and cascade their in-flight goal/review rows to NULL stamped
     mentor. Log each as reason="backfill".

  2. Stamped/live mismatch on in-flight rows — find goals + reviews
     in in-flight statuses where Goal.manager_id (or
     AnnualReview.mentor_id) doesn't match the owner's current
     User.mentor_id. Bring stamped into sync with live. This catches
     the user-visible bug "Bob's My Goals row shows Anjali even
     though Bob is now mentored by Priya" for orgs that pre-date the
     cascade.

Both passes are idempotent — re-running produces zero changes after
the first successful run.

Usage:
    python backend/scripts/backfill_mentor_state.py --all-orgs
    python backend/scripts/backfill_mentor_state.py --org-id=1
    python backend/scripts/backfill_mentor_state.py --org-id=1 --dry-run

The script reuses the helpers from admin_routes (no copy-paste) so
the cascade logic stays single-sourced. The "admin" actor used in
the log rows is the first HR_MyOrg user found in the org — there is
no real human actor for a backfill, so we attribute to the
highest-authority role available. If no HR_MyOrg user exists in the
org the script logs a warning and uses user_id=0 as a sentinel.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone

# Allow running from anywhere — fix up sys.path so `app.*` imports work.
import pathlib
_BACKEND_ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_BACKEND_ROOT))

from sqlalchemy.orm import Session, aliased  # noqa: E402

from app.core.database import SessionLocal  # noqa: E402
from app.models.user_models import User, Role  # noqa: E402
from app.models.goal_models import Goal  # noqa: E402
from app.models.annual_review_models import AnnualReview  # noqa: E402
from app.models.organization_models import Organization  # noqa: E402
from app.api.routes.admin_routes import (  # noqa: E402
    _GOAL_IN_FLIGHT_STATUSES,
    _REVIEW_IN_FLIGHT_STATUSES,
    _cascade_mentor_reassignment,
    _log_mentor_move,
)


def _resolve_actor(db: Session, org_id: int) -> User | None:
    """Pick an HR_MyOrg user in this org to attribute the backfill to.
    No real human actor exists; we use the highest-authority role so
    the audit-log entries point at a meaningful row. Returns None if
    the org has no HR_MyOrg user — caller logs a warning and skips."""
    return (
        db.query(User)
        .filter(
            User.org_id == org_id,
            User.role == Role.HR_MYORG.value,
            User.is_deleted == False,  # noqa: E712
        )
        .order_by(User.id.asc())
        .first()
    )


def _backfill_dangling_pointers(
    db: Session, org_id: int, actor: User, *, dry_run: bool
) -> int:
    """Pass 1: null User.mentor_id where it points at a soft-deleted
    user; stamp mentor_orphaned_at; cascade in-flight goal/review
    rows to NULL stamped mentor."""
    # Self-referential join on the `users` table — aliased() so the
    # WHERE can reference the mentor's is_deleted flag distinctly
    # from the mentee's.
    MentorAlias = aliased(User)
    danglers = (
        db.query(User)
        .join(MentorAlias, MentorAlias.id == User.mentor_id)
        .filter(
            User.org_id == org_id,
            User.is_deleted == False,  # noqa: E712
            User.mentor_id.isnot(None),
            MentorAlias.is_deleted == True,  # noqa: E712
        )
        .all()
    )

    if not danglers:
        return 0

    if dry_run:
        for u in danglers:
            print(
                f"  [DRY-RUN] would orphan user_id={u.id} ({u.full_name}) — "
                f"dangling mentor_id={u.mentor_id} (deleted user "
                f"{u.mentor.full_name})"
            )
        return len(danglers)

    now = datetime.now(timezone.utc)
    for u in danglers:
        old_mentor_id = u.mentor_id
        # Cascade in-flight stamped refs to NULL on this mentee.
        _cascade_mentor_reassignment(
            db,
            admin=actor,
            mentee=u,
            old_mentor_id=old_mentor_id,
            new_mentor_id=None,
            reason="backfill",
        )
        u.mentor_id = None
        u.mentor_orphaned_at = now
        _log_mentor_move(
            db,
            org_id=u.org_id,
            admin_user_id=actor.id,
            employee_user_id=u.id,
            entity_type="user",
            entity_id=u.id,
            old_mentor_id=old_mentor_id,
            new_mentor_id=None,
            reason="backfill",
        )
    db.commit()
    return len(danglers)


def _backfill_inflight_mismatch(
    db: Session, org_id: int, actor: User, *, dry_run: bool
) -> tuple[int, int]:
    """Pass 2: bring in-flight Goal.manager_id + AnnualReview.mentor_id
    into sync with the owner's current User.mentor_id. Returns
    (goals_updated, reviews_updated)."""

    goal_rows = (
        db.query(Goal, User)
        .join(User, User.id == Goal.user_id)
        .filter(
            Goal.org_id == org_id,
            User.is_deleted == False,  # noqa: E712
            Goal.approval_status.in_(_GOAL_IN_FLIGHT_STATUSES),
        )
        .all()
    )
    goal_mismatches = [
        (g, u) for g, u in goal_rows if g.manager_id != u.mentor_id
    ]

    review_rows = (
        db.query(AnnualReview, User)
        .join(User, User.id == AnnualReview.user_id)
        .filter(
            AnnualReview.org_id == org_id,
            User.is_deleted == False,  # noqa: E712
            AnnualReview.status.in_(_REVIEW_IN_FLIGHT_STATUSES),
        )
        .all()
    )
    review_mismatches = [
        (r, u) for r, u in review_rows if r.mentor_id != u.mentor_id
    ]

    if dry_run:
        for g, u in goal_mismatches:
            print(
                f"  [DRY-RUN] would sync goal_id={g.id} owner={u.full_name}: "
                f"manager_id {g.manager_id} → {u.mentor_id}"
            )
        for r, u in review_mismatches:
            print(
                f"  [DRY-RUN] would sync review_id={r.id} owner={u.full_name}: "
                f"mentor_id {r.mentor_id} → {u.mentor_id}"
            )
        return len(goal_mismatches), len(review_mismatches)

    for g, u in goal_mismatches:
        old = g.manager_id
        g.manager_id = u.mentor_id
        _log_mentor_move(
            db,
            org_id=g.org_id,
            admin_user_id=actor.id,
            employee_user_id=u.id,
            entity_type="goal",
            entity_id=g.id,
            old_mentor_id=old,
            new_mentor_id=u.mentor_id,
            reason="backfill",
        )

    for r, u in review_mismatches:
        old = r.mentor_id
        r.mentor_id = u.mentor_id
        # Also clear mentor drafts when the row moves to a new
        # mentor (matches Scenario 3b in the policy doc — the new
        # mentor types their own words). When moving to NULL, we
        # also null the drafts so re-mentoring later doesn't inherit
        # a stranger's typing.
        r.mentor_overall_review_draft = None
        r.mentor_performance_rating_draft = None
        _log_mentor_move(
            db,
            org_id=r.org_id,
            admin_user_id=actor.id,
            employee_user_id=u.id,
            entity_type="annual_review",
            entity_id=r.id,
            old_mentor_id=old,
            new_mentor_id=u.mentor_id,
            reason="backfill",
        )

    db.commit()
    return len(goal_mismatches), len(review_mismatches)


def run_for_org(db: Session, org_id: int, *, dry_run: bool) -> None:
    actor = _resolve_actor(db, org_id)
    if actor is None:
        print(
            f"  ! No HR_MyOrg actor in org_id={org_id}; skipping. "
            f"(Need at least one active HR_MyOrg user to attribute "
            f"backfill log entries to.)"
        )
        return

    print(f"\n=== org_id={org_id} (actor={actor.email}) ===")

    pass1 = _backfill_dangling_pointers(db, org_id, actor, dry_run=dry_run)
    print(f"  Pass 1 (dangling mentor_id): {pass1} mentees orphaned")

    g_count, r_count = _backfill_inflight_mismatch(
        db, org_id, actor, dry_run=dry_run
    )
    print(
        f"  Pass 2 (in-flight stamped<->live sync): "
        f"{g_count} goals, {r_count} annual reviews aligned"
    )


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "One-shot backfill that fixes dangling mentor pointers and "
            "syncs in-flight goal/review stamped mentor_id to the "
            "owner's current mentor. Idempotent."
        )
    )
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--org-id", type=int, help="Run for a single org.")
    group.add_argument(
        "--all-orgs",
        action="store_true",
        help="Run for every org in the DB.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would change without committing any updates.",
    )
    args = parser.parse_args()

    db = SessionLocal()
    try:
        if args.all_orgs:
            org_ids = [oid for (oid,) in db.query(Organization.id).all()]
            print(f"Running on {len(org_ids)} orgs: {org_ids}")
            for org_id in org_ids:
                run_for_org(db, org_id, dry_run=args.dry_run)
        else:
            run_for_org(db, args.org_id, dry_run=args.dry_run)

        if args.dry_run:
            print("\n[DRY-RUN] No changes were committed.")
        else:
            print("\nDone. Re-run to confirm idempotency (should report 0).")
    finally:
        db.close()


if __name__ == "__main__":
    main()
