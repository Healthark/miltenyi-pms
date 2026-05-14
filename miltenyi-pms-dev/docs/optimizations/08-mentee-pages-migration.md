# 08 — MyMentees + MenteeDetail: dynamic-key queries, cross-page cache sharing, and finishing deferred mentor-eval mutations

> **PR:** _pending_
> **Files changed:** `frontend/src/lib/queryKeys.ts` (added `mentees.detail(id)` + `mentees.pairings()`), `frontend/src/pages/MyMentees.tsx`, `frontend/src/pages/MenteeDetail.tsx`.
> **Headline result:** Three queries migrated (one with dynamic per-mentee key), two mutations that were deliberately deferred from PR #21 finally land in the cache architecture. Two cross-cutting teaching points reinforced: **cross-page cache sharing** (different pages, same key, one cache entry) and **`isPending` vs `isFetching`** (the `silent: true` reload pattern becomes obsolete).

---

## TL;DR

`MyMentees.tsx` has two role-gated sub-views: Mentor's roster (`getSummaries`) and HR's all-pairings grouped view (`getAllPairings`). `MenteeDetail.tsx` fetches one mentee at a time (`getDetail(menteeId)` — first **dynamic-key** read query in our codebase) and writes the two mentor-eval mutations (`submitMentorEval`, `saveMentorDraft`) that were left imperative back in PR #21 because they live in this page's drawer flow, not on the AnnualReviews page.

While porting `MenteeDetail`'s loading logic we drop the bespoke `silent: true` reload pattern entirely — TanStack Query's `isPending` flag distinguishes "first load ever" from "background refetch," which is the exact information the silent flag was trying to encode by hand.

The Mentor's roster (`queryKeys.mentees.summaries()`) is the **same key** `MentorDashboard` uses (introduced in PR #19). A mentor who visits `/dashboard` first and then navigates to `/my-mentees` sees instant data — and vice versa — without us writing a single line of "sharing" logic. **This is the cache architecture paying off across page boundaries**, the win we promised in PR #19 and can now finally point at.

---

## Part 1 — The new pattern: dynamic-key queries

The four migrations so far (`AdminPanel`, dashboards, `AnnualReviews`, `AnnualGoals`, `ProjectReviews`) all used static keys: `["admin", "users"]`, `["goals", "mine", "annual"]`, etc. The key was a literal tuple — every consumer of that data shared one cache entry.

`MenteeDetail` is different. Each mentee has a different URL (`/my-mentees/42`, `/my-mentees/57`, ...) and each one fetches different data from a different endpoint (`GET /mentees/42/detail`, `GET /mentees/57/detail`). We need a separate cache entry per mentee.

The factory pattern handles this naturally — the method takes a parameter:

```ts
mentees: {
  all: ["mentees"] as const,
  summaries: () => [...queryKeys.mentees.all, "summaries"] as const,
  pairings: () => [...queryKeys.mentees.all, "pairings"] as const,
  detail: (id: number) =>
    [...queryKeys.mentees.all, "detail", id] as const,   // ← dynamic key
},
```

And the consumer:

```tsx
const detailQuery = useQuery({
  queryKey: queryKeys.mentees.detail(menteeId),  // [...] = ["mentees", "detail", 42]
  queryFn: () => menteeService.getDetail(menteeId),
  enabled: Boolean(menteeId) && !Number.isNaN(menteeId),
});
```

**What this gives us:**
- Each mentee has its own cache entry, keyed by `["mentees", "detail", menteeId]`
- Switching from `/my-mentees/42` to `/my-mentees/57` is **not** a refetch of the same query — it's a new cache entry being populated. The first time you visit each mentee, there's a network round-trip; subsequent visits within `gcTime` (5 min default) are instant.
- The broadcast key `queryKeys.mentees.all` still catches **all** of them via prefix matching: `["mentees"]` matches `["mentees", "detail", 42]` AND `["mentees", "detail", 57]` AND `["mentees", "summaries"]` etc. Invalidate the namespace and every mentee's cache (and the roster, and the pairings) goes stale.

**The `enabled` gate** keeps the query parked when `menteeId` is NaN (which happens momentarily if the user hand-types `/my-mentees/abc`). Without the gate, we'd fire a request with `id=NaN` and the backend would 404.

We saw the parameterized-key pattern before with `queryKeys.dashboard.hrSummary(fy)` in PR #19. The mentee detail is the cleaner example because each mentee is a distinct, navigable URL.

---

## Part 2 — `isPending` vs `isFetching`

The old `MenteeDetail` had a clever loading-state trick:

```tsx
const loadDetail = useCallback(
  (options?: { silent?: boolean }) => {
    if (!options?.silent) setIsLoading(true);   // ← skip skeleton on reloads
    // ... fetch ...
  },
);

const reloadDetail = useCallback(() => {
  loadDetail({ silent: true });   // post-mutation reload: keep UI visible
}, [loadDetail]);
```

The intent: when a child component triggers a refresh (`reloadDetail`), we want the page to keep showing the existing data, NOT flash a skeleton, while the fetch happens in the background.

TanStack Query has this distinction first-class:

| Flag | True when | UI use |
|---|---|---|
| `isPending` | The query has NEVER successfully resolved | Show skeleton |
| `isFetching` | A fetch is in flight (initial OR background) | Optional spinner overlay |
| `isLoading` (v4 alias) | Same as `isPending` (deprecated name) | — |

After the first successful fetch, `isPending` is `false` forever (well, until the cache entry is garbage-collected). When an invalidation triggers a background refetch, `isPending` stays `false`, `isFetching` flips to `true`. `data` continues to hold the previous value the whole time.

This means **the JSX should gate on `isPending`**, not `isFetching`:

```tsx
const isLoading = detailQuery.isPending;  // skeleton only on first-ever load
```

The `silent: true` flag was hand-rolling the distinction. With useQuery we get it for free: every background refetch is automatically "silent" (data stays visible), and the only thing the user sees is the updated values once they land.

**Rule of thumb:** show skeletons for `isPending`. Show a subtle background spinner (a tiny corner icon, a thin progress bar at the top of the page) for `isFetching` if you want to communicate "data is updating," but it's optional. Most pages don't bother.

---

## Part 3 — Cross-page cache sharing

This is the win that's worth pausing on. `MyMentees.tsx`'s `MyMenteesView` uses:

```tsx
const menteesQuery = useQuery({
  queryKey: queryKeys.mentees.summaries(),  // ["mentees", "summaries"]
  queryFn: menteeService.getSummaries,
});
```

`MentorDashboard.tsx` (migrated in PR #19) uses the **exact same key**:

```tsx
const { data: mentees } = useQuery({
  queryKey: queryKeys.mentees.summaries(),  // ["mentees", "summaries"]
  queryFn: menteeService.getSummaries,
});
```

What happens at runtime:
1. Mentor opens the app, lands on `/dashboard` (their default). `MentorDashboard` mounts, fires `getSummaries`, populates cache entry `["mentees", "summaries"]`.
2. They navigate to `/my-mentees`. `MyMentees.tsx`'s `MyMenteesView` mounts, **the cache entry already exists**, `data` is returned synchronously, no network round-trip.
3. If we're past `staleTime` (30s default), a silent background refetch fires. The user sees instant data; the data updates a second later if anything changed.

This is **stale-while-revalidate across page boundaries.** We didn't write a single line of code to coordinate the two pages. The cache *is* the coordination — same key, same cache entry, regardless of where in the tree the consumer lives.

Compare to the pre-PR-#19 world: each page had its own `useState + useEffect`, each one fired its own request, each one had its own loading state. Three pages showing the same data meant three HTTP requests in flight per session. Now it's one.

When you plan a new page, ask: "is some other page going to want this data?" If yes, give them both the same `queryKey`. They share the cache for free.

---

## Part 4 — Finishing what PR #21 deferred

Doc 04 explicitly called out:
> **`EvalDrawer` / `useReviewDetails` mentor evaluation mutations.** Separate component scope; own PR. Until then, `['annual-reviews', 'mentees']` stays stale-tolerant via refetch-on-focus.

Those mutations (`submitMentorEval`, `saveMentorDraft`) actually live in `MenteeDetail.tsx` — they're called from inside `EvalDrawer` but the handlers are owned by this page. Now that we're touching the page, they migrate.

```tsx
const invalidateMentorEvalScope = useCallback(() => {
  void queryClient.invalidateQueries({ queryKey: queryKeys.mentees.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.annualReviews.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
}, [queryClient]);

const submitMentorEvalMutation = useMutation({
  mutationFn: (vars: { reviewId: number; payload: MentorEvalPayload }) =>
    annualReviewService.submitMentorEval(vars.reviewId, vars.payload),
  onSuccess: () => {
    invalidateMentorEvalScope();
    setEvalFy(null);
  },
  onError: (err) => setEvalError(getErrorMessage(err)),
});
```

**Three namespaces invalidated per mutation:**

| Namespace | Why |
|---|---|
| `mentees.all` | This mentee's detail (the page we're on) + the mentor's summaries (badge counts change) |
| `annualReviews.all` | TeamReviewTab, HR's All Reviews, the mentee's own history — all show this review row |
| `dashboard.all` | Mentor's `mentor_annual_reviews_pending` count in the dashboard widget |

Broadcast invalidation makes this clean — three `.all` keys, one helper, every relevant cache entry refreshed. The alternative (listing every specific key the mutation could touch) would be ~7-8 keys and easy to get incomplete.

**Recap of the "cost of invalidating broadly" argument** (from doc 05): invalidating a key with no observer is a no-op. The cache entry is just marked stale; nothing fires. When something later subscribes to that key, it sees stale and refetches. So `queryKeys.dashboard.all` from this page (where no dashboard widget is mounted) is essentially free.

---

## Part 5 — The unmigrated-children bridge pattern

`MenteeDetail` passes a `reloadDetail` callback to two child tabs that still do their own imperative mutations:

```tsx
<MenteeGoalsTab ... onReload={reloadDetail} />
<MenteeProjectsTab ... onReload={reloadDetail} />
```

The pre-migration `reloadDetail` was a useCallback that re-ran `menteeService.getDetail(menteeId)` and updated local state. With useQuery, the equivalent is invalidating that key:

```tsx
const reloadDetail = useCallback(() => {
  void queryClient.invalidateQueries({
    queryKey: queryKeys.mentees.detail(menteeId),
  });
}, [queryClient, menteeId]);
```

**Why keep the `onReload` prop API instead of removing it:**

The child tabs (`MenteeGoalsTab`, `MenteeProjectsTab`) aren't migrated to useQuery/useMutation yet — they're imperative. They expect to be told when to refresh. Two options at this PR boundary:

- **Migrate the children NOW.** Means understanding each tab's mutations, expanding scope, larger diff.
- **Bridge the API.** Keep the `onReload` prop; bind it to an invalidate call. Children stay untouched. When they migrate (own PR), they'll call `queryClient.invalidateQueries(...)` themselves and the `onReload` prop can be dropped.

We pick the bridge. Scope discipline beats migration completeness in any single PR.

**The pattern generalizes:** when a parent migrates and a child hasn't yet, expose a callback that does what the cache architecture would do internally. The child uses it the same way it always did. Future PR migrates the child and removes the prop.

---

## Part 6 — Final scorecard

### Files changed
| File | Lines | What |
|---|---|---|
| `frontend/src/lib/queryKeys.ts` | +6 | Added `mentees.detail(id)` and `mentees.pairings()` |
| `frontend/src/pages/MyMentees.tsx` | ~+30 / −45 | 2 queries; dropped 6 useStates (3 per sub-view) and 2 useEffect+cancelled patterns |
| `frontend/src/pages/MenteeDetail.tsx` | ~+75 / −60 | 1 dynamic-key query, 2 mutations, deleted `silent: true` reload machinery, kept `reloadDetail` as cache-invalidate bridge |

### Bundle impact
| Chunk | Before | After | Δ |
|---|---|---|---|
| MyMentees | 4.07 KB gzip | 4.08 KB | +0.01 KB |
| MenteeDetail | 12.99 KB | 13.10 KB | +0.11 KB |
| Other chunks | — | — | unchanged |

### Capability gains
- ✅ Cross-page cache sharing for `mentees.summaries` (MentorDashboard ↔ MyMentees)
- ✅ Per-mentee cache entries — switching between mentees is instant on revisit
- ✅ Mentor-eval mutations finally migrated; invalidation broadcast catches dashboard counts (fixes the same staleness bug pattern we hit in earlier PRs)
- ✅ Skeleton UX driven by `isPending` (first load only), no `silent: true` boilerplate
- ✅ The `onReload` bridge pattern is now templated for future child migrations

---

## Part 7 — Trade-offs we deliberately made

### Why three-namespace broadcast invalidation on mentor-eval mutations

A more conservative approach would list specific keys: `["annual-reviews", "mine"]`, `["annual-reviews", "org"]`, `["annual-reviews", "mentees"]`, `["mentees", "detail", thisId]`, `["mentees", "summaries"]`, `["dashboard", "summary"]`, `["dashboard", "hr-summary", anyFy]`...

That's 7+ keys to list, easy to forget one, and we'd add more keys as the schema grows. The three `.all` broadcasts catch everything under each namespace in one call each.

**Cost:** other cache entries under those namespaces (e.g. `["mentees", "summaries"]` when only the mentor's badge count is conceptually affected) get marked stale even when they didn't really change. Next time someone observes them, they refetch. The cost of an over-invalidation is one GET that returns essentially-the-same-data. Cheap.

**Benefit:** correctness. We never miss a key.

For mutations that affect many namespaces (mentor evaluations touch the mentee's profile, the review system, AND dashboard counts), broadcast is the right default.

### Why we didn't migrate the child tabs in this PR

`MenteeGoalsTab` and `MenteeProjectsTab` (still imperative) plus `MenteeAnnualSummaryTab` and `MenteeReviewTab` (probably read-only consumers) are all separate components. Migrating each is its own pattern:

- `MenteeGoalsTab` → has goal-approval mutations (mentor approves/rejects mentee goals). Belongs to a "TeamGoalsTab + MenteeGoalsTab + CriteriaChecklist" PR that consolidates the mentor-side goal review flow.
- `MenteeProjectsTab` → likely read-only over `data.project_assignments` which it gets as a prop. Probably nothing to migrate.
- `MenteeAnnualSummaryTab` + `MenteeReviewTab` → both render their tab's data from props (zero service calls); definitely nothing to migrate.

The `onReload` prop bridge means we can migrate them one-at-a-time later without touching MenteeDetail again.

### Why `MyMentees`'s `isHRMyOrg` branch uses a separate sub-component

`MyMentees.tsx` exports a wrapper that picks between `MyMenteesView` (Mentor) and `AllMentorPairings` (HR). Each sub-component has its own `useQuery`. Could be combined into one component with a role-gated `enabled` flag pattern like AnnualReviews.

We didn't combine because the two sub-views have **completely different UI** (a grid of mentee cards vs a grouped-by-mentor accordion). Sharing the query layer would just push the `if (isHRMyOrg) ... else ...` into the render. The current factoring is cleaner.

The two queries DON'T share a cache entry (different keys, different data shapes). HR_MyOrg never uses `mentees.summaries()` — they always use `mentees.pairings()`. Mentor never uses pairings. No cache-sharing win lost.

### Why we don't paginate `getAllPairings`

For HR_MyOrg with 1000+ employees, `getAllPairings` returns every mentor with their nested mentees. Could be 1000+ rows of data. The original audit flagged this as a candidate for pagination.

We're not paginating in this PR — pagination is a separate theme (the one we offered as the alternative direction). When that theme lands, `getAllPairings` becomes `getAllPairings({ cursor, limit })` and the query becomes a `useInfiniteQuery` with `getNextPageParam`.

For now, the page renders the whole list and HR's filter input does client-side narrowing. At sub-1000 orgs this is fine; at larger scales, virtualization + server pagination are the fix.

---

## Part 8 — What you should now know cold

1. The dynamic-key query pattern — `queryKeys.mentees.detail(id)` returns a unique tuple per `id`, giving each mentee its own cache entry.
2. The `isPending` vs `isFetching` distinction — skeleton on the first, optional subtle indicator on the second, NEVER both.
3. Why the `silent: true` reload pattern is unnecessary with useQuery — stale-while-revalidate is the default.
4. Cross-page cache sharing — same key, two pages, one cache entry. This is the architectural payoff of theme 2 you can now see in production.
5. The `onReload` bridge pattern for parent-migrated, child-unmigrated handoffs.
6. The broadcast-vs-explicit decision for mutations that affect many namespaces — broadcast wins when the alternative is 7+ explicit keys.

---

## Part 9 — Verify it works

```bash
cd frontend
npm run build       # passes? good
npm run dev
```

In the app:

1. **As Mentor — cross-page cache test:**
   - Log in. Land on `/dashboard`. Open DevTools.
   - Confirm `["mentees", "summaries"]` query fires once, lands as green.
   - Navigate to `/my-mentees`. **No new HTTP request** for the summaries — it should serve from cache.
   - The page renders instantly with the same data the dashboard widget shows.

2. **MenteeDetail per-mentee caching:**
   - From `/my-mentees`, click a mentee (say `/my-mentees/42`). DevTools shows `["mentees", "detail", 42]` fire and resolve.
   - Click "Back to mentees," then click a different mentee (`/my-mentees/57`). DevTools shows `["mentees", "detail", 57]` is a separate cache entry, fires its own request.
   - Click "Back to mentees," then click `/my-mentees/42` again. **No new request** — cache hit. Page renders instantly.

3. **`isPending` vs `isFetching`:**
   - On `/my-mentees/42`, open a tab where a child triggers `reloadDetail` (e.g., an action inside MenteeGoalsTab).
   - Watch the page: data stays visible (no skeleton flash), then updates when the refetch lands.
   - In DevTools, the query briefly flashes blue (isFetching=true, isPending=false) then back to green.

4. **Mentor-eval mutation invalidation:**
   - Open a mentee with a `pending_mentor` annual review.
   - Click "Evaluate" — drawer opens. Save a draft. Submit final evaluation.
   - DevTools: after the mutation success, `["mentees", ...]`, `["annual-reviews", ...]`, AND `["dashboard", ...]` should all flash blue → green (broadcast invalidation).
   - The page's tabs show updated state without a manual reload.

5. **HR_MyOrg pairings view:**
   - Switch to an HR_MyOrg user. `/my-mentees` renders `AllMentorPairings`.
   - DevTools: `["mentees", "pairings"]` fires and resolves; `["mentees", "summaries"]` is parked (never enabled for HR).

---

## Part 10 — What's deliberately not done here

- **Child tab migrations** (`MenteeGoalsTab`, `MenteeProjectsTab`, `MenteeAnnualSummaryTab`, `MenteeReviewTab`). The `onReload` bridge keeps the unmigrated ones working until they get their own PR.
- **Pagination for `getAllPairings`.** The HR view fetches every mentor + nested mentees in one shot. Fine at < 1000 employees; not at 5000+. Separate "pagination + virtualization" PR per the original audit.
- **`ManagementReview.tsx`**. Same theme (calls `annualReviewService.getCalibrationGrid`); its own page-level migration.
- **`PrimaryEvaluationTab` and `SecondaryEvalTab` of `ProjectReviews`**. Per PR #07's deferred list; will use the `projectReviews` namespace's existing factory entries + new keys for the PM-queue.
