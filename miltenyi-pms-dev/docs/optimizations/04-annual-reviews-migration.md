# 04 — AnnualReviews + TeamReviewTab migration: role-gated queries with `enabled`

> **PR:** [#21](https://github.com/Healthark/miltenyi-pms/pull/21)
> **Files changed:** `frontend/src/pages/AnnualReviews.tsx`, `frontend/src/components/reviews/TeamReviewTab.tsx`.
> **Headline result:** Three queries migrated (`getMyReviewHistory`, `getAllReviews`, `getMenteeReviews`), two mutations migrated (`submitSelfReview`, draft save). New pattern introduced: **role-gated `enabled` queries** + **multi-key invalidation**.

---

## TL;DR

This is the first PR where the same page is read by **three different roles** that need **different data**. We use TanStack Query's `enabled` flag to register all the queries unconditionally (hooks order rule) but only fire the one the current user actually needs.

We also introduce **multi-key invalidation**: when a Staff user submits a self-review, the mutation invalidates BOTH `['annual-reviews', 'mine']` AND `['annual-reviews', 'all']`. The Staff user only sees their own history; the HR user (if any are logged in elsewhere) sees the new row appear in the All Reviews table without doing anything. This is the cache acting as a cross-user broadcast channel.

Mentor evaluation mutations (`submitMentorEval`, `saveMentorDraft`) are **not** migrated in this PR — they live in `EvalDrawer` / `useReviewDetails`, not in `AnnualReviews.tsx`. Separate scope, separate PR.

---

## Part 1 — The new patterns introduced

If you've read docs #02 and #03 you already know `useQuery` and `useMutation`. This PR adds two new ideas on top of them.

### Pattern A — Role-gated queries with `enabled`

Three roles render this page with three different data needs:

| Role | What they fetch | Why |
|---|---|---|
| Staff | `getMyReviewHistory()` | "Show me my own self-reviews" |
| Mentor | `getMenteeReviews()` (via `TeamReviewTab`) | "Show me my mentees' reviews" |
| HR_MyOrg | `getAllReviews()` | "Show me every annual review in the org" |

The naive approach is `if (isStaff) useQuery({...})`. **This breaks the Rules of Hooks** — you can't conditionally call a hook. React tracks hook calls by order, and conditional registration shifts that order between renders, which crashes the reconciler.

The right approach: **always register the query, gate the fetch with `enabled`**:

```tsx
const myReviewsQuery = useQuery({
  queryKey: ["annual-reviews", "mine"],
  queryFn: annualReviewService.getMyReviewHistory,
  enabled: isStaff,           // ← the gate
});
const allReviewsQuery = useQuery({
  queryKey: ["annual-reviews", "all"],
  queryFn: annualReviewService.getAllReviews,
  enabled: isHRMyOrg,
});
```

What `enabled: false` actually does:
- The hook still runs (Rules of Hooks happy)
- The cache entry is registered but no network request fires
- `data` is `undefined`, `isPending` is `true`, `status` is `'pending'`
- The query stays "parked." If `enabled` later flips to `true` (e.g. role updates from a session refresh), the query fires automatically

This is the canonical pattern for "fetch only if X is true." Use it for:
- Role-based data
- Param-driven data (`enabled: id !== null`)
- Step-by-step flows ("fetch step 2 only after step 1 succeeds")
- Anywhere you'd otherwise want `if (cond) useQuery(...)` — replace with `useQuery({ enabled: cond })`

### Pattern B — Multi-key invalidation

When a Staff user submits their self-review, the new row is now in the database. **Who needs to know?**

- The Staff user themselves — their history list (`['annual-reviews', 'mine']`) shows the new row
- Any HR user looking at All Reviews on another tab/machine — their list (`['annual-reviews', 'all']`) needs the new row

The old code only updated local Staff state with `setReviews((prev) => [...])`. HR's view was stale until they refreshed.

The new code:

```tsx
const submitMutation = useMutation({
  mutationFn: annualReviewService.submitSelfReview,
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["annual-reviews", "mine"] });
    void queryClient.invalidateQueries({ queryKey: ["annual-reviews", "all"] });
    // ...
  },
  // ...
});
```

**Two `invalidateQueries` calls in one `onSuccess`.** Each write declares **every** key it could affect, not just the one the current user is looking at. That's the real unlock of theme 2's cache architecture: cross-key invalidation is essentially free, and missing one is a stale-UI bug.

**How to know which keys to invalidate:** ask "after this write succeeds, what cached data is now out of date?" Walk the list:
- `submitSelfReview` creates / promotes a row in the user's own history → invalidate `['annual-reviews', 'mine']`
- That same row appears in HR's org-wide view → invalidate `['annual-reviews', 'all']`
- Mentor's mentee list also changes if this user is someone's mentee → invalidate `['annual-reviews', 'mentees']` (we don't yet, see Part 5)

You'll undershoot at first. The fix is mechanical — add the missing key invalidation when you notice the staleness.

---

## Part 2 — The work, step by step

### Step 1 — Replace the role-branched `load()` callback

**Before:**
```tsx
const [reviews, setReviews] = useState<AnnualReview[]>([]);
const [allReviews, setAllReviews] = useState<AnnualReview[]>([]);
const [isLoading, setIsLoading] = useState(true);

const load = useCallback(async () => {
  setIsLoading(true);
  try {
    if (isHRMyOrg) {
      setAllReviews(await annualReviewService.getAllReviews());
    } else if (isStaff) {
      setReviews(await annualReviewService.getMyReviewHistory());
    } else {
      // Mentor: TeamReviewTab loads its own data
    }
  } finally {
    setIsLoading(false);
  }
}, [isHRMyOrg, isStaff]);

useEffect(() => { void load(); }, [load]);
```

**After:**
```tsx
const myReviewsQuery = useQuery({
  queryKey: ["annual-reviews", "mine"],
  queryFn: annualReviewService.getMyReviewHistory,
  enabled: isStaff,
});
const allReviewsQuery = useQuery({
  queryKey: ["annual-reviews", "all"],
  queryFn: annualReviewService.getAllReviews,
  enabled: isHRMyOrg,
});

const reviews = myReviewsQuery.data ?? [];
const allReviews = allReviewsQuery.data ?? [];
const isLoading = isStaff
  ? myReviewsQuery.isPending
  : isHRMyOrg
    ? allReviewsQuery.isPending
    : false;
```

**Three notes:**

1. **Both queries register unconditionally**, gated by `enabled`. Hooks order is stable across renders.
2. **`?? []` defaults** keep downstream `.find()` / `.filter()` / `.map()` working on day-one before the first fetch resolves.
3. **`isLoading` is role-aware.** Staff care about `myReviewsQuery.isPending`; HR cares about `allReviewsQuery.isPending`; Mentor doesn't care (their TeamReviewTab has its own state).

**Gotcha: `isPending` vs `isLoading` in v5.** In TanStack Query v4, `isLoading` meant "no data yet" and `isFetching` meant "request in flight." In v5 they renamed `isLoading` to `isPending` (and `status: 'loading'` to `status: 'pending'`) to align with React's Promise nomenclature. Use `isPending`. The old name `isLoading` still works as an alias but is deprecated; new code should use `isPending`.

### Step 2 — Wire `submitSelfReview` through `useMutation`

The old handler did try/catch + manual upsert into local `reviews` array + isSaving state. All of that goes away:

**Before:**
```tsx
const [isSaving, setIsSaving] = useState(false);

const handleSubmit = async (payload: SelfReviewPayload) => {
  const ok = await confirm({ ... });
  if (!ok) return;
  setIsSaving(true);
  setFormError("");
  try {
    const saved = await annualReviewService.submitSelfReview(payload);
    // upsert into local state by id...
    setReviews((prev) => {
      const idx = prev.findIndex((r) => r.id === saved.id);
      if (idx === -1) return [saved, ...prev];
      const next = prev.slice();
      next[idx] = saved;
      return next;
    });
    setShowForm(false);
    toast.success("Self-review submitted.");
  } catch (err) {
    setFormError(getErrorMessage(err));
  } finally {
    setIsSaving(false);
  }
};
```

**After:**
```tsx
const submitMutation = useMutation({
  mutationFn: annualReviewService.submitSelfReview,
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["annual-reviews", "mine"] });
    void queryClient.invalidateQueries({ queryKey: ["annual-reviews", "all"] });
    setShowForm(false);
    toast.success("Self-review submitted.");
  },
  onError: (err) => setFormError(getErrorMessage(err)),
});

const handleSubmit = async (payload: SelfReviewPayload) => {
  const ok = await confirm({ ... });
  if (!ok) return;
  setFormError("");
  try {
    await submitMutation.mutateAsync(payload);
  } catch {
    /* handled by onError */
  }
};
```

Why `mutateAsync` + try/catch:
- `SelfReviewFormModal` awaits `onSubmit` to drive its internal "Submitting..." state
- `mutate` is fire-and-forget; using it would mean the modal can't know when the submit finishes
- `mutateAsync` returns a Promise; the caller can await it
- We catch + swallow because `onError` already handled the UI (set `formError`); without the catch, the rejection is "unhandled"

This is the same pattern as `handleSaveUser` in PR #20. It comes up any time a child component awaits a callback.

Why upsert logic is gone: `invalidateQueries` refetches the entire list and the cache propagates to every observer. Server response is the source of truth. If the server normalises `cycle_name` or computes a status transition, we get that automatically.

### Step 3 — Wire the create-or-PATCH draft flow through ONE mutation

Two endpoints back the draft save: POST `/self/draft` for new draft, PATCH `/<id>/draft` for an existing one. The component already had logic for choosing. The migration consolidates both into a single `useMutation`:

```tsx
const draftMutation = useMutation({
  mutationFn: (payload: SelfReviewDraftPayload) =>
    currentReview
      ? annualReviewService.saveDraft(currentReview.id, payload)
      : annualReviewService.createSelfDraft(payload),
  onSuccess: () => {
    void queryClient.invalidateQueries({ queryKey: ["annual-reviews", "mine"] });
    void queryClient.invalidateQueries({ queryKey: ["annual-reviews", "all"] });
    toast.success("Draft saved.");
  },
  onError: (err) => setFormError(getErrorMessage(err)),
});
```

**The `mutationFn` closure captures `currentReview`** — when the user has no draft yet, `currentReview` is null and we hit POST; once a draft exists, subsequent saves hit PATCH. The caller passes only the payload; the mutation figures out the verb.

This pattern — **one mutation, two underlying endpoints chosen by current state** — is common for upsert flows. Trying to expose them as two separate mutations would force every caller to ask "create or update?" and pick the right one. Hiding the decision behind the mutationFn keeps the call site simple:

```tsx
const handleSaveDraft = async (payload: SelfReviewDraftPayload) => {
  setFormError("");
  try {
    await draftMutation.mutateAsync(payload);
  } catch { /* handled by onError */ }
};
```

### Step 4 — Migrate `TeamReviewTab` (single query)

Smallest migration of the bunch — one `useState + useEffect + useCallback` block replaced by one `useQuery`:

```tsx
const reviewsQuery = useQuery({
  queryKey: ["annual-reviews", "mentees"],
  queryFn: annualReviewService.getMenteeReviews,
});
const reviews: MenteeAnnualReview[] = reviewsQuery.data ?? [];
const isLoading = reviewsQuery.isPending;
```

No `enabled` gate here — the tab only renders when the active role is Mentor, so by the time this hook runs we already know the user wants the data.

**Key choice: `['annual-reviews', 'mentees']`.** Sits under the `['annual-reviews']` namespace so a future call to `invalidateQueries({ queryKey: ['annual-reviews'] })` (without any further segments) blasts the entire family — mine, all, mentees — in one call. Plan keys hierarchically for exactly this reason.

---

## Part 3 — What's deliberately not migrated

The audit found mutation call sites in `EvalDrawer` (mentor evaluation flow) and `useReviewDetails` (the shared hook drawer components use). These call `submitMentorEval` and `saveMentorDraft`. **They are not migrated in this PR.**

Why:
1. They live in a different component scope (drawer + hook, not the page)
2. Touching them means touching the mentor evaluation modal flow, which has its own state machine
3. PR scope discipline > completeness

What this means: until those land in their own PR, when a mentor submits an evaluation, the `['annual-reviews', 'mentees']` cache stays stale. The current default (`refetchOnWindowFocus: true`) mitigates this — alt-tabbing away and back refetches it. Not perfect, but acceptable as a transitional state.

When the mentor mutations are migrated, **their onSuccess should invalidate `['annual-reviews', 'mentees']` AND `['annual-reviews', 'all']`** (the same row appears in HR's table too).

Similarly, `ManagementReview.tsx` and `MenteeDetail.tsx` also call `annualReviewService` and are migration candidates. Their own PRs.

---

## Part 4 — Final scorecard

### Files changed
| File | Lines | What |
|---|---|---|
| `frontend/src/pages/AnnualReviews.tsx` | ~+50 / −55 | 2 role-gated queries + 2 mutations; deleted `load()`, `isSaving`, `isDraftSaving` states |
| `frontend/src/components/reviews/TeamReviewTab.tsx` | ~+10 / −20 | 1 query; deleted `load()` + `isLoading` useState |

### Bundle impact
| Chunk | PR #20 (before) | This PR (after) | Δ |
|---|---|---|---|
| AnnualReviews | 7.65 KB gzip | 7.65 KB | — |
| Other chunks | — | — | unchanged |

Zero bundle impact. `useQuery` and `useMutation` are already in `query-vendor`.

### Capability gains
- ✅ Staff self-review submits now refresh HR's All Reviews table automatically (cross-key invalidation)
- ✅ Drafts and final submits go through the same cache invalidation paths
- ✅ TeamReviewTab benefits from refetch-on-window-focus (mentor reviews update when they return to the tab)
- ✅ The `enabled` flag pattern is now templated for any future role-gated query (e.g. PM-only queries in ProjectReviews next PR)

---

## Part 5 — Trade-offs we deliberately made

### Why `enabled` instead of conditional `if (role) useQuery(...)`

The Rules of Hooks require hooks to be called in the same order on every render. A conditional `useQuery` call shifts the order when the role changes (e.g. session refresh fills in `user.role`), which breaks React's reconciler.

`enabled` is the documented pattern. It registers the hook unconditionally and parks the network request behind a runtime flag. No hooks-order violations possible.

### Why not use a more granular queryKey hierarchy

We chose `['annual-reviews', 'mine']` instead of something like `['annual-reviews', 'history', userId]`. Two reasons:

1. **The endpoint already knows the user** — the JWT-derived session identifies who "mine" refers to. There's no userId to put in the key for security/correctness; it's implicit in the auth context.
2. **Per-user keying would prevent cache sharing across components** — multiple pages displaying "my reviews" should hit one cache entry, not N (where N is "how many places do we ask for my reviews").

If we ever need to show review history for **another** user (e.g., HR's per-user drill-down), that's a different query: `['annual-reviews', 'user', userId, 'history']`. The "mine" and "user/:id/history" branches stay logically separate.

### Why invalidate both `mine` and `all` instead of writing to the cache directly

The `submitSelfReview` response is the new/updated row. We could:
```tsx
queryClient.setQueryData(['annual-reviews', 'mine'], (old: AnnualReview[] = []) => {
  const idx = old.findIndex(r => r.id === created.id);
  if (idx === -1) return [created, ...old];
  return old.map(r => r.id === created.id ? created : r);
});
queryClient.setQueryData(['annual-reviews', 'all'], (old: AnnualReview[] = []) => {
  // ...same splice/replace logic...
});
```

…and save the GET round-trip. We chose `invalidateQueries` instead because:

1. The list (especially `all`) might be sorted/paginated by the server in ways our client splice doesn't understand
2. The server might compute derived fields (employee_name, function, designation) we'd otherwise miss
3. Self-review submission is not a hot path — one extra GET is fine

`setQueryData` is reserved for cases where the response IS the canonical full cache entry (like the settings PATCH in PR #20). Lists where the server might have computed sort/derived columns: `invalidateQueries`.

### Why not migrate `EvalDrawer` mutations in the same PR

Scope. EvalDrawer is a separate component with its own state machine, several internal forms, and its own callers (TeamReviewTab opens it, MenteeDetail opens it). Migrating it means understanding both AnnualReviews AND the mentor flow's internal state — too much in one PR.

The migration will land in its own PR. Until then, the `['annual-reviews', 'mentees']` cache is stale-tolerant (refetch-on-focus catches it).

---

## Part 6 — What you should now know cold

1. The `enabled` flag pattern for conditional queries; why you can't just wrap `useQuery` in an `if`.
2. The difference between `isPending` (v5) and `isLoading` (v4 alias). New code uses `isPending`.
3. Multi-key invalidation: any mutation declares every cache key it could affect, regardless of who's currently viewing what.
4. Why we hide create-or-update routing inside the `mutationFn` closure (one mutation, two endpoints, one caller).
5. Why list mutations prefer `invalidateQueries` over `setQueryData` (server sort + derived columns).
6. When NOT to migrate ("EvalDrawer lives in a different scope" is a valid reason).

---

## Part 7 — Verification checklist

```bash
cd frontend
npm run build       # passes? good
npm run dev
```

In the running app:

1. **As Staff:**
   - Open `/annual-reviews`. DevTools shows `["annual-reviews", "mine"]` green; `["annual-reviews", "all"]` parked (status: pending, enabled: false).
   - Start a self-review, save as draft. Toast fires. DevTools shows `mine` flash blue (refetch) then green.
   - Submit the draft. Same flow + modal closes.

2. **As Mentor:**
   - Open `/annual-reviews`. Tab is "Team Review". DevTools shows `["annual-reviews", "mentees"]` green.
   - Alt-tab away ~5s, come back. DevTools shows the query flash blue (refetch-on-focus).
   - Open a mentee review in the drawer, submit a mentor evaluation. The table does NOT auto-refresh yet (drawer mutations not migrated in this PR). Alt-tab away and back to trigger a refetch and see the new state.

3. **As HR_MyOrg:**
   - Open `/annual-reviews`. Tab is "All Reviews". DevTools shows `["annual-reviews", "all"]` green; `["annual-reviews", "mine"]` parked.
   - Filter by cycle/status/employee — purely client-side filter, no new query fires.
   - Open in a second browser tab (still HR). In tab #1, refresh the All Reviews list. In tab #2, observe via DevTools that the cache stays as-is (different tabs = different in-memory caches).

4. **Cross-key invalidation (Staff → HR):**
   - Open `/annual-reviews` as a Staff user in tab A.
   - Open `/annual-reviews` as an HR user in tab B (different browser profile or incognito so it's a separate session).
   - As Staff in tab A, submit a self-review. Verify in tab A that history shows the new row.
   - In tab B, the All Reviews list DOES NOT auto-refresh — these are separate sessions/caches. Alt-tab back into tab B → refetch-on-focus picks up the new row.
   - **Within a single session/tab**, the multi-key invalidation does light up both observers. The test for that is harder to construct manually but DevTools confirms the invalidation fires on both keys.

If all of the above behaves as described, the migration is sound.

---

## Part 8 — What's deliberately not done here

- **EvalDrawer / useReviewDetails mentor mutations.** Separate scope; own PR.
- **`ManagementReview.tsx`** — calls `annualReviewService.getCalibrationGrid` and friends. Page-level migration, own PR.
- **`MenteeDetail.tsx`** — calls `annualReviewService` for the per-mentee review history. Page-level migration, own PR.
- **Per-row optimistic updates.** A self-review submit could optimistically push the new row into `['annual-reviews', 'mine']` and rollback on failure, for an instant-feeling UI. Worth doing once the mentor flow lands and we have a clear hot-path candidate.
- **A query keys factory** (`src/lib/queryKeys.ts`). We now have 9 distinct keys (4 admin, 3 dashboard, 1 mentees, 3 annual-reviews — wait, that's actually 11). The factory is overdue. Next PR.
