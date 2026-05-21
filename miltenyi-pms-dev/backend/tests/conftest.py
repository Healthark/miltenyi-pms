"""
conftest.py — shared pytest fixtures for the backend test suite (doc 33).

What's here:
    - engine        : per-test in-memory SQLite engine.
    - db_session    : SQLAlchemy session bound to that engine.
    - app_with_db   : FastAPI app with `get_db` overridden to use the
                      test session.
    - as_user       : factory fixture; returns a `client` callable bound
                      to a specific test user (auth bypassed).
    - query_counter : event-listener fixture that counts SQL statements
                      emitted on the test engine. Use in any test that
                      asserts query-volume claims (e.g. doc 24's "N+1
                      eliminated" + doc 25's "true constant query count"
                      claims).

What's NOT here (intentionally):
    - No persistent Postgres test DB. In-memory SQLite is fast and
      requires zero setup. The downside: a few PG-only features (ILIKE
      case-insensitivity, some array ops) behave differently. For
      query-count tests this doesn't matter; for tests that depend on
      PG-specific behaviour we'd swap engines via env var, not here.
    - No alembic-driven schema. `Base.metadata.create_all()` is faster
      and good enough for unit tests. CI integration tests against
      Postgres are a future concern.
    - No factory-boy / faker. Seed data is built by hand in each test
      via small helpers. Easier to read than chained factories until
      the suite grows past ~20 tests.

The fixture surface stays deliberately small. Doc 33 explains the
"start tiny, grow when forced" rationale.
"""

from __future__ import annotations

from typing import Callable, Iterator

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

# Side-effect import: registers every model on `Base.metadata` so
# `create_all` below has the full schema. The `app.models` package's
# __init__ imports every model module.
import app.models  # noqa: F401
from app.api.dependencies import get_current_user, get_current_user_allow_password_reset
from app.core.database import Base, get_db
from app.models.user_models import User


# ── DB engine + session ──────────────────────────────────────────────


@pytest.fixture
def engine() -> Iterator[Engine]:
    """Per-test in-memory SQLite engine.

    `connect_args={"check_same_thread": False}` is required because
    TestClient runs the FastAPI app in a different thread than the
    test body. SQLite's default thread guard would reject the cross-
    thread connection otherwise.

    `poolclass=StaticPool` is the load-bearing piece for in-memory
    SQLite: by default, every new connection to `:memory:` gets its
    OWN empty database. Without a static pool, the request handler
    (different thread, different pool slot) sees an empty DB even
    though the test body seeded data through its own session.
    StaticPool forces a single shared connection across the engine.

    A FRESH engine per test means schema gets recreated each time —
    no leakage between tests. At our suite size this is fine; if the
    suite grows past hundreds of tests, swap to session-scoped engine
    + per-test transaction rollback.
    """
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()


@pytest.fixture
def db_session(engine: Engine) -> Iterator[Session]:
    """A SQLAlchemy session bound to the test engine."""
    TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = TestSessionLocal()
    try:
        yield session
    finally:
        session.close()


# ── FastAPI app + auth bypass ────────────────────────────────────────


@pytest.fixture
def app_with_db(engine: Engine) -> Iterator[FastAPI]:
    """The production FastAPI app with `get_db` overridden so routes
    use the test engine. Auth is NOT overridden here — that's the
    `as_user` fixture's job, since the test user is per-test data."""
    # Import here, not at module top, so the import doesn't fire on
    # collection (and so that any test that wants to monkey-patch
    # config before the app loads can still do so).
    from main import app

    TestSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

    def override_get_db() -> Iterator[Session]:
        s = TestSessionLocal()
        try:
            yield s
        finally:
            s.close()

    app.dependency_overrides[get_db] = override_get_db
    yield app
    # Clean up so subsequent tests using the same `main.app` import
    # don't inherit our overrides. FastAPI's `app` is module-level
    # global state — this is the standard cleanup pattern.
    app.dependency_overrides.clear()


@pytest.fixture
def as_user(app_with_db: FastAPI) -> Callable[[User], TestClient]:
    """Factory: returns a TestClient that authenticates as the given
    `User` instance. Use when a test seeded a user and wants to make
    requests as that user.

    Auth bypass works by overriding `get_current_user` to return the
    fixed user. The JWT/cookie path is bypassed entirely — the test
    isn't exercising auth, so faking the dependency is the right
    move. (Auth-specific tests would override differently.)
    """

    def make(user: User) -> TestClient:
        app_with_db.dependency_overrides[get_current_user] = lambda: user
        # The exempt routes (password change, logout, session refresh)
        # depend on the bypass variant instead of get_current_user, so
        # override both — otherwise a test asking to act "as user X"
        # against /auth/session would fall through to the real JWT path.
        app_with_db.dependency_overrides[get_current_user_allow_password_reset] = lambda: user
        return TestClient(app_with_db)

    return make


# ── Query counter ────────────────────────────────────────────────────


class QueryCounter:
    """Captures every SQL statement issued through the bound engine.

    Use to assert query-count claims like doc 24's "~5 queries per
    page regardless of limit" or doc 25's "constant query count
    regardless of secondary_evaluations cardinality." Without this,
    those docs say "verified manually" — this fixture makes the same
    claims regression-proof.

    `count` is the number of statements (cheap to assert against).
    `statements` is the actual SQL list (useful when an assertion
    fails and you want to see what fired).
    """

    def __init__(self) -> None:
        self.statements: list[str] = []

    @property
    def count(self) -> int:
        return len(self.statements)

    def reset(self) -> None:
        self.statements.clear()


@pytest.fixture
def query_counter(engine: Engine) -> Iterator[QueryCounter]:
    """Hooks SQLAlchemy's `before_cursor_execute` event on the test
    engine. Every emitted SQL statement is appended to
    `counter.statements`. Detaches on teardown so the count doesn't
    leak between tests."""
    counter = QueryCounter()

    def on_execute(_conn, _cursor, statement, _parameters, _context, _executemany):
        counter.statements.append(statement)

    event.listen(engine, "before_cursor_execute", on_execute)
    yield counter
    event.remove(engine, "before_cursor_execute", on_execute)
