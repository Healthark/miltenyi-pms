# 05 — AnnualGoals migration with broadcast-key invalidation + `setQueryData` hot paths

> **PR:** _pending_
> **Files changed:** `frontend/src/pages/AnnualGoals.tsx` only.
> **Headline result:** 3 queries, 5 mutations, plus the criterion-toggle hot path now uses `setQueryData` for instant feedback. Two new patterns introduced: **broadcast-key invalidation** and **hot-path `setQueryData`** for mutations the user fires repeatedly.

---

## TL;DR

`AnnualGoals.tsx` was the largest page in the audit (1261 lines). It's role-aware (Staff, Mentor, HR), has 5 distinct write paths, and has a hot-path interaction — the criterion checkbox — that the user can click dozens of times per minute. A naive migration would either lose its instant-feedback feel (every checkbox = network roundtrip + skeleton flash) or end up with a dozen `invalidateQueries` calls.

We solve both problems with two patterns:

1. **Broadcast-key invalidation.** Instead of listing `['goals', 'mine', 'annual']`, `['goals', 'all']`, `['goals', 'mentees']` on every mutation, we invalidate the **parent key** `['goals']`. TanStack Query's prefix matching catches every child under it in one call. Same for `['dashboard']` — every goal mutation also affects dashboard counts.

2. **`setQueryData` for hot paths.** The criterion toggle uses `queryClient.setQueryData(['goals', 'mine', 'annual'], (prev) => ...)` to update the cache **synchronously** without a refetch. The UI feels instant; the dashboard refetches in the background.

We also fixed a pre-existing bug along the way: the old code never refreshed dashboard goal counts after a goal write. The migration's broadcast invalidation now does.

---

## Part 1 — The problems we're solving

Look at the old code's five mutations. Each one did:

```tsx
const updated = await goalService.someWrite(...);
setGoals((prev) => prev.map((g) => (g.id === updated.id ? updated : g)));
toast.success("...");
```

Three issues with this pattern, compounded across 5 write paths:

1. **Only the `goals` array updates.** `allGoals` (HR's view), the dashboard's `total_goals` count, and TeamGoalsTab's view of the same data are all stale. The old `setGoals(...)` only touched the Staff "my goals" array.

2. **Boilerplate per mutation.** Every write reimplements `findIndex + splice + toast`. Five writes = five hand-rolled upserts. Easy to get subtly wrong (sort order, null handling).

3. **No cross-component coordination.** If a future view of "all goals across the org" mounts elsewhere — a dashboard widget, an export preview — it has no way to know a write happened.

The criterion toggle had a separate problem: it was structured as a parent-owned `setGoals((prev) => ...)` callback, which made it **instant** (no network wait) but **wrong** when the data later refetched (the local state would be overwritten by the server's view, which might not yet include the toggle the user just made).

The migration fixes all four. Different patterns for different access shapes.

---

## Part 2 — Pattern 1: Broadcast-key invalidation

This is the major new concept in this PR. Stay with the example — it's the kind of thing that's hard to motivate in the abstract but obvious once you've seen the alternative.

### Cache keys form a hierarchy

We've been planning keys like URLs all along:

```
['goals', 'mine', 'annual']     ← Staff's own annual goals
['goals', 'mine', 'project']    ← Staff's project goals (future)
['goals', 'all']                ← HR's org-wide view
['goals', 'mentees']            ← TeamGoalsTab (Mentor)
['dashboard', 'summary']         ← Dashboard goal counts
['dashboard', 'hr-summary', fy]  ← HR's dashboard by FY
```

When you call `invalidateQueries({ queryKey: ['goals'] })`, TanStack Query matches **by prefix**. Every cache entry whose key STARTS WITH `['goals']` is invalidated. That's all four of the goal queries above, regardless of which one(s) are currently mounted. Future cache entries under `['goals']` (e.g. `['goals', 'user', 42, 'history']` we might add later) get invalidated automatically too.

### The contrast

**Explicit list** (what we did in PR #21 for annual-reviews):
```tsx
onSuccess: () => {
  void queryClient.invalidateQueries({ queryKey: ['annual-reviews', 'mine'] });
  void queryClient.invalidateQueries({ queryKey: ['annual-reviews', 'all'] });
}
```

**Broadcast** (what we're doing in this PR):
```tsx
onSuccess: () => {
  void queryClient.invalidateQueries({ queryKey: ['goals'] });
}
```

### When to prefer which

| | Explicit list | Broadcast |
|---|---|---|
| **Number of affected children** | 1–2 | 3+ |
| **Future-proofing** | Have to remember to add new keys | Auto-catches new keys |
| **Readability of intent** | "I'm invalidating these two specific things" | "Everything under this namespace" |
| **Risk** | Forget a key → stale UI | Over-invalidates → wasted refetches |
| **Examples in our codebase** | annual-reviews (2 children) | goals (4+ children + dashboard) |

For goals, the broadcast is the right call. There are 4+ existing children and the goal namespace is genuinely "everything that depends on goal data is stale after a goal write." Listing them explicitly would be a maintenance burden — every time someone adds a new query under `['goals', ...]`, they'd have to find every mutation and add the key.

For annual-reviews, two children, explicit list reads more clearly.

**The rule of thumb:** use broadcast when "every X cache entry is affected" is what you mean. Use explicit list when "these specific X and Y" is what you mean. The cost of over-invalidating is one wasted GET per unrelated subscriber; cheap.

### Our broadcast helper

Five mutations all do the same two invalidations (`['goals']` + `['dashboard']`). DRY them with a helper:

```tsx
const invalidateGoalsAndDashboard = useCallback(() => {
  void queryClient.invalidateQueries({ queryKey: ["goals"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
}, [queryClient]);

// Then every onSuccess:
const createGoalMutation = useMutation({
  mutationFn: ...,
  onSuccess: () => {
    invalidateGoalsAndDashboard();
    closeModal();
    toast.success("Goal created.");
  },
});
```

Tiny, but worth doing — the alternative is the same two lines copy-pasted across five mutations, which is exactly the kind of thing that drifts over time as people forget the `['dashboard']` invalidation.

### Why `['dashboard']` too

The dashboard summary tile shows `total_goals`, `draft_goals`, `submitted_goals`, etc. Every goal mutation changes one of those numbers. The old code never refreshed them — they were silently stale until the user navigated to the dashboard.

**This migration fixes a pre-existing bug.** Calling out as a teaching point: "invalidate every cache key affected by this write" forces you to think about every downstream consumer. The old pattern, where you splice into local state, only thought about the page in front of you. The new pattern systematically asks "what else cares?"

---

## Part 3 — Pattern 2: `setQueryData` for hot paths

The criterion checkbox lets a Staff user toggle individual criteria within a goal. Toggling recomputes `progress_percent`, which the UI shows immediately. The user might click 10 checkboxes in 20 seconds.

If we used `invalidateQueries` here:
- Each click → server PATCH → response → invalidate → server GET → response → re-render
- Each interaction has a ~200ms perceived delay
- Three checkboxes in a row could queue three full refetches

Instead, we use `setQueryData` to write directly to the cache:

```tsx
const handleCriterionUpdate = useCallback(
  (goalId: number, updated: Criterion) => {
    queryClient.setQueryData<Goal[]>(
      ["goals", "mine", "annual"],
      (prev) => {
        if (!prev) return prev;
        return prev.map((g) => {
          if (g.id !== goalId) return g;
          const newCriteria = g.criteria.map((c) =>
            c.id === updated.id ? updated : c,
          );
          return {
            ...g,
            criteria: newCriteria,
            progress_percent: recomputeProgress(newCriteria),
          };
        });
      },
    );
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  },
  [queryClient],
);
```

What this does:
1. **Pulls the cache entry** for `['goals', 'mine', 'annual']` via `setQueryData`'s function form
2. **Returns a new array** with the updated criterion spliced in and `progress_percent` recomputed
3. TanStack Query stores the new value and notifies subscribers — re-render happens synchronously
4. **No network refetch.** Server PATCH already happened (in CriteriaChecklist); the response was passed into this handler as `updated`. We trust the cache update is consistent with the server.

The `void queryClient.invalidateQueries({ queryKey: ['dashboard'] })` after fires-and-forgets a dashboard refetch in the background — the user isn't watching the dashboard, so the refetch is silent.

### When to use `setQueryData` vs `invalidateQueries`

| | `invalidateQueries` | `setQueryData` |
|---|---|---|
| **What happens** | Marks stale → refetch | Writes to cache → no refetch |
| **UI lag** | One round-trip | Synchronous |
| **Use when** | Server might have computed extra state we don't know about | We have the exact new entry the cache should hold |
| **Risk** | Slightly slower UX | Drift from server (write the wrong value → stuck wrong until next refetch) |
| **Hot path cost** | Bad (queues N refetches) | Free |

For hot paths — checkboxes, drag-and-drop reorders, instant filters that mutate server state — `setQueryData` is essential. For cold paths — modal save buttons, list operations — `invalidateQueries` is safer.

### Drift safety

`setQueryData`'s risk is that you write a wrong value into the cache and the UI shows it until the next refetch. Two mitigations:

1. The next "natural" refetch (focus refetch, manual invalidation, etc.) will overwrite with server truth. So drift is **bounded** — never permanent.
2. For criterion toggles specifically, the server's response IS what we're writing in. CriteriaChecklist receives the response from `updateCriterion` and passes it to `handleCriterionUpdate`. The cache update is by construction consistent with the server's view of THAT criterion.

If `progress_percent` is recomputed differently by the server, we'd be wrong locally for a moment. Acceptable trade.

---

## Part 4 — The work, step by step

### Step 1 — Three role-gated queries replace `loadGoals`

**Before:**
```tsx
const [goals, setGoals] = useState<Goal[]>([]);
const [allGoals, setAllGoals] = useState<TeamGoal[]>([]);
const [isLoading, setIsLoading] = useState(true);
const [roleExpectation, setRoleExpectation] = useState<UserRoleExpectation | null>(null);

useEffect(() => {
  // ... fetch expectations
}, []);

const loadGoals = useCallback(async () => {
  setIsLoading(true);
  try {
    if (isHRMyOrg) {
      setAllGoals(await goalService.getAllGoals());
    } else if (isStaff) {
      setGoals(await goalService.getMyGoals("annual"));
    }
  } finally {
    setIsLoading(false);
  }
}, [isHRMyOrg, isStaff]);

useEffect(() => { void loadGoals(); }, [loadGoals]);
```

**After:**
```tsx
const expectationsQuery = useQuery({
  queryKey: ["profile", "expectations"],
  queryFn: profileService.getMyExpectations,
});
const myGoalsQuery = useQuery({
  queryKey: ["goals", "mine", "annual"],
  queryFn: () => goalService.getMyGoals("annual"),
  enabled: isStaff,
});
const allGoalsQuery = useQuery({
  queryKey: ["goals", "all"],
  queryFn: goalService.getAllGoals,
  enabled: isHRMyOrg,
});

const roleExpectation = expectationsQuery.data ?? null;
const goals = myGoalsQuery.data ?? [];
const allGoals = allGoalsQuery.data ?? [];
const isLoading = isStaff
  ? myGoalsQuery.isPending
  : isHRMyOrg
    ? allGoalsQuery.isPending
    : false;
```

Same pattern as PR #21 — three queries register unconditionally, two are gated by `enabled` so they don't fire for the wrong role. The expectations query is universal (every role has its own role expectation).

### Step 2 — Five mutations, broadcast invalidation

```tsx
const invalidateGoalsAndDashboard = useCallback(() => {
  void queryClient.invalidateQueries({ queryKey: ["goals"] });
  void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
}, [queryClient]);

const createGoalMutation = useMutation({
  mutationFn: (payload: GoalCreatePayload) =>
    goalService.createGoal({ ...payload, goal_type: "annual" }),
  onSuccess: () => {
    invalidateGoalsAndDashboard();
    closeModal();
    toast.success("Goal created.");
  },
  onError: (err) => setModalError(getErrorMessage(err)),
});

const updateGoalMutation = useMutation({
  mutationFn: (vars: { id: number; payload: GoalUpdatePayload }) =>
    goalService.updateGoal(vars.id, vars.payload),
  onSuccess: () => {
    invalidateGoalsAndDashboard();
    closeModal();
    toast.success("Goal updated.");
  },
  onError: (err) => setModalError(getErrorMessage(err)),
});

const submitGoalMutation = useMutation({
  mutationFn: (goalId: number) => goalService.submitGoal(goalId),
  onSuccess: () => {
    invalidateGoalsAndDashboard();
    toast.success("Goal submitted for review.");
  },
  onError: (err) => snackbar.error(getErrorMessage(err)),
});

const submitSelfReviewMutation = useMutation({
  mutationFn: (vars: {
    goalId: number;
    cycleHalf: SelfReviewCycleHalf;
    payload: GoalSelfReviewPayload;
  }) =>
    goalService.submitSelfReview(vars.goalId, vars.cycleHalf, vars.payload),
  onSuccess: () => {
    invalidateGoalsAndDashboard();
    closeSelfReview();
    toast.success("Self-review submitted.");
  },
  onError: (err) => setSelfReviewError(getErrorMessage(err)),
});

const saveSelfReviewDraftMutation = useMutation({
  mutationFn: (vars: {
    goalId: number;
    cycleHalf: SelfReviewCycleHalf;
    payload: GoalSelfReviewPayload;
  }) =>
    goalService.saveSelfReviewDraft(vars.goalId, vars.cycleHalf, vars.payload),
  onSuccess: () => {
    invalidateGoalsAndDashboard();
    toast.success("Draft saved.");
  },
  onError: (err) => setSelfReviewError(getErrorMessage(err)),
});
```

**Observations:**
- All five share `invalidateGoalsAndDashboard()` — broadcast invalidation
- Multi-arg mutations (updateGoal, submitSelfReview, saveSelfReviewDraft) all use the **pack-into-an-object** pattern from PR #20
- Errors route differently per UI surface: modal mutations → `setModalError`/`setSelfReviewError`, fire-and-forget mutations → snackbar
- `isPending` flags: `createGoalMutation.isPending || updateGoalMutation.isPending` becomes `isSavingGoal`, passed to the GoalFormModal; `submitSelfReviewMutation.isPending` and `saveSelfReviewDraftMutation.isPending` go directly into the SelfReview modal

### Step 3 — The criterion toggle keeps its instant feedback

```tsx
const handleCriterionUpdate = useCallback(
  (goalId: number, updated: Criterion) => {
    queryClient.setQueryData<Goal[]>(
      ["goals", "mine", "annual"],
      (prev) => {
        if (!prev) return prev;
        return prev.map((g) => {
          if (g.id !== goalId) return g;
          const newCriteria = g.criteria.map((c) =>
            c.id === updated.id ? updated : c,
          );
          return {
            ...g,
            criteria: newCriteria,
            progress_percent: recomputeProgress(newCriteria),
          };
        });
      },
    );
    void queryClient.invalidateQueries({ queryKey: ["dashboard"] });
  },
  [queryClient],
);
```

`CriteriaChecklist` (the child) calls `goalService.updateCriterion()` itself and receives the response. It passes the response to this handler. We **write the response directly into the cache** — synchronous, no refetch.

The dashboard invalidate fires in the background — the dashboard isn't mounted while on this page, so the user never sees a loading state.

**Note this is the only place in this PR where we deliberately don't broadcast.** The criterion update doesn't affect `['goals', 'all']` (HR's view doesn't show criterion-level state for other users) or `['goals', 'mentees']` (similar). We update only the entry that needs it.

### Step 4 — Handlers shrink to thin wrappers

```tsx
const handleSave = async (payload: GoalCreatePayload | GoalUpdatePayload) => {
  setModalError("");
  try {
    if (editingGoal) {
      await updateGoalMutation.mutateAsync({
        id: editingGoal.id,
        payload: payload as GoalUpdatePayload,
      });
    } else {
      await createGoalMutation.mutateAsync(payload as GoalCreatePayload);
    }
  } catch { /* handled by onError */ }
};

const handleSubmit = async (goal: Goal) => {
  const ok = await confirm({ ... });
  if (!ok) return;
  submitGoalMutation.mutate(goal.id);   // fire-and-forget
};

const handleSelfReviewSubmit = async (cycleHalf, payload) => {
  if (!selfReviewGoal) return;
  const ok = await confirm({ ... });
  if (!ok) return;
  setSelfReviewError("");
  try {
    await submitSelfReviewMutation.mutateAsync({
      goalId: selfReviewGoal.id,
      cycleHalf,
      payload,
    });
  } catch { /* handled by onError */ }
};
```

Same `mutate` vs `mutateAsync` rule from PR #20: use `mutateAsync` when the caller (modal) awaits to drive its own UI state. Use `mutate` when the caller doesn't care about completion.

---

## Part 5 — Final scorecard

### Files changed
| File | Lines | What |
|---|---|---|
| `frontend/src/pages/AnnualGoals.tsx` | ~+135 / −140 | 3 queries + 5 mutations + criterion `setQueryData`; deleted `loadGoals`, expectations effect, `goals`/`allGoals` useStates, 4 `isSaving`-style flags |

### Bundle impact
| Chunk | PR #21 (before) | This PR (after) | Δ |
|---|---|---|---|
| AnnualGoals | 14.36 KB gzip | **14.49 KB** | +0.13 KB (mutation wrappers) |
| Other chunks | — | — | unchanged |

### Capability gains
- ✅ Dashboard goal counts now refresh after every goal write (fixed pre-existing staleness bug)
- ✅ Cross-component refresh works automatically for any future view of any goal query
- ✅ Criterion toggles stay instant via `setQueryData`; dashboard refreshes silently in the background
- ✅ Mutation `isPending` flags replace four hand-rolled `isSaving` useStates
- ✅ Broadcast-key invalidation pattern templated for future PRs (ProjectReviews, etc.)

---

## Part 6 — Trade-offs we deliberately made

### Why broadcast `['goals']` instead of listing children

The goal namespace currently has 3 actively-queried children (`mine.annual`, `all`, `mentees`) and is likely to grow (project goals, per-user history, exports, drill-downs). Listing them explicitly on every mutation means each addition has to find every mutation and add the key.

The broadcast catches all current and future children for free. The downside — over-invalidating an unmounted child query — is essentially free (the cache invalidation is a no-op if nothing is observing the key, and the cached entry just gets marked stale for the next mount).

This isn't always the right call. For annual-reviews (PR #21), we have two clear children that don't generalize, and listing them explicitly tells the reader exactly what the mutation affects. Match the pattern to the situation.

### Why `setQueryData` for criterion toggle but not for goal CRUD

Criterion toggle is hot path (many clicks per minute). Goal create/update/submit is cold path (a few per session). Different shapes warrant different tools:

- **Hot path** → `setQueryData`. Synchronous UI update. The user doesn't notice the network roundtrip.
- **Cold path** → `invalidateQueries`. Slightly slower (round-trip to refetch the list) but safer (server is canonical truth).

Could we use `setQueryData` everywhere? Yes — and lose the server-as-truth safety net. The cost of being briefly wrong on a list operation that happens once a session is much lower than the cost of being wrong on a criterion that changes every few seconds. Trade-off per call site.

### Why we didn't migrate `CriteriaChecklist` itself

`CriteriaChecklist` is used in 4+ places (AnnualGoals, TeamGoalsTab, MenteeGoalsTab, AnnualGoalCard's edit mode). Migrating it would mean either:
- Hard-coding a queryKey inside it (breaks reusability)
- Passing a queryKey prop (adds API surface to every caller)
- Calling broadcast invalidate `['goals']` (works, but ties the component to the goals namespace)

Cleanest path: leave it imperative for now (it owns its own `updateCriterion` service call) and have the parent reconcile via `setQueryData`. When we migrate TeamGoalsTab and MenteeGoalsTab in future PRs, each can adopt the same parent-side reconciliation. Once 100% of the consumers are migrated, we can revisit unifying inside CriteriaChecklist.

### Why we don't migrate TeamGoalsTab in this PR

Scope discipline. TeamGoalsTab is a 500+ LOC component that loads its own `getMenteeGoals()` data and has its own mentor-side mutations (`approveGoal`, `requestChanges`, etc.). It's a separate page-level concern — own PR.

The migrations we did here invalidate `['goals']` broadcast, so once TeamGoalsTab is migrated to use `['goals', 'mentees']`, it'll auto-refresh on every write from this page. The contract is forward-compatible.

### Why we kept the role-expectations as a standalone query

We could fold expectations into a single combined "page bootstrap" query:
```tsx
const bootstrap = useQuery({
  queryKey: ['annual-goals', 'bootstrap'],
  queryFn: () => Promise.all([profileService.getMyExpectations(), ...]),
});
```

We didn't. Reasons:
- Expectations are stable (a user's role expectation rarely changes); they have different staleness from goals
- A future Profile page would also want the same `['profile', 'expectations']` cache entry; keeping it independent enables sharing
- The "everything in one query" anti-pattern hides per-resource staleness controls

Each resource is its own cache entry. Group hooks logically; group cache entries by data shape.

---

## Part 7 — What you should now know cold

1. **Cache keys form a hierarchy**, and `invalidateQueries({ queryKey: [parent] })` matches by prefix.
2. **When to broadcast vs. when to list explicitly** (3+ children: broadcast; 1-2: explicit).
3. **`setQueryData` vs `invalidateQueries`** — the hot-path vs cold-path trade.
4. **The "every cache key affected by this write" mental model** — including dashboards and side-views, not just the page in front of you.
5. **Why we don't always migrate a child component** when migrating its parent.
6. **The `setQueryData` function form** — `(prev) => newData` instead of passing a static value.
7. **The cost of bundling queries** ("one big bootstrap" hides per-resource staleness; prefer separate queries).

---

## Part 8 — Verify it works

```bash
cd frontend
npm run build       # passes? good
npm run dev
```

In the running app:

1. **As Staff (My Goals):**
   - Open `/annual-goals`. DevTools shows: `["profile", "expectations"]`, `["goals", "mine", "annual"]` both green. `["goals", "all"]` parked.
   - Create a goal. Toast fires. DevTools shows BOTH `["goals", ...]` and `["dashboard", ...]` flash blue → green.
   - Edit a goal, save. Same flash pattern.
   - Submit a goal for review. Same.

2. **The criterion checkbox:**
   - Click a criterion checkbox. UI updates instantly. **DevTools shows the goals cache entry's data update but NO blue-fetching flash** — that's `setQueryData` doing its job.
   - Dashboard query flashes in the background.
   - Click multiple criteria in a row — each one is instant, no queue of refetches.

3. **As HR (All Goals):**
   - DevTools shows `["goals", "all"]` green, `["goals", "mine", "annual"]` parked.
   - Filter / sort works client-side (no new queries).
   - If you do happen to write a goal somehow (unlikely from this view), the broadcast invalidation would refresh both `mine` and `all`.

4. **Cross-page coordination test:**
   - Open `/annual-goals` in tab A as Staff.
   - Open `/dashboard` in tab B (same user, same browser).
   - In tab A, submit a goal → tab A's modal closes, table refreshes.
   - Switch to tab B → DevTools shows the dashboard query was invalidated; the goal-count tile reflects the new state (within the focus-refetch window).
   - This is the cache acting as a cross-component broadcast channel — exactly what the architecture promises.

5. **Self-review flow:**
   - Open a goal's self-review modal. Save a draft. Submit a self-review. Both flash invalidations in DevTools, both close modals on success.

---

## Part 9 — What's deliberately not done here

- **`CriteriaChecklist.updateCriterion`** stays imperative — reusable component with many consumers; migrating it is its own PR.
- **`TeamGoalsTab`** (Mentor's goal-approval queue) — separate component, ~500 LOC, own PR.
- **`MenteeGoalsTab`** (inside MenteeDetail) — part of MenteeDetail migration.
- **Optimistic UI for goal submit / approval** — `onMutate` patterns. Worth doing once we've cleaned up all the per-page migrations and want to make the mentor flow feel instant.
- **A query keys factory** (`src/lib/queryKeys.ts`). We now have 13+ keys across `['admin', ...]`, `['dashboard', ...]`, `['mentees', ...]`, `['annual-reviews', ...]`, `['goals', ...]`, `['profile', ...]`. **Overdue.** Likely the next PR.
