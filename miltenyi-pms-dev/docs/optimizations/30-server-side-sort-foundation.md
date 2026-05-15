# 30 — Server-side sort foundation: ORDER BY + the tiebreaker that survives

> **PR:** [#47](https://github.com/Healthark/miltenyi-pms/pull/47)
> **Files changed:** `backend/app/api/routes/annual_review_routes.py`, `frontend/src/services/annual-review.service.ts`, `frontend/src/pages/AnnualReviews.tsx`.
> **Headline result:** Conceptual pivot from filter to sort. Introduces `?sort_by=&sort_dir=` on `/annual-reviews/all` with `Literal[...]` validation. The crucial design choice: **the `id.desc()` tiebreaker from doc 22 stays as the final ORDER BY clause under any primary sort** — without it, two rows sharing the same `sort_by` value would swap positions across pages. Frontend deletes the client-side sort entirely; the page now just owns the `(filter, sort)` tuple and lets the server do the work. Bundle: AnnualReviews **42.50 → 42.02 KB raw, 8.57 → 8.55 KB gzip** — code SHRINKS because client-sort machinery goes away.

---

## TL;DR

Filters (docs 26–29) narrow the universe. Sort orders what's left. They compose orthogonally: the page bakes both into the queryKey, the backend applies both to the same SQL query, and the cache distinguishes every distinct `(filter, sort)` combination.

The interesting parts of sort that filter didn't have:

| Concept | Why it matters |
|---|---|
| **Tiebreaker survives the primary swap** | Without `id.desc()` as the final ORDER BY, two rows with the same `sort_by` value can swap positions across pages — the classic OFFSET/LIMIT footgun (doc 22 Part 2). |
| **Joins are needed for sort independent of filter** | Sort by `function` requires joining `Function` even if no `?function=` filter is set. Conditional-join logic widens from `bool(filter)` to `bool(filter) OR sort_by == column`. |
| **`Literal[…]` for safe param validation** | An unknown `sort_by` value would crash the column lookup. FastAPI's `Literal[…]` types auto-422 invalid input before it reaches the route body. |
| **Frontend client-sort can be DELETED** | After server-side sort lands, `compareValues`, `ALL_REVIEWS_SORT_CONFIG`, and the `sorted = sort ? reviews.sort(...) : reviews` ternary all become dead code. The bundle shrinks. |

This PR applies sort to one endpoint (`/annual-reviews/all` — doc 26's foundation endpoint) so the concepts get a focused doc. The remaining four paginated endpoints follow the same pattern in PR #31 (the rollout).

---

## Part 1 — Sort + filter composability

Both flow into the same `requestParams` object that's baked into the queryKey:

```tsx
const requestParams: Record<string, string> = {
  ...filterParams,
  ...(allReviewsSort
    ? { sort_by: allReviewsSort.key, sort_dir: allReviewsSort.direction }
    : {}),
};

useInfiniteQuery({
  queryKey: queryKeys.annualReviews.org(requestParams),
  queryFn: ({ pageParam }) =>
    annualReviewService.getAllReviews({ ...requestParams, limit, offset }),
  // …
});
```

Two consequences:

- **Distinct cache entries per `(filter, sort)` combo.** Filter to status=draft, sort by employee_name asc → one cache entry. Same filter, sort by employee_name desc → a different entry. Switching between them is instant on the second visit (cache hit), no network.
- **Changing sort triggers a fresh first-page fetch.** Same as filter: TanStack Query treats the new key as a new query, fires `?sort_by=…&offset=0`. The Load More button then pages through the *re-sorted* universe.

This is what "composable" means here. The two systems don't know about each other; they just both happen to live in the same `requestParams` bag, and the cache layer + the backend SQL builder both respect that.

---

## Part 2 — The tiebreaker that survives

This is the load-bearing concept of the whole PR. Worth its own section.

### The setup

Doc 22 added `id.desc()` as the final tiebreaker on the default ORDER BY:

```python
.order_by(
    AnnualReview.cycle_name.desc(),
    AnnualReview.created_at.desc(),
    AnnualReview.id.desc(),    # tiebreaker
)
```

Reason: when two rows share the same `(cycle_name, created_at)`, OFFSET/LIMIT could place them on different pages on different requests. The `id.desc()` pins them to a deterministic order.

### What happens when the user picks a sort

The user picks `sort_by=function&sort_dir=asc`. ORDER BY becomes:

```python
.order_by(
    Function.name.asc(),       # primary — what the user picked
    AnnualReview.id.desc(),    # tiebreaker — survives the swap
)
```

The default `(cycle_name DESC, created_at DESC)` is DROPPED because the user wants a different primary order. But the `id.desc()` tiebreaker stays.

### Why the tiebreaker MUST stay

Consider 100 reviews where 60 of them have `Function.name = "Engineering"` (the others vary). User sorts by function ascending. Page 1 (LIMIT 50, OFFSET 0):

Without tiebreaker:
```
1.  Engineering — Alice
2.  Engineering — Bob       ← could also be "Engineering — Carol" depending on plan
3.  Engineering — Carol
...
50. Engineering — Mike
```

Page 2 (LIMIT 50, OFFSET 50):
```
51. Engineering — Nancy
...
60. Engineering — Zach
61. Marketing — Alice
...
```

But on a second request to page 1, Postgres could legitimately return:
```
1.  Engineering — Carol     ← previously row 2
2.  Engineering — Alice     ← previously row 1
3.  Engineering — Bob
```

The user clicks Load More expecting "next 50." Postgres returns OFFSET 50 of *its current ordering* — which might now exclude Alice (who was on page 1 the first time but moved to position 51 in the second ordering). **Alice disappears from the user's view, or worse, appears twice.**

This is what "unstable pagination" looks like. The fix is the `id.desc()` tiebreaker — once we say "Engineering ascending, then id descending," every (function.name, id) pair becomes unique and the order is deterministic.

### Why `id.desc()` and not `id.asc()`

Either works for stability. We pick `desc()` to match doc 22's choice for the default ordering — newer rows first when there's a tie. Internal consistency; no functional difference.

### Why we don't bother adding `created_at.desc()` as the secondary

For the **default** ordering (no sort_by), it's `cycle_name DESC, created_at DESC, id DESC` — three levels. For **user-picked** sort, we collapse to two: `<primary>, id DESC`. The created_at tier is dropped.

Reasoning:
- `id.desc()` alone is enough for stability. `created_at + id` adds nothing pagination-wise.
- Users picking "sort by X" want X to dominate ordering. Inserting `created_at` between X and `id` would surface "rows created today vs yesterday" as a sort axis the user didn't ask for.
- Simpler ORDER BY = simpler query plan.

If a user complains "I sorted by status and the order within a status group looks random," the answer is "it's by ID, which is roughly creation order." Documented behavior.

---

## Part 3 — Conditional joins now consider sort too

Pre-PR, the join logic was filter-driven:

```python
needs_user_join = bool(function_ or designation or employee)
if needs_user_join:
    base_q = base_q.join(User, User.id == AnnualReview.user_id)
    if function_:
        base_q = base_q.join(Function, ...).filter(...)
```

Post-PR, sort can also need the joins:

```python
needs_user_join = bool(function_ or designation or employee) or sort_by in (
    "function", "designation", "employee_name",
)
needs_function_join = bool(function_) or sort_by == "function"
needs_designation_join = bool(designation) or sort_by == "designation"

if needs_user_join:
    base_q = base_q.join(User, User.id == AnnualReview.user_id)
    if employee:
        base_q = base_q.filter(User.full_name == employee)
    if needs_function_join:
        base_q = base_q.join(Function, ...)
        if function_:
            base_q = base_q.filter(Function.name == function_)
    if needs_designation_join:
        base_q = base_q.join(Designation, ...)
        if designation:
            base_q = base_q.filter(Designation.name == designation)
```

Two principles:

1. **A join is added if EITHER filter or sort needs the table** — the union of needs.
2. **Filters add WHERE clauses inside the join block** but the join itself happens regardless. Pre-PR, `if function_:` did both the join AND the filter in one line; post-PR they're separated because the join might fire without the filter (sort-only case).

Subtle but important: a request like `?sort_by=function` (no filters) now joins `User` and `Function` to enable the `ORDER BY Function.name`. Without the join, the column reference would fail at SQL compile time.

---

## Part 4 — `Literal[…]` for input validation

Sort columns map to specific SQL columns. If the client sends `sort_by=evil_string`, the route would crash trying to look it up in `_ALL_REVIEWS_SORT_COLUMNS`. FastAPI's `Literal[...]` type prevents this entirely:

```python
sort_by: Optional[
    Literal[
        "employee_name", "function", "designation",
        "cycle_name", "status",
        "self_performance_rating", "mentor_performance_rating",
        "final_performance_rating",
    ]
] = Query(None, …)

sort_dir: Literal["asc", "desc"] = Query("asc", …)
```

FastAPI validates the incoming string against the literal set before the route body runs. Unknown values → 422 Unprocessable Entity with a clean error message, never a 500.

Trade-off: the literal list mirrors the `_ALL_REVIEWS_SORT_COLUMNS` map. If we add a new sortable column, BOTH have to be updated. Cost is "remember to update two places"; benefit is "the route is immune to junk input."

An alternative would be `sort_by: str` + a runtime check inside the route. Same end result, more lines, less clear intent. Pydantic-style validation via type annotations is the FastAPI idiom; we use it.

---

## Part 5 — Frontend: client-sort dies

This is the satisfying part. Before:

```tsx
// AnnualReviews.tsx, at module level
const ALL_REVIEWS_SORT_CONFIG: Record<AllReviewsSortKey, {
  kind: SortKind;
  get: (r: AnnualReview) => SortValue;
}> = {
  employee_name:             { kind: "alpha",   get: (r) => r.employee_name ?? `User #${r.user_id}` },
  function:                  { kind: "alpha",   get: (r) => r.function },
  // …
};

// inside AllReviewsTab
const sorted = sort
  ? reviews.slice().sort((a, b) => {
      const { kind, get } = ALL_REVIEWS_SORT_CONFIG[sort.key];
      return compareValues(get(a), get(b), kind, sort.direction);
    })
  : reviews;
```

After:

```tsx
// at the page level
const [allReviewsSort, setAllReviewsSort] = useState<
  SortState<AllReviewsSortKey> | null
>(null);
// …flows into requestParams + queryKey

// inside AllReviewsTab
const sorted = reviews;
```

The SORT_CONFIG record disappears. `compareValues` import disappears. `SortKind` and `SortValue` imports disappear. `sorted` becomes a one-line alias to `reviews` (kept just so the downstream variable name reads naturally).

**The bundle gets smaller.** AnnualReviews dropped from 42.50 KB raw / 8.57 KB gzip to **42.02 KB raw / 8.55 KB gzip** — about half a KB raw. Not headline-grabbing, but it's the right shape: server-side sort isn't just faster, it's *less code*.

This is a recurring theme across the optimization arc: a lot of "performance" wins are actually "delete the workaround." Virtualization deleted the "render 1000 DOM nodes" approach. Pagination deleted the "fetch everything and show 50" approach. Server-side filter deleted the "load everything and filter in JS" approach. Server-side sort deletes the "load everything and sort in JS" approach.

---

## Part 6 — `<SortableHeader>` keeps its contract

The good news: existing UI code doesn't change. `<SortableHeader>` receives `sort` + `onSort` props the same way it always has. Only the *binding* changed — `sort` and `onSort` are now passed in as props instead of from `useState` calls inside `AllReviewsTab`.

```tsx
// Before:
<SortableHeader label="Employee" columnKey="employee_name" sort={sort} onSort={setSort} />

// After (only the prop wire changes; SortableHeader's API is identical):
<SortableHeader label="Employee" columnKey="employee_name" sort={sort} onSort={onSortChange} />
```

User experience is identical — click column header to sort asc, click again to flip to desc, click again to clear. The difference is invisible to the user but the work moves from JS (client-sort) to SQL (ORDER BY).

---

## Part 7 — What this PR does NOT solve

- **Other endpoints.** `/goals/all`, `/project-reviews/all`, `/annual-reviews/calibration`, `/annual-reviews/mentees` all still sort client-side. PR #31 rolls out the same template to all four. By that point the doc is short — the heavy concept-doc is THIS PR.
- **Sort by joined-table columns that don't exist as columns.** All sortable columns here are direct DB columns. Sort by a computed property (e.g. "loaded user activity score") would need either a stored column or a `case when …` expression in ORDER BY. Not in scope.
- **Multi-column sort.** Sort by `function ASC, then employee_name ASC` (two simultaneous primary sorts) isn't supported — the user picks one. Multi-column would require an array `sort_by[]` param + tuple state on the frontend. Possible follow-up if HR ever asks for it.
- **Server-side sort preservation across filter changes.** Currently changing filter resets to first page (correct) but keeps sort (also correct — user expectation). The opposite (changing sort resets sort to default) isn't a thing because the user IS the one picking the sort.

---

## Trade-offs

- **Adding a new sortable column means TWO edits** (frontend `AllReviewsSortKey`, backend `_ALL_REVIEWS_SORT_COLUMNS` + the `Literal[...]` list). Lock-step is the cost of strong typing on both ends. Mitigation: a sync test in PR #31's doc when we have more dimensions to compare.
- **`id.desc()` tiebreaker means rows within a sort group appear in creation order, not by the picked-primary's "tie semantics."** Documented in Part 2. Users who expect "tie = identical, indistinguishable" might not notice the secondary ordering, which is fine.
- **Cache memory grows with `filter × sort` combos.** Same trade-off as filters alone (doc 26 Part 2). Bounded by TanStack Query's `gcTime`; acceptable in practice.
- **Faceted dropdowns + server-side sort interaction.** Faceted-style dropdown options derive from loaded rows (doc 26 Part 4). When sort changes, dropdown options re-derive from the same loaded universe; nothing breaks but the dropdowns CAN re-order when sort changes.

---

## Verification

```bash
cd frontend
npm run build
```

Expected:
- `dist/assets/AnnualReviews-*.js` **42.02 KB raw / 8.55 KB gzip** (vs 42.50 / 8.57 baseline — SHRINKS slightly).
- Backend: `cd backend && python -c "from app.api.routes import annual_review_routes; print('OK')"` succeeds.

End-to-end:
- As HR_MyOrg, open `/annual-reviews` → "All Reviews" tab → DevTools Network: first request is `GET /annual-reviews/all?limit=50&offset=0` (no sort params).
- Click the "Employee" column header → next request adds `sort_by=employee_name&sort_dir=asc`. Page 1 returns rows alphabetically by employee name.
- Click "Employee" again → request flips to `sort_dir=desc`. Order reverses.
- Click "Function" → request shifts to `sort_by=function&sort_dir=asc`. Notice that `Function` is now joined in the SQL even though no `?function=` filter is set.
- Apply Status filter on top of sort → next request has BOTH `status=...` and `sort_by=...&sort_dir=...`. AND semantics; sort and filter compose.
- Load More with active sort → next page fetches `?...&offset=50`. Rows continue in the same sort order, no duplicates (the `id.desc()` tiebreaker is doing its job).
- Cache HIT check: sort by A → sort by B → sort by A → React Query DevTools shows cache hit on the third visit.
- Bad input check: open DevTools console, run `fetch("/api/v1/annual-reviews/all?sort_by=evil")` → expect HTTP 422 with FastAPI validation error.
- As Staff or Mentor → no `/annual-reviews/all` requests (role gated).

---

## What the next PR teaches

**PR #31 (sort rollout)** applies the same template to the remaining four paginated endpoints:

- `/goals/all` (list-of-parents; sort applies to the user list, since users are the parent)
- `/project-reviews/all` (flat, similar to here)
- `/annual-reviews/calibration` (degenerate list-of-parents; sort applies to users)
- `/annual-reviews/mentees` (flat, smallest)

By that PR the template is rote. Doc 31 will be short — just the per-endpoint sort dimensions + any per-endpoint quirks. Expected to be the final doc in theme 5.
