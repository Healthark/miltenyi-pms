# 10 — Goal-approval flow migration: TeamGoalsTab + MenteeGoalsTab

> **PR:** [#27](https://github.com/Healthark/miltenyi-pms/pull/27)
> **Files changed:** `frontend/src/components/goals/TeamGoalsTab.tsx`, `frontend/src/components/mentees/MenteeGoalsTab.tsx`, `frontend/src/pages/MenteeDetail.tsx` (prop wiring).
> **Headline result:** First child-component PR after the page-level milestone. 1 query + 7 mutations migrated. New design choice documented: **when to leave a component imperative** (CriteriaChecklist stays unchanged on purpose).

---

## TL;DR

`TeamGoalsTab` (the Mentor's goal-approval queue, mounted as a tab inside `/annual-goals`) and `MenteeGoalsTab` (the per-mentee version inside `/my-mentees/:id`) are both children of pages we already migrated. They're imperative — `useState + useEffect + Promise.all + manual setGoals((prev) => ...)` — and they have the most mutations of any component in the codebase so far.

We migrate both. **CriteriaChecklist** (a leaf used by both files plus AnnualGoals) **stays imperative on purpose**: the only consumer that interactively toggles criteria is AnnualGoals' Staff view, which uses `setQueryData` for instant feedback (PR #22). Putting `invalidateQueries` inside CriteriaChecklist would either undo that hot-path optimization or require complex per-parent queryKey wiring.

Other change: `MenteeGoalsTab` swaps its `onReload` prop for `menteeId`. The bridge callback (PR #25) was a transitional thing; this component now manages its own cache invalidation directly. `MenteeProjectsTab` keeps the `onReload` bridge — it'll migrate in its own PR.

---

## Part 1 — The new design choice: keep CriteriaChecklist imperative

This is the part of the PR worth pausing on. Every previous migration converted every service call in scope. This one deliberately doesn't.

### Why

`CriteriaChecklist.tsx` is a leaf component that owns the criterion-toggle checkbox and the proof-comments textarea. Both interactions call `goalService.updateCriterion(criterion.id, payload)` imperatively today.

The component is consumed in four places:
- **`AnnualGoals.tsx`** — Staff's own goals, interactive. The parent handles cache writes via `setQueryData` ([PR #22 part 3](./05-annual-goals-migration.md#part-3--pattern-2-setquerydata-for-hot-paths)).
- **`AnnualGoalCard.tsx`** — Staff's edit mode (within AnnualGoals).
- **`MenteeGoalsTab.tsx`** — Mentor's view, `readOnly` (no mutations from here).
- **`TeamGoalsTab.tsx`** — does NOT use CriteriaChecklist.

**Only one consumer is interactive: AnnualGoals' Staff view.** Three callers are read-only or write-via-the-staff-view.

If we migrate CriteriaChecklist to useMutation:

| Approach | Problem |
|---|---|
| `invalidateQueries({queryKey: queryKeys.goals.all})` inside the component | Undoes PR #22's hot-path `setQueryData` optimization — every checkbox toggle = full goals refetch + skeleton flash. 10 clicks/minute → 10 wasted refetches. |
| Take a queryKey prop from each parent | Adds API surface; every parent has to know which key to invalidate; the leaf gets coupled to the cache schema. |
| Take an `onUpdated` callback that lets each parent reconcile | Identical to today's pattern with extra ceremony — useState in the leaf instead of imperative — for zero gain. |

**The third-best of those is what we have today.** CriteriaChecklist stays imperative. The cache-write responsibility lives at the parent (specifically `AnnualGoals.handleCriterionUpdate` which does `setQueryData`).

This is **scope discipline informed by the actual call graph**, not "we'll get to it later." The leaf is correctly imperative for its current uses; migrating it would make things worse.

### When you'd revisit

- If a future Staff-facing page also wants interactive criterion toggles → consider extracting a `useCriterionToggle()` hook that bundles the mutation + setQueryData logic, parametrized by queryKey
- If `MenteeGoalsTab` ever becomes interactive (Mentor toggles a criterion for their mentee, which is **not** allowed today) → the calculus changes

Until then, leaf-level imperative service calls are fine when the parent owns the cache.

---

## Part 2 — TeamGoalsTab: 1 query + 5 mutations

This is the biggest mutation count in any single component we've touched.

### The query

```tsx
const teamGoalsQuery = useQuery({
  queryKey: queryKeys.goals.mentees(),
  queryFn: () => goalService.getTeamGoals("annual"),
});
const goals: TeamGoal[] = teamGoalsQuery.data ?? [];
const isLoading = teamGoalsQuery.isPending;
```

`queryKeys.goals.mentees()` was added in PR #23's factory but no consumer existed yet. Now it does. Broadcast invalidations from any goal mutation (from AnnualGoals or elsewhere) will catch this query.

### The five mutations

```tsx
const invalidateGoalsScope = useCallback(() => {
  void queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
}, [queryClient]);

const approveGoalMutation = useMutation({
  mutationFn: (vars: { goalId: number; ownerName: string }) =>
    goalService.updateApproval(vars.goalId, { approval_status: "approved" }),
  onSuccess: (_data, vars) => {
    invalidateGoalsScope();
    toast.success(`${vars.ownerName}'s goal approved.`);
  },
  onError: (err) => snackbar.error(getErrorMessage(err)),
});

const requestChangesMutation = useMutation({
  mutationFn: (vars: { goalId: number; feedback: string }) =>
    goalService.updateApproval(vars.goalId, {
      approval_status: "changes_requested",
      feedback: vars.feedback,
    }),
  onSuccess: () => {
    invalidateGoalsScope();
    setFeedbackTarget(null);
    toast.success("Feedback sent.");
  },
  onError: (err) => setModalError(getErrorMessage(err)),  // modal context
});

const bulkApproveMutation = useMutation({
  mutationFn: (goalIds: number[]) => goalService.bulkApprove(goalIds),
  onSuccess: (result, goalIds) => {
    invalidateGoalsScope();
    // ... partial-success logic ...
  },
  onError: (err) => setBulkError(getErrorMessage(err)),
});

const saveMentorReviewDraftMutation = useMutation({
  mutationFn: (vars: { goalId: number; cycleHalf: SelfReviewCycleHalf; payload: GoalMentorReviewPayload }) =>
    goalService.saveMentorReviewDraft(vars.goalId, vars.cycleHalf, vars.payload),
  onSuccess: () => { invalidateGoalsScope(); toast.success("Draft saved."); },
  onError: (err) => setReviewError(getErrorMessage(err)),
});

const submitMentorReviewMutation = useMutation({
  mutationFn: (vars: { goalId: number; cycleHalf: SelfReviewCycleHalf; payload: GoalMentorReviewPayload }) =>
    goalService.submitMentorReview(vars.goalId, vars.cycleHalf, vars.payload),
  onSuccess: () => { invalidateGoalsScope(); closeReview(); },
  onError: (err) => setReviewError(getErrorMessage(err)),
});
```

### One observation worth calling out

**Two mutations share `updateApproval` but become separate `useMutation` instances** (`approveGoalMutation` and `requestChangesMutation`). Same service call, two distinct UX flows:
- Approve → toast success, no modal
- Request changes → modal stays open on error, closes on success, different toast

Could we collapse into one `useMutation` and branch in the handler? Yes — and lose the per-flow error routing (`snackbar` vs `setModalError`) and per-flow success behaviour (close-modal vs not). Two mutations is the cleaner separation. The DRY violation (two definitions hitting the same endpoint) is paid back in clarity.

The `mutationFn` is what makes them different at the cache layer: tanstack tracks them separately, so `approveGoalMutation.isPending` and `requestChangesMutation.isPending` are independent — exactly what the UI needs.

### Error routing per surface

The mutations route errors to **different UI surfaces** depending on context:

| Mutation | Caller context | Error goes to |
|---|---|---|
| `approveGoalMutation` | Row-level action button | `snackbar` (no modal open) |
| `requestChangesMutation` | Inside FeedbackModal | `setModalError` (modal stays open) |
| `bulkApproveMutation` | Inside BulkApproveModal | `setBulkError` (modal stays open) |
| `saveMentorReviewDraftMutation` | Inside GoalMentorReviewModal | `setReviewError` |
| `submitMentorReviewMutation` | Same modal as above | `setReviewError` |

**The pattern:** route errors to the surface the user is looking at. If they're in a modal, the modal should explain the failure. If they're on the page, the snackbar floats over the page. This requires per-mutation `onError` callbacks — which is exactly what useMutation gives us.

---

## Part 3 — MenteeGoalsTab: 2 mutations + dropping the bridge prop

`MenteeGoalsTab` was migrated more conservatively because:
1. It doesn't fetch its own data (`goals` comes in as a prop from MenteeDetail)
2. The two mutations were straightforward applications of patterns established by TeamGoalsTab

### The prop change

```diff
 interface MenteeGoalsTabProps {
   readonly goals: TeamGoal[];
   readonly menteeName: string;
-  /** Called after an action (approve / request-changes) so the parent can re-fetch. */
-  readonly onReload: () => void;
+  /** Used to invalidate this specific mentee's detail entry after an
+   *  action. Replaces the old `onReload` callback the parent used to
+   *  pass — this component now manages its own cache invalidation. */
+  readonly menteeId: number;
 }
```

PR #25 introduced the `onReload` callback as a **bridge for unmigrated children** — the parent passes a stable callback, the child calls it when it needs the parent to refresh. With MenteeGoalsTab now migrated, the bridge isn't needed. The component invalidates the right cache key directly:

```tsx
const invalidateScope = useCallback(() => {
  void queryClient.invalidateQueries({
    queryKey: queryKeys.mentees.detail(menteeId),
  });
  void queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
}, [queryClient, menteeId]);
```

This pattern — **child takes the relevant ID, child does its own invalidation** — is cleaner than a callback prop because:
- No prop-drilling for refresh logic
- Child explicitly declares which cache scopes it affects
- Parent doesn't have to know what the child mutates

### Why the mentees.detail invalidation is explicit

Notice the invalidation footprint:
- `queryKeys.mentees.detail(menteeId)` — **specific** key, not broadcast
- `queryKeys.goals.all` — broadcast
- `queryKeys.dashboard.all` — broadcast

Why is the mentee detail specific instead of broadcast?

Because the mentee detail endpoint returns a `goals_list` field baked into the response. The `mentees.summaries()` cache entry (mentor's roster) DOES NOT contain per-goal data — it has aggregate counts (`goals.approved`, `goals.draft`, etc.). So:

- A goal-approval change affects **this specific mentee's detail** (the goals_list inside it)
- It also affects **the dashboard counts** (mentor's pending-approvals tile)
- It also affects **all goal queries** (Staff's mine, the mentor's queue, HR's org view)
- It does NOT affect other mentees' details (they have different goals)

So broadcasting `queryKeys.mentees.all` would over-invalidate (refreshing every other mentee's detail unnecessarily). Specific is correct.

This is a refinement of the broadcast-vs-explicit decision from PR #22:

> The cost of an over-invalidation is one wasted GET per unrelated subscriber; cheap.

True in general. But when you can be specific without losing correctness or readability, do. Broadcasting "all mentees" when only one mentee is affected is the kind of laziness that scales poorly — a mentor with 20 mentees would refetch all 20 detail entries on every goal approval.

---

## Part 4 — MenteeDetail wiring update

```diff
 {activeTab === "goals" && (
   <MenteeGoalsTab
     goals={data.goals_list}
     menteeName={data.full_name}
-    onReload={reloadDetail}
+    menteeId={menteeId}
   />
 )}
```

One-line change. `MenteeProjectsTab` keeps `onReload={reloadDetail}` — it's still imperative. The `reloadDetail` callback in `MenteeDetail.tsx` stays (still used by MenteeProjectsTab). When MenteeProjectsTab migrates (own PR), the callback can be deleted.

This is the **incremental migration pattern** working as designed. Parent migrated first (PR #25), then children migrate one at a time (this PR for goals, next PR for projects). The bridge prop is the shock absorber that lets us migrate incrementally without big-bang refactors.

---

## Part 5 — Final scorecard

### Files changed
| File | Lines | What |
|---|---|---|
| `frontend/src/components/goals/TeamGoalsTab.tsx` | ~+100 / −110 | 1 query + 5 mutations; deleted 4 `setGoals((prev) => ...)` upserts, 4 isSaving-style useStates, loadGoals callback, the mount useEffect |
| `frontend/src/components/mentees/MenteeGoalsTab.tsx` | ~+45 / −35 | 2 mutations; dropped `onReload` prop, took `menteeId` prop |
| `frontend/src/pages/MenteeDetail.tsx` | 1 line | Wire `menteeId` instead of `onReload` for MenteeGoalsTab |

### Bundle impact
| Chunk | Before | After | Δ |
|---|---|---|---|
| AnnualGoals (TeamGoalsTab lives here) | 14.51 KB gzip | **14.43 KB** | −0.08 KB |
| MenteeDetail (MenteeGoalsTab lives here) | 13.10 KB | **13.24 KB** | +0.14 KB |

TeamGoalsTab actually shrank — the deleted boilerplate outweighed the added useQuery/useMutation calls. MenteeDetail grew slightly because MenteeGoalsTab gained mutation-wrapper code.

### Capability gains
- ✅ TeamGoalsTab refreshes automatically when AnnualGoals' Staff side approves/requests-changes/submits a goal (the broadcast finally catches both directions)
- ✅ MenteeGoalsTab self-manages its cache invalidation (no callback prop drilling)
- ✅ Dashboard counts (`mentor_goals_pending_approval`, `goal_approval_funnel`) auto-refresh after any goal-approval mutation — fixing the dashboard-staleness pattern earlier PRs noted
- ✅ All 7 mutations route errors to the surface the user is looking at (snackbar / modalError / bulkError / reviewError per context)

---

## Part 6 — Trade-offs we deliberately made

### Why two `useMutation` instances for the same `updateApproval` endpoint

Approve and Request Changes both hit `PATCH /goals/:id/approval` with different `approval_status` values. Could be one `useMutation` with caller-driven payload.

We chose two because:
- Different UX behaviour (modal stays open vs closes)
- Different error surfaces (modalError vs snackbar)
- Different toast copy
- Different `isPending` states needed independently (row's approve button has its own loading state; feedback modal has its own loading state)

The cost (slight DRY violation in mutationFn shape) is paid back by per-flow clarity. Same pattern as PR #20's `createUser` vs `updateUser`: both hit the users endpoint family but get their own mutation instances for UX-specific behaviour.

### Why CriteriaChecklist stays imperative (one more time)

[Part 1 covers this in depth.] Short version: the only interactive consumer is AnnualGoals' Staff view, which uses `setQueryData` (PR #22) to avoid hot-path refetches. Migrating CriteriaChecklist to `useMutation` would either:
- Undo that optimization (invalidate inside CriteriaChecklist → refetch every click), or
- Require complex per-parent queryKey wiring (defeats the purpose of the leaf)

Imperative IS the right design for this leaf.

### Why MenteeGoalsTab's invalidation isn't pure broadcast

`queryKeys.mentees.detail(menteeId)` is specific, not `queryKeys.mentees.all`. Discussed in Part 3 — broadcasting "all mentees" would over-invalidate every other mentee's detail. The mentee-detail endpoint is per-mentee; specific is correct.

The same logic would apply if we ever had `queryKeys.projectReviews.detail(reviewId)` invalidations from a mutation that only affects one review. Specific when you can be specific; broadcast when the namespace really is the right granularity.

### Why MenteeGoalsTab doesn't take its own `useQuery`

MenteeGoalsTab gets `goals` as a prop. The parent (MenteeDetail) fetches `mentees.detail(id)` which includes `goals_list`. Having MenteeGoalsTab fetch its own goals would mean:
- A separate cache entry (e.g. `mentees.detail(id).goals_list` vs a hypothetical `goals.forMentee(id)`)
- Duplication of data already in the detail response
- Two queries to invalidate after a goal-approval write instead of one

The current shape — parent fetches the omnibus mentee detail, children render slices of it — is cleaner. The tab is a presentational+mutation component, not a data-fetching one.

This is a different shape from AnnualGoals' `AllGoalsTab` (which would have its own query if migrated). Each component picks the shape that matches what its parent provides.

---

## Part 7 — What you should now know cold

1. **When to leave a leaf imperative.** If the only interactive consumer optimizes via `setQueryData`, the leaf is correctly imperative.
2. **Specific vs broadcast invalidation, refined.** Broadcast when the namespace is the right granularity. Specific when you can identify the exact cache entry affected without compromising clarity.
3. **Two `useMutation` instances for one endpoint.** Different UX flows over the same write deserve separate mutation instances.
4. **Error routing per surface.** `onError` callbacks should write to the surface the user is currently looking at — modal vs snackbar vs inline.
5. **The bridge prop -> direct invalidation handoff.** PR #25 introduced `onReload` as a bridge; this PR removes it from MenteeGoalsTab now that MenteeGoalsTab manages its own invalidation.

---

## Part 8 — Verify it works

```bash
cd frontend
npm run build       # passes? good
npm run dev
```

In the app:

1. **TeamGoalsTab basics (as Mentor):**
   - Open `/annual-goals`. Tab is "Team Goals".
   - DevTools: `["goals", "mentees"]` flashes blue → green.
   - Approve a single goal → DevTools shows `["goals", ...]` AND `["dashboard", ...]` flash blue → green. Toast fires.
   - Request changes on a goal → modal opens. Submit feedback → modal closes, broadcast invalidation fires, toast.
   - Bulk approve via the modal → partial-success summary handled; modal closes on full success or stays open with error pill on partial.
   - Open a Mentor Review modal → save a draft → submit. Both fire broadcast invalidations.

2. **Cross-page coordination test:**
   - As Mentor: open `/annual-goals` (TeamGoalsTab green).
   - In another browser tab, log in as a Staff user (the mentor's mentee). Open `/annual-goals` and submit a draft goal.
   - Back in the mentor's tab: the goal-approval queue might already have refreshed (focus refetch). Even if not, navigating away and back triggers an immediate fresh fetch.

3. **MenteeGoalsTab (as Mentor on a specific mentee):**
   - Open `/my-mentees/<id>` → click the "Annual Goals" tab.
   - DevTools shows `["mentees", "detail", <id>]` green (from the parent).
   - Approve a goal here → DevTools shows `["mentees", "detail", <id>]` flash blue → green (the specific invalidation), AND `["goals", ...]` AND `["dashboard", ...]` (the broadcasts).
   - Switch tabs within MenteeDetail (Annual Summary, Projects). Goals tab data stays consistent.

4. **Confirm `onReload` is gone from MenteeGoalsTab:**
   - Look at `MenteeDetail.tsx` JSX: `<MenteeGoalsTab ... menteeId={menteeId} />`. No `onReload`.
   - `MenteeProjectsTab` still has `onReload={reloadDetail}` — confirms the bridge pattern is per-child.

5. **CriteriaChecklist remains interactive (no regression):**
   - As Staff on `/annual-goals`: toggle a criterion checkbox on an approved goal.
   - DevTools: NO refetch fires. The goal cache entry's data updates **synchronously** via setQueryData (PR #22's pattern).
   - Dashboard count flashes in the background (`["dashboard", ...]` invalidation that AnnualGoals' handleCriterionUpdate still does).

---

## Part 9 — What's deliberately not done here

- **`CriteriaChecklist`** stays imperative on purpose (Part 1).
- **`MenteeProjectsTab`** keeps its `onReload` bridge — separate scope, separate PR. Will migrate similarly when its turn comes.
- **`EvalDrawer` + `useReviewDetails`** (mentor-eval drawer flow on AnnualReviews tabs) — separate PR, the last child-component scope.
- **`PrimaryEvaluationTab` + `SecondaryEvalTab`** (PM's project-review writes) — separate PR.

After those three remaining child-component PRs, plus the `SystemSettingsProvider` internal swap, the TanStack Query rollout is complete.
