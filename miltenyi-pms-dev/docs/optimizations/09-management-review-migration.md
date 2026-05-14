# 09 — ManagementReview: on-demand modal-driven queries and the rating-publish mutation

> **PR:** _pending_
> **Files changed:** `frontend/src/lib/queryKeys.ts` (added `annualReviews.calibration()` + `annualReviews.detail(id)`), `frontend/src/pages/ManagementReview.tsx`.
> **Headline result:** Last page-level migration done. New pattern documented: **modal-driven on-demand queries** — a query that fires only when the user opens a UI surface, replacing the imperative useEffect-on-prop-change pattern.

---

## TL;DR

`ManagementReview.tsx` is HR_MyOrg's calibration grid — every annual review in the active FY, with HR's ability to publish the final management rating inline. It has two reads and one write:

- **Calibration grid** (`getCalibrationGrid()`) — page-level table, fetched once on mount
- **Per-review detail** (`getReview(reviewId)`) — fetched **only when the Rate modal opens**, to show the mentee's self-narrative and the mentor's evaluation alongside the rating selector
- **Set management rating** (`setManagementRating(reviewId, payload)`) — the actual publish

The migration applies templates we already know — broadcast invalidation, `enabled`-gated dynamic-key queries — but it's the **first PR where a query is gated on a modal being open** rather than on a role or a URL param. That distinction is worth a section.

This is the last page-level migration. After this PR the only TanStack Query work remaining is **child components** (the goal-approval tabs, the eval drawers' internal mutations) and the **SystemSettingsProvider internal swap**. After that, the cache rollout is complete.

---

## Part 1 — The new pattern: modal-driven on-demand queries

### The shape of the problem

HR opens the Rate modal for one of the calibration rows. The modal needs the **full review detail** — mentee's self-narrative, mentor's evaluation text — which the calibration grid endpoint doesn't return (it's a lighter-weight per-row summary).

Pre-migration, the page had a useEffect keyed on `editTarget?.row.review_id`:

```tsx
useEffect(() => {
  const reviewId = editTarget?.row.review_id;
  if (reviewId == null) {
    setEditReview(null);
    setIsEditReviewLoading(false);
    setEditReviewError("");
    return;
  }
  let alive = true;
  setIsEditReviewLoading(true);
  setEditReview(null);
  setEditReviewError("");
  annualReviewService
    .getReview(reviewId)
    .then((r) => { if (alive) setEditReview(r); })
    .catch((err) => { if (alive) setEditReviewError(getErrorMessage(err)); })
    .finally(() => { if (alive) setIsEditReviewLoading(false); });
  return () => { alive = false; };
}, [editTarget?.row.review_id]);
```

That's a lot of code for "fetch this when the modal opens."

### The useQuery form

```tsx
const editReviewId = editTarget?.row.review_id ?? null;
const editReviewQuery = useQuery({
  queryKey: queryKeys.annualReviews.detail(editReviewId ?? -1),
  queryFn: () => annualReviewService.getReview(editReviewId as number),
  enabled: editReviewId !== null,
});
const editReview = editReviewQuery.data ?? null;
const isEditReviewLoading = editReviewId !== null && editReviewQuery.isPending;
const editReviewError = editReviewQuery.isError
  ? getErrorMessage(editReviewQuery.error)
  : "";
```

**Two things changed:**

1. **`enabled` does the gating.** When `editReviewId` is null (modal closed), the query is parked — no network call, no observers. When the modal opens, `editReviewId` becomes a real ID, the query fires.

2. **The cache is per-id.** `queryKeys.annualReviews.detail(42)` and `queryKeys.annualReviews.detail(57)` are separate cache entries. The same key was introduced in PR #25 for `mentees.detail(id)`; this is the same pattern at a different namespace.

**The cache-warming side effect:** if HR closes the Rate modal and reopens it for the **same review** within `gcTime` (5 min default), no second fetch fires. The legacy code refetched every modal open. This is a small but real UX win on the calibration workflow where HR sometimes opens, glances, closes, and reopens.

### The `?? -1` placeholder

```tsx
queryKey: queryKeys.annualReviews.detail(editReviewId ?? -1),
```

`queryKeys.annualReviews.detail(id)` expects a `number`. When `editReviewId` is `null`, we need a placeholder. Three options:

| Option | What | Cost |
|---|---|---|
| `?? -1` (used here) | Synthesize a sentinel id when the modal is closed | The "closed" cache entry is `["annual-reviews", "detail", -1]` — never matches a real review, never fetched (enabled=false), inert |
| Conditional query type | `useQuery({...} as ...)` with a union | Adds a TS dance with no real benefit |
| Make `detail(id)` accept `null` | `detail: (id: number \| null)` | Spreads `null` into the key; you'd see `[..., "detail", null]` in DevTools |

We picked `?? -1` because the cost is zero (enabled gates the fetch) and the DevTools display stays uniformly numeric. The sentinel never appears in any rendered UI — it's purely an internal placeholder while the modal is closed.

### When to use this pattern

- A modal / drawer / popover that fetches data only when opened
- A tab inside a tabbed page that's not the default
- Any "I need this data only if the user does X" flow

The `enabled` flag is the gate. The `queryKey` makes the data shareable across opens — close and reopen the same modal, get cached data.

---

## Part 2 — Calibration grid: a textbook migration

The grid itself is straightforward. Replace:

```tsx
const [rows, setRows] = useState<CalibrationRow[]>([]);
const [isLoading, setIsLoading] = useState(true);
const [loadError, setLoadError] = useState("");

const load = useCallback(async () => {
  setIsLoading(true);
  setLoadError("");
  try {
    setRows(await annualReviewService.getCalibrationGrid());
  } catch (err) {
    setLoadError(getErrorMessage(err));
  } finally {
    setIsLoading(false);
  }
}, []);

useEffect(() => { void load(); }, [load]);
```

With:

```tsx
const gridQuery = useQuery({
  queryKey: queryKeys.annualReviews.calibration(),
  queryFn: annualReviewService.getCalibrationGrid,
});
const rows: CalibrationRow[] = gridQuery.data ?? [];
const isLoading = gridQuery.isPending;
const loadError = gridQuery.isError ? getErrorMessage(gridQuery.error) : "";
```

Three useStates + one useCallback + one useEffect → one useQuery + three derived consts. The pattern by now is rote.

### Manual `load()` call after mutation, removed

The old `handleSave` ended with `await load()` to refresh the grid after the rating was published. The new mutation's `onSuccess` invalidates `annualReviews.all` (broadcast), which catches the calibration key automatically. **No manual refresh call needed.**

---

## Part 3 — The mutation

```tsx
const setRatingMutation = useMutation({
  mutationFn: (vars: { reviewId: number; rating: number }) =>
    annualReviewService.setManagementRating(vars.reviewId, {
      management_performance_rating: vars.rating,
    }),
  onSuccess: () => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.annualReviews.all,
    });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.dashboard.all,
    });
    closeEdit();
  },
  onError: (err) => setSaveError(getErrorMessage(err)),
});
const isSaving = setRatingMutation.isPending;
```

**Two broadcast invalidations:**

1. `queryKeys.annualReviews.all` catches:
   - The calibration grid (this row's rating fields change)
   - The detail query for this review (rating + status fields change)
   - Mentee's own history (`mine`) — they can now see the published rating
   - HR's `org` view of all reviews
   - TeamReviewTab (`mentees`) — the mentor sees the management rating
2. `queryKeys.dashboard.all` catches:
   - `AnnualReviewFunnelCard.completed` count moves when a review's status transitions to "completed" (the management-rating publish is what flips it)

The legacy code did `await load()` to refresh just the grid. The broadcast invalidation is **strictly more correct** — it fixes the same dashboard-staleness pattern earlier PRs noted. After publishing a management rating, the annual review funnel on the HR dashboard auto-refreshes; previously it required a manual page refresh.

### `mutate()` not `mutateAsync()`

```tsx
setRatingMutation.mutate({ reviewId: ..., rating: ... });
```

The Rate modal doesn't await `handleSave`. It's fire-and-forget — `onSuccess` closes the modal, `onError` surfaces `saveError` inline in the open modal. So plain `mutate()` is correct; `mutateAsync()` would force an unused `await` and try/catch.

Recall the rule from doc #03:
- `mutateAsync` when the caller (a modal) awaits to drive its own UI state
- `mutate` for everything else

The Rate modal's UX is: click "Publish Rating" → button shows spinner (driven by `setRatingMutation.isPending`) → either modal closes (onSuccess) or error renders inline (onError). No await needed at the call site.

---

## Part 4 — Factory additions

```ts
annualReviews: {
  all: ["annual-reviews"] as const,
  mine: () => [...annualReviews.all, "mine"] as const,
  org: () => [...annualReviews.all, "org"] as const,
  mentees: () => [...annualReviews.all, "mentees"] as const,
  calibration: () =>                              // NEW
    [...annualReviews.all, "calibration"] as const,
  detail: (id: number) =>                         // NEW (dynamic)
    [...annualReviews.all, "detail", id] as const,
},
```

The `detail(id)` accessor here is the **second** dynamic-key entry across the codebase (the first was `mentees.detail(id)` in PR #25). Same pattern: parameter goes into the key as the last segment, and TanStack Query's prefix matching means `queryKeys.annualReviews.all` invalidates every `detail(id)` along with `calibration`, `mine`, `org`, `mentees`.

---

## Part 5 — Final scorecard

### Files changed
| File | Lines | What |
|---|---|---|
| `frontend/src/lib/queryKeys.ts` | +8 | Added `annualReviews.calibration()` + `annualReviews.detail(id)` |
| `frontend/src/pages/ManagementReview.tsx` | ~+50 / −70 | 2 queries + 1 mutation; deleted `load()` useCallback, the modal-driven useEffect, `loadError`/`isSaving`/`isEditReviewLoading`/`editReview`/`editReviewError` useStates |

### Bundle impact
| Chunk | Before | After | Δ |
|---|---|---|---|
| ManagementReview | 4.05 KB gzip | 4.08 KB | +0.03 KB (mutation wrapper) |
| Other chunks | — | — | unchanged |

### Capability gains
- ✅ Per-review detail caches across modal opens (second-open is instant for the same review)
- ✅ Dashboard annual-review funnel auto-refreshes after a rating publishes (fixes pre-existing staleness)
- ✅ Mentee's own history auto-refreshes after their management rating publishes (same fix, mentee-facing)
- ✅ TeamReviewTab (the mentor's view) auto-refreshes after their mentee's review completes
- ✅ Page-level migrations are now **complete** — every page in the app uses the cache architecture

---

## Part 6 — Trade-offs we deliberately made

### Why `?? -1` instead of typing `detail` to accept `null`

We could make the factory accept `null`:

```ts
detail: (id: number | null) =>
  [...annualReviews.all, "detail", id] as const,
```

Then the call site is `queryKeys.annualReviews.detail(editReviewId)` without the `?? -1`. Cleaner at the call site, BUT:

- The DevTools display would show `[..., "detail", null]` for the closed-modal placeholder entry
- Future readers of the factory would have to remember "the `null` case is for queries that aren't enabled yet"
- The sentinel value (`null` vs `-1`) is purely an internal placeholder — the user never sees it either way

We picked `?? -1` because it keeps the factory signature clean (`detail(id: number)` reads as "give me the data for THIS id"). The sentinel only appears at one call site (the modal handler), where the inert nature is documented inline.

### Why no `staleTime` override on `calibration`

The calibration grid changes frequently during active rating cycles — every time HR publishes a rating, the row's status moves. Default 30s staleTime + broadcast invalidation on every mutation = grid stays fresh.

We considered `staleTime: 0` to make every revisit refetch silently, but the broadcast invalidation on the mutation gives us the same effect at the moment data could actually change. Keeping the default is consistent with other list endpoints.

### Why the mutation invalidates `annualReviews.all` instead of listing children

Same trade-off discussion as PR #22 (broadcast vs explicit lists). For an `annualReviews` mutation that:

- Modifies one specific review
- Changes its status (rating publish flips the lifecycle)
- Affects the calibration grid (this row's columns change)
- Affects the detail query for this exact id
- Affects the mentee's `mine` history (they can now see the rating)
- Affects HR's `org` view
- Affects the mentor's `mentees` view (TeamReviewTab)

...that's 4+ keys to list. Broadcast wins. The factory's `.all` accessor matches all five children with one call.

The dashboard invalidation stays explicit (`queryKeys.dashboard.all`) because it's a separate namespace — broadcast inside `annualReviews` wouldn't catch it.

### Why we kept the `editTarget` useState

`editTarget` holds the current Rate-modal state: which row is being edited + the in-progress rating draft. This is **client state**, not server state — it lives only in this tab, it changes from user interaction, no server is involved. `useState` is the right tool.

Don't migrate everything to useQuery. Server data → useQuery. Client state → useState. Separating them is the whole point of theme 2 (doc #02 part 1).

---

## Part 7 — What you should now know cold

1. The modal-driven on-demand query pattern — `enabled` gates fetch on a modal being open.
2. The `?? -1` sentinel pattern for factory methods that require non-nullable parameters in the enabled-false case.
3. Why broadcast invalidation across `annualReviews.all` is correct here (4+ children would be affected anyway).
4. The "page-level migrations are complete" milestone — what's still left vs what's done.

---

## Part 8 — Verify it works

```bash
cd frontend
npm run build       # passes? good
npm run dev
```

In the app (as HR_MyOrg):

1. **Calibration grid loads:**
   - Open `/management-review`. DevTools: `["annual-reviews", "calibration"]` flashes blue → green.

2. **On-demand detail fetch:**
   - Click the Rate (pencil) icon on a row with `pending_management` status.
   - The modal opens. DevTools shows `["annual-reviews", "detail", <reviewId>]` flash blue → green.
   - The self + mentor narrative renders alongside the rating selector.

3. **Modal cache test:**
   - Close the modal. Reopen the same row. **No new request** — DevTools shows the detail query stays green (still in cache).
   - Open a different row. New cache entry fires.

4. **Publish a rating:**
   - With the modal open, pick a rating, click "Publish Rating," confirm in the dialog.
   - Mutation fires. DevTools: BOTH `["annual-reviews", ...]` AND `["dashboard", ...]` namespaces flash blue → green (broadcast invalidation).
   - Modal closes. Grid row reflects the new rating without a page refresh.
   - Navigate to `/dashboard` (HR dashboard) — the `AnnualReviewFunnelCard` reflects the completed-count bump (this is the staleness fix).

5. **Closed-modal placeholder:**
   - With no row being edited, DevTools should NOT show any active `["annual-reviews", "detail", ...]` query.
   - You might see one or more cache entries for previously-opened reviews (from step 3) — those are stale-cached, not fetching.

6. **Error path:**
   - Hack a 400 response (e.g. set rating to 0 if the backend rejects, or pause your network and try to publish).
   - `saveError` displays inline in the modal. Modal stays open. DevTools shows the mutation in error state under the "Mutations" tab.

---

## Part 9 — What's deliberately not done here

- **`EvalDrawer` + `useReviewDetails`** — these handle in-place mentor-eval edits from various pages. Will use `queryKeys.annualReviews.detail(id)` (added in this PR) when migrated.
- **`PrimaryEvaluationTab` + `SecondaryEvalTab`** of `ProjectReviews` — own child-component migration PR.
- **`TeamGoalsTab`, `MenteeGoalsTab`, `CriteriaChecklist`** — the mentor-side goal flow.
- **`SystemSettingsProvider`** — swap the hand-rolled context cache for `useQuery` internally; public API (`useSystemSettings()`) unchanged.

The page-level migration arc is now done. What remains is interior (child components) and infrastructure (SystemSettingsProvider). After those, the cache rollout is complete and we pivot to a fresh theme (pagination + virtualization or memoization).
