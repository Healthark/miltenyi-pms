"""
test_project_reviews_query_count.py — first concrete test (doc 33).

What this test does:
    Seeds an org with 50 ProjectReview rows, hits
    GET /api/v1/project-reviews/all?limit=50 as an HR_MyOrg user, and
    asserts that the response is correct AND that the number of SQL
    statements emitted stays bounded.

Why this is the first test:
    Doc #24 (`24-batch-prefetch-helper.md`) claimed pagination + the
    `_prefetch_review_dependencies` helper reduced this endpoint from
    `~5N+5` queries to "a constant handful." Doc #25
    (`25-joinedload-secondary-evaluations.md`) tightened that further
    with `joinedload(secondary_evaluations)`. Both claims were
    "verified manually" because no test framework existed.

    This test makes those claims regression-proof: if a future refactor
    accidentally reintroduces an N+1 inside `_build_review_response`,
    the assertion fails loudly.

How the assertion threshold was picked:
    Doc 25 predicted ~5 queries at limit=50:
      1. COUNT(*) for total
      2. windowed-fetch with joinedload(secondary_evaluations)
      3. _get_settings_row
      4. batched users in _prefetch_review_dependencies
      5. batched projects in _prefetch_review_dependencies

    We assert `< 20` to leave headroom for engine-internal pragmas
    (SQLite emits a few PRAGMA queries during transactions), session
    setup, etc. The test still catches N+1 regressions cleanly —
    50 rows × ~5 queries each would push the count well past 200.

    Adjust the threshold if the suite grows and we want tighter
    bounds; for one-test PR, 20 is conservative and safe.
"""

from __future__ import annotations

from datetime import datetime, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.organization_models import Organization
from app.models.project_models import Project
from app.models.project_review_models import ProjectReview, ProjectReviewStatus
from app.models.system_settings_models import SystemSettings
from app.models.user_models import Role, User
from tests.conftest import QueryCounter


# ── Seed helpers ─────────────────────────────────────────────────────


def _seed_org_and_admin(db: Session) -> tuple[Organization, User]:
    """Bare-minimum seed: org + HR_MyOrg user + SystemSettings.

    The SystemSettings row is REQUIRED — without it, the route's
    `_get_settings_row` returns None, and `_build_review_response`'s
    fallback re-fetches it per row (50× SELECT system_settings). The
    helper's intended contract is "callers pre-fetch settings once
    and thread it down"; the test must produce conditions matching
    that contract.
    """
    org = Organization(name="Test Org")
    db.add(org)
    db.flush()  # populate org.id without committing

    admin = User(
        org_id=org.id,
        employee_code="HR001",
        full_name="HR Admin",
        email="hr@test.local",
        role=Role.HR_MYORG.value,
        password_hash="not-checked-in-tests",
    )
    db.add(admin)
    db.flush()

    settings = SystemSettings(
        org_id=org.id,
        active_cycle_name="Q1 FY26-27",
        cycle_type="quarterly",
        fiscal_start_month=4,
    )
    db.add(settings)
    db.flush()
    return org, admin


def _seed_50_reviews(db: Session, org: Organization, pm: User) -> list[ProjectReview]:
    """Seed one project + 50 reviews on it.

    The reviews target 50 distinct staff users so the endpoint's
    batched-user fetch exercises a realistic IN-list size. The pm
    parameter doubles as the reviewer for all 50 — fine, the test
    isn't checking per-reviewer data, just query volume.
    """
    project = Project(
        org_id=org.id,
        project_code="TEST-001",
        name="Test Project",
        pm_id=pm.id,
        status="active",
    )
    db.add(project)
    db.flush()

    reviews: list[ProjectReview] = []
    for i in range(50):
        staff = User(
            org_id=org.id,
            employee_code=f"STAFF-{i:03d}",
            full_name=f"Staff {i}",
            email=f"staff{i}@test.local",
            role=Role.EMPLOYEE.value,
            password_hash="not-checked",
        )
        db.add(staff)
        db.flush()

        review = ProjectReview(
            org_id=org.id,
            user_id=staff.id,
            project_id=project.id,
            reviewer_id=pm.id,
            cycle="Q1 FY26-27",
            status=ProjectReviewStatus.REVIEWED.value,
            performance_group="Meeting Expectations",
            created_at=datetime.now(timezone.utc),
        )
        db.add(review)
        reviews.append(review)

    db.commit()
    return reviews


# ── The test ─────────────────────────────────────────────────────────


def test_project_reviews_all_query_count_is_bounded(
    db_session: Session,
    as_user,
    query_counter: QueryCounter,
) -> None:
    """GET /project-reviews/all?limit=50 should issue a small fixed
    number of queries regardless of the 50-row page size — that's
    the doc-24 + doc-25 claim.

    Failure mode this catches: someone refactors
    `_build_review_response` and accidentally reintroduces a per-row
    query (e.g., looks up `Goal.owner.function.name` lazily inside
    the helper). The query count would jump to ~50+ and this
    assertion fires.
    """
    # 1. Seed.
    org, admin = _seed_org_and_admin(db_session)
    _seed_50_reviews(db_session, org, admin)

    # 2. Make the request as the HR_MyOrg user. Reset the counter
    #    AFTER seeding — we only care about queries that fire under
    #    the route handler, not the inserts that built the fixture.
    client: TestClient = as_user(admin)
    query_counter.reset()
    resp = client.get("/api/v1/project-reviews/all?limit=50&offset=0")

    # 3. Sanity: response succeeded with the expected shape.
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "items" in body and "total" in body
    assert len(body["items"]) == 50
    assert body["total"] == 50

    # 4. The headline assertion. ~5 queries is the doc-25 prediction;
    #    < 20 catches any N+1 regression while leaving headroom for
    #    engine internals.
    assert query_counter.count < 20, (
        f"Query count {query_counter.count} exceeds bound. "
        f"Possible N+1 regression. Statements:\n"
        + "\n".join(f"  {s[:140]}" for s in query_counter.statements)
    )
