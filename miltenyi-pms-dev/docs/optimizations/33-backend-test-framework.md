# 33 — Backend test framework + first query-count assertion

> **PR:** _pending_
> **Files added:** `backend/requirements-dev.txt`, `backend/pytest.ini`, `backend/tests/__init__.py`, `backend/tests/conftest.py`, `backend/tests/test_project_reviews_query_count.py`.
> **Headline result:** Closes the "verified manually" loop docs since #24 kept noting. Adds a minimal pytest infrastructure (~150 LOC of fixtures) plus one concrete regression test: `GET /project-reviews/all?limit=50` issues **6 SQL queries** for 50 rows — matches doc #25's "~5 queries regardless of page size" prediction. Future contributors extend the same `conftest.py` to assert other claims docs have made by hand.

---

## TL;DR

Every backend PR since theme 4 has shipped with a "verified manually" caveat. Doc #24 sketched what a query-count test would look like; doc #25 raised the stakes ("true constant query count"); doc #29 noted that future optimization PRs could claim verifiable wins once a test framework existed. **No framework existed.** This PR ships the smallest one that makes the most important claim regression-proof:

| Claim | Doc | Test |
|---|---|---|
| "/project-reviews/all issues ~5 queries regardless of page size" | #25 | `test_project_reviews_all_query_count_is_bounded` asserts `< 20` |

The threshold is deliberately loose (`< 20`, actual is `6`). The test catches the failure mode that matters — an accidental N+1 inside `_build_review_response` would push the count to `~250`. The exact constant isn't worth asserting against; the **bound** is.

---

## Part 1 — Why the framework is small

Three pieces:

```
backend/
├── requirements-dev.txt   # pytest + httpx, kept out of production deps
├── pytest.ini             # discovery config
└── tests/
    ├── __init__.py
    ├── conftest.py        # ~150 LOC of fixtures
    └── test_project_reviews_query_count.py
```

What's deliberately NOT here:

- **No factory-boy / faker.** Seed data is built by hand in each test via small `_seed_*` helpers. Easier to read than chained factories until the suite grows past ~20 tests.
- **No Postgres integration tests.** In-memory SQLite is fast and zero-setup. A few PG-only features (`ILIKE` case-insensitivity, some array ops) behave differently, but for query-count tests this doesn't matter.
- **No CI integration.** That's its own PR. The README documents how to run locally; if and when CI runs Python tests, this suite is what it runs.
- **No alembic-driven schema.** `Base.metadata.create_all()` is faster and good enough for unit tests.
- **No HTTP mocking, no JWT exercise.** Auth is bypassed via `dependency_overrides`; tests don't exercise the auth layer because they're not testing it.

This is the **"start tiny, grow when forced"** principle. Doc 24 said a future PR would profile + assert query counts. Doc 25 said it'd test the joinedload constant. Doc 29 said it'd land when the first real test motivated it. **One test motivates it now.** The rest of the surface can wait until a future PR has a specific claim to lock down.

---

## Part 2 — The three fixtures that make it work

### `engine` — in-memory SQLite with `StaticPool`

```python
@pytest.fixture
def engine() -> Iterator[Engine]:
    eng = create_engine(
        "sqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()
```

Three things doing real work:

1. **`sqlite:///:memory:`** — no file on disk, no cleanup, fast.
2. **`connect_args={"check_same_thread": False}`** — required because FastAPI's `TestClient` runs the app in a different thread than the test body. SQLite's default thread guard would reject the cross-thread connection.
3. **`poolclass=StaticPool`** — **load-bearing.** By default, every new connection to `:memory:` gets its OWN empty database. Without a static pool, the request handler (different thread, different pool slot) sees an empty DB even though the test seeded data through its own session. Took one wasted debugging round to spot — the test failed with `no such table: users` while the seed data was sitting in a completely separate in-memory DB instance. `StaticPool` forces a single shared connection across the engine.

A FRESH engine per test means the schema gets recreated every time → no leakage between tests. Good enough for now. If the suite grows past hundreds of tests, swap to a session-scoped engine + per-test transaction rollback (the Django-style "TestCase wraps in a transaction" pattern).

### `app_with_db` + `as_user` — auth + DB override

```python
@pytest.fixture
def app_with_db(engine: Engine) -> Iterator[FastAPI]:
    from main import app
    TestSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)

    def override_get_db():
        s = TestSessionLocal()
        try: yield s
        finally: s.close()

    app.dependency_overrides[get_db] = override_get_db
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
def as_user(app_with_db: FastAPI):
    def make(user: User) -> TestClient:
        app_with_db.dependency_overrides[get_current_user] = lambda: user
        return TestClient(app_with_db)
    return make
```

Three patterns worth pointing at:

1. **`from main import app` happens INSIDE the fixture, not at module top.** FastAPI's `app` is module-level global state; importing it at conftest top would tie the import to test collection time, before any monkeypatching could happen. Inside-the-fixture is the standard pattern.

2. **`app.dependency_overrides.clear()` on teardown.** Without this, the override leaks to subsequent tests reusing the same `main.app` import. The clear is the FastAPI equivalent of a `try/finally` cleanup.

3. **`as_user` is a factory, not a fixture-with-a-fixed-user.** Tests seed their own user (with their own role + org), then pass it to `as_user(user)`. Auth is bypassed entirely — the test isn't exercising auth, it's exercising the route. Auth-specific tests would override differently (or not at all).

### `query_counter` — the headline fixture

```python
class QueryCounter:
    def __init__(self):
        self.statements: list[str] = []
    @property
    def count(self) -> int:
        return len(self.statements)
    def reset(self) -> None:
        self.statements.clear()


@pytest.fixture
def query_counter(engine: Engine) -> Iterator[QueryCounter]:
    counter = QueryCounter()
    def on_execute(_conn, _cursor, statement, *_, **__):
        counter.statements.append(statement)
    event.listen(engine, "before_cursor_execute", on_execute)
    yield counter
    event.remove(engine, "before_cursor_execute", on_execute)
```

Uses SQLAlchemy's `before_cursor_execute` event — fires for every emitted SQL statement on the bound engine. The counter accumulates statements; `.count` is the assertion target, `.statements` is the diagnostic when an assertion fails.

`reset()` is important: the test seeds data (which itself emits hundreds of INSERTs), then calls `reset()` BEFORE making the request — so we only count queries that fired under the route handler, not the inserts that built the fixture.

---

## Part 3 — The first test

```python
def test_project_reviews_all_query_count_is_bounded(
    db_session: Session,
    as_user,
    query_counter: QueryCounter,
) -> None:
    org, admin = _seed_org_and_admin(db_session)
    _seed_50_reviews(db_session, org, admin)

    client = as_user(admin)
    query_counter.reset()
    resp = client.get("/api/v1/project-reviews/all?limit=50&offset=0")

    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 50
    assert body["total"] == 50

    assert query_counter.count < 20, (
        f"Query count {query_counter.count} exceeds bound. "
        f"Possible N+1 regression. Statements:\n"
        + "\n".join(f"  {s[:140]}" for s in query_counter.statements)
    )
```

**Why the threshold is `< 20` when the actual is `6`:**

| Source of queries | Count |
|---|---|
| `COUNT(*)` for `total` field | 1 |
| Windowed page fetch (with `joinedload(secondary_evaluations)`) | 1 |
| `_get_settings_row` | 1 |
| Batched users (`_prefetch_review_dependencies`) | 1 |
| Batched projects (`_prefetch_review_dependencies`) | 1 |
| Engine internals / pragmas / transaction setup | ~1 |
| **Actual measured total** | **6** |

We assert `< 20` so the test isn't fragile to minor refactors (e.g., adding one extra metadata fetch wouldn't break it). The bound catches the failure mode that matters — a re-introduction of N+1 would push the count past `~250`, well over 20.

If we wanted to assert the exact constant (`assert count == 6`), a single innocuous refactor would break it and create test maintenance pain. Loose bounds are the right call for "catch regressions, not micro-changes."

### The seed-data subtlety

The test almost shipped broken because `SystemSettings` wasn't seeded — `_build_review_response`'s fallback fires per row when `settings=None` reaches it, producing `50× SELECT system_settings` queries. The first run showed `count = 56`, not `6`.

**The seed must match the production contract.** In production every org has a `SystemSettings` row created at org setup. Tests need to mirror that, or they catch failures that production never sees.

`_seed_org_and_admin` now includes `SystemSettings`, with a comment explaining why. Documentation-via-test-comment is its own form of regression protection: future contributors copying the helper will see the requirement.

---

## Part 4 — How to run + extend

```bash
cd backend
pip install -r requirements.txt -r requirements-dev.txt
pytest                    # runs the whole suite
pytest -v                 # verbose (one line per test, names visible)
pytest tests/test_project_reviews_query_count.py::test_project_reviews_all_query_count_is_bounded  # one test
```

**Adding a test:**
1. Create `backend/tests/test_<thing>.py`.
2. Use the `db_session`, `as_user`, and (if making query-count claims) `query_counter` fixtures.
3. Build seed data via small helpers, not factories.
4. Reset the query counter BEFORE the request — otherwise the count includes the inserts.

**When to add new fixtures:**
- A new common seed shape used by 3+ tests → factor into conftest.
- A new auth pattern (rate-limited user, deactivated user, etc.) → new fixture.
- A new DB shape (Postgres for `ILIKE` semantics, transaction rollback for speed) → new engine fixture, parameterized.

---

## Part 5 — What this PR does NOT solve

- **CI integration.** Tests run locally only. A future PR adds GitHub Actions / similar.
- **PG-vs-SQLite divergence tests.** `ILIKE` is case-insensitive on Postgres, case-sensitive on SQLite. If a future bug only manifests on PG, a PG-targeted test fixture is needed.
- **Auth/integration tests.** The auth dependency is bypassed everywhere. Real auth tests exercise the JWT + cookie path — different fixture setup.
- **Other "verified manually" claims.** Docs 19-32 made many claims that could be regression-tested. They will be, when someone has a specific reason. We don't pre-emptively test every claim.
- **Test data factories.** When seed helpers start getting unwieldy across multiple tests, a `factory-boy` setup might be worth introducing. Not now.

---

## Trade-offs

- **In-memory SQLite has different semantics from production Postgres.** ILIKE, JSON ops, EXISTS subqueries with complex correlations — some behave differently. For query-count tests this is fine; for feature-correctness tests, would need PG.
- **`StaticPool` means the engine is single-connection.** Can't simulate concurrent requests with this fixture. If we ever need that (probably never for unit tests), would need a different pool strategy.
- **Fresh engine per test = slow if the suite grows.** Each test pays the schema creation cost. At one test, ~2 seconds. At 100 tests, ~3 minutes. When that becomes painful, switch to session-scoped engine + per-test transaction rollback.
- **Auth bypass means we never exercise the JWT/cookie path.** Acceptable trade-off; auth itself is well-trodden territory and the route-level tests don't care.

---

## Verification

```bash
cd backend
pip install -r requirements.txt -r requirements-dev.txt
pytest tests/ -v
```

Expected output:
```
tests/test_project_reviews_query_count.py::test_project_reviews_all_query_count_is_bounded PASSED
======================== 1 passed in ~2-3s =========================
```

To prove the bound catches regressions: temporarily comment out the `deps=deps` argument in the `/project-reviews/all` route handler (so `_build_review_response` falls back to per-row queries). Re-run — the test should fail with `Query count 250+ exceeds bound. Possible N+1 regression. Statements: ...`.

---

## What's next

Theme 7 (the verifiability theme) opens here. Possible follow-ups:

- **More query-count tests** for `/goals/all` (doc 24 also discussed N+1 there), `/calibration` (the OUTER JOIN behaviour from doc 31), `/annual-reviews/all` (theme 4 foundation).
- **Schema migration tests** — does `alembic upgrade head` from scratch produce a schema consistent with `Base.metadata`?
- **Filter/sort feature tests** — verify the doc-26-through-31 claims about server-side filter + sort matching the right rows.
- **CI integration** — auto-run on every push.

Or stop here. The framework exists; specific tests get added when specific claims need locking down. **One test, one foundation.** The arc remains at a natural endpoint either way.
