# 20 — Paginate `GET /goals/all`: "list-of-parents" pagination

> **PR:** _pending_
> **Files changed:** `backend/app/api/routes/goal_routes.py`, `frontend/src/lib/pagination.ts` (new), `frontend/src/services/goal.service.ts`, `frontend/src/services/annual-review.service.ts`, `frontend/src/pages/AnnualGoals.tsx`.
> **Headline result:** Second endpoint paginated under the foundation from PR #36 (doc #19). But "All Goals" groups goals by employee — a naive row-paginator would split a single employee's goals across pages. The fix: paginate by **employee** (the parent), then ship every goal for that page's employees in one batched fetch. New shared type at `lib/pagination.ts`. Bundle: AnnualGoals **76.32 KB → 76.48 KB raw, gzip 15.13 KB → 15.18 KB** (+0.05 KB gzip).

---

## TL;DR

Foundation PR #36 established the offset/limit + `useInfiniteQuery` template against `GET /annual-reviews/all`. That endpoint was easy: rows are flat, the UI renders one virtualized row per review, "next page" means "next 50 reviews."

This PR applies the same template to `GET /goals/all` — but the All Goals tab groups goals **by employee**. Expanding a user reveals their goals across cycles inline; "Year" and "Mentor" columns reflect the latest goal in the group. If we paginated by goal row the way #19 does, a user with 4 goals could have goals 1–2 on page 1 and goals 3–4 on page 2 — the group would be split, and `buildAllGoalsGroups` (which already runs over the loaded array) would render the SAME user twice. Bad.

The fix is to change the pagination **unit**. The server paginates by employee — the "parent" of the visible group — and ships **every non-DRAFT goal for those employees** in `items`. The grouping function consumes the loaded goal array unchanged; every group is whole, no employee straddles pages. We're calling this pattern **"list-of-parents" pagination**.

The asymmetry between `items` (goals) and `total` (employees) is unusual; the doc spends most of its time explaining why it's the right call here even though it would feel wrong in most APIs.

---

## Part 1 — Why "paginate by row" doesn't work for grouped views

The All Goals tab looks like this (collapsed):

```
| Employee   | Function    | Designation     | Year     | Mentor     |
| Alice K.   | Eng         | Senior          | FY26     | Carol R.   |
| Bob T.     | Design      | Lead            | FY25     | Dave M.    |
| Charlie P. | Eng         | Mid             | FY26     | Carol R.   |
...
```

Clicking a row expands the group inline:

```
| Charlie P. | Eng         | Mid             | FY26     | Carol R.   |
    Goal              | Description                | Status     | Action
    1. Ship X         | …                          | Approved   | View
    2. Mentor Y       | …                          | H1 Self    | View
    3. Migrate Z      | …                          | Pending    | —
```

`buildAllGoalsGroups(goals)` turns the flat goal array into `[{user_id, goals[], …}]` by hashing on `user_id`. The renderer expects every group to carry **all** of that user's non-DRAFT goals — that's what powers the "Year = latest FY" and "Mentor = mentor on the latest goal" derivations on the user-level row.

Now picture pagination-by-goal-row, server returns 50 goals at a time:

- Page 1: goals 1–50 across the org. Charlie has 4 goals; rows 38–41 of that page happen to be his first 3, and his 4th is at row 51 (next page).
- `buildAllGoalsGroups` runs over the 50-row page → produces a Charlie group with 3 goals. Latest-FY is computed wrong (the 4th might be his newest). Mentor column shows the mentor on goal #3 instead of #4.
- User clicks Load More → page 2 arrives → `flatMap` produces 100 goals → re-running the grouper now puts Charlie's 4th goal back in his group, fixing the column derivations.

Two failure modes:
1. **Between pages**, Charlie's columns lie. Not a crash, just wrong data.
2. **If filters drop the 4th goal** (e.g. user hides "Pending Approval"), the columns stay wrong forever — there's no event to re-derive them from.

The deeper issue: the rendering UNIT (a user group) doesn't match the pagination UNIT (a goal row). They have to match, or the renderer can't reason about completeness.

### Two ways to make them match

| Option | Approach | Trade-off |
|---|---|---|
| **A** | Paginate by goal row, ship a `complete=false` flag, re-fetch missing goals when needed | Complex client logic, double round-trips, weird UI states |
| **B** | Paginate by employee, ship every goal for the page's employees | Server query is more nuanced; `items.length` no longer equals `limit` |

B is what we ship. The complexity moves to the SQL on the server (a single query a junior reader can follow) rather than to coordination logic on the client (which would need to live forever).

---

## Part 2 — Backend: paginate by employee, ship all their goals

### The endpoint

```python
@router.get("/all", response_model=Paginated[TeamGoalResponse])
def list_all_goals(
    db: DbSession,
    current_user: CurrentUser,
    limit: int = Query(50, ge=1, le=200, description="Maximum EMPLOYEES…"),
    offset: int = Query(0, ge=0, description="Employees to skip…"),
):
    ...
    # 1. Subquery: distinct user_ids with ≥ 1 non-DRAFT goal in the org.
    has_goal_subq = (
        db.query(Goal.user_id)
        .filter(
            Goal.org_id == current_user.org_id,
            Goal.approval_status != ApprovalStatus.DRAFT.value,
            Goal.user_id == User.id,
        )
        .exists()
    )

    users_q = (
        db.query(User)
        .filter(User.org_id == current_user.org_id)
        .filter(has_goal_subq)
        .order_by(User.full_name.asc(), User.id.asc())
    )

    # 2. total = EMPLOYEE count, not goal count.
    total_users = users_q.with_entities(User.id).count()

    # 3. Page the user list.
    page_users = users_q.offset(offset).limit(limit).all()
    page_user_ids = [u.id for u in page_users]

    # 4. Fetch ALL non-DRAFT goals for the page's employees.
    if page_user_ids:
        goals = (
            db.query(Goal)
            .options(
                joinedload(Goal.owner).joinedload(User.function),
                joinedload(Goal.owner).joinedload(User.designation),
                joinedload(Goal.manager),
                joinedload(Goal.criteria),
            )
            .filter(
                Goal.org_id == current_user.org_id,
                Goal.approval_status != ApprovalStatus.DRAFT.value,
                Goal.user_id.in_(page_user_ids),
            )
            .order_by(Goal.created_at.desc())
            .all()
        )
    else:
        goals = []

    # ...resolve owner_name / function / designation per goal...

    return Paginated[TeamGoalResponse](
        items=goals,
        total=total_users,             # EMPLOYEE count
        limit=limit,
        offset=offset,
        has_more=(offset + len(page_users)) < total_users,
    )
```

### Why an `EXISTS` subquery instead of joining `Goal` to `User`

A join + `DISTINCT` would also work:

```python
# Alternative — works but does more
db.query(User).join(Goal).filter(...).distinct().order_by(...)
```

The JOIN multiplies User rows by goal count BEFORE the DISTINCT collapses them. Postgres handles it fine, but at HR scale the engine is doing useless work: matching every goal row against every user row, then throwing 99% of the matches away. `EXISTS` (or `WHERE user_id IN (SELECT …)`) tells the planner "I only need a yes/no per user." Better plan, fewer rows in flight, same result. For a 1000-user / 5000-goal org the cost difference is small in absolute terms, but the EXISTS shape is the one you want to internalize — it generalises to every "users who have at least one X" query.

### Why a separate goals fetch instead of joinedload(User.goals)

The User table is paginated; the User table is what `OFFSET/LIMIT` runs on. If we asked SQLAlchemy to `joinedload` the `User.goals` collection on the paginated query, two things go wrong:

1. **The LIMIT lies.** `LIMIT 50` would limit `JOIN`-multiplied rows, not user rows. SQLAlchemy actually wraps the query in a subquery to fix that ("subquery loading"), but you're paying for the wrap. (See SQLAlchemy's [`subqueryload` docs](https://docs.sqlalchemy.org/en/20/orm/queryguide/relationships.html) — the whole feature exists *because* eager-load-with-limit is wrong by default.)
2. **The filter has to live on the join clause** — `Goal.approval_status != DRAFT` — which forces a `contains_eager` and an `outerjoin` and turns a 4-line query into a 12-line one.

The two-step pattern (page the parents, fetch the children for the page) is the textbook fix. It's two round-trips instead of one, but each is cheap and the SQL is plain. The "ship all children for the page" semantic is exactly what `useInfiniteQuery` wants on the client.

### What `total` MEANS

For `GET /annual-reviews/all` (PR #36), `total` was the row count — what the user actually sees. Same unit, same number.

For `GET /goals/all`, `items` is goal rows but `total` is **the employee count**. The unit shifted. The frontend needs to know this so it doesn't render "Loaded 47 of 1000 goals" when only 47 GOALS have been streamed but the server's "1000" means employees. The fix is twofold:

- The service docstring names the unit explicitly: `total` is the employee count, not the goal count.
- The UI counter says "Loaded N of T **employees**" — explicit unit, no ambiguity.

We considered renaming `total` → `total_parents` in the response payload for this endpoint, but rejected it. The wire shape stays uniform across every paginated endpoint (#36 + future endpoints); the API contract is "total is the count of the underlying iterable." Each endpoint documents what that iterable is.

---

## Part 3 — Frontend: shared type extraction, useInfiniteQuery, Load More

### `lib/pagination.ts` — extracting the shared shape

PR #36 added `interface Paginated<T>` inline at the bottom of `annual-review.service.ts`. With a second consumer (this PR's `goal.service.ts`), there are now two callers and a clear pattern. Time to extract.

```ts
// frontend/src/lib/pagination.ts
export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
}
```

Both services now do:

```ts
import type { Paginated } from "@/lib/pagination";
```

`annual-review.service.ts` re-exports `Paginated` for back-compat (some other modules may have imported it from there). The re-export costs zero bytes — TypeScript types vanish at build time — but keeps existing call sites compiling without churn:

```ts
// in annual-review.service.ts
export type { Paginated };
export type PaginatedAnnualReviews = Paginated<AnnualReview>;
```

This is the **"library-shape promotion"** pattern: a type starts inline at its first caller, gets extracted to a shared module the moment a second caller appears. Same shape, no rewriting.

### `getAllGoals` — service signature

```ts
// Before
getAllGoals: async (): Promise<TeamGoal[]> => {
  const res = await apiClient.get<TeamGoal[]>("/goals/all");
  return res.data;
},

// After
getAllGoals: async (
  params: { limit?: number; offset?: number } = {},
): Promise<PaginatedAllGoals> => {
  const res = await apiClient.get<PaginatedAllGoals>("/goals/all", { params });
  return res.data;
},

export type PaginatedAllGoals = Paginated<TeamGoal>;
```

Default `{}` so a caller that doesn't care about pagination still gets the first page (limit=50, offset=0 from the server's `Query(50, …)` defaults). Useful for tests and Storybook-style harnesses.

### `useInfiniteQuery` — the React hook

Mirrors the PR #36 pattern exactly:

```ts
const ALL_GOALS_PAGE_SIZE = 50;
const allGoalsQuery = useInfiniteQuery({
  queryKey: queryKeys.goals.org(),
  queryFn: ({ pageParam }) =>
    goalService.getAllGoals({
      limit: ALL_GOALS_PAGE_SIZE,
      offset: pageParam,
    }),
  initialPageParam: 0,
  getNextPageParam: (lastPage) =>
    lastPage.has_more ? lastPage.offset + lastPage.limit : undefined,
  enabled: isHRMyOrg,
});
```

Three things to notice:

1. **The cache key is unchanged.** `queryKeys.goals.org()` was the legacy `useQuery` key; reusing it means **every existing broadcast invalidation** in the page (`invalidateGoalsAndDashboard()` calls `invalidateQueries({ queryKey: queryKeys.goals.all })`) refetches the loaded pages without us touching the mutation code. The cache primitive doesn't care if the value is a single response or a stack of pages — invalidation marks the entry stale and the query observer refetches whatever shape it expects.
2. **`pageParam` is the offset.** TanStack Query treats it as an opaque token; we choose its semantics. Offset is the simplest choice that matches the backend.
3. **`enabled: isHRMyOrg`** keeps the query parked for Staff and Mentor users — same role gate as the legacy `useQuery`.

### Flattening pages → goal array

```ts
const allGoals: TeamGoal[] =
  allGoalsQuery.data?.pages.flatMap((p) => p.items) ?? [];
```

`data.pages` is an array of `PaginatedAllGoals` — one per fetched page. `flatMap(p => p.items)` produces a single goal array. Everything downstream — filters, sort, `buildAllGoalsGroups` — operates on this combined list without knowing pagination exists.

This is what makes "list-of-parents" work: because every page ships **all** of its employees' goals, the flatmapped array never has a partial employee. `buildAllGoalsGroups(allGoals)` always produces complete groups, regardless of how many pages have loaded.

### Total employee count

```ts
const allGoalsTotalEmployees =
  allGoalsQuery.data?.pages[allGoalsQuery.data.pages.length - 1]?.total ?? 0;
```

The server returns the same `total` on every page (because the filter is the same). We read it off the latest page. Used by the Load More counter.

### Load More button + counter

```tsx
{hasNextPage && (
  <div className="flex items-center gap-3 justify-center">
    <button
      type="button"
      onClick={onLoadMore}
      disabled={isFetchingNextPage}
      className="…"
    >
      {isFetchingNextPage ? "Loading…" : "Load more"}
    </button>
    <span className="text-xs text-text-muted">
      Loaded {new Set(goals.map((g) => g.user_id)).size} of {totalEmployees} employees
    </span>
  </div>
)}
```

`new Set(goals.map(g => g.user_id)).size` is the count of distinct employees in the loaded goal array. It's not equal to `sortedGroups.length` (which is post-filter) — the loaded-vs-server count must reflect what the **server** has shipped, not what filters have narrowed. Two different lenses on the same data; the doc explains both because the distinction trips up the next person who skims the code.

`hasNextPage` is derived from `getNextPageParam` returning `undefined` (i.e. the server's `has_more` was `false` on the latest page). When the server runs out of employees, the button disappears.

`isFetchingNextPage` is true only during a `fetchNextPage()` call — distinct from `isFetching` (which also fires during a background refetch). This matters: we don't want the "Loading…" label to flash every time `invalidateQueries` triggers a refetch in the background after a mutation.

---

## Part 4 — Why we kept the per-filter counter separate

There are now TWO counters in the All Goals tab:

```
Filter row:    {sortedGroups.length} employees · {filtered.length} of {goals.length} goals
Load More row: Loaded {distinctUsers} of {totalEmployees} employees
```

We considered merging them. Don't. They answer two different questions:

| Counter | Question |
|---|---|
| **Filter** | "How much of what I have on screen survived my filters?" |
| **Load More** | "How much have I asked the server for vs. how much is available?" |

Both are useful. Merged into one line, neither would read cleanly — and once you start nesting "displayed/loaded/total" you've made the user do arithmetic to understand the affordance.

The pattern, more generally: **a counter is most useful when it sits next to the affordance it describes.** The filter counter sits next to the filter controls. The pagination counter sits next to the Load More button.

---

## Part 5 — What this PR does NOT solve

- **Other paginated endpoints.** `GET /annual-reviews/calibration` (1000+ reviews in the active cycle) and `GET /annual-reviews/mentees` (mentor's roster) still ship everything. Next PRs.
- **Per-criterion data.** Each TeamGoal still carries its full `criteria[]` array. For goals with 20+ criteria that's not negligible; if it becomes a problem we'd ship them on demand via a new endpoint, not change pagination.
- **Cursor-based pagination.** Offset/limit is fine here for the same reasons as #19 (slow churn, append-mostly data, simpler `useInfiniteQuery` recipe). Moving to cursors would be a larger refactor of the backend AND every frontend `getNextPageParam` — defer until we actually see drift.
- **Search/filter pushdown to the server.** The Employee / Function / Designation / Year / Mentor filters all run client-side on the loaded goal array. At 1000+ employees that may eventually be too much; the natural fix is `?employee=&function=…` on the endpoint. Not in this PR's scope.

---

## Trade-offs

- **Two-step query vs single join.** Costs one extra DB round-trip per page. Worth it: the SQL is plain, the `User.goals` eager-load corner cases (LIMIT semantics, filter pushdown) stay out of the code. At our scale the round-trip is cheap; at 100× scale we'd profile both.
- **`total` semantics changed per endpoint.** `/annual-reviews/all` returns row-count, `/goals/all` returns parent-count. We documented it loudly but a future contributor who copies the doc from PR #36 might forget. The mitigation is the per-service docstring + the test (we should add one — left for a follow-up PR).
- **One extra UI counter.** We added "Loaded N of T employees" alongside the existing filter counter, instead of folding both into one line. Readability won over compactness. See Part 4.

---

## Verification

```bash
cd frontend
npm run build
```

Expected:
- `dist/assets/AnnualGoals-*.js` ~76.48 KB raw / **~15.18 KB gzip** (vs 76.32 / 15.13 baseline — about +0.05 KB gzip for the pagination wiring).
- No new vendor chunks (TanStack Query was already installed in PR #19; `useInfiniteQuery` is part of the same package).

End-to-end:
- As HR_MyOrg, open `/annual-goals` → "All Goals" tab → DevTools Network → first request is `GET /goals/all?limit=50&offset=0`. Response includes `items: [...]`, `total: <employee count>`, `has_more: <boolean>`.
- Scroll to bottom of the virtualized list → "Load more" button visible (only if `has_more=true`).
- Click "Load more" → second request `GET /goals/all?limit=50&offset=50`. Button label flashes "Loading…" → reverts. Counter updates: "Loaded N of T employees".
- Expand any user group → all of that user's goals (across cycles) are present, NOT just a subset. Verifies "groups never split across pages".

---

## What the next PR teaches

The first time we touch a similarly-grouped endpoint (e.g. mentor's mentees with their reviews nested), the pattern is reusable as-is. The doc for #20 — this one — is the reference. Beyond that:

- `/annual-reviews/calibration` — flat list, same shape as PR #36's `/annual-reviews/all`. Should be a small, low-narrative PR.
- `/annual-reviews/mentees` — mentor's view; flat per-mentee. Same shape as foundation.
- Search/filter pushdown — a different theme, probably its own pair of PRs.
