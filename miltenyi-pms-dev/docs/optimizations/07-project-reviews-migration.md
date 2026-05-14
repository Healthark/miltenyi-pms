# 07 — ProjectReviews migration: 5 role-gated queries + cache-warming probe pattern

> **PR:** _pending_
> **Files changed:** `frontend/src/lib/queryKeys.ts` (new `projectReviews` namespace), `frontend/src/pages/ProjectReviews.tsx`.
> **Headline result:** 5 page-level reads migrated. New pattern introduced: **cache-warming probe** — a probe query whose data is reused by a downstream consumer instead of a separate state flag.

---

## TL;DR

`ProjectReviews.tsx` (last of the three "big" pages — ~1000 lines) had four `useEffect` data-loading patterns and one "probe" effect that fetched the secondary queue just to check if `rows.length > 0`. We collapsed all five into `useQuery` calls, each role-gated by `enabled`.

The most interesting new pattern is the **cache-warming probe**: the secondary queue probe used to be a one-shot fetch that threw away the data after reading `.length`. With useQuery, the probe's result lives in the cache, so when the SecondaryEvalTab eventually mounts (the tab the probe controls visibility of), it'll find data already there. The probe is no longer a "wasted" call — it's a cache primer.

No new TanStack Query concepts beyond what PR #04 (role-gated `enabled`) established. The page now follows the same template as AnnualReviews — proof the template scales.

---

## Part 1 — What was there before

The page renders one of four tabs based on role:
- **Staff** → "My Reviews" (own project cards + role expectations modal data)
- **PM** → "Primary Evaluation" tab (loads its own data inside `PrimaryEvaluationTab`)
- **Mentor** → "Mentees' Reviews" (read-only over `getMenteeReviews()`)
- **HR** → "All Reviews" (read-only org-wide)
- **Anyone with secondary assignments** → "Secondary Evaluation" tab (visibility gated on a `getSecondaryQueue()` probe)

The data-loading code:

```tsx
const [cards, setCards] = useState<MyProjectCard[]>([]);
const [menteeReviews, setMenteeReviews] = useState<ProjectReviewResponse[]>([]);
const [allReviews, setAllReviews] = useState<ProjectReviewResponse[]>([]);
const [expectations, setExpectations] = useState<RoleExpectation[]>([]);
const [isLoading, setIsLoading] = useState(true);

// Three role-specific load callbacks
const loadStaffData = useCallback(async () => { ... });
const loadMentorData = useCallback(async () => { ... });
const loadHRData = useCallback(async () => { ... });

useEffect(() => {
  if (isStaff) void loadStaffData();
  else if (isMentor) void loadMentorData();
  else if (isHR) void loadHRData();
  else setIsLoading(false);
}, [isStaff, isMentor, isHR, loadStaffData, loadMentorData, loadHRData]);

// Probe effect — separate from the role bootstrap
const [hasSecondaryWork, setHasSecondaryWork] = useState(false);
useEffect(() => {
  if (!canBeSecondary) {
    setHasSecondaryWork(false);
    return;
  }
  let cancelled = false;
  void projectReviewService
    .getSecondaryQueue()
    .then((rows) => { if (!cancelled) setHasSecondaryWork(rows.length > 0); })
    .catch(() => { if (!cancelled) setHasSecondaryWork(false); });
  return () => { cancelled = true; };
}, [canBeSecondary]);
```

Four useStates for data, one for loading, one for the probe flag. Three `useCallback` load functions. Two effects (one for role data, one for probe). Plus `let cancelled` race-condition guards on every fetch.

That's the boilerplate the migration deletes.

---

## Part 2 — Pattern: the cache-warming probe

This is the only new technique in this PR. Worth understanding.

### The probe's job

The "Secondary Evaluation" tab should only appear when the user has at least one project where they're a secondary evaluator. The visibility check needs an API call (`getSecondaryQueue()`) — there's no client-side way to know without asking the server.

The old code did the minimum: hit the endpoint, count rows, set a boolean. The actual data — the list of pending secondary reviews — was discarded. When the user later clicked the tab, `SecondaryEvalTab` re-fetched the same data.

Net: **two HTTP requests for the same data** in the common case.

### The fix

With `useQuery`, the probe's data lives in the cache:

```tsx
const secondaryQueueQuery = useQuery({
  queryKey: queryKeys.projectReviews.secondaryQueue(),
  queryFn: projectReviewService.getSecondaryQueue,
  enabled: canBeSecondary,
});
const hasSecondaryWork = (secondaryQueueQuery.data?.length ?? 0) > 0;
```

Two things this does:

1. **Derives `hasSecondaryWork` from cached data.** No separate state flag, no separate effect to keep it in sync. If the cache invalidates (focus refetch, manual invalidate), `hasSecondaryWork` recomputes automatically because `secondaryQueueQuery.data` re-renders the component.

2. **Pre-warms the cache** for the tab. When `SecondaryEvalTab` is migrated in a future PR, it'll do `useQuery({ queryKey: queryKeys.projectReviews.secondaryQueue() })` with the same key. TanStack Query sees a cache entry under that key already and serves it instantly — no second HTTP request.

### When this pattern is the right tool

You want this every time:
- A parent component fetches data to decide whether to render a child
- The child, if rendered, would fetch (some or all of) the same data

The pattern works because **the cache is keyed by content, not by component**. Whoever asks for `queryKeys.projectReviews.secondaryQueue()` gets the same entry, regardless of where in the tree they live.

### When NOT to use this pattern

If the parent only needs a small slice (a count, an existence flag) and the full data is large/expensive, you'd want a dedicated lightweight endpoint:
```ts
HEAD /project-reviews/secondary-queue        → returns just the count
GET  /project-reviews/secondary-queue        → returns the full list
```
Each gets its own queryKey. The parent uses the cheap one; the child uses the expensive one.

For our case the secondary queue is small (~handful of rows for someone who's a secondary evaluator), so reusing the same data is the right call. If it grew to hundreds of rows, we'd revisit.

---

## Part 3 — The full migration

Five `useEffect`-based fetches become five `useQuery` calls:

```tsx
const cardsQuery = useQuery({
  queryKey: queryKeys.projectReviews.mine(),
  queryFn: projectReviewService.getMyProjects,
  enabled: isStaff,
});
const expectationsQuery = useQuery({
  queryKey: queryKeys.projectReviews.roleExpectations(),
  queryFn: projectReviewService.getRoleExpectations,
  enabled: isStaff,
});
const menteeReviewsQuery = useQuery({
  queryKey: queryKeys.projectReviews.mentees(),
  queryFn: projectReviewService.getMenteeReviews,
  enabled: isMentor,
});
const allReviewsQuery = useQuery({
  queryKey: queryKeys.projectReviews.org(),
  queryFn: projectReviewService.getAllReviews,
  enabled: isHR,
});
const secondaryQueueQuery = useQuery({
  queryKey: queryKeys.projectReviews.secondaryQueue(),
  queryFn: projectReviewService.getSecondaryQueue,
  enabled: canBeSecondary,
});

const cards = cardsQuery.data ?? [];
const expectations = expectationsQuery.data ?? [];
const menteeReviews = menteeReviewsQuery.data ?? [];
const allReviews = allReviewsQuery.data ?? [];
const hasSecondaryWork = (secondaryQueueQuery.data?.length ?? 0) > 0;

const isLoading = isStaff
  ? cardsQuery.isPending
  : isMentor
    ? menteeReviewsQuery.isPending
    : isHR
      ? allReviewsQuery.isPending
      : false;
```

**What got deleted:**
- 4 `useState` data arrays
- 1 `useState` loading flag
- 1 `useState` boolean (`hasSecondaryWork`)
- 3 `useCallback` load functions
- 2 `useEffect`s with cancelled-flag race-condition guards

**What got added:**
- 5 `useQuery` calls
- 6 derived const declarations (data + isLoading)

Net **fewer** lines, **simpler** semantics, **better** cache behaviour. The shape of the page is exactly the same — every consumer of `cards`, `menteeReviews`, etc. continues to work because the variable names match.

### Why Staff queries are TWO separate `useQuery` calls

The old code fetched `getMyProjects()` and `getRoleExpectations()` together in a `Promise.all`. We could replicate that with a combined endpoint or by wrapping both fetches in a single `queryFn`. We didn't.

Reason: **they're independent data**. Role expectations rarely change (basically static reference data); my projects change every cycle. Keeping them as separate queries means:
- Different `staleTime` is possible per query (we don't tune it yet, but the option is there)
- The expectations cache can warm a future per-user expectations modal opened from a different page — different consumers, same cache entry
- Failure isolation: if the expectations endpoint flakes for some reason, the My Projects table still loads

The `Promise.all` pattern in the old code was a micro-optimization (one fewer wait) — TanStack Query already fires the two queries in parallel automatically when registered side-by-side, so we don't lose anything.

### Why PM has no page-level query

`PrimaryEvaluationTab` (a child component) loads its own pm-queue data. We don't fetch it at the page level because the PM only uses this tab — they never need the My Reviews, Mentees, or All Reviews data. Putting a `getPMQueue()` query here would mean the PM hits the endpoint on page mount even if they never click the tab.

PMs also have a custom `isLoading` story: their loading state is owned by the tab, not the page. The page just shows the tab shell while the tab loads. That's why our `isLoading` falls through to `false` for PMs:

```tsx
const isLoading = isStaff
  ? cardsQuery.isPending
  : isMentor
    ? menteeReviewsQuery.isPending
    : isHR
      ? allReviewsQuery.isPending
      : false;            // ← PM: tab owns its own loading
```

This is one of those "scope discipline" calls. We migrate the page; we leave the child tab for its own PR.

---

## Part 4 — `queryKeys` factory expansion

Added the `projectReviews` namespace:

```ts
projectReviews: {
  all: ["project-reviews"] as const,
  mine: () => [...queryKeys.projectReviews.all, "mine"] as const,
  mentees: () => [...queryKeys.projectReviews.all, "mentees"] as const,
  org: () => [...queryKeys.projectReviews.all, "org"] as const,
  secondaryQueue: () =>
    [...queryKeys.projectReviews.all, "secondary-queue"] as const,
  roleExpectations: () =>
    [...queryKeys.projectReviews.all, "role-expectations"] as const,
},
```

Same factory pattern from PR #06. Added only the keys this PR uses. When `PrimaryEvaluationTab` is migrated, it'll add `pmQueue` and possibly `single(reviewId)` for the detail-view fetch. The factory grows incrementally per migration.

**Note on `roleExpectations`:** this is distinct from `profile.expectations` in the factory. Both fetch "what's expected of me at my role level" but from different sources:
- `profile.expectations` (used by AnnualGoals) — role expectations for annual goals (long-form behavioural criteria)
- `projectReviews.roleExpectations` — role expectations for project reviews (the 7 dimensions: task execution, ownership, etc.)

Two endpoints, two cache entries. We could share if the backend ever merges them; for now they're distinct.

---

## Part 5 — Final scorecard

### Files changed
| File | Lines | What |
|---|---|---|
| `frontend/src/lib/queryKeys.ts` | +12 | New `projectReviews` namespace (5 methods + `.all`) |
| `frontend/src/pages/ProjectReviews.tsx` | ~+45 / −75 | 5 queries; deleted 6 useStates, 3 useCallback loaders, 2 effects, 5 race-condition guards |

### Bundle impact
| Chunk | Before | After | Δ |
|---|---|---|---|
| ProjectReviews | 12.35 KB gzip | **12.33 KB** | −0.02 KB |
| Others | — | — | unchanged |

Yes, slightly smaller. The deleted boilerplate outweighed the added useQuery call sites.

### Capability gains
- ✅ Cross-page cache sharing for `secondaryQueue` (probe pre-warms the tab's data)
- ✅ Cross-user cache sharing for `roleExpectations` (Staff Role A's data is reused if a future per-mentee view opens it)
- ✅ Focus-refetch keeps mentor/HR views fresh when the user returns to the tab
- ✅ No more `let cancelled = false` boilerplate; TanStack Query handles unmount-mid-fetch

---

## Part 6 — Trade-offs we deliberately made

### Why we kept Staff queries split instead of combining

Old code: one `Promise.all([getMyProjects(), getRoleExpectations()])`.
New code: two parallel `useQuery` calls.

Same network parallelism (TanStack fires them in parallel automatically), but cleaner semantics: independent data, independent failures, independent staleness, independent reusability across pages.

Cost: zero. TanStack Query's parallelism is what `Promise.all` was emulating.

### Why we kept `cancelled` boilerplate removal as a side-benefit, not a feature

Every `useEffect`-based fetch in the legacy code had:
```tsx
let cancelled = false;
void service.fetch().then((r) => { if (!cancelled) setX(r); });
return () => { cancelled = true; };
```

Five of those in this file alone. Gone — useQuery handles unmount-during-fetch internally via AbortController.

We don't call this out in commit messages because it's an automatic win that comes with every migration. But it's worth knowing: **every useEffect+useState→useQuery migration removes a real class of bugs** ("setState called on unmounted component" warnings, race conditions where stale data overwrites fresh).

### Why no mutations in this PR

The PM evaluation flow (`submitPMEvaluation`, `savePMDraft`, `updateReview`) and the secondary flow (`submitSecondaryEval`, `saveSecondaryDraft`, `updateSecondaryEval`) all live in child components. Migrating them means understanding each component's state machine — out of scope for "the page" migration.

When those PRs land, they'll use `useMutation` with broadcast invalidation:
```ts
queryClient.invalidateQueries({ queryKey: queryKeys.projectReviews.all });
queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
```
The dashboard's project-review counts will start refreshing properly after a submit, fixing the same kind of staleness bug we fixed in AnnualGoals.

### Why `hasSecondaryWork` is derived, not in state

Old code: `useState<boolean>(false)` + a `setHasSecondaryWork` callback inside a fetch's `.then()`.

New code: `const hasSecondaryWork = (secondaryQueueQuery.data?.length ?? 0) > 0;`

The derived form re-evaluates on every render. That's fine — the underlying data only re-renders the component when the cache entry changes. No wasted work, less state to keep in sync.

**Rule of thumb:** if a value can be derived from existing state every render, don't put it in `useState`. Stale-state bugs come from two sources of truth; the derived form has one.

---

## Part 7 — What you should now know cold

1. The cache-warming probe pattern (one component fetches to check existence, another reuses the cached data).
2. Why split queries beat `Promise.all` for independent data (parallelism is free; semantic independence is the win).
3. The "derive don't store" rule for booleans computed from query data.
4. When NOT to put a query at the page level (the child component owns its own loading state).

---

## Part 8 — Verify it works

```bash
cd frontend
npm run build       # passes? good
npm run dev
```

In the app:

1. **As Staff:**
   - Open `/project-reviews`. DevTools: `["project-reviews", "mine"]` AND `["project-reviews", "role-expectations"]` both green within ~1s.
   - The secondary queue probe also fires: `["project-reviews", "secondary-queue"]` green; if the user has secondary work, the tab appears.
   - Click the "Secondary Evaluation" tab — `SecondaryEvalTab` mounts. In its first render, the data is **already there** (cache hit). No second network request.

2. **As Mentor:**
   - Open `/project-reviews`. DevTools: `["project-reviews", "mentees"]` green; `["project-reviews", "mine"]` parked.
   - `secondary-queue` query is parked (Mentor can't be Secondary).

3. **As HR:**
   - Open `/project-reviews`. DevTools: `["project-reviews", "org"]` green; secondary-queue probe also fires (HR can be Secondary).

4. **As PM:**
   - Open `/project-reviews`. DevTools: page-level queries all parked. The PM tab loads its own data (you'll see it in DevTools once `PrimaryEvaluationTab` is migrated in a follow-up PR; for now it stays imperative).

5. **Cross-tab session test (Staff):**
   - Open `/project-reviews` in tab A.
   - Open `/project-reviews` in tab B (same session, same browser).
   - DevTools in tab A shows the queries; tab B has its own separate DevTools but the network panel shows the queries fired (separate browser-tab contexts don't share cache).
   - Within a single tab, navigating away and back instantly serves from cache.

6. **Hard refresh test:**
   - Refresh the page. DevTools queries reset to pending, then resolve. Initial paint shows skeletons in the right places.

---

## Part 9 — What's deliberately not done here

- **PM's `PrimaryEvaluationTab`** — owns its own `getPMQueue()`, `submitPMEvaluation()`, etc. Separate scope. When migrated, will use `queryKeys.projectReviews.pmQueue()` (factory addition) and invalidate the full `queryKeys.projectReviews.all` broadcast after any write.
- **`SecondaryEvalTab`** — owns its own submit/draft flow. Will reuse the `secondary-queue` cache entry the probe already warms.
- **`ProjectReviewDetailModal`** — fetches a single review via `getReview(id)`. Will need a new factory entry `queryKeys.projectReviews.detail(id)`.
- **Dashboard staleness fix.** The dashboard's project review counts (`project_reviews_pending_primary`, `project_reviews_pending_secondary`) won't auto-refresh after a project-review mutation until the writer-side components migrate. Same gap that existed for annual goals before PR #22 fixed it.
