# 19 — Pagination foundation: backend `?limit/offset` + frontend `useInfiniteQuery`

> **PR:** [#36](https://github.com/Healthark/miltenyi-pms/pull/36)
> **Files changed:** `backend/app/schemas/pagination.py` (new), `backend/app/api/routes/annual_review_routes.py`, `frontend/src/services/annual-review.service.ts`, `frontend/src/pages/AnnualReviews.tsx`.
> **Headline result:** First backend change in the optimization series. `GET /annual-reviews/all` now accepts `?limit/offset` and returns `Paginated[AnnualReviewResponse]`. Frontend swaps `useQuery` → `useInfiniteQuery` with a "Load more" button. At HR scale (1000+ reviews) the payload goes from "all rows on every page-mount" to "50 per fetch, on demand."

---

## TL;DR

A new shape of problem from everything before. Themes #02–#18 were **frontend-only**: the backend served what it served, and we reshaped the frontend around it. Themes from here on touch **both sides** because the goal shifts from "render less of what we have" to "fetch less in the first place."

This PR establishes the pattern with one endpoint as the teaching example. The next PRs apply the template to the other HR-scale endpoints (`getAllGoals`, `getCalibrationGrid`, etc.).

**The full picture, when this PR lands:**

Before:
```
HR opens /annual-reviews → backend: SELECT * FROM annual_reviews WHERE org_id=? → 5000 rows
                        → 2 MB JSON payload → frontend renders ~20 virtualized rows
                        → 4980 rows wasted: fetched, parsed, held in memory, never displayed
```

After:
```
HR opens /annual-reviews → backend: SELECT * FROM annual_reviews WHERE org_id=? LIMIT 50 OFFSET 0
                        → 20 KB JSON payload → frontend renders ~15 virtualized rows from 50 loaded
HR clicks "Load more"   → backend: ... LIMIT 50 OFFSET 50
                        → another 20 KB → frontend now has 100 loaded, still renders ~15 in the window
```

**Network payload, DB load, and memory all scale with what the user actually requests** — not with the org's total review count.

---

## Part 1 — Why pagination is "a different shape of problem"

The cache rollout (#02–#14) and the virtualization arc (#15–#18) were both frontend-only because they fixed bugs in how the frontend HANDLED responses. The data shape on the wire was unchanged.

Pagination is different because it changes WHAT THE BACKEND SENDS:

| Layer | Cache rollout | Virtualization | Pagination |
|---|---|---|---|
| **Backend** | Untouched | Untouched | **New route shape** |
| **Schemas** | Untouched | Untouched | **New `Paginated[T]`** |
| **Frontend service** | Untouched (refactored only) | Untouched | **New signature + return type** |
| **React hook** | `useQuery`/`useMutation` | `useQuery` | **`useInfiniteQuery`** |
| **UI** | Untouched | Replaced table with div-grid | **Adds Load More button** |

Both halves of the change must ship together. A backend with pagination + a frontend that doesn't understand the new response shape = broken UI. A frontend that sends `?limit/offset` to an endpoint that ignores them = looks like it works locally but doesn't actually paginate.

So the PR's natural unit is **end-to-end on one endpoint**. The doc has to teach both sides.

---

## Part 2 — Backend: `Paginated[T]` generic + `?limit/offset`

### The new schema

```python
# backend/app/schemas/pagination.py
from typing import Generic, List, TypeVar
from pydantic import BaseModel, ConfigDict

T = TypeVar("T")

class Paginated(BaseModel, Generic[T]):
    model_config = ConfigDict(from_attributes=True)
    items: List[T]
    total: int
    limit: int
    offset: int
    has_more: bool
```

A Pydantic v2 generic. Each consuming route specializes it: `Paginated[AnnualReviewResponse]`, `Paginated[CalibrationRow]`, etc. The five fields are the convention every paginated endpoint follows:

- `items` — the page's rows
- `total` — count of rows matching the underlying query (NOT just this page)
- `limit` — page size the server honoured
- `offset` — rows skipped before this page
- `has_more` — convenience flag, saves callers an arithmetic check

`has_more` is technically redundant (the frontend could compute `offset + items.length < total` itself), but serializing it makes the contract explicit and saves every consumer from getting the math wrong.

### The route

```python
@router.get("/all", response_model=Paginated[AnnualReviewResponse])
def get_all_annual_reviews(
    db: DbSession,
    current_user: CurrentUser,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    _require_hr_myorg(current_user)

    # Shared filter chain — used for both the count() and the windowed
    # fetch so the totals match exactly what the windowed rows are
    # drawn from.
    base_q = db.query(AnnualReview).filter(
        AnnualReview.org_id == current_user.org_id
    )

    total = base_q.count()
    reviews = (
        base_q.order_by(...).offset(offset).limit(limit).all()
    )

    # ... existing name resolution + post-processing ...

    return Paginated[AnnualReviewResponse](
        items=reviews,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + len(reviews)) < total,
    )
```

Three implementation details worth pausing on:

**1. Server clamps `limit` to a max of 200.** A client requesting `?limit=10000` gets `422` (Query validation rejects it). This bounds DB work + payload size even when callers misbehave.

**2. The base query is built ONCE and reused** for both `.count()` and `.offset().limit().all()`. SQLAlchemy's lazy-query model means we're not running two filter chains — we're attaching two terminal operations to the same filtered base. The count gets its own SQL (`SELECT COUNT(*)`), the fetch gets a windowed `SELECT *`.

**3. The post-processing (name resolution, employee_meta, fallback final ratings) runs on the PAGE only.** Pre-pagination, this loop walked all 5000 reviews on every call. Post-pagination, it walks at most 200. The N+1 prevention in `joinedload` matters even more now because each page must be self-contained — no inter-page caching of user names.

### Why offset/limit and not cursor-based

The two main pagination paradigms:

| Approach | Mechanism | Robust against insertions? | Complexity |
|---|---|---|---|
| **Offset/limit** | `?limit=50&offset=100` → skip 100, take 50 | ❌ A row inserted between pages can cause skip/duplicate | Trivial |
| **Cursor-based** | `?cursor=abc&limit=50` → continue from this opaque token | ✅ Server tracks "where we left off" with a stable key (typically a timestamp or PK) | Moderate |

Cursor-based is more correct for high-churn data (think Twitter feed: new posts arrive between paging requests, and we don't want to skip or repeat). Offset is fine for low-churn data.

For HR's annual reviews:
- Reviews are added once per cycle, at low velocity
- Within a calibration window (the typical session), the dataset is effectively frozen
- An HR user paging through their org's reviews doesn't expect to see real-time inserts

Offset wins on simplicity. If a future page or scenario has high-churn paging (e.g., a live notification feed), revisit with cursor-based.

**Documented for honesty:** if HR is mid-paging and a new review is created between fetches, the new review could either be missed (if it lands above the current page's offset) or appear twice (if it lands within an already-fetched range and then shifts during a subsequent fetch). For our use case this is acceptable.

---

## Part 3 — Frontend: `useInfiniteQuery`

`useQuery` returns one cache entry per `queryKey`. `useInfiniteQuery` returns a multi-page cache entry: `{ pages: T[], pageParams: P[] }`. Same key, multiple sequential pages.

```tsx
const PAGE_SIZE = 50;
const allReviewsQuery = useInfiniteQuery({
  queryKey: queryKeys.annualReviews.org(),
  queryFn: ({ pageParam }) =>
    annualReviewService.getAllReviews({
      limit: PAGE_SIZE,
      offset: pageParam,
    }),
  initialPageParam: 0,
  getNextPageParam: (lastPage) =>
    lastPage.has_more ? lastPage.offset + lastPage.limit : undefined,
  enabled: isHRMyOrg,
});
```

Three parameters worth understanding:

### `queryFn: ({ pageParam }) => ...`

Unlike `useQuery`, the query function receives an object with `pageParam` — the cursor for THIS page. On the first call it's `initialPageParam`; on subsequent calls it's whatever `getNextPageParam` returned.

We translate `pageParam` (a number, the offset) into the service call's `offset` argument.

### `initialPageParam: 0`

The first page's `pageParam`. For offset-based pagination this is the starting row offset (0 = "from the beginning"). For cursor-based it would be `null` or an empty string ("no cursor yet, give me the first page").

### `getNextPageParam: (lastPage, allPages) => ...`

Computes the cursor for the NEXT page from the most recently fetched page. Return `undefined` to signal "no more pages."

Our implementation:
- If `lastPage.has_more === true`, return `lastPage.offset + lastPage.limit` (the next offset)
- Otherwise return `undefined`

The server's `has_more` flag drives the frontend's "is there more to load?" decision. Single source of truth.

### Reading the data

The hook's return shape:
```ts
{
  data: {
    pages: PaginatedAnnualReviews[],   // array of page responses
    pageParams: number[],               // matching array of offsets
  } | undefined,
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
  fetchNextPage: () => Promise<...>,
  isPending: boolean,                   // first fetch only
  // ... plus all the standard useQuery fields
}
```

For consumers that want "one flat list," flatten the pages:
```ts
const allReviews = allReviewsQuery.data?.pages.flatMap((p) => p.items) ?? [];
```

`flatMap((p) => p.items)` produces a single concatenated array. The virtualizer (PR #16's `useVirtualizer`) doesn't care about pagination — it sees one list of length N, where N grows as pages load.

### The `total` field

The most recent page's `total` is the canonical count:
```ts
const allReviewsTotal =
  allReviewsQuery.data?.pages[allReviewsQuery.data.pages.length - 1]?.total ?? 0;
```

Why the LAST page? Because if rows were inserted between fetches (low-churn but possible), `total` on the latest page is most accurate. For our use case all pages return the same `total` (the dataset is frozen for the session), but the last-page-wins pattern is safest.

---

## Part 4 — UI: Load More button

The choice of UX pattern is independent of the cache mechanics:

| UX | Mechanism | Tradeoff |
|---|---|---|
| **Load More button** | Explicit click → `fetchNextPage()` | Predictable, discoverable, accessible |
| **Infinite scroll** | Intersection observer on sentinel row → auto-fetch | Smooth UX but harder to test, requires bottom-of-list signal |
| **Both** | Auto-fetch on scroll-near-end PLUS a Load More button for keyboard/AT users | Best of both at modest complexity cost |

We picked Load More for this PR. Reasons:
- Simpler — no intersection observer to wire
- Discoverable — HR sees the button and the counter ("Loaded 50 of 1234") without scrolling
- Accessible — keyboard users get a Tab-able control
- Easier to test manually

The button sits **below** the virtualized scroll container (not inside as the last virtual row) so HR can click it without scrolling to the bottom of the 600px window:

```tsx
{hasNextPage && (
  <div className="flex items-center gap-3 justify-center">
    <button
      type="button"
      onClick={onLoadMore}
      disabled={isFetchingNextPage}
    >
      {isFetchingNextPage ? "Loading…" : "Load more"}
    </button>
    <span className="text-xs text-text-muted">
      Loaded {reviews.length} of {total}
    </span>
  </div>
)}
```

When the user clicks Load More:
1. `fetchNextPage()` fires → backend GET with the next offset
2. `isFetchingNextPage` flips true → button label shows "Loading…"
3. Server returns the next page → cache updates → `data.pages` grows by one entry
4. Component re-renders → `allReviews` now contains 100 items (was 50)
5. Virtualizer recomputes total height → list grows by ~50 × 48px = ~2400px of virtual content
6. `isFetchingNextPage` flips back to false → button label reverts to "Load more"
7. If `has_more` is now false (we just loaded the final page), the whole Load More block hides

No scroll jump, no list flash. The new rows simply extend the existing virtualized list.

---

## Part 5 — What stays client-side (for now)

The current implementation **filters and sorts on the frontend**, over the loaded pages only. This means:

- A filter like "function = Engineering" only matches reviews already loaded. If matching rows exist in unloaded pages, the user sees fewer results than they should.
- The filter narrows the visible set on display; loading more pages may surface additional matches.
- The "Showing N of T" counter says `N = filtered.length` and `T = total` — accurate, but the gap can mislead if matches are scattered across pages.

This is **honest pagination but partial filtering**. The follow-up PR will move filtering to the server (`?function=Engineering&status=completed&...`), making the filter set authoritative regardless of what's loaded.

**Why defer:** server-side filtering requires backend changes to translate query params into SQL filter clauses AND debouncing the search inputs on the frontend (so each keystroke doesn't fire a round-trip). Mixing that into this PR would obscure the pagination-foundation lesson. Better to ship pagination first, then layer filtering on top.

For the dev environment with small data, the current behaviour is fine. For production at scale, server-side filtering is the next PR.

---

## Part 6 — Cache invalidation across pages

A subtle point worth understanding: `useInfiniteQuery` stores all loaded pages under ONE cache key. When something invalidates that key (e.g., a mutation `onSuccess` that calls `queryClient.invalidateQueries({ queryKey: queryKeys.annualReviews.org() })`), **all loaded pages refetch from offset 0 to offset N**.

This is correct behaviour:
- The dataset may have changed
- Re-fetching from offset 0 ensures consistency (no duplicate or skipped rows due to inserts)
- The user's loaded-pages-count is preserved (if they had 3 pages loaded, they'll have 3 pages after refetch)

The cost: N round-trips after each invalidation instead of one. For our HR-only paginated endpoint with low write volume this is fine. If we ever paginated a hot-write list (e.g., a notification feed with frequent inserts), we'd revisit — possibly using `setQueryData` with surgical page updates instead of full invalidation.

For now: the mutations that affect annual reviews (mentor evaluation submits, etc.) invalidate `queryKeys.annualReviews.all` as broadcast. After this PR, those invalidations correctly refetch all loaded pages of the All Reviews list.

---

## Part 7 — Final scorecard

### Files changed
| File | What |
|---|---|
| `backend/app/schemas/pagination.py` | **NEW.** Generic `Paginated[T]` wrapper. |
| `backend/app/api/routes/annual_review_routes.py` | `GET /all` accepts `?limit/offset`, returns paginated shape. Same post-processing logic on the page's rows. |
| `frontend/src/services/annual-review.service.ts` | `getAllReviews` takes optional `{limit, offset}`, returns `PaginatedAnnualReviews`. New `Paginated<T>` type. |
| `frontend/src/pages/AnnualReviews.tsx` | `useQuery` → `useInfiniteQuery` for the All Reviews tab. AllReviewsTab gains four new props (`total`, `hasNextPage`, `isFetchingNextPage`, `onLoadMore`). Load More button below the virtualized list. |

### Bundle impact
| Chunk | Before | After | Δ |
|---|---|---|---|
| `query-vendor` | 16.44 KB gzip | **16.71 KB** | +0.27 KB (useInfiniteQuery internals) |
| `AnnualReviews` | 8.05 KB | **8.31 KB** | +0.26 KB (useInfiniteQuery wiring + Load More UI) |
| All other chunks | — | — | unchanged |

### Capability gains
- ✅ Backend payload bounded — 50 rows per fetch max (or up to 200 if a future caller requests it), regardless of org size
- ✅ Initial page-load is constant — fetching 50 rows takes the same time whether the org has 200 or 5000 reviews
- ✅ HR can stop loading at any point — sessions where they only need recent reviews don't pull historical ones
- ✅ DB load drops proportionally — `SELECT ... LIMIT 50 OFFSET 0` returns fast even on a huge table
- ✅ Cache invalidation behaviour preserved — mutations still refresh all loaded pages
- ✅ Existing virtualization (PR #16) keeps working — paginated rows flow into the same `useVirtualizer` setup

### What's NOT solved yet
| Problem | This PR | Next PR |
|---|---|---|
| Network payload at HR scale | ✅ Fixed — page size cap | — |
| Backend DB load at HR scale | ✅ Fixed — LIMIT/OFFSET | — |
| **Filter accuracy across unloaded pages** | ❌ Client-side filter sees only loaded rows | Server-side filtering |
| **Sort accuracy across unloaded pages** | ❌ Client-side sort sees only loaded rows | Server-side sort (paired with filter) |
| **Search across unloaded rows** | ❌ Search input doesn't exist here, but pattern applies | Debounced search → server param |

---

## Part 8 — Trade-offs we deliberately made

### Why establish the pattern with one endpoint first

We could have paginated all four HR-scale endpoints (annual reviews, annual goals, calibration grid, mentee reviews) in one PR. We didn't because:

1. **The pattern is novel.** First time touching the backend. First Pydantic generic. First `useInfiniteQuery`. First Load More UX. The doc would have to teach all of that AND apply it 4×. Too much surface area.
2. **Each endpoint has its own gotchas.** Calibration grid has mutations (rating publish) that mid-PR could affect; annual goals has nested user grouping; mentee reviews has different access control. One at a time means each lesson is focused.
3. **Risk isolation.** A bug in pagination shape on one endpoint is bounded to that endpoint's consumers.

PR #19 establishes the template. PRs #20-22 apply it to the other endpoints. Same discipline as the cache rollout (foundation + per-page migrations).

### Why offset/limit and not cursor

Covered in Part 2. Short version: low-churn data + simpler implementation + acceptable insertion behaviour for our use case = offset wins. Cursor stays in reserve for if/when we paginate something high-churn.

### Why Load More button and not auto-scroll

Covered in Part 4. Short version: explicit click is discoverable, accessible, and testable. Auto-scroll is a UX improvement we can layer on top later (intersection observer on a sentinel row, calling `fetchNextPage()` when it enters the viewport). The Load More button can stay as a backup for keyboard/AT users.

### Why client-side filtering stays for now

Covered in Part 5. Short version: server-side filtering is a real refactor (backend + frontend debouncing) and deserves its own PR + doc. Mixing it with pagination would muddy both lessons.

### Why we kept the existing `queryKeys.annualReviews.org()` key

`useInfiniteQuery` works with the same `queryKey` API as `useQuery`. Reusing the existing factory entry means:
- Any code that invalidates `queryKeys.annualReviews.org()` works unchanged
- Broadcast invalidation via `queryKeys.annualReviews.all` still catches it
- No factory churn

The cache structure under the hood is different (it's now a multi-page cache entry vs a single-value entry), but the KEY is the same. Cache layers above don't care about the structural change.

---

## Part 9 — What you should now know cold

1. **The pagination convention** for this codebase: `?limit&offset`, response `{items, total, limit, offset, has_more}`. Generic `Paginated[T]` on the backend, `Paginated<T>` on the frontend.
2. **`useInfiniteQuery`'s shape:** `queryFn` gets `{pageParam}`, `getNextPageParam` derives the next cursor, `data.pages.flatMap(...)` flattens, `hasNextPage` + `isFetchingNextPage` + `fetchNextPage()` drive the UI.
3. **Backend pattern:** build the filtered base query once, reuse it for `.count()` AND the windowed `.offset().limit().all()`. Same conditions, same total.
4. **What pagination doesn't solve:** filtering and sorting across unloaded pages. Both move server-side in the next PR.
5. **Cache invalidation across pages** refetches every loaded page from offset 0. Costs N round-trips per invalidation; acceptable for low-write endpoints.
6. **`has_more` from the server** drives `getNextPageParam`'s "return undefined to stop." Server is the single source of truth for "is there more?"

---

## Part 10 — Verify it works

```bash
# Backend
cd backend
# (the server should already be running; otherwise: `python -m uvicorn app.main:app --reload`)

# Frontend
cd frontend
npm run build       # passes? good
npm run dev
```

Manual verification:

1. **Backend route check (curl or Postman):**
   ```bash
   curl -H "Cookie: <session>" "http://localhost:8000/api/v1/annual-reviews/all?limit=10&offset=0"
   ```
   Expect a JSON object with `items` (array of 10), `total`, `limit: 10`, `offset: 0`, `has_more`.
2. **`?limit=300` (over max)** → expect HTTP 422 from FastAPI's Query validation.
3. **`?limit=10&offset=5`** → items skip the first 5 and return the next 10.
4. **As HR_MyOrg** in the app: open `/annual-reviews` → "All Reviews" tab. The list loads with up to 50 reviews. Open Network DevTools: see one request to `/annual-reviews/all?limit=50&offset=0`.
5. **Click "Load more"** (visible if total > 50). Network shows a new request with `offset=50`. The list grows by 50.
6. **Filter to narrow** the visible set. The "Showing N of T" counter updates. The filter applies to LOADED rows — if you have 100 loaded out of 5000 total, filtering "function = Engineering" only matches Engineering rows in those 100.
7. **Scroll the virtualized list** — virtualization still works. ~15-22 DOM rows at any time, regardless of how many pages have loaded.
8. **Reach the last page** — Load More disappears, "Loaded N of T" counter shows the final number.
9. **DevTools TanStack Query panel** (bottom-left in dev) — find the `["annual-reviews", "org"]` query. Inspect its data: it's a `{pages, pageParams}` shape now, not a flat array.

---

## Part 11 — What's next

The pagination foundation arc continues:

- **#20** Apply pagination to `GET /annual-goals/all` (HR view of all org goals). Same template; doc will be shorter since the pattern is established.
- **#21** Apply pagination to `GET /annual-reviews/calibration` (ManagementReview's calibration grid) — has mutations, so invalidation across pages matters more.
- **#22** Apply pagination to `GET /project-reviews/all` and `GET /project-reviews/mentees` — two endpoints, same template.
- **#23** Server-side filtering — move `function`, `designation`, `status`, etc. query params into the SQL. Add debouncing on search inputs. The biggest accuracy upgrade for paginated lists.
- **#24+** Server-side sorting (paired with filtering), search across all rows, optimistic updates, and re-render hygiene.

Each PR builds on what came before. After this arc, the entire HR-facing surface scales to 10000+ rows without any client-side compromise.
