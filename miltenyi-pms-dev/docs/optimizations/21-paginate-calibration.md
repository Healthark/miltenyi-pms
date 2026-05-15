# 21 — Paginate `GET /annual-reviews/calibration`: the degenerate list-of-parents

> **PR:** [#38](https://github.com/Healthark/miltenyi-pms/pull/38)
> **Files changed:** `backend/app/api/routes/annual_review_routes.py`, `frontend/src/services/annual-review.service.ts`, `frontend/src/pages/ManagementReview.tsx`.
> **Headline result:** Third paginated endpoint. Each calibration row corresponds to exactly one Staff user (reviews are 0-or-1 per user in the active cycle), so the list-of-parents pattern from PR #37 collapses to "paginate the rows" — `total` and `items.length` measure the same thing again. The change is a near-mechanical application of the template, with one subtle gotcha that's worth its own section: **the sort moves from Python into SQL**, because OFFSET/LIMIT is meaningless without a stable ORDER BY. Bundle: ManagementReview **17.21 → 17.96 KB raw, 4.44 → 4.65 KB gzip** (+0.21 KB gzip).

---

## TL;DR

This is the "boring" PR in the pagination arc. The previous two introduced new patterns:

- **PR #36 (doc 19):** Foundation — flat list, `offset/limit`, `useInfiniteQuery`.
- **PR #37 (doc 20):** List-of-parents — paginate the *parent* entity, ship all *children* for the page.

This PR applies them to `/annual-reviews/calibration`. The endpoint LEFT-joins every active Staff user against their AnnualReview row for the active cycle: one row per user, even if the user hasn't created a review yet (status="not_started"). Because the "parent" (User) has at most one "child" (AnnualReview) per cycle, the two patterns collapse: paginating users is the same as paginating rows. `total` and `items.length` are the same unit again — just like the foundation.

The interesting bit is the small but load-bearing **change to where sorting happens**. The legacy endpoint fetched every Staff user, then sorted in Python by employee_name. That works when you have the whole list in memory; it breaks once you only have a page. ORDER BY moves into SQL.

---

## Part 1 — The "degenerate" case in the pagination taxonomy

Three endpoints in, the template has a small taxonomy:

| Case | Paginate by | `total` is | `items.length` is | Where it shows up |
|---|---|---|---|---|
| **Flat** (#36) | Row | Row count | Row count | `/annual-reviews/all` |
| **Parent → N children** (#37) | Parent | Parent count | Goal count (≠ parent) | `/goals/all` |
| **Parent → 0-or-1 child** (this PR) | Parent (= row) | User count | User count | `/annual-reviews/calibration` |

The third case is a **degenerate** list-of-parents. The "child" is a 0-or-1 LEFT-joined relationship (the AnnualReview), so each user produces exactly one row. Per-page, the two counts coincide. You COULD describe it as either "paginate by user" or "paginate by row" — they're the same operation.

Why mention this at all if it's just a flat list? Two reasons:

1. **The SQL still has to be two-step.** Paginate the User table, then batch-fetch reviews for the page's user IDs. Even though we end up with one row per user, the underlying data model is still parent + LEFT JOIN, and the same "fetch the parents, then their children" structure keeps the eager-load corner cases out of the code (see PR #37 doc 20 Part 2 for the eager-load-with-LIMIT corner case in full).
2. **The user mental model is "rows, not users."** HR sees a calibration table; "Load more" loads more rows. The doc has to be explicit that this is fine — neither name is misleading, they're both correct.

So the doc is short, the code is short, and the only thing worth writing about is the sort.

---

## Part 2 — Moving sort from Python to SQL

The legacy endpoint had this at the bottom:

```python
rows.sort(key=lambda r: r.employee_name.lower())
return rows
```

Fine before pagination. Once we add `OFFSET/LIMIT`, it's broken. The SQL query has no ORDER BY, which means Postgres returns rows in whatever physical order it likes — usually insertion order, but the docs don't promise that. Page 1 gets users [A, B, C, D, E]. Page 2 gets users [F, G, H, I, J]. Python then sorts each page alphabetically. But there's no guarantee that the boundary between pages aligns with the alphabet — page 1 might happen to be [A, C, D, J, K] (DB returned them in that order) and page 2 [B, E, F, …]. Page 1 displays as [A, C, D, J, K], page 2 appends as [B, E, F, …], and "Load more" produces a list that isn't sorted overall, just sorted within each page.

The fix is one line:

```python
.order_by(User.full_name.asc(), User.id.asc())
.offset(offset)
.limit(limit)
```

ORDER BY before OFFSET/LIMIT. Postgres ranks every matching row by `(full_name, id)`, then takes the requested window. The secondary `id.asc()` tiebreaker matters: if two users share a name (Bob Smith × 2), without a tiebreaker their relative order isn't deterministic, and the same Bob could appear on two consecutive pages — or be silently dropped. **Always pair OFFSET/LIMIT with a tiebroken ORDER BY.** It's the textbook pagination footgun.

The Python `rows.sort(...)` line gets deleted. Sort lives in SQL now.

### Why we couldn't just leave Python sort in place

Two reasons:

1. **Each page would have to download everyone** to sort the full universe before slicing — which defeats the whole point of pagination.
2. **Sort by computed/joined fields** wouldn't be possible. If we ever sort by mentor_name or function (which come from joins), Python's array sort can do it, but only over the LOADED rows. SQL's ORDER BY can drive the windowing — see Part 4 for what we'd add to push filter/sort to the server in a future PR.

### What we considered

| Approach | What it costs | Verdict |
|---|---|---|
| **SQL ORDER BY + OFFSET/LIMIT** (what we shipped) | One small change; sort + pagination unified | ✅ |
| **Cursor pagination keyed on full_name + id** | More complex; deal with name collisions explicitly; messier `?cursor=…` URLs | Defer — offset/limit is fine until churn becomes a real problem |
| **Sort in Python after fetching everyone** | No pagination at all (the bug we're fixing) | ❌ |

---

## Part 3 — The frontend change is mechanical

`useQuery` → `useInfiniteQuery`. Same cache key. Same broadcast invalidation. Same virtualizer. Same filters. The only new things are:

- `flatMap(p => p.items)` to keep the downstream code looking at a single array.
- Read `total` off the latest page for the counter.
- A Load More button below the card.

```tsx
const CALIBRATION_PAGE_SIZE = 50;
const gridQuery = useInfiniteQuery({
  queryKey: queryKeys.annualReviews.calibration(),
  queryFn: ({ pageParam }) =>
    annualReviewService.getCalibrationGrid({
      limit: CALIBRATION_PAGE_SIZE,
      offset: pageParam,
    }),
  initialPageParam: 0,
  getNextPageParam: (lastPage) =>
    lastPage.has_more ? lastPage.offset + lastPage.limit : undefined,
});
const rows = gridQuery.data?.pages.flatMap((p) => p.items) ?? [];
const totalUsers =
  gridQuery.data?.pages[gridQuery.data.pages.length - 1]?.total ?? 0;
```

No `enabled` gate here — the whole page is HR_MyOrg-only (route-gated), so there's nobody who shouldn't be fetching this. (Compare to `getAllReviews` in doc 19 and `getAllGoals` in doc 20, both of which sit on pages shared by other roles and use `enabled: isHRMyOrg` to keep parked.)

### Load More counter — same unit on both sides

```tsx
<span className="text-xs text-text-muted">
  Loaded {rows.length} of {totalUsers}
</span>
```

For #20 the counter had to spell out the unit ("Loaded N of T **employees**") because `items` and `total` measured different things. Here they don't: `rows.length` is users, `totalUsers` is users. The unit is implicit in the table that sits above the counter — no need to label it.

This is what "the same template applied at three different shapes" produces. The first time you see the pattern (doc 19), the counter is just "N of T". The second time (doc 20), it has to disambiguate. The third time, it's back to "N of T" — but for a different reason, and you've earned the right to be terse because you know the audience now reads the counter as "of the calibration rows."

---

## Part 4 — What this PR does NOT solve

- **Server-side filter/sort.** The Function / Designation / Mentor / Status filters and the column sort all still run client-side over the loaded array. At 1000+ Staff users, sorting by management_performance_rating will rank only the loaded rows, not the universe — so "show me the lowest-rated user" misleads after the first page. Pushing filter/sort to the server is the natural next theme; this PR keeps the existing client-side behaviour, which is correct when the user has paged through the whole list.
- **`/annual-reviews/mentees`** — mentor's roster. Same flat shape, smaller scale (a mentor has a few mentees, not a whole org). Probably the next paginated endpoint, but lower-priority because mentee rosters are small.
- **`/project-reviews/all`** — HR's project-review view-only table. Another flat list. Same template will apply.

---

## Trade-offs

- **One extra DB round-trip per page** (User page → review fetch). Same cost as PR #37, same justification: the two-step query keeps eager-load-with-LIMIT corner cases out of the code, and at our scale the round-trip is cheap.
- **No telemetry yet on real-world page sizes.** We picked `limit=50` to match PR #36/#37 for consistency. If HR is calibrating a 1500-user org, that's 30 clicks of Load More. Bumping the default to 100 is a one-character change; revisit once we have usage data.
- **Filter/sort gets less useful at scale.** Documented in Part 4. The fix is server-side filter/sort, which is its own theme.

---

## Verification

```bash
cd frontend
npm run build
```

Expected:
- `dist/assets/ManagementReview-*.js` ~17.96 KB raw / **~4.65 KB gzip** (vs 17.21 / 4.44 baseline — +0.21 KB gzip for the pagination wiring + Load More UI).

End-to-end:
- As HR_MyOrg, open `/management-review` → DevTools Network → first request is `GET /annual-reviews/calibration?limit=50&offset=0`. Response includes `items: [...]`, `total: <user count>`, `has_more: <boolean>`.
- If the org has > 50 active Staff users, "Load more" button visible below the calibration card.
- Click "Load more" → second request `?offset=50`. Button label flashes "Loading…" → reverts. Counter advances. New rows append.
- Set a management rating on any row → broadcast invalidation refetches all loaded pages (the loaded pages refresh together because the cache key is shared).
- Verify ordering: scroll through the loaded rows. They should be alphabetical by `employee_name`, with no duplicates across page boundaries. Two users with the same name (if you can seed it) should appear consecutively, with the lower User.id first.

---

## What the next PR teaches

- **`/annual-reviews/mentees`** — same flat-list template, smaller scale. A mentor might have 5 mentees in a "1000-user org" — pagination at 50/page means one page covers everyone. Worth paginating anyway for consistency, but the doc will be short.
- **`/project-reviews/all`** — flat list of project reviews; HR-scale. Same template.
- **Server-side filter/sort** is the natural next theme. The shape of "Load more" UI changes when the server can narrow before paging: filters become "true" filters (they narrow the loaded universe, not just the displayed window) and sort becomes globally meaningful. Probably its own pair of PRs.
