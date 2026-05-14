# 11 — Project-review writes: PrimaryEvaluationTab + SecondaryEvalTab

> **PR:** _pending_
> **Files changed:** `frontend/src/lib/queryKeys.ts` (added `projectReviews.pmQueue()`), `frontend/src/components/project-reviews/PrimaryEvaluationTab.tsx`, `frontend/src/components/project-reviews/SecondaryEvalTab.tsx`.
> **Headline result:** 3 queries + 6 mutations migrated. The **cache-warming probe** introduced in PR #07 finally has a consumer — `SecondaryEvalTab` reads the same key the parent ProjectReviews page probed at mount, so the tab data is instantly available on click.

---

## TL;DR

The PM (Primary Evaluator) and Secondary Evaluator flows for project reviews. Both deferred from PR #07 (the ProjectReviews page migration) — they live in child components with their own page-like state machines, so they got their own PR.

**The win worth highlighting:** in PR #07 we introduced a "cache-warming probe" pattern: the parent ProjectReviews page fires `useQuery({ queryKey: queryKeys.projectReviews.secondaryQueue() })` at mount to decide whether to render the Secondary tab. The data fetched by that probe sits in the cache. When the user clicks the Secondary tab, `SecondaryEvalTab` does its own `useQuery` on the same key — **and finds the cache already warm**. No second HTTP request. The page-level probe and the tab-level read share one cache entry.

This is the kind of architectural payoff that's invisible if you're not looking for it. The probe pays for the tab's first paint; the tab's mutations invalidate the probe alongside everything else. Cross-component coordination via the cache, exactly as designed.

---

## Part 1 — Cache-warming probe: from promise to payoff

Re-reading [doc 07 part 2](./07-project-reviews-migration.md#part-2--pattern-cache-warming-probe):

> The old code did the minimum: hit the endpoint, count rows, set a boolean. The actual data — the list of pending secondary reviews — was discarded. When the user later clicked the tab, `SecondaryEvalTab` re-fetched the same data.
>
> Net: **two HTTP requests for the same data** in the common case.

The doc described the future state — what would happen once `SecondaryEvalTab` was migrated. This PR delivers it.

### The complete picture

```tsx
// In ProjectReviews.tsx (the page) — fires at mount for any non-PM,
// non-Mentor user. The result is used ONLY to derive
// `hasSecondaryWork` for tab visibility:
const secondaryQueueQuery = useQuery({
  queryKey: queryKeys.projectReviews.secondaryQueue(),
  queryFn: projectReviewService.getSecondaryQueue,
  enabled: canBeSecondary,
});
const hasSecondaryWork = (secondaryQueueQuery.data?.length ?? 0) > 0;
```

```tsx
// In SecondaryEvalTab.tsx (this PR) — when the user clicks the tab:
const queueQuery = useQuery({
  queryKey: queryKeys.projectReviews.secondaryQueue(),
  queryFn: projectReviewService.getSecondaryQueue,
});
const reviews = queueQuery.data ?? [];
```

Same key. Same `queryFn`. TanStack Query's cache is keyed by content, not by component — the parent and the tab share one cache entry.

When the user clicks the Secondary tab:
1. `SecondaryEvalTab` mounts and registers a `useQuery` observer on the existing cache entry
2. The cache already has data from the parent's probe (within `staleTime`, default 30s)
3. **The query function does NOT fire** — `data` is returned synchronously
4. The tab renders fully populated on its first frame

Compare to the old world: the probe and the tab each owned a separate `useEffect + setState`. Two requests, two loading states, two opportunities for inconsistency.

### Why same `queryFn` matters

If two `useQuery` calls have the same `queryKey` but different `queryFn` references, TanStack Query uses the **most recently registered** queryFn. In practice this rarely matters because they should produce identical results — but it's worth knowing. The factory-keyed pattern naturally avoids drift: both call sites use `queryKeys.projectReviews.secondaryQueue()`, both use `projectReviewService.getSecondaryQueue`. If we change the service signature, both sites update together.

---

## Part 2 — PrimaryEvaluationTab: 2 queries + 3 mutations

The PM's queue of pending evaluations. Standard application of the established patterns.

### Queries

```tsx
const pmQueueQuery = useQuery({
  queryKey: queryKeys.projectReviews.pmQueue(),
  queryFn: projectReviewService.getPMQueue,
});
const expectationsQuery = useQuery({
  queryKey: queryKeys.projectReviews.roleExpectations(),
  queryFn: projectReviewService.getRoleExpectations,
});
```

Two notes:
- `pmQueue` is a **new** factory entry (added this PR). The PM tab is the only consumer.
- `roleExpectations` reuses the factory entry from PR #07. The parent ProjectReviews already fetched it (for Staff users), so when a PM lands here, the expectations data is warm — same cross-page sharing as the secondary queue.

### Three mutations, same broadcast pattern

```tsx
const invalidatePMScope = useCallback(() => {
  void queryClient.invalidateQueries({ queryKey: queryKeys.projectReviews.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
}, [queryClient]);

const updateReviewMutation = useMutation({
  mutationFn: (vars: { reviewId: number; payload: PMEvaluationPayload }) =>
    projectReviewService.updateReview(vars.reviewId, vars.payload),
  onSuccess: () => {
    invalidatePMScope();
    closeModal();
    toast.success("Evaluation updated.");
  },
  onError: (err) => setModalError(getErrorMessage(err)),
});

const submitMutation = useMutation({
  mutationFn: (vars: { projectId: number; userId: number; payload: PMEvaluationPayload }) =>
    projectReviewService.submitPMEvaluation(vars.projectId, vars.userId, vars.payload),
  onSuccess: () => { invalidatePMScope(); closeModal(); toast.success("Evaluation submitted."); },
  onError: (err) => setModalError(getErrorMessage(err)),
});

const draftMutation = useMutation({
  mutationFn: (vars: { projectId: number; userId: number; payload: PMEvaluationDraftPayload }) =>
    projectReviewService.savePMDraft(vars.projectId, vars.userId, vars.payload),
  onSuccess: () => { invalidatePMScope(); toast.success("Draft saved."); },
  onError: (err) => setModalError(getErrorMessage(err)),
});
```

Three observations worth pausing on:

**1. `updateReview` vs `submitPMEvaluation` are separate mutations.** Same flow (PM commits an evaluation) but different endpoints (PUT vs POST) and slightly different UX (edit vs submit). We treat them as separate `useMutation` instances for the same reason PR #20 made `createUser` and `updateUser` separate, and PR #27 made `approveGoal` and `requestChanges` separate: distinct UX flows over the same data model deserve independent mutation state.

**2. The draft mutation doesn't close the modal.** Notice `submitMutation.onSuccess` calls `closeModal()`; `draftMutation.onSuccess` doesn't. Same reason as PR #22's `saveSelfReviewDraft` mutation: drafts are explicit "save and keep editing" actions. The modal stays open after a draft save.

**3. The broadcast fans out further than you might expect.** `invalidatePMScope` triggers refetches on:
- `projectReviews.pmQueue` (this tab) — the row this PM just submitted moves from pending → reviewed
- `projectReviews.secondaryQueue` (other tab, if open) — if a Secondary evaluator is mid-review, the underlying review state changed
- `projectReviews.mine` (Staff's own /project-reviews) — the Staff user can now see their newly-published rating
- `projectReviews.mentees` (Mentor's view) — the mentor of this employee sees their mentee's new rating
- `projectReviews.org` (HR's view) — the org-wide table reflects the new row state
- `dashboard.summary` / `dashboard.hrSummary` — `project_reviews_pending_primary` / `project_review_completion` counts shift

Six observers (potentially) updated by one mutation's invalidation. The broadcast pattern's quiet power.

---

## Part 3 — SecondaryEvalTab: 1 query + 3 mutations

### The query reuses PR #07's probe

Covered in Part 1. The data is hot the moment the tab mounts.

### Three mutations following the same template

```tsx
const updateSecondaryMutation = useMutation({
  mutationFn: (vars: { reviewId: number; payload: SecondaryEvalPayload }) =>
    projectReviewService.updateSecondaryEval(vars.reviewId, vars.payload),
  onSuccess: () => {
    invalidateSecondaryScope();
    closeImpactModal();
    toast.success("Review updated.");
  },
  onError: (err) => setModalError(getErrorMessage(err)),
});

const submitSecondaryMutation = useMutation({
  mutationFn: (vars: { reviewId: number; payload: SecondaryEvalPayload }) =>
    projectReviewService.submitSecondaryEval(vars.reviewId, vars.payload),
  onSuccess: () => {
    invalidateSecondaryScope();
    closeImpactModal();
    toast.success("Review submitted.");
  },
  onError: (err) => setModalError(getErrorMessage(err)),
});

const draftSecondaryMutation = useMutation({
  mutationFn: (vars: { reviewId: number; payload: SecondaryEvalDraftPayload }) =>
    projectReviewService.saveSecondaryDraft(vars.reviewId, vars.payload),
  onSuccess: (_data, vars) => {
    invalidateSecondaryScope();
    setIsDraftMode(true);
    setEditImpact(vars.payload.impact_statement ?? "");
    toast.success("Draft saved.");
  },
  onError: (err) => setModalError(getErrorMessage(err)),
});
```

Symmetric to PrimaryEvaluationTab — same factory key namespace, same broadcast helper, same modal-await contract via `mutateAsync` in the handlers.

### One subtle pattern: passing vars into onSuccess

`draftSecondaryMutation.onSuccess` accesses `vars.payload.impact_statement` to keep the modal's `editImpact` state in sync. The second argument to `onSuccess` is **the variables that were passed to `mutate(vars)` / `mutateAsync(vars)`**. This is how mutations can react to "what was the input" without the callsite passing state around.

The shape: `onSuccess: (data, variables, context) => { ... }`
- `data` — the resolved value of `mutationFn`
- `variables` — exactly what was passed to `mutate(vars)`
- `context` — only useful when you use `onMutate` for optimistic updates (covered in a future doc)

We've been using `variables` quietly since PR #20 (the deactivate user mutation passed the full user object through). This is the first PR where it's worth calling out explicitly because the use case — "react to the input, not just the response" — comes up often in modal flows.

---

## Part 4 — Final scorecard

### Files changed
| File | Lines | What |
|---|---|---|
| `frontend/src/lib/queryKeys.ts` | +5 | Added `projectReviews.pmQueue()`; clarified comments on `secondaryQueue` (it's the consumer side of PR #07's probe) |
| `frontend/src/components/project-reviews/PrimaryEvaluationTab.tsx` | ~+85 / −60 | 2 queries + 3 mutations; deleted `loadData` callback, 4 `isSaving`-style useStates, manual `setPmCards` upsert |
| `frontend/src/components/project-reviews/SecondaryEvalTab.tsx` | ~+85 / −60 | 1 query + 3 mutations; deleted `loadReviews` callback, 2 `isSaving`-style useStates, manual `await loadReviews()` calls |

### Bundle impact
| Chunk | Before | After | Δ |
|---|---|---|---|
| ProjectReviews | 12.33 KB gzip | 12.40 KB | +0.07 KB (six new mutation wrappers, offset by deleted boilerplate) |
| Other chunks | — | — | unchanged |

### Capability gains
- ✅ Secondary tab is **instant** on click — cache pre-warmed by the parent's PR #07 probe
- ✅ Project review counts on dashboard (`project_reviews_pending_primary` / `_secondary`) auto-refresh after every PM or Secondary write — fixes the same staleness pattern earlier PRs noted
- ✅ Cross-tab refresh: PM submits a review in Primary tab → Secondary tab (if open in another window) refetches via focus refresh
- ✅ The `roleExpectations` cache entry is now shared across three call sites (parent ProjectReviews for Staff, PrimaryEvaluationTab for PMs, and possibly future Staff drill-downs) — one fetch covers all three

---

## Part 5 — Trade-offs we deliberately made

### Why `pmQueue` is a new factory entry (and `secondaryQueue` wasn't)

When PR #07 migrated the parent ProjectReviews page, it knew the secondary queue would be used by both the parent (for visibility) AND a future SecondaryEvalTab migration. We added `secondaryQueue` to the factory then, anticipating the consumer.

`pmQueue` was different: the parent page never fetches it (PMs use PrimaryEvaluationTab exclusively). There was no parent-level consumer to add the key for. So we deferred adding it until the tab itself migrated.

**The discipline:** add factory entries when there's an actual consumer. Adding speculatively bloats the factory with unused methods that drift from reality. PR #07 added `secondaryQueue` because the probe was an immediate consumer; `pmQueue` waits for this PR.

### Why we split `updateReview` and `submitPMEvaluation` into two mutations

Both hit endpoints in the same family (`/project-reviews/...`), do similar things (record a PM's evaluation), and could plausibly be one mutation with branching. We've made the same call before:
- PR #20: `createUser` vs `updateUser` — different endpoints, different lifecycle, different UX after success
- PR #27: `approveGoal` vs `requestChanges` — same endpoint, different statuses, different error routing

Here:
- `updateReview` uses PUT, only valid for already-submitted reviews (edit existing)
- `submitPMEvaluation` uses POST, creates a new row

Independent `isPending` flags matter when both could conceivably be in flight at the same time (e.g. you re-open an edit modal while a different review is being submitted — admittedly rare in practice, but the architecture is cleaner). Separate mutations also let `onError` route differently if we ever want to (currently both go to `setModalError`).

The cost — two useMutation declarations instead of one — is paid back by clarity.

### Why the draft mutation doesn't close the modal

`submitMutation.onSuccess`: closes the modal (the PM committed; we want them out).
`draftMutation.onSuccess`: leaves it open (the PM saved progress; they may want to keep typing).

Same pattern across the codebase: `saveSelfReviewDraft` in AnnualGoals (PR #22), `saveSelfReviewDraft` in AnnualReviews (PR #21), `saveSecondaryDraft` here. The user's intent for a draft is "save and continue"; we honor that.

### Why we don't use `setQueryData` for these mutations

We could be cleverer: after `submitPMEvaluation` succeeds, the response is the updated row. We could `setQueryData(['project-reviews', 'pm-queue'], (old) => old.map(c => c.review_id === r.id ? r : c))` and skip the refetch.

We don't, for the same reasons as PR #20 and #21: list-position changes (the row moves from `pending` to `reviewed`, which might re-sort if any sort is active), server-side computed fields, and other things our local splice can't model perfectly. Refetching after a write is the safer, simpler default for list-aware mutations. `setQueryData` is reserved for cases where the response IS the canonical full cache entry (PR #20's settings save) or where the path is hot enough to need synchronous updates (PR #22's criterion toggle).

---

## Part 6 — What you should now know cold

1. **Cache-warming probes pay off across components.** The probe and the eventual consumer share a cache entry by virtue of using the same factory key. No coordination code needed.
2. **The `variables` argument to `onSuccess`** is how a mutation reacts to its input. Useful for draft flows that need to keep the modal's local state in sync with what was just saved.
3. **The `pmQueue` vs `secondaryQueue` factory-entry timing:** add when there's a consumer, not speculatively.
4. **Tabs that load their own data** are cheap to migrate — they're just useQuery-on-mount in a child component. Cross-tab cache sharing happens automatically.

---

## Part 7 — Verify it works

```bash
cd frontend
npm run build       # passes? good
npm run dev
```

In the app:

1. **PM cache-warming test:**
   - Log in as a PM. Open `/project-reviews`. The Primary Evaluation tab loads automatically (per role-based default in the page).
   - DevTools: `["project-reviews", "pm-queue"]` AND `["project-reviews", "role-expectations"]` both green.
   - `["project-reviews", "secondary-queue"]` is also green if the PM is also a secondary evaluator on some project (rare for PMs in practice — they usually aren't both).

2. **Secondary cache-warming test (THE BIG ONE):**
   - Log in as a Staff user who's listed as Secondary evaluator on at least one project.
   - Open `/project-reviews`. The page mounts on the "My Reviews" tab by default. DevTools shows `["project-reviews", "secondary-queue"]` green (from the probe).
   - Click the "Secondary Evaluation" tab. **The tab renders instantly with data** — no spinner, no skeleton flash. DevTools shows the query still green — no new request fired. The probe's data is the tab's data.

3. **PM mutations:**
   - As PM, click "Start Evaluation" on a pending row → modal opens, fill in the eval, click Submit Evaluation. Modal closes. DevTools: BOTH `["project-reviews", ...]` AND `["dashboard", ...]` namespaces flash blue → green. The row's status badge flips from "Pending" to "Reviewed."
   - Save Draft on a different row → modal stays open. DevTools shows the same broadcast. The row's "has_draft_content" badge appears.
   - Edit an already-reviewed row → modal opens in edit mode, click Save Changes. Updates without changing the row's status.

4. **Secondary mutations:**
   - As Staff with Secondary work, navigate to the Secondary tab. Click on a pending row → impact statement modal opens.
   - Save Draft → modal stays open, "Draft saved" toast, badge flips to Draft.
   - Submit → modal closes, "Review submitted" toast, badge flips to Submitted.
   - Edit an already-submitted impact → modal opens with existing text, Save Changes → modal closes.

5. **Cross-tab freshness:**
   - In window A: PM submits an evaluation.
   - In window B (separate browser tab, different role): refocus the window. DevTools shows the relevant queries refetch (focus refetch is on by default). The new state appears.

---

## Part 8 — What's deliberately not done here

- **`MenteeProjectsTab`** (the last consumer of `projectReviewService.getReview` and the last `onReload` bridge from PR #25). Its own focused PR.
- **`EvalDrawer` + `useReviewDetails`** (annual-review mentor-eval inline editor). Different namespace (`annualReviews`), different scope. Own PR.
- **`SystemSettingsProvider`** internal swap. Smallest remaining piece.

After those three, the TanStack Query rollout is complete and we move to the pagination/virtualization theme.
