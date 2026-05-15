# 24 — Eliminate N+1 in `_build_review_response` with a batched prefetch helper

> **PR:** _pending_
> **Files changed:** `backend/app/api/routes/project_review_routes.py`.
> **Headline result:** First non-pagination PR in theme #4 — the deferred follow-up promised by doc 22 Part 2. The three batch callers of `_build_review_response` (`/all`, `/mentees`, `/secondary-queue`) used to issue ≥ 5N SQL queries to render N reviews. With the new `ReviewBatchDeps` + `_prefetch_review_dependencies` pattern, each request issues a small fixed number of queries regardless of N. At `limit=50`, that's roughly **250 round-trips → 52** (still N for the lazy-loaded `secondary_evaluations` relationship, ≤ 2 for everything else). The next iteration (joinedload on `secondary_evaluations`) gets that to a pure constant, but is deferred — that's its own one-liner PR.

---

## TL;DR

`_build_review_response` is the function that turns a `ProjectReview` ORM row into the API response shape. It needs five auxiliary lookups per review: employee, reviewer, project, project's PM, and one user per secondary evaluator. The legacy implementation did each lookup inline — `db.query(User).filter(...).first()` — which works for one row but is the textbook N+1 when a batch endpoint renders 50 of them.

The fix in this PR:

1. A new dataclass `ReviewBatchDeps` carrying pre-fetched lookup maps (`users_by_id`, `projects_by_id`).
2. A new helper `_prefetch_review_dependencies(reviews, db)` that builds the deps bundle in 2 batched queries.
3. `_build_review_response` accepts an **optional** `deps` parameter. When provided, the helper reads from the maps; when `None`, the legacy per-row path runs unchanged.
4. The three batch callers pass `deps=`. The four single-row callers don't change at all.

The pattern is general — any "build response per row from related entities" loop benefits. The discipline is in the **optional** parameter: single-row callers were always O(1)-ish (a constant 5 queries per request), they don't need the batched path, and dragging them through a refactor risks breaking working code for no measurable gain.

---

## Part 1 — The shape of an N+1

The legacy `_build_review_response` per row:

```python
employee = db.query(User).filter(User.id == review.user_id).first()             # query 1
reviewer = (db.query(User).filter(User.id == review.reviewer_id).first()
            if review.reviewer_id else None)                                    # query 2
project = db.query(Project).filter(Project.id == review.project_id).first()    # query 3
pm_user = (db.query(User).filter(User.id == project.pm_id).first()
           if project and project.pm_id else None)                              # query 4

for ev in review.secondary_evaluations:                                         # lazy load → query 5
    ev_user = db.query(User).filter(User.id == ev.evaluator_id).first()         # +1 per ev
    ...
```

For a single row that's 5 queries (plus 1 per secondary evaluation). The constant cost is acceptable for `GET /project-reviews/{id}` — the route is already paying for one row's worth of work.

For a 50-row batch (post-pagination `/all`), it's **5 × 50 = 250 queries** for the main entities, plus more for secondary evaluations. The DB round-trip latency dominates over actual query work; even with a connection pool, that's seconds of user-visible delay.

The N+1 anti-pattern's official name is misleading — it suggests "1 query to find the parents, then N queries to find the children." In this codebase it's more like **5N queries to denormalize the children**, which is worse. Each row triggers fan-out, and the fan-out compounds with batch size.

### Why pagination only capped the damage

Doc 22 paginated `/all` to `limit=50` per page. That capped each request to `5 × 50 = 250` queries. But:
- Loading multiple pages amplifies linearly: 5 pages = 1250 queries
- The cap is per-request, not per-user-session
- At `limit=200` (the server max), a single request issues `1000+` queries

Pagination is the wrong tool to fix N+1. Pagination bounds payload size; batched prefetch bounds query count. **Both fixes are needed and they compose orthogonally.** Doing pagination first was right (it's the user-visible win), but leaving the N+1 in place after pagination would have eventually shown up as "Load More is slow even though the payload is small."

---

## Part 2 — The fix: `ReviewBatchDeps` + `_prefetch_review_dependencies`

### The deps bundle

```python
@dataclass
class ReviewBatchDeps:
    users_by_id: dict[int, User] = field(default_factory=dict)
    projects_by_id: dict[int, Project] = field(default_factory=dict)
```

A single dataclass with the maps the helper needs. Two reasons not to pass them as loose kwargs:

1. **The helper's signature stays stable.** If we ever need more lookups (e.g. role expectations, designations), they're added inside `ReviewBatchDeps` without changing every call site.
2. **Type system catches mistakes.** `_build_review_response(deps=users_by_id)` won't compile when `deps` expects a `ReviewBatchDeps`. With four loose dicts you'd accidentally swap two of them and never know.

The "one named bundle" pattern is standard refactoring discipline. The dataclass costs nothing at runtime — Python instantiates it once per request — and saves a lot of cognitive load when reading the code.

### The prefetch helper

```python
def _prefetch_review_dependencies(
    reviews: Iterable[ProjectReview],
    db: DbSession,
) -> ReviewBatchDeps:
    reviews_list = list(reviews)
    if not reviews_list:
        return ReviewBatchDeps()

    project_ids = {r.project_id for r in reviews_list if r.project_id is not None}
    user_ids: set[int] = set()
    for r in reviews_list:
        if r.user_id is not None:
            user_ids.add(r.user_id)
        if r.reviewer_id is not None:
            user_ids.add(r.reviewer_id)
        for ev in r.secondary_evaluations:
            if ev.evaluator_id is not None:
                user_ids.add(ev.evaluator_id)

    projects_by_id: dict[int, Project] = {}
    if project_ids:
        projects_by_id = {
            p.id: p
            for p in db.query(Project).filter(Project.id.in_(project_ids)).all()
        }
        # Fold in PM ids — must happen BEFORE the user fetch.
        for p in projects_by_id.values():
            if p.pm_id is not None:
                user_ids.add(p.pm_id)

    users_by_id: dict[int, User] = {}
    if user_ids:
        users_by_id = {
            u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()
        }

    return ReviewBatchDeps(
        users_by_id=users_by_id,
        projects_by_id=projects_by_id,
    )
```

Three things to notice:

#### 1. **Two queries total, regardless of N**

We collect every relevant ID into Python sets first, then run two `WHERE id IN (…)` queries. The DB does one index scan per query instead of `N` lookups.

Postgres handles big `IN` lists comfortably up to ~10k entries; beyond that, performance degrades and you'd switch to a temp table or unnest. At our scale (limit ≤ 200 reviews × ~5 unique IDs each = ~1000 IDs max), we're not close to the threshold.

#### 2. **Project query MUST come before user query**

The PM's user ID lives on the Project (`project.pm_id`), not on the review directly. So we have to fetch projects first to discover which user IDs we need. **Order matters when there's a transitive dependency.** This is the kind of thing a passing reviewer might rearrange thinking "let's group the user fetches" — and then PMs render as "Unknown" because their IDs never got collected.

The comment in the helper calls this out:
```python
# Fold in PM ids — must happen BEFORE the user fetch.
```

If we ever add a third entity with another transitive dep, the ordering will grow. At that point it's worth a topological-sort comment block. Today it's two layers, no topology needed.

#### 3. **The `secondary_evaluations` relationship is still lazy-loaded**

The for loop `for ev in r.secondary_evaluations` triggers SQLAlchemy's lazy load — one SELECT per review for the evaluator rows. The loaded collection is then cached on the review object, so accessing it again inside `_build_review_response` doesn't re-query.

Net cost per batch:
- 1 lazy-load SELECT per review for `secondary_evaluations` (= N queries)
- 1 batched SELECT for `projects` (= 1 query)
- 1 batched SELECT for `users` (covering employees, reviewers, PMs, secondary evaluators — = 1 query)

So `N + 2` queries instead of `5N + per-secondary`. At `limit=50` that's **52 vs 250**, a 5× improvement.

To get to a true constant, we'd add `joinedload(ProjectReview.secondary_evaluations)` at the page-fetch query in each route — one extra LEFT JOIN per route. That collapses the lazy-load fan-out to zero. We didn't do it in this PR because:
- The query is a route concern (caller-specific), not the helper's
- It's a one-line change per call site, hard to get wrong
- Touching three routes again in the same PR muddies the scope ("which change broke things?")

Documented as deferred follow-up below.

---

## Part 3 — The optional-parameter trade-off

`_build_review_response` accepts `deps: Optional[ReviewBatchDeps] = None`. When `None`, the legacy per-row path runs. When provided, the helper reads from the maps.

```python
if deps is not None:
    employee = deps.users_by_id.get(review.user_id) if review.user_id else None
    # … etc
else:
    employee = db.query(User).filter(User.id == review.user_id).first()
    # … etc
```

This doubles the code in the helper. There's a temptation to make `deps` **required** and migrate every caller. Don't.

### Why optional is right

Two reasons:

#### 1. Four callers are NOT in the N+1 group

| Caller | Type | Behaviour |
|---|---|---|
| `POST /evaluate/{user_id}` | Single-row | Builds one response from a freshly-saved review. |
| `PATCH /evaluate/{user_id}/draft` | Single-row | Same — partial save, single response. |
| `PUT /{review_id}` | Single-row | HR-only edit, single response. |
| `GET /{review_id}` | Single-row | Single review by ID. |

Each fetches **one** ProjectReview. The legacy "5 queries per row" path inside the helper is a constant cost — not N+1, not worth fixing. Forcing them to construct a `ReviewBatchDeps` of one element would add LOC, more import noise, and zero performance gain.

#### 2. Refactoring working code carries risk

These four callers handle the **write paths** (POST, PATCH, PUT) and the single-row read. They each have their own permission checks, transaction boundaries, and edge cases. Migrating them would mean re-running every test scenario (which we can't — no test framework exists yet, doc 22 Part 4) and re-verifying every error path.

The discipline: **only change what needs changing.** Pagination's N+1 was real and measurable. The single-row callers' "N+1" is a misnomer — it's a constant 5 queries per request, which is fine.

### The cost of `Optional`

The doubled-code-in-the-helper is real overhead:
- The `if deps is not None: … else: …` branch makes the helper longer.
- Future maintainers might think the legacy path is "the wrong way" and consolidate, breaking single-row callers.

Mitigations:
- The else-branch comment makes the intent explicit ("legacy path, used by single-row callers where the constant cost is fine").
- A future PR could eventually retire the legacy path by migrating the single-row callers — but only AFTER a test framework exists to verify nothing regresses.

---

## Part 4 — What this PR does NOT solve

- **`joinedload(ProjectReview.secondary_evaluations)` on page-fetch queries.** Would collapse the remaining N lazy loads to zero. One-line change per of the three batch route handlers (`/all`, `/mentees`, `/secondary-queue`). Deferred for scoping: this PR is about the helper pattern, the joinedload is a per-route polish.
- **Test framework setup.** No `tests/` directory exists in the backend. The query-count claim is verified manually (see Verification below) — establishing the framework is its own PR.
- **The remaining single-row callers' "legacy path".** Four sites still issue 5 queries per request. That's fine; they're O(1)-per-request. Retiring the path requires tests first.
- **The `_compute_active_cycle_name(settings)` call per request.** That helper is cheap (pure function over the settings row), and `settings` is already pre-fetched once per request, so this isn't an N+1. Noting for completeness.
- **Other endpoints with similar shape.** `goal_routes.py`'s `/all` does its own per-row owner/manager fetches via SQLAlchemy joinedloads (already batched, doc 20 covered it). `annual_review_routes.py`'s batch endpoints have a similar pattern but were already partially-batched. The `_build_review_response` N+1 was the worst offender; the others either don't have one or are smaller.

---

## Trade-offs

- **More LOC in the helper.** Optional-parameter machinery + the two-path branching adds ~30 lines. Worth it: callers stay simple, single-row callers stay untouched.
- **The deps bundle is request-scoped.** It's built once per request and not cached. That's fine — these batch endpoints aren't called frequently enough to make caching worthwhile, and stale lookup data would be a real bug source.
- **Secondary-evaluations still lazy-load.** Documented above. The `joinedload` is a known follow-up.
- **Manual verification.** No test catches a regression. If a future maintainer adds a per-row query inside `_build_review_response` for a new field, query count silently doubles. Mitigated by the doc + the helper's explicit "single round-trip per entity type" comment, but a test would be better. Deferred.

---

## Verification

The backend has no test framework, so the verification recipe is manual. Two ways:

### Option A — SQLAlchemy echo

Edit `backend/app/db/session.py` (or wherever `create_engine` lives) and add `echo=True`. Every SQL statement is logged to stderr. Then:

```bash
# Terminal 1 — backend with echo on
cd backend && uvicorn main:app --reload --log-level debug

# Terminal 2 — make the request as HR_MyOrg
curl -H "Authorization: Bearer $TOKEN" "http://localhost:8000/api/v1/project-reviews/all?limit=50&offset=0" > /dev/null
```

Count SELECTs in the backend's stderr. Expected: about ~`N+5` (one for the page fetch, one COUNT for total, one for settings, one batched user fetch, one batched project fetch, plus N lazy-load secondary-evaluations). Pre-PR baseline was `~5N + page-fetch + COUNT + settings ≈ 250+` at `limit=50`.

### Option B — `before_cursor_execute` event listener (one-shot script)

For a more targeted check without changing config:

```python
# verify_query_count.py — run from backend/ directory
from sqlalchemy import event
from app.db.session import engine  # adjust import to match repo

queries: list[str] = []

@event.listens_for(engine, "before_cursor_execute")
def _capture(conn, cursor, statement, parameters, context, executemany):
    queries.append(statement)

# … make a request via TestClient or directly call get_all_reviews(...) …

print(f"Emitted {len(queries)} queries")
for q in queries:
    print(q[:120])
```

The script is throwaway — once we have a real test framework, this becomes a fixture (`@pytest.fixture(name="query_counter")`) that every batch endpoint test can assert against.

### What to look for

- Pre-PR: query count grows roughly linearly with `limit`.
- Post-PR: query count grows roughly linearly with `limit` (because of `secondary_evaluations` lazy load) but each step is +1, not +5.
- After the deferred joinedload follow-up: query count is constant (~5) regardless of `limit`.

---

## What the next PR teaches

- **Joinedload on secondary_evaluations** — the deferred polish. Tiny PR, lets us claim "true constant query count" instead of "linear with much lower slope." Mostly a one-liner per route.
- **Test framework setup** — pytest, conftest with a SQLAlchemy session fixture, a `query_counter` fixture for query-count assertions. Once it exists, every future optimization PR can claim verifiable wins.
- **Server-side filter/sort** as theme #5 — the conceptually richest pivot. Once the server can filter, the page-fetch query gets a `WHERE` clause; the prefetch helper doesn't change (it operates on whatever rows the route hands it). The two systems compose cleanly because we kept them orthogonal.
