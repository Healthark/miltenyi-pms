# 25 — Joinedload polish: collapse N lazy loads on `secondary_evaluations`

> **PR:** _pending_
> **Files changed:** `backend/app/api/routes/project_review_routes.py`.
> **Headline result:** Closes the doc-24 sub-arc. The prefetch helper from PR #41 collapsed `5N` per-row entity queries into 2 batched ones, but **still triggered N lazy loads** when iterating each review's `secondary_evaluations` relationship to collect evaluator ids. One `.options(joinedload(ProjectReview.secondary_evaluations))` per batch route folds those into the parent SELECT via a LEFT JOIN. At `limit=50`, query count drops from **~52 to ~5** — a true constant regardless of page size.

---

## TL;DR

Doc 24 traded **5N main-entity queries** for **2 batched queries + N lazy-load fan-outs on `secondary_evaluations`**. The lazy loads remained because:
- They're a property of the SQLAlchemy relationship (`relationship(..., lazy="select")` by default).
- The prefetch helper iterates them by necessity (to collect `evaluator_id`).
- Each iteration triggers one SELECT against `project_review_evaluators WHERE project_review_id = ?`.

For 50 reviews that's 50 round-trips on top of the 2 batched main-entity queries, plus the page-fetch SELECT, COUNT, and settings — a total of ~52.

The fix is one line per batch route:

```python
.options(joinedload(ProjectReview.secondary_evaluations))
```

SQLAlchemy turns the parent SELECT into a LEFT JOIN over `project_review_evaluators`, returning all the related rows in the same query. The collection is pre-populated on each ProjectReview before the prefetch helper sees it, so subsequent iterations are pure Python.

Three routes (`/all`, `/mentees`, `/secondary-queue`) get the same one-liner. The doc is short — but the **placement** decision is worth a section: on `/all`, the `base_q` is shared between the windowed fetch and the COUNT query, so the joinedload only belongs on the windowed-fetch chain.

---

## Part 1 — The remaining N+1 after PR #41

Doc 24 showed why the per-row main-entity queries were N+1. What it left behind:

```python
# Inside _prefetch_review_dependencies:
for r in reviews_list:
    if r.user_id is not None:
        user_ids.add(r.user_id)
    if r.reviewer_id is not None:
        user_ids.add(r.reviewer_id)
    for ev in r.secondary_evaluations:    # ← lazy load fires here, once per review
        if ev.evaluator_id is not None:
            user_ids.add(ev.evaluator_id)
```

The `r.secondary_evaluations` access triggers SQLAlchemy's default lazy load. For 50 reviews that's 50 SELECTs against `project_review_evaluators`. The collection IS then cached on the instance, so `_build_review_response`'s later iteration doesn't re-query — but the damage was done in the helper.

This was deliberately deferred in doc 24 Part 4 because:
- The fix is a one-line change per route handler (not the helper).
- Touching three routes again in the same PR muddies the scope.
- It was a known polish, not a structural issue.

PR #25 is that one-line change × 3.

---

## Part 2 — The fix: `joinedload(ProjectReview.secondary_evaluations)`

For `/mentees` and `/secondary-queue`, the change is mechanical — add `.options(joinedload(...))` to the existing chain:

```python
reviews = (
    db.query(ProjectReview)
    .options(joinedload(ProjectReview.secondary_evaluations))   # ← new
    .filter(...)
    .order_by(...)
    .all()
)
```

SQLAlchemy emits a SQL statement like:

```sql
SELECT project_reviews.*, project_review_evaluators.*
FROM project_reviews
LEFT OUTER JOIN project_review_evaluators
  ON project_review_evaluators.project_review_id = project_reviews.id
WHERE …
ORDER BY …
```

Every parent + its evaluators come back in one round-trip. The ORM splits them back into objects + populated collections in Python. The next time the helper accesses `r.secondary_evaluations`, the collection is already loaded — no SELECT.

### A note on `joinedload` vs `selectinload`

SQLAlchemy offers two eager-load strategies:

| Strategy | What it emits | When to use |
|---|---|---|
| `joinedload` | One SQL with a LEFT JOIN | One-to-many or many-to-one. Best when the child set is small per parent. |
| `selectinload` | Two SQL: one for parents, one `WHERE child_id IN (...)` | Many-to-many or when JOIN multiplies rows badly. |

For `secondary_evaluations`, each ProjectReview has 0-3 evaluators in practice. The LEFT JOIN duplicates parent rows by evaluator count — for a review with 3 evaluators, you get 3 row copies, which SQLAlchemy collapses back to one instance. Mild row-duplication cost; cheap because the small parent column set repeats.

`selectinload` would issue two SELECTs (one for parents, one for evaluators with a parent-id `IN` list) and avoid the duplication. For our scale, the difference is invisible. We pick `joinedload` because:
- The duplication is bounded (≤ 3× per row in the worst case).
- One round-trip beats two on round-trip-latency-bound queries.
- It's what the codebase already uses for similar patterns (`joinedload(User.function)` etc).

If we ever see `secondary_evaluations` grow to dozens per review (which the data model doesn't really support), revisit. Until then, `joinedload` is the right default.

---

## Part 3 — The placement decision for `/all`

`/all` is different because it has a shared `base_q`:

```python
base_q = db.query(ProjectReview).filter(...)   # filter shared by both queries below

total = base_q.with_entities(ProjectReview.id).count()   # path A: COUNT

reviews = (                                              # path B: windowed fetch
    base_q
    .order_by(...).offset(...).limit(...)
    .all()
)
```

Where does the joinedload go?

| Placement | Effect |
|---|---|
| **On `base_q` itself** | The joinedload travels into BOTH paths. The COUNT path (path A) doesn't need the joined data — it's projecting to just `ProjectReview.id`, so SQLAlchemy is smart enough to skip the JOIN at the planner level. But intent-wise, the option is in the wrong place: it says "I always want these rows joined" even though COUNT doesn't. |
| **On the windowed-fetch chain only** (what we shipped) | The COUNT runs over a clean base_q; the windowed fetch runs with the JOIN. Each query expresses exactly what it needs. |

The shipped code:

```python
reviews = (
    base_q
    .options(joinedload(ProjectReview.secondary_evaluations))
    .order_by(...)
    .offset(offset)
    .limit(limit)
    .all()
)
```

The diff is identical in size either way. The choice is about **expressing intent in the code**, not about performance. Future-me (or another contributor) reading the route should not have to mentally re-derive "wait, does the COUNT actually run a LEFT JOIN?" — putting the option only on the fetch chain makes the answer obvious from the indentation.

This is the general lesson: **when a SQLAlchemy `Query` is reused for two purposes, put per-purpose options on the per-purpose chain, not on the shared base**. Especially true with `.options(joinedload(...))`, which carries semantic intent.

---

## Part 4 — What this PR does NOT solve

- **Test coverage for the query-count claim.** Still no test framework. Same recipe as doc 24 Verification — SQL echo or one-shot event listener.
- **Other N+1 hot spots.** `_build_review_response` is the worst offender in the codebase but probably not the only one. A future audit pass would find more; not in this PR.
- **`evaluator_id` lookups inside `_prefetch_review_dependencies`** still fire — but they're folded into the same `users_by_id` batched fetch that doc 24 introduced, so they're not N+1.

---

## Trade-offs

- **Row duplication via LEFT JOIN.** Bounded by `secondary_evaluations` count per review (typically 0-3). Acceptable.
- **One more thing to know about each batch route.** A new contributor reading any of these routes has to understand `joinedload(...)`. Documented in code comments + cross-referenced to this doc.
- **`selectinload` left on the table.** If profiling later shows JOIN duplication is the bottleneck, swap is one keyword. No structural commitment.

---

## Verification

```bash
cd backend
# Same SQL-echo recipe as doc 24 Part Verification.
```

Expected after this PR for `GET /project-reviews/all?limit=50&offset=0`:
1. `SELECT COUNT(*) FROM project_reviews WHERE …` (the COUNT path — no JOIN).
2. `SELECT project_reviews.*, project_review_evaluators.* FROM project_reviews LEFT OUTER JOIN project_review_evaluators ON … WHERE …` (the windowed fetch with eager load).
3. `SELECT * FROM system_settings WHERE org_id = ?` (settings fetch from `_get_settings_row`).
4. `SELECT * FROM projects WHERE id IN (…)` (batched projects from `_prefetch_review_dependencies`).
5. `SELECT * FROM users WHERE id IN (…)` (batched users from `_prefetch_review_dependencies`).

**5 SELECTs total**, regardless of how many rows the page contains.

Pre-PR (post-doc-24): ~52 SELECTs at `limit=50`.
Pre-PR (pre-doc-24): ~250 SELECTs at `limit=50`.

End-to-end:
- As HR_MyOrg, hit `/project-reviews/all` → response is identical to pre-PR (same `Paginated[ProjectReviewResponse]` shape, same secondary-evaluation arrays per review).
- As Mentor, hit `/project-reviews/mentees` → same.
- As anyone with secondary-evaluator assignments, hit `/project-reviews/secondary-queue` → same.

---

## What the next PR teaches

The doc-24 sub-arc closes here. The natural next themes:

- **Theme #5 — server-side filter/sort.** The conceptually richest remaining theme. The page-fetch query grows `?cycle=&function=&status=` params; the prefetch helper composes cleanly because it operates on whatever rows the route hands it. The Load More button's semantics shift: it pages through the **filtered** universe, not the entire one.
- **Test framework setup.** Pytest + conftest + `query_counter` fixture. Makes every future optimization PR's claim verifiable.
- **An N+1 audit pass elsewhere.** `goal_routes.py`'s patterns are already mostly batched; `annual_review_routes.py` has partial batching. A targeted look might find one or two more spots.
