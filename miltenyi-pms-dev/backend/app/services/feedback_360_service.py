"""
360 Feedback service — pure-function helpers used by the routes.

Anonymity contract
------------------
The reviewer's identity ONLY enters the system through the JWT-resolved
`current_user` and is consumed by `reviewer_hash()` immediately. Once
the hash is computed and the row is written, no code path can recover
who the reviewer was without:
    1. The DB rows (visible to anyone with read access).
    2. The backend code (knows the algorithm).
    3. The deployment env (`FEEDBACK_HASH_SECRET`).
A motivated attacker with all three could brute-force the hash space
(N users × M targets × per-cycle), which is detectable via secret-
access logs in a properly-managed deployment. This is the same level
of anonymity that real-world enterprise 360 tools provide.

Worked-with v1
--------------
"Did the reviewer and target work together this FY?" is approximated
as "do they share at least one project_id in `project_assignments`?".
ProjectAssignment doesn't carry an explicit cycle marker, so a stricter
date-overlap check would require joining through Project.start_date /
expected_end_date, which are nullable. We accept the v1 approximation
and document its limitation here. Snapshot-at-submit semantics: the
flag is computed once when the review is created and never updates.
"""

from __future__ import annotations

import hashlib
import hmac
from datetime import date

from sqlalchemy import and_, exists
from sqlalchemy.orm import Session, aliased

from app.core.config import settings
from app.core.cycle_utils import current_half_and_fy
from app.models.project_models import ProjectAssignment
from app.models.user_models import User


# ── Anonymity ────────────────────────────────────────────────────────


def reviewer_hash(reviewer_id: int, target_id: int, fy_year: int) -> str:
    """HMAC-SHA256 hex of the reviewer/target/cycle tuple, keyed by the
    deployment secret. Deterministic — same inputs always produce the
    same 64-char hex. The output is the only persisted artifact tied to
    a reviewer; the inputs are never stored."""
    msg = f"{reviewer_id}|{target_id}|{fy_year}".encode("utf-8")
    secret = settings.FEEDBACK_HASH_SECRET.encode("utf-8")
    return hmac.new(secret, msg, hashlib.sha256).hexdigest()


# ── Cycle ────────────────────────────────────────────────────────────


def current_active_fy(today: date | None = None) -> int:
    """Return the integer fiscal-year-start for the active cycle (e.g.
    2026 for FY26-27 when fiscal_start_month=4 and today is May 2026).

    Independent of cycle_type — 360 feedback is FY-scoped regardless of
    whether the org runs annual / half-yearly / quarterly review cycles.
    """
    instant = today or date.today()
    _half, fy_year = current_half_and_fy(instant, settings.FISCAL_START_MONTH)
    return fy_year


# ── Worked-with ──────────────────────────────────────────────────────


def did_work_together(
    db: Session,
    reviewer_id: int,
    target_id: int,
    org_id: int,
) -> bool:
    """True iff the reviewer and target share at least one project
    assignment in the same org. v1 ignores the cycle window — see the
    module docstring's 'Worked-with v1' note."""
    SubA = aliased(ProjectAssignment)
    SubB = aliased(ProjectAssignment)
    return db.query(
        exists().where(
            and_(
                SubA.user_id == reviewer_id,
                SubB.user_id == target_id,
                SubA.project_id == SubB.project_id,
                SubA.org_id == org_id,
                SubB.org_id == org_id,
            )
        )
    ).scalar() or False


def shared_project_targets(
    db: Session,
    reviewer_id: int,
    org_id: int,
) -> set[int]:
    """Return the set of user_ids that share at least one project with
    the reviewer. Used to compute the worked-with flag for every peer
    in the Give Feedback list in a single query (avoids N+1)."""
    SubA = aliased(ProjectAssignment)
    SubB = aliased(ProjectAssignment)
    rows = (
        db.query(SubB.user_id)
        .join(SubA, SubA.project_id == SubB.project_id)
        .filter(
            SubA.user_id == reviewer_id,
            SubA.org_id == org_id,
            SubB.org_id == org_id,
            SubB.user_id != reviewer_id,
        )
        .distinct()
        .all()
    )
    return {r[0] for r in rows}


# ── Viewing rules ────────────────────────────────────────────────────


def can_view_target(
    viewer: User,
    target_user_id: int,
    db: Session,
) -> bool:
    """Aggregate-view permission check:
        - Self                                                  ✓
        - Direct mentor (one level down)                         ✓
        - Management (role=Admin AND is_management=true)         ✓
        - Plain Admin (is_management=false)                      ✗
        - Anyone else                                            ✗
    """
    if viewer.id == target_user_id:
        return True

    target = (
        db.query(User)
        .filter(User.id == target_user_id, User.org_id == viewer.org_id)
        .first()
    )
    if target is None:
        return False

    # Direct mentor — viewer is one level above target in the chain.
    if target.mentor_id == viewer.id:
        return True

    # Management override.
    if viewer.role == "Admin" and bool(viewer.is_management):
        return True

    return False
