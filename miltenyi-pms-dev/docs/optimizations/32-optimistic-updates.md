# 32 — Optimistic updates: instant-feel mutations via `onMutate` + rollback

> **PR:** [#50](https://github.com/Healthark/miltenyi-pms/pull/50)
> **Files changed:** `frontend/src/lib/optimistic.ts` (new), `frontend/src/pages/ManagementReview.tsx`, `frontend/src/components/goals/TeamGoalsTab.tsx`, `frontend/src/pages/MenteeDetail.tsx`.
> **Headline result:** Opens theme 6 — the first non-data-volume optimization in the arc. After 31 docs of "fetch less / render less / sort in SQL," this one's about **perceived latency**: clicking "Approve" or "Publish Rating" no longer waits for the network round-trip before the UI reflects the change. New shared `patchRowsAcross` helper handles both `useQuery<T[]>` and `useInfiniteQuery` paginated-cache shapes — important because theme 5 baked filter/sort into queryKeys, so a single affected row can live in many cache entries that all need patching. Applied to four high-frequency mutations; deliberately skipped one (documented). Bundle: ~+0.4 KB gzip across three pages for the helper + four call-site rewrites.

---

## TL;DR

The TanStack Query optimistic-update recipe is well-known, three lifecycle hooks:

1. **`onMutate`**: snapshot current cache state → apply optimistic patch via `setQueryData` → return rollback context.
2. **`onError`**: restore from snapshot.
3. **`onSettled`**: invalidate to revalidate against server truth (fires on success OR failure).

What makes the application interesting after theme 5:

| Concept | Why it matters here |
|---|---|
| **Cache shape varies** | Some queries are `useQuery<T[]>` (`reviews_list`, `goals` array); others are `useInfiniteQuery` returning `{ pages: [{ items: T[] }] }`. Optimistic patches need to handle both. |
| **Multiple cache entries per row** | Theme 5 made filter + sort part of the queryKey. A single review can appear in 5+ cache entries (different filter combos). Optimistic patches must walk them all. |
| **Identity isn't always `.id`** | `CalibrationRow` uses `review_id` (nullable!) instead of `id`. The helper takes a predicate, not a key field. |
| **When NOT to be optimistic** | Some mutations don't benefit — server-generated IDs (CREATE flows), bulk operations with partial failures, admin CRUD. Documented as deliberate exclusions. |

Four mutations got the treatment:
- **`setManagementRating`** (ManagementReview) — single-field update on calibration grid.
- **`approveGoal`** (TeamGoalsTab) — status transition.
- **`requestChanges`** (TeamGoalsTab) — status transition + feedback text patch.
- **`submitMentorEval`** (MenteeDetail) — status transition + multi-field patch (clears drafts, sets submitted values).

---

## Part 1 — The shared helper

```ts
// frontend/src/lib/optimistic.ts
export function patchRowsAcross<T>(
  queryClient: QueryClient,
  prefix: QueryKey,
  predicate: (row: T) => boolean,
  patch: Partial<T> | ((row: T) => T),
): OptimisticSnapshot;
```

Three responsibilities:

### 1. Walk every cache entry under a prefix

`queryClient.getQueriesData({ queryKey: prefix })` returns every cache entry whose key starts with `prefix`. So passing `queryKeys.annualReviews.all` (which is `['annual-reviews']`) yields entries like:

- `['annual-reviews', 'org', { cycle: 'Q1', status: 'pending_mentor' }]` (HR's filtered list)
- `['annual-reviews', 'calibration', { function: 'Eng' }]` (calibration grid, function filter)
- `['annual-reviews', 'mentees', {}]` (mentor view)
- `['annual-reviews', 'detail', 42]` (one open Rate modal)

A review the user is editing could live in **any of these**. The helper patches whichever entries contain it.

### 2. Handle two cache shapes

```ts
if (isInfiniteData<T>(data)) {
  // { pages: [{ items: T[], ... }], pageParams: [...] }
  // Walk pages, patch matching items, return new pages array.
} else if (Array.isArray(data)) {
  // T[] from a plain useQuery.
} else {
  // Single T from a useQuery (e.g., detail endpoint).
}
```

The detection is duck-typed (`"pages" in data && "pageParams" in data`) so we don't take a hard dependency on `InfiniteData<T>`'s exported type — TanStack Query has tweaked that import path between minor versions.

### 3. Return a rollback snapshot

```ts
return {
  restore: () => {
    for (const { key, data } of restoreList) {
      queryClient.setQueryData(key, data);
    }
  },
};
```

The snapshot stores the **original references**. Calling `.restore()` puts them back identity-equal — observers see the same object reference they had before the patch, which avoids spurious re-renders if React's `===` checks happen to fire on top-level data.

### Why no type constraint on `T`

The original draft had `T extends { id: number }`. That broke for `CalibrationRow` which uses `review_id` (and which is nullable). Lesson: the helper doesn't actually USE any field on `T` — that's the predicate's job. Don't constrain what you don't use.

---

## Part 2 — The pattern at a call site

```ts
const setRatingMutation = useMutation({
  mutationFn: (vars) => annualReviewService.setManagementRating(vars.reviewId, {
    management_performance_rating: vars.rating,
  }),

  onMutate: async (vars) => {
    // 1. Cancel in-flight refetches under the affected prefix.
    //    Otherwise a stale response can land AFTER the optimistic
    //    patch and overwrite it.
    await queryClient.cancelQueries({ queryKey: queryKeys.annualReviews.all });

    // 2. Apply the patch + snapshot the original state.
    const snapshot = patchRowsAcross<CalibrationRow>(
      queryClient,
      queryKeys.annualReviews.all,
      (r) => r.review_id === vars.reviewId,
      {
        management_performance_rating: vars.rating,
        final_performance_rating: vars.rating,
        final_rating_enabled: true,
        status: "completed",
      },
    );

    // 3. Return rollback context.
    return { snapshot };
  },

  onSuccess: () => {
    closeEdit();  // close the modal AFTER server confirms
  },

  onError: (err, _vars, context) => {
    context?.snapshot.restore();          // rollback
    setSaveError(getErrorMessage(err));   // in-modal error
  },

  onSettled: () => {
    // Revalidate against truth — fires on success AND failure.
    void queryClient.invalidateQueries({ queryKey: queryKeys.annualReviews.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  },
});
```

Five points worth naming:

#### 1. `cancelQueries` MUST come before the patch

If a refetch is mid-flight (HR opens the page, a 200ms response is on its way back), and we patch the cache, then the refetch lands and OVERWRITES the patch. The user sees the optimistic change for ~50ms then the old state pops back. `cancelQueries` short-circuits the in-flight request.

It returns a Promise — `await` it, otherwise the patch races the cancellation.

#### 2. The patch object mirrors what the server will eventually return

`final_performance_rating: vars.rating` plus `final_rating_enabled: true` plus `status: 'completed'` — these are exactly what the backend produces. Optimistic UI lies to itself about what the server will return; the lie has to be CORRECT, otherwise the `onSettled` revalidation will visibly flip values right after.

Pre-empting the backend's behavior here means reading the route carefully and mirroring its post-conditions. Easy to get wrong; review-pair this against the actual SQLAlchemy update.

#### 3. The modal stays open on `onMutate` — closes on `onSuccess`

A subtler UX decision. Closing the modal immediately would feel snappier — but it loses the in-modal error slot if the request fails. Keeping the modal open until `onSuccess` lets `onError` populate `saveError` and the user retry without losing the form context.

The instant-feel win comes from the **calibration grid row updating in the background**, not the modal close. The user clicks "Publish" → glances at the row behind the modal → sees the new rating → modal closes a beat later. Same perceived speed, recoverable on failure.

#### 4. `onSettled` is the universal revalidator

Fires on both success and error. Use it for invalidation — `onSuccess` would skip revalidation on a failure (leaving the optimistic patch in place if `onError` somehow forgot to roll back); `onError` would skip revalidation on success (missing any drift between optimistic patch and actual server state).

In practice: `onMutate` patches → `mutationFn` runs → `onSuccess` OR `onError` runs → `onSettled` always runs. Put cleanup that doesn't depend on outcome in `onSettled`.

#### 5. Type the predicate carefully

```ts
patchRowsAcross<CalibrationRow>(
  queryClient,
  queryKeys.annualReviews.all,
  (r) => r.review_id === vars.reviewId,
  { management_performance_rating: vars.rating, /* … */ },
)
```

The generic `<CalibrationRow>` flows into the predicate (`r` is typed as `CalibrationRow`) and the patch (must be `Partial<CalibrationRow>`). Both predicate and patch get type-checked against the same row shape.

When the same cache entry happens to also contain rows of a different type (e.g., a different namespace under the same prefix) the predicate just returns false for those — no patching, no crash.

---

## Part 3 — When NOT to make a mutation optimistic

This is the load-bearing part of the doc. The instinct after seeing optimistic updates work is "make every mutation optimistic." Don't. Some have real reasons to stay synchronous.

### CREATE flows (server-generated ID)

`submitSelfReview` on `/annual-reviews/self` creates a NEW review row when the user has no draft yet:

```python
@router.post("/self", response_model=AnnualReviewResponse)
def submit_self_review(...):
    review = AnnualReview(
        user_id=current_user.id,
        cycle_name=active_cycle,
        # ...
    )
    db.add(review)
    db.commit()
    db.refresh(review)  # populates `id`, `created_at`
    return review
```

The frontend doesn't know `review.id` until the server returns. Optimistic-adding a row to the cache means inventing a temp ID (`Math.random()`, negative number, UUID, ...), then RECONCILING the temp ID with the server-assigned ID in `onSuccess`. That's the "temp-ID pattern" — possible but invasive:

- Cache entries hold the temp-ID row throughout the request.
- `onSuccess` walks every cache entry and replaces the temp-ID row with the server's response.
- The user can't refresh the page mid-request (the temp-ID row would persist).
- If the request fails, rollback removes the temp-ID row (fine).
- If the user immediately edits the just-created row, the edit references the temp ID — needs another reconciliation pass.

For a once-per-cycle action like submitting an annual self-review, the user is deliberate and prepared to wait briefly. The optimistic-feel win is small; the implementation complexity is high. **Skip it.**

### Bulk operations with partial failures

`bulkApprove` returns `{ approved_ids: [...], failures: [{ goal_id, reason }] }`. The UI shows different feedback per outcome. Optimistically marking all goals as approved, then rolling back ONLY the failures, requires tracking which specific patches failed — doable but the per-row reconciliation negates the simplicity that makes optimistic worth doing. **Skip it.**

### Admin CRUD (low frequency)

Creating/updating/deleting users in the admin panel happens once every few weeks per org. The user is a deliberate admin doing intentional work; 200ms of network latency is invisible. **Skip it.**

### Irreversible / destructive operations

Settings save, account deletion, billing changes. If the server fails the rollback is correct but the user has already perceived "it happened" — that's bad UX for irreversible actions. **Always wait for server confirmation.**

### Heuristic, condensed

| Make optimistic when | Skip optimistic when |
|---|---|
| Mutation is frequent (hot path) | Mutation is rare (once per cycle) |
| The patch shape is fully known client-side | Server generates a new ID or other unknowable values |
| Failure is rare and recoverable | Failure is common or destructive |
| The user is rapidly interacting | The user is deliberate, expects to wait |

---

## Part 4 — The four mutations we shipped

### `setManagementRating` (ManagementReview)

**Why:** HR's rating-publish flow. Modal opens, HR picks 1-5, clicks Publish. Pre-PR: 200-500ms wait while the modal sits there. Post-PR: row flips to "completed" + rating populates in the calibration grid the moment they click. Modal stays open one beat to confirm; closes on success.

**Patch:** `management_performance_rating`, `final_performance_rating` (synthesized fallback), `final_rating_enabled: true`, `status: "completed"`. All four mirror the backend's `set_management_rating` route.

**Identity:** `r.review_id === vars.reviewId` (because `CalibrationRow.review_id` is the unique identifier, not `id`).

### `approveGoal` + `requestChanges` (TeamGoalsTab)

**Why:** Mentor reviewing the goal-approval queue. Clicks Approve → goal vanishes from "Pending Approval" filter (the row's `approval_status` changes, the active filter no longer matches). Pre-PR: 200-300ms wait + the row stayed visible during it; mentor often double-clicked thinking it didn't register.

**Patch:** `approval_status: "approved"` for approve, `{ approval_status: "changes_requested", manager_feedback: feedback }` for requestChanges.

**Note on filter interaction:** the row may no longer match the user's current filter after the patch (e.g., filter = `pending_approval`, new status = `approved`). The helper doesn't try to remove the row from the page — it just patches in place. `onSettled` invalidates the queries, which triggers a refetch that produces the correct filtered result. Brief visual blip (row stays visible for ~100ms with mismatched status). Acceptable.

### `submitMentorEval` (MenteeDetail)

**Why:** Mentor finishes evaluating, hits Submit. Status advances pending_mentor → pending_management.

**Patch:** Multi-field: `status`, `mentor_overall_review`, `mentor_performance_rating`, plus **nulling out the draft columns** because the backend clears them on submit. If we didn't null the drafts in the optimistic patch, the UI would briefly show "draft 4/5 + submitted 4/5" side-by-side, which looks wrong.

**Two prefixes patched:** `queryKeys.annualReviews.all` AND `queryKeys.mentees.all` (the mentee profile page caches reviews under both). The helper runs twice with different snapshots; both get rolled back if the request fails.

---

## Part 5 — What this PR does NOT cover

- **`submitSelfReview`** — temp-ID pattern, deliberately skipped (Part 3).
- **`bulkApprove`** — partial-failure semantics, skipped (Part 3).
- **`saveMentorReviewDraft` / `saveSelfReviewDraft`** — auto-save UX. Draft saves are slightly different: the user is typing, the request fires periodically, errors don't really need rollback (the user keeps their text in the local state). Optimistic might help here but it's a different pattern (debounced + tolerant of stale responses). Worth its own PR if anyone wants the polish.
- **Admin CRUD** (`AdminPanel`) — low frequency, no benefit (Part 3).
- **`submitMentorReview` on goals** (half-yearly cycle reviews) — similar to `submitMentorEval` on annual reviews; could be added with the same pattern. Skipped this PR for scope.
- **Goal create** (`AnnualGoals`) — CREATE flow, temp-ID complication.
- **Project review writes** (`PrimaryEvaluationTab`, `SecondaryEvalTab`) — similar shapes to the mentor flows; could be added. Skipped this PR for scope.

If theme 6 continues, the natural follow-ups are the remaining ~3-5 high-frequency mutations (mentor-review submits on goals, PM evaluation submits, secondary-eval submits).

---

## Trade-offs

- **Optimistic state can lie.** If the patch is wrong (forgot a field, mis-typed a value), the UI shows the wrong thing for ~200ms then `onSettled` revalidates. Manageable; documented loudly.
- **Cache memory accumulates patches.** Each mutation creates a snapshot + a new cache entry value. Old values get GC'd after `gcTime` (default 5min). No memory leak concern at our scale.
- **The helper is 100 LOC.** Not negligible. But it's reused 4× in this PR and would be reused 4-6× more if theme 6 continues. Beats inlining ~40 LOC of boilerplate per mutation.
- **Filter-mismatch visual blip.** Row may stay visible under a non-matching filter for ~100ms until `onSettled` triggers refetch. Documented in Part 4.
- **Modal-close timing is a per-mutation choice.** `setManagementRating` keeps modal open until success (recoverable error). Another mutation might prefer immediate-close + snackbar-on-error. No single "right" answer — depends on whether the modal carries unrecoverable form state.

---

## Verification

```bash
cd frontend
npm run build
```

Expected:
- `ManagementReview-*.js` ~17.88 KB raw / **~4.67 KB gzip** (+0.11 KB)
- `AnnualGoals-*.js` ~76.87 KB raw / **~15.48 KB gzip** (+0.12 KB — TeamGoalsTab is bundled here)
- `MenteeDetail-*.js` ~63.44 KB raw / **~13.47 KB gzip** (+0.16 KB)

End-to-end:

**setManagementRating:**
- As HR_MyOrg, open `/management-review`, click Rate on a row.
- Set rating to 4, click Publish.
- Observe: **the row in the calibration grid behind the modal updates INSTANTLY** (status → Completed, Management Rating cell → 4). Modal stays open for the ~200-500ms server round-trip, then closes.
- If you can simulate a backend error (kill the backend, try to publish): row should ROLL BACK to original state, modal stays open, error appears in the modal's saveError slot.

**approveGoal:**
- As Mentor, open `/annual-goals` → Team Goals → Pending Approval queue.
- Click Approve on a goal. Row's status badge flips to "Approved" instantly. Toast appears once the server confirms.
- Rollback test: with backend down, row reverts after a moment.

**requestChanges:**
- Click Request Changes, write feedback, submit. Row's status flips to "Changes Requested" + the feedback text populates immediately. Modal closes on success.

**submitMentorEval:**
- As Mentor with a pending-mentor review, click Evaluate → fill in → Submit. Row's status flips from "Pending Mentor" to "Pending Management" instantly. Draft fields cleared in cache.

**Cache invariant:** During each optimistic action, open React Query DevTools — observe `cancelQueries` firing on the prefix, then `setQueryData` updates, then on `onSettled` the queries marked stale + refetched.

---

## What's next

Theme 6 is OPEN — this is its foundation PR. Possible follow-ups:

- **More mutations** — half-yearly mentor reviews, PM evaluations, secondary evals. Mechanical applications of the pattern.
- **Draft auto-save optimistic** — separate pattern; debounced, tolerant of stale responses. Worth its own doc.
- **Concurrent mutations** — what if a user double-clicks Approve? TanStack Query's mutation cache handles this (parallel requests with their own rollback contexts), but the doc could cover edge cases.

Or stop here — one foundation PR + four call sites is a coherent starting point. The arc remains at a natural endpoint either way.
