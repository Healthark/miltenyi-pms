# 12 — MenteeProjectsTab: closing the bridge-pattern loop

> **PR:** [#29](https://github.com/Healthark/miltenyi-pms/pull/29)
> **Files changed:** `frontend/src/lib/queryKeys.ts` (added `projectReviews.detail(id)`), `frontend/src/components/mentees/MenteeProjectsTab.tsx`, `frontend/src/pages/MenteeDetail.tsx` (deleted the `reloadDetail` callback entirely).
> **Headline result:** 2 queries + 6 mutations migrated. The `onReload` bridge prop introduced in PR #25 fully unwinds here — both child consumers (`MenteeGoalsTab` in PR #27, `MenteeProjectsTab` in this PR) now self-manage cache invalidation, so `MenteeDetail.reloadDetail` is deleted.

---

## TL;DR

`MenteeProjectsTab` (the per-mentee project-review queue inside `/my-mentees/:id`) is the last child component still using the bridge callback pattern from PR #25. It also has the most mutations of any single component we've touched so far — **six** mutations spanning both the PM (Primary) and Secondary evaluator flows, because a mentor can be either role on any given project.

The migration does three things at once:
1. **Six mutations** to `useMutation` with mixed specific + broadcast invalidation
2. **The on-demand `getReview(reviewId)` modal fetch** moves to `useQuery` with the same `enabled`-gated pattern as ManagementReview's Rate modal (PR #26), backed by a new `queryKeys.projectReviews.detail(id)` factory entry
3. **The `onReload` bridge prop is removed**, and since this was the last consumer, `MenteeDetail.reloadDetail` is deleted entirely

There's also a small but interesting pattern shift: where the legacy code used `useState` + `useEffect` to fetch + merge the impact-statement detail into the row, we now use **render-time derivation** — the query result is folded into the row in the JSX path, not stored in state.

This is the **second-to-last** TanStack Query migration. After EvalDrawer + useReviewDetails (#13) and SystemSettingsProvider (#14), the rollout is complete.

---

## Part 1 — Six mutations from one component

The mentor of a Staff user can be on the same project as them in two capacities:
- **Primary evaluator (PM)** — owns the project, writes the main PM evaluation
- **Secondary evaluator** — listed as `secondary_evaluator_id` on the project, writes an impact statement

For each capacity, there are three write operations (submit, update, save-draft). Hence six mutations:

| Mutation | Service call | Modal |
|---|---|---|
| `updateReviewMutation` | `projectReviewService.updateReview` | EvalModal (edit) |
| `submitPMEvalMutation` | `projectReviewService.submitPMEvaluation` | EvalModal (create) |
| `savePMDraftMutation` | `projectReviewService.savePMDraft` | EvalModal (draft) |
| `updateSecondaryMutation` | `projectReviewService.updateSecondaryEval` | ImpactModal (edit) |
| `submitSecondaryMutation` | `projectReviewService.submitSecondaryEval` | ImpactModal (submit) |
| `saveSecondaryDraftMutation` | `projectReviewService.saveSecondaryDraft` | ImpactModal (draft) |

All six share the **same invalidation footprint** (see Part 2). All six route errors to `setModalError` (one shared error state because both modals render mutually exclusively). The `isPending` flags get OR'd together per modal:

```tsx
const isEvalSaving =
  submitPMEvalMutation.isPending || updateReviewMutation.isPending;
const isEvalDraftSaving = savePMDraftMutation.isPending;
const isImpactSaving =
  submitSecondaryMutation.isPending || updateSecondaryMutation.isPending;
const isImpactDraftSaving = saveSecondaryDraftMutation.isPending;
```

Six mutations, four flags. Each modal's submit button shows a spinner for its mutation's pending state without us tracking it manually.

### Why six separate mutations instead of two-with-branching

We've made this call before — PR #20 (createUser vs updateUser), PR #27 (approveGoal vs requestChanges), PR #28 (updateReview vs submitPMEvaluation). The reasoning compounds:

- Independent `isPending` flags
- Independent `onSuccess` callbacks (different toast copy: "Evaluation updated" vs "Evaluation submitted" vs "Draft saved")
- Independent `mutationFn` signatures (PUT takes reviewId; POST takes projectId + userId; PATCH takes reviewId too but different payload type)
- Future-proof: if we ever need per-mutation `onMutate` for optimistic updates, they're already split

Each mutation is ~15 lines. Six × 15 = 90 lines for the mutation block. The alternative — two mutations with internal branching — is fewer lines but less clear and harder to evolve.

---

## Part 2 — Mixed specific + broadcast invalidation (refined)

This component's mutations affect four cache scopes. We invalidate two specifically, two by broadcast:

```tsx
const invalidateScope = useCallback(() => {
  // SPECIFIC: this mentee's payload (project_assignments embedded)
  void queryClient.invalidateQueries({
    queryKey: queryKeys.mentees.detail(menteeUserId),
  });
  // SPECIFIC: mentor's roster (projects.pending_reviews_count moves)
  void queryClient.invalidateQueries({
    queryKey: queryKeys.mentees.summaries(),
  });
  // BROADCAST: every project-review query (pmQueue, secondaryQueue,
  // mine, mentees, org, all detail entries)
  void queryClient.invalidateQueries({
    queryKey: queryKeys.projectReviews.all,
  });
  // BROADCAST: project_reviews_pending_primary/_secondary counts
  void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
}, [queryClient, menteeUserId]);
```

### Why this mix

The decision splits cleanly along **per-entity vs cross-cutting** lines:

**Specific keys (per-mentee data):**
- `mentees.detail(menteeUserId)` — only THIS mentee's detail. Broadcasting `mentees.all` would over-invalidate every other mentee detail we have cached. A mentor with 20 mentees would refetch 20 detail entries on every approval.
- `mentees.summaries()` — there's only one summaries cache entry (the mentor's roster), so "specific" and "broadcast" are the same here. We use the specific form for clarity.

**Broadcast keys (cross-namespace, cross-consumer):**
- `projectReviews.all` — the write affects PM queue, secondary queue, Staff's own view, HR's org view, individual review details. Listing them explicitly would be 5+ keys.
- `dashboard.all` — covers Staff and HR dashboards both, summary and HR summary, all FYs. Broadcast is the right granularity.

This is the **refinement** of broadcast-vs-explicit we touched on in PR #27 and #28: per-entity data wants specific keys (cost of over-invalidating scales with N entities); cross-cutting data wants broadcast (cost of being too specific scales with how many consumers you forget).

The mental model: **does this mutation affect ONE thing or MANY things?**
- "This mentee's project assignments" → ONE thing → specific
- "Every project review somewhere in the app" → MANY things → broadcast

---

## Part 3 — Render-time derivation replaces useState+useEffect

The legacy code fetched the impact-statement detail with this dance:

```tsx
const [impactTarget, setImpactTarget] = useState<MenteeEvalRow | null>(null);
const [impactLoading, setImpactLoading] = useState(false);

const handleWriteImpact = async (row: MenteeEvalRow) => {
  setModalError("");
  if (row.review_id == null) return;
  setImpactLoading(true);
  try {
    const review = await projectReviewService.getReview(row.review_id);
    setImpactTarget({ ...row, review_detail: review } as MenteeEvalRow);
  } catch (err) {
    setModalError(getErrorMessage(err));
  } finally {
    setImpactLoading(false);
  }
};
```

Two pieces of state for one logical "impact target with its detail." Why two? Because the data has two sources: the row info comes from a prop, the detail comes from a fetch. The state had to hold both.

The migration splits that apart:

```tsx
// Pure UI state — what row the user clicked
const [impactRow, setImpactRow] = useState<MenteeEvalRow | null>(null);
const [impactReviewId, setImpactReviewId] = useState<number | null>(null);

// Server state — fetched when the modal opens (enabled-gated)
const detailQuery = useQuery({
  queryKey: queryKeys.projectReviews.detail(impactReviewId ?? -1),
  queryFn: () => projectReviewService.getReview(impactReviewId as number),
  enabled: impactReviewId !== null,
});

// Render-time derivation — merge the two when both are available
const impactTarget: MenteeEvalRow | null = impactRow && detailQuery.data
  ? ({ ...impactRow, review_detail: detailQuery.data } as MenteeEvalRow)
  : impactRow;

const impactLoading = impactReviewId !== null && detailQuery.isPending;

const handleWriteImpact = (row: MenteeEvalRow) => {
  setModalError("");
  if (row.review_id == null) return;
  setImpactRow(row);
  setImpactReviewId(row.review_id);
  // No async, no try/catch, no setX(true)/setX(false). The detail
  // fetch fires when impactReviewId flips non-null; the result
  // flows into impactTarget via the derivation above.
};
```

### Three small principles being demonstrated

**1. State holds inputs, not outputs.** `impactRow` and `impactReviewId` are inputs (the user's click). The merged `impactTarget` is an output (derived). When you can derive instead of store, derive. The merged value automatically updates when either input changes.

**2. The handler shrinks because the wiring is declarative.** The legacy handler did the fetch + the merge + the error routing all imperatively. The new handler just flips two pieces of state; everything else cascades through React's render.

**3. Cache-driven reactivity is one-way.** The query observes `impactReviewId`. When it changes, the query refetches (or hits cache). The result flows down through the JSX. The old code had two-way coupling: handler-imperatively-fetches, handler-imperatively-sets-state. The new code is unidirectional.

This is the kind of refactor that's invisible if you're not looking — same UI, same behaviour — but the **shape** is cleaner. Less state to keep in sync, fewer paths through the handler, no race conditions between handler-running and component-unmounting (TanStack Query handles unmount via AbortController).

---

## Part 4 — The bridge pattern fully unwinds

Recap of the lifecycle:

| PR | What happened |
|---|---|
| PR #25 (MenteeDetail) | Parent migrated to useQuery. Children (`MenteeGoalsTab`, `MenteeProjectsTab`) still imperative — given `onReload` callback prop as a **bridge** so they could request a parent refetch without knowing the cache key |
| PR #27 (MenteeGoalsTab) | First child migrated. Stops accepting `onReload`; takes `menteeId` instead, self-invalidates `queryKeys.mentees.detail(menteeId)`. Parent's `reloadDetail` callback shrinks to just one remaining caller. |
| **PR #12 (this one)** | **Second child migrated. Same pattern — `onReload` drops, `menteeUserId` is what we needed anyway. Zero callers left. `MenteeDetail.reloadDetail` deleted entirely.** |

The bridge pattern is a transitional tool. It exists exactly for the case where a parent migrates first and you don't want to force the children to migrate at the same time. Once all children have migrated, the bridge disappears.

The right time to introduce a bridge: when a parent migration would otherwise need a big-bang of all its children migrated at the same time. The right time to remove it: when the last child has migrated. **Code reviewers should reject bridge callbacks that outlive their last consumer.**

```diff
-  // Bridge for unmigrated child tabs (MenteeGoalsTab, MenteeProjectsTab)
-  // that still do imperative mutations and need to refresh the
-  // mentee-detail view. Once those tabs migrate to useMutation, they'll
-  // invalidate keys directly and we can drop this prop. Until then,
-  // expose a stable callback that hits the same invalidation a useQuery
-  // mutation would.
-  const reloadDetail = useCallback(() => {
-    void queryClient.invalidateQueries({
-      queryKey: queryKeys.mentees.detail(menteeId),
-    });
-  }, [queryClient, menteeId]);
+  // The `reloadDetail` bridge callback that used to live here is gone.
+  // Both child tabs that consumed it (MenteeGoalsTab in PR #27,
+  // MenteeProjectsTab in #12) now self-manage their cache invalidation
+  // by accepting `menteeId` / `menteeUserId` and calling
+  // queryClient.invalidateQueries directly. The bridge pattern from
+  // PR #25 has fully unwound.
```

---

## Part 5 — Factory addition: `projectReviews.detail(id)`

Symmetric to the `annualReviews.detail(id)` added in PR #26 for the ManagementReview Rate modal. Same shape, same `enabled`-gated usage, same `?? -1` sentinel for the closed-modal placeholder.

```ts
projectReviews: {
  all: ["project-reviews"] as const,
  mine: () => [...projectReviews.all, "mine"] as const,
  mentees: () => [...projectReviews.all, "mentees"] as const,
  org: () => [...projectReviews.all, "org"] as const,
  pmQueue: () => [...projectReviews.all, "pm-queue"] as const,
  secondaryQueue: () => [...projectReviews.all, "secondary-queue"] as const,
  roleExpectations: () => [...projectReviews.all, "role-expectations"] as const,
  detail: (id: number) =>                                     // NEW
    [...projectReviews.all, "detail", id] as const,
},
```

The `projectReviews` namespace is now feature-complete. No more keys to add unless we introduce a new endpoint.

### Why no parent pre-warms this cache

Compare `secondaryQueue` (parent ProjectReviews probes it for visibility) vs `detail(id)` (no parent fetches this — it's strictly per-on-demand-modal). Different keys, different parent relationships.

The factory entry is added **when there's a consumer**. The detail key has one consumer (the impact modal in this component); no parent pre-warms it.

---

## Part 6 — Final scorecard

### Files changed
| File | Lines | What |
|---|---|---|
| `frontend/src/lib/queryKeys.ts` | +5 | New `projectReviews.detail(id)` |
| `frontend/src/components/mentees/MenteeProjectsTab.tsx` | ~+150 / −120 | 1 useQuery (existing key) + 1 useQuery (new detail key) + 6 useMutation; dropped useEffect-based expectation fetch, the imperative impact-detail fetch with its own loading state, 2 `isSaving`-style useStates, the `onReload` prop |
| `frontend/src/pages/MenteeDetail.tsx` | ~+5 / −10 | Deleted `reloadDetail` callback (no consumers); dropped `onReload={reloadDetail}` from MenteeProjectsTab JSX |

### Bundle impact
| Chunk | Before | After | Δ |
|---|---|---|---|
| MenteeDetail (where MenteeProjectsTab lives) | 13.24 KB gzip | **13.31 KB** | +0.07 KB |
| Other chunks | — | — | unchanged |

Six mutation wrappers added, callback bridge + imperative fetch deleted. Net almost flat.

### Capability gains
- ✅ Mentor can submit/edit/draft both PM and Secondary evaluations from MenteeDetail with full cache coordination
- ✅ Dashboard counts auto-refresh after any write here
- ✅ Parent mentee detail + roster summaries refresh after writes — without callback prop drilling
- ✅ Impact-modal detail cache persists across opens (PR #26's modal-driven on-demand pattern applied again)
- ✅ Bridge pattern from PR #25 has fully unwound — `MenteeDetail.reloadDetail` deleted, no callback indirection

---

## Part 7 — Trade-offs we deliberately made

### Why MenteeProjectsTab does both PM and Secondary flows

A mentor visiting `/my-mentees/:id` might be Primary on some of their mentee's projects, Secondary on others. Splitting into two tabs (a la ProjectReviews page's PrimaryEvaluationTab + SecondaryEvalTab) would force the mentor to figure out which tab to use per project — bad UX.

So MenteeProjectsTab takes the row-level approach: each project's row exposes the right button based on `viewer_evaluator_role` (Primary / Secondary / null). The component owns six mutations because the row's button can fire any of them.

The cost: more mutations in one file. The benefit: simpler mental model for the user (one list, one set of buttons that adapt).

### Why one shared `setModalError` instead of two

Both modals (EvalModal and ImpactModal) render mutually exclusively — never both at the same time. So they can share an error state. Two separate `modalError` useStates would be:
- More state to reason about
- A theoretical correctness risk if both modals ever rendered concurrently (they don't)
- No actual gain

The pattern: **share state across UI surfaces that don't co-exist**. The mutual exclusivity is enforced by the component's logic (`evalTarget` and `impactTarget` are never both set), so the shared state is safe.

### Why we kept `closeEval` and `closeImpact` separate

Both close-functions just reset state. Could be one `closeModals()` that nulls both targets. We didn't because:
- The mutations call them specifically (`updateReviewMutation.onSuccess: closeEval`, `submitSecondaryMutation.onSuccess: closeImpact`) — clarity at the call site matters
- Future-proof: if a flow ever opens BOTH modals (which shouldn't happen but…), only the right one closes
- Cost: 6 lines for two functions instead of 4 for one. Negligible.

### Why render-time derivation instead of `useEffect` to set `impactTarget`

We could have:
```tsx
const [impactTarget, setImpactTarget] = useState(null);
useEffect(() => {
  if (impactRow && detailQuery.data) {
    setImpactTarget({ ...impactRow, review_detail: detailQuery.data });
  }
}, [impactRow, detailQuery.data]);
```

…and gotten the same UI behaviour. We chose the render-time derivation because:
- It's strictly fewer hooks (no useState + no useEffect → just a const declaration)
- It removes a state-update cycle (current render: derive → next render: see update vs current render: setState → re-render → derive)
- It cannot drift from its inputs — there's no "stale state" risk

When you can derive instead of store, derive. **`useState` + `useEffect` to recompute a value from props/state is almost always an anti-pattern** — it's React's bottom-of-the-stack-trace red flag.

---

## Part 8 — What you should now know cold

1. **Mixed specific + broadcast invalidation** — per-entity data wants specific keys, cross-cutting data wants broadcast. The rule: "does this mutation affect ONE thing or MANY things?"
2. **Render-time derivation beats useState+useEffect** for one-way data flow. State holds inputs; derive outputs in the JSX path.
3. **Bridge pattern lifecycle** — introduce when a parent migrates ahead of its children; remove when the last child has migrated. The bridge in `MenteeDetail` is gone with this PR.
4. **Shared state across mutually-exclusive UI** is safe and reduces noise. Two modals → one error state.
5. **Six mutations vs two-with-branching** — separate is clearer, future-proof, and pays back the line count in maintainability.

---

## Part 9 — Verify it works

```bash
cd frontend
npm run build
npm run dev
```

In the app (log in as a Mentor with mentees that have project assignments):

1. **Open `/my-mentees/<menteeId>` → Projects tab.**
   - DevTools: `["project-reviews", "role-expectations"]` green (warm if mentor visited `/project-reviews` first; otherwise fires now).
   - `["mentees", "detail", <menteeId>]` is also green from the parent.

2. **PM flow:**
   - On a row where the mentor is Primary and the review is pending, click "Evaluate" → EvalModal opens.
   - Save draft → modal stays open, "Draft saved" toast. DevTools shows `["mentees", "detail", <id>]`, `["mentees", "summaries"]`, `["project-reviews", ...]`, `["dashboard", ...]` all flash blue → green.
   - Submit → modal closes, status badge moves "Pending" → "Reviewed" on the row, dashboard counts update.
   - Click "Edit" on a reviewed row → EvalModal opens in edit mode, save changes.

3. **Secondary flow (the on-demand fetch test):**
   - On a row where mentor is Secondary (`viewer_evaluator_role === "Secondary"`), click "Write Impact" or "Edit Impact."
   - **First click:** DevTools shows `["project-reviews", "detail", <reviewId>]` flash blue → green. ImpactModal opens with the response.
   - **Close and reopen the same row:** modal opens **instantly** — no new request. The detail query is cache-warm.
   - **Click a different Secondary row:** new cache entry under `detail(<different-id>)`.
   - Submit / save draft → invalidations fire across all four scopes.

4. **Cross-tab cache sharing:**
   - In window A: submit a PM evaluation here.
   - In window B (separate tab, mentor logged in on `/dashboard`): refocus → `dashboard.summary` refetches, project_reviews_pending_primary count reflects the change.

5. **Confirm the bridge is gone:**
   - Inspect `MenteeDetail.tsx`: no `reloadDetail` callback. The MenteeProjectsTab JSX has only `menteeUserId` (no `onReload`).
   - As a sanity check, do a goal-approval action (MenteeGoalsTab from PR #27) → it still works using its own `menteeId` self-invalidation. No regressions.

---

## Part 10 — What's deliberately not done here

Two child-component PRs left, then SystemSettingsProvider, then the cache rollout is **complete**:

- **`EvalDrawer` + `useReviewDetails`** — the annual-review mentor-eval inline editor. Reuses `queryKeys.annualReviews.detail(id)` from PR #26.
- **`SystemSettingsProvider`** — replace the hand-rolled context cache with `useQuery` while keeping the public `useSystemSettings()` hook signature unchanged.

After those, fresh theme: **pagination + virtualization**.
