# 26 — Server-side filter foundation: filters become part of the queryKey

> **PR:** [#43](https://github.com/Healthark/miltenyi-pms/pull/43)
> **Files changed:** `backend/app/api/routes/annual_review_routes.py`, `frontend/src/services/annual-review.service.ts`, `frontend/src/lib/queryKeys.ts`, `frontend/src/pages/AnnualReviews.tsx`.
> **Headline result:** Opens theme #5 — once pagination ships, the *next* place users feel slow is filtering, because today every filter runs **client-side on the loaded array**. After pagination this got subtly wrong: filter by Status="Pending Mentor" on Page 1 and you see only the matches from the 50 already-loaded rows, not the full universe. This PR moves filters to the server, **bakes them into the TanStack Query cache key**, and lets Load More page through the filtered universe instead of the entire one. Bundle: AnnualReviews **42.08 → 42.30 KB raw, 8.36 → 8.48 KB gzip** (+0.12 KB gzip).

---

## TL;DR

Filters and pagination interact subtly. Before this PR:

```
HR sets Status="Pending Mentor" on the All Reviews tab.
Server has 5000 reviews; 47 are pending_mentor; 3 are on the loaded page 1 of 50.
HR sees: 3 reviews.
Load More fetches page 2 (50 more raw rows). Maybe 2 more pending_mentor surface.
HR sees: 5 reviews.
The toolbar reads "Loaded 100 of 5000" — misleading: only 5 match. The actual
filtered universe is 47, but neither HR nor the UI knows that.
```

After this PR:

```
HR sets Status="Pending Mentor".
Frontend bakes status="pending_mentor" into the queryKey: TanStack Query treats
this as a NEW cache entry, fires a fresh first-page request:
  GET /annual-reviews/all?status=pending_mentor&limit=50&offset=0
Server runs the filter in SQL: WHERE status = 'pending_mentor', returns total=47
and the first page of matching rows (up to 50).
HR sees: 47 matching reviews (or all of them if total < 50, no Load More needed).
Counter reads: "47 matches" at the top; "Loaded 47 of 47" by Load More (hidden
since has_more=false).
```

The shift is conceptually clean — pagination semantics now read **"page through the filtered universe"** instead of "page through everything and post-filter." The implementation has two halves:

1. **Backend** accepts `?cycle&status&function&designation&employee` query params, applies them as WHERE clauses (with a conditional JOIN to `User` + `Function` + `Designation` for the user-attribute filters).
2. **Frontend** lifts filter state up to the page level so it can flow into the queryKey, drops the client-side filter loop, and reworks the counter + empty-state messaging.

---

## Part 1 — Why filter state lives at the page, not in the tab component

This is the load-bearing architectural decision. The old `AllReviewsTab` owned its own filter state locally (`useState` × 5). The new version has filters lifted UP to the page (`AnnualReviews.tsx`).

The reason: **TanStack Query reads the queryKey at hook-call time.** The `useInfiniteQuery` lives at the page level. For filters to influence the query, they have to be visible to that hook — which means they must live at the page level (or above).

```tsx
// At the page
const [allReviewsFilters, setAllReviewsFilters] = useState<AllReviewsFilters>({});

const allReviewsQuery = useInfiniteQuery({
  queryKey: queryKeys.annualReviews.org(filterParams),   // ← filters in the key
  queryFn: ({ pageParam }) =>
    annualReviewService.getAllReviews({
      ...filterParams,
      limit: PAGE_SIZE,
      offset: pageParam,
    }),
  // …
});

// Pass filters + setter to the child as a controlled component
<AllReviewsTab
  reviews={allReviews}
  filters={allReviewsFilters}
  onFiltersChange={setAllReviewsFilters}
  // … rest
/>
```

Two alternatives we considered:

| Option | Approach | Why we didn't pick it |
|---|---|---|
| **Move `useInfiniteQuery` into `AllReviewsTab`** | Filter state stays local; the hook reads it directly. | Requires changing the parent's `isLoading` derivation (since the all-reviews query becomes private to the tab). More invasive refactor. |
| **`enabled: false` + manual `refetch()` triggers** | Filter changes call `refetch()` instead of changing the key. | Loses every cache benefit. Going back to the same filter set wouldn't hit the cache. The whole point of the queryKey is to give each filter set its own cache entry. |

Lifting state up is the smallest change that gets the semantics right. AllReviewsTab becomes a [controlled component](https://react.dev/learn/sharing-state-between-components) for filter state — the page owns the data, the tab presents it.

---

## Part 2 — Cache key from filter state: the "different filter = different entry" pattern

```ts
// queryKeys.ts
org: (filters: Record<string, string | undefined> = {}) =>
  [...queryKeys.annualReviews.all, "org", filters] as const,
```

Every distinct filter set produces a distinct cache key. TanStack Query deep-equals on keys: two `{}` objects compare equal even though they're different references; two `{ status: "draft" }` objects compare equal; `{ status: "draft" }` ≠ `{ status: "pending_mentor" }`.

Consequences:

- **Switching filter sets is instant on second visit.** HR filters to "pending_mentor", then to "completed", then back. The third trip is a cache hit; no network request.
- **Mutations using broadcast invalidation still work.** `queryClient.invalidateQueries({ queryKey: queryKeys.annualReviews.all })` invalidates every entry under `['annual-reviews', ...]` — including all filter variants. After `setManagementRating` publishes, every cached filter view refetches its loaded pages on next access.
- **Cache memory grows with filter variety.** Each new filter combo HR explores allocates a cache entry. TanStack Query's default `gcTime` (5 minutes) garbage-collects unused entries, so the steady-state memory is bounded by "filter combos visited in the last 5 minutes."

### The empty-filters trap

A subtle bug we avoided. Before normalizing:

```tsx
// BAD — passes `{ status: "" }` to the API
const allReviewsQuery = useInfiniteQuery({
  queryKey: queryKeys.annualReviews.org(filters),
  queryFn: ({ pageParam }) =>
    annualReviewService.getAllReviews({ ...filters, limit: …, offset: … }),
});
```

If the UI uses `""` (or `"all"`) as the "no filter" sentinel and we pass that straight through to the API, the server might interpret it as "filter by empty string" depending on how Pydantic handles it. Worse, the queryKey now carries `{ status: "" }` which is *different* from `{ }`, so navigating between "All" and back to "All" produces unnecessary cache misses.

The fix is a normalization step right before the query:

```tsx
const filterParams: Record<string, string> = Object.fromEntries(
  Object.entries(allReviewsFilters).filter(
    ([, v]) => v !== undefined && v !== "",
  ),
) as Record<string, string>;
```

Now `{ status: undefined }` and `{ status: "" }` both produce `{}`, which both the queryKey and the API request agree means "no narrowing on this dim."

---

## Part 3 — Backend: conditional JOIN + WHERE per filter

```python
base_q = db.query(AnnualReview).filter(
    AnnualReview.org_id == current_user.org_id
)

# Direct-column filters — no join needed.
if cycle:
    base_q = base_q.filter(AnnualReview.cycle_name == cycle)
if status_:
    base_q = base_q.filter(AnnualReview.status == status_)

# User-attribute filters require joining User. Add the join lazily
# so unfiltered requests stay single-table.
needs_user_join = bool(function_ or designation or employee)
if needs_user_join:
    base_q = base_q.join(User, User.id == AnnualReview.user_id)
    if employee:
        base_q = base_q.filter(User.full_name == employee)
    if function_:
        base_q = base_q.join(Function, Function.id == User.function_id).filter(
            Function.name == function_
        )
    if designation:
        base_q = base_q.join(
            Designation, Designation.id == User.designation_id
        ).filter(Designation.name == designation)
```

Three things worth pointing out:

#### 1. `status` and `function` are reserved Python names

Inside this file `status` already refers to `fastapi.status` (the HTTP-status module). `function` is the Python builtin function type. We use `status_` and `function_` in the Python signature, with FastAPI `Query(alias="status")` / `Query(alias="function")` so the wire-name stays clean.

```python
status_: Optional[str] = Query(
    None,
    alias="status",
    description="…",
),
```

A pure-Python rename pattern. The frontend sees `?status=` exactly as expected; the Python code reads `status_` to avoid shadowing.

#### 2. Conditional joins keep the unfiltered path fast

When no user-attribute filter is set, no JOIN runs. The endpoint is single-table — same plan as pre-PR. Performance characteristics for "HR clicks the All Reviews tab with no filters set" are unchanged.

When filters DO apply, the JOIN chain is `AnnualReview → User → (Function | Designation)`. INNER JOIN is correct: every `AnnualReview` has a non-null `user_id` (FK constraint), so the join never accidentally drops legitimate rows. The filter chain then narrows further with WHERE.

#### 3. The COUNT path inherits the same filters

`base_q.count()` runs AFTER all the filter / join chaining. So the response's `total` field is exactly the count of rows matching the active filter set — not the org-wide count. That's the whole point: Load More + the counter both read the same filtered universe.

If we had built filters as a separate `apply_filters(query, …)` helper and only applied them to the windowed fetch (forgetting the COUNT), the `total` would be wrong and `has_more` would lie. The "build base_q once, use it for both" pattern from PR #36 onwards is doing real work here.

---

## Part 4 — Faceted-style dropdowns: the trade-off we're shipping

The filter dropdowns (Cycle / Status / Function / Designation / Employee) derive their option list from the loaded reviews:

```tsx
const cycles = Array.from(
  new Set(reviews.map((r) => r.cycle_name).filter(Boolean)),
).sort((a, b) => b.localeCompare(a));
```

`reviews` is now the **filtered universe**, not the org-wide universe. So if HR filters by Status="Pending Mentor", the Cycle dropdown shows only the cycles that have at least one pending-mentor review.

This is **faceted-search behaviour**. It's the same shape as how Amazon shows "Category: Books (47) | Movies (12)" — the facets reflect what's in the current result set.

Pros:
- Each visible option is guaranteed to return matches.
- The user sees the dimensionality of the current result set at a glance.

Cons:
- Other dropdowns "shrink" when one dropdown narrows. To see the full Function list again, HR has to clear other filters first.
- A user picking up the workflow might be confused by a Function dropdown that's missing "Engineering" even though Engineering exists in the org.

We're shipping this trade-off explicitly because the alternative (an unfiltered "facets endpoint" returning all distinct values regardless of filter state) is a separate cross-cutting feature. For PR #26 the goal is to land server-side filtering as a foundation; the faceted-dropdown behaviour is a secondary concern that future PRs can refine.

**If/when faceted gets confusing in practice**, the fix is a `/annual-reviews/all/filter-options` endpoint that returns `{ cycles: [], statuses: [], functions: [], designations: [] }` and a `useQuery` against it on the page. The dropdowns would read options from THAT query instead of from the loaded reviews. Filter state and the option list become independent.

Sketched as a follow-up; not in this PR.

---

## Part 5 — Counter + empty-state messaging changes

The toolbar counter shifted from "filtered.length of total" (post-client-filter / loaded universe) to "{total} matches" (the server-filtered universe count).

```tsx
{/* Before */}
{filtered.length} of {total}

{/* After */}
{total} {total === 1 ? "match" : "matches"}
```

The Load More counter beside the button (unchanged from PR #36): "Loaded N of T" — N is loaded rows, T is the filtered total. Both numbers now refer to the filtered universe.

Empty state grew a new branch — `reviews.length === 0` can now mean either "no reviews in the org" or "your filters returned nothing":

```tsx
const hasActiveFilters = Object.values(filters).some(
  (v) => v !== undefined && v !== "",
);

if (reviews.length === 0) {
  return (
    <div className="…">
      <p>{hasActiveFilters ? "No reviews match these filters" : "No annual reviews recorded"}</p>
      <p>
        {hasActiveFilters
          ? "Try clearing one or more filters above to broaden the result."
          : "Reviews will appear here once Staff submit self-reviews and mentors start evaluating."}
      </p>
    </div>
  );
}
```

The remediation message is different for each case — "wait for Staff to submit" doesn't help if you've just over-filtered. Spelling them out separately is a small UX win.

---

## Part 6 — What this PR does NOT solve

- **Server-side sort.** Sort still operates client-side on the loaded pages. At HR scale with active filters that fit on a single page, this is fine. With filters that span many pages, sort is incomplete ("show me lowest-rated" sorts what's loaded, not the universe). A future PR pushes `?sort_by=&sort_dir=` to the server.
- **Substring search.** Employee combobox commits exact names; backend matches `User.full_name == employee`. A `search` param doing `ILIKE '%query%'` would let HR type partial names and live-filter as they type. Requires frontend debouncing (otherwise every keystroke fires a request).
- **Faceted-dropdown refinement.** See Part 4. Workable as-is; needs a separate endpoint when the trade-off bites.
- **Other endpoints.** `/goals/all`, `/project-reviews/all`, `/annual-reviews/calibration`, `/annual-reviews/mentees` all still filter client-side. The next 3-4 PRs will roll out the same pattern; a generic helper might emerge after the second or third.
- **URL-state sync.** Filters live in React state, not the URL. HR can't bookmark or share a filtered view yet. Future polish PR.

---

## Trade-offs

- **More cache entries.** Each filter combo HR visits gets its own entry. Bounded by `gcTime` (5 min default), but a power user exploring many combos pre-warms a lot of memory. Acceptable at our scale.
- **Faceted dropdowns shrink under filters.** Documented in Part 4. The "fix" is a separate endpoint; not free.
- **Sort still client-side.** Documented in Part 6. Future PR.
- **Filter state isn't in the URL.** Future polish. The cost: refresh loses the filter set. Mitigation: cache entries from before-refresh would be lost too, so the server pays the cost once on re-open and we're back where we started.

---

## Verification

```bash
cd frontend
npm run build
```

Expected:
- `dist/assets/AnnualReviews-*.js` ~42.30 KB raw / **~8.48 KB gzip** (vs 42.08 / 8.36 baseline — +0.12 KB gzip for the filter wiring + counter + empty-state branches).

End-to-end:
- As HR_MyOrg, open `/annual-reviews` → "All Reviews" tab → DevTools Network: first request is `GET /annual-reviews/all?limit=50&offset=0` (no filter params).
- Pick "Status = Pending Mentor" → second request fires immediately: `GET /annual-reviews/all?status=pending_mentor&limit=50&offset=0`. Response's `total` is the count of pending-mentor reviews in the org. Toolbar reads "{total} matches".
- Pick "Function = Engineering" on top of Status → third request: `?status=pending_mentor&function=Engineering&limit=50&offset=0`. AND semantics.
- Clear Status → request fires with only `?function=Engineering&…`.
- Filter to a combination with no matches → empty state shows "No reviews match these filters."
- Type a name in the Employee combobox, pick it from the suggestions → request fires with `?employee=...&…`.
- Network tab pattern: every filter change fires exactly one new request (no debouncing concerns since dropdowns commit instantly and the combobox commits on click).
- Cache HIT verification: change Status → wait → change it back. Second request to the original filter set may be a cache hit (no network) depending on `staleTime`. React Query DevTools confirms.

---

## What the next PR teaches

Theme #5 just opened. Natural next steps:

- **PR #27: Apply the pattern to `/goals/all`.** Same shape; the user-attribute joins are similar (Goal → User → Function/Designation). After 2 endpoints with the same shape, a `_apply_filters` helper might emerge.
- **PR #28-30: Roll out to remaining endpoints.** `/project-reviews/all` (HR-facing), `/annual-reviews/calibration`, `/annual-reviews/mentees`.
- **PR #31: Server-side sort.** Significantly more interesting than filter — sort interacts with the OFFSET/LIMIT tiebreaker, requires a stable secondary order, and lets the frontend ditch the client-side sort entirely (and its bundle).
- **PR #32 (optional): URL-state sync.** Pure frontend; saves filter state to the URL query string so HR can bookmark/share filtered views.
