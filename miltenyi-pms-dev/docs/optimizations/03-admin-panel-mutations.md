# 03 — AdminPanel mutations with `useMutation` + `invalidateQueries`

> **PR:** _pending_
> **Files changed:** `frontend/src/pages/AdminPanel.tsx` only.
> **Headline result:** 4 user mutations + 1 settings mutation migrated to `useMutation`. Cross-component cache invalidation, `mutate` vs `mutateAsync`, `setQueryData` vs `invalidateQueries`, form-state isolation from background refetches.

---

## TL;DR

Doc 02 introduced `useQuery` for reads. This PR introduces `useMutation` for **writes** — and that's where the cache architecture actually pays off.

The AdminPanel had five write paths:
- Create user
- Update user (form modal)
- Deactivate user
- Reactivate user
- Update system settings (the form on the Settings tab)

Each one was doing the same dance: try/catch around the service call, manually splice the response into `useState`'d arrays, set a local `isSaving` flag, show a toast on success or a snackbar on error.

We replaced all five with `useMutation` + cache invalidation. The local `useState` arrays are gone — the cache *is* the state, and every observer of `['admin', 'users']` re-renders when the cache updates.

This is the PR where you'll feel the "ah, this is why we did all that foundation work" click.

---

## Part 1 — Why mutations are the real win

A read-only `useQuery` cache is a nice optimization. A `useMutation` + `invalidateQueries` flow is an **architectural shift**. Here's why.

### The bug the old pattern invited

The previous AdminPanel did:
```tsx
const created = await adminService.createUser(payload);
setUsers((prev) => [created, ...prev]);
```

That works **as long as you only have one component rendering the users list.**

Imagine a future where:
- The sidebar has a user count badge that hits `getUsers()`
- A dashboard widget shows "most recently added users"
- The AdminPanel users table is the third consumer

When AdminPanel creates a user with the old pattern, **only AdminPanel's `users` state updates**. The sidebar and dashboard don't know. They show stale data until the user refreshes the page.

This is the *defining failure mode* of "the component owns the data." Cross-component coordination is impossible without a shared source of truth.

### The fix is structural, not patch-y

With `invalidateQueries({ queryKey: ['admin', 'users'] })`:
1. The mutation succeeds
2. The cache marks every query whose key starts with `['admin', 'users']` as stale
3. Every component currently observing those queries refetches automatically — wherever they live in the tree
4. Each gets the fresh data and re-renders

You don't have to know who else is showing the users list. The cache is the broadcast channel. Add a new consumer tomorrow, it joins the broadcast for free.

This is the architectural shift the cache buys you.

---

## Part 2 — Concept primer: `useMutation`

The API mirrors `useQuery`, but for writes:

```tsx
const m = useMutation({
  mutationFn: (vars) => api.doWrite(vars),
  onSuccess: (data, vars) => { ... },
  onError:   (error, vars) => { ... },
  onSettled: (data, error, vars) => { ... },  // runs in both cases
});

// Then somewhere in your component:
m.mutate(varsObject);
// or
await m.mutateAsync(varsObject);

// And UI feedback flags:
m.isPending     // true while the mutation is in flight
m.isError       // true if it failed
m.isSuccess     // true after a successful resolution
m.error         // the error if isError
m.data          // the response if isSuccess
m.reset()       // wipe the mutation's state
```

### `mutationFn` takes exactly one argument

This is the most important quirk. `mutate(x)` passes `x` as the *one* argument to `mutationFn`. If your write needs multiple arguments, **pack them into an object**:

```tsx
// updateUser(id, payload) takes two args, mutationFn takes one
const updateUserMutation = useMutation({
  mutationFn: (vars: { id: number; payload: UserUpdatePayload }) =>
    adminService.updateUser(vars.id, vars.payload),
  // ...
});

// Then:
updateUserMutation.mutate({ id: 42, payload: { full_name: "Alice" } });
```

This pattern is universal. Every multi-arg mutation in our codebase follows it.

### `mutate` vs `mutateAsync`

This trips everyone up the first time. Same operation, different return shape:

| | `mutate(vars)` | `mutateAsync(vars)` |
|---|---|---|
| Returns | `void` (fire-and-forget) | `Promise<TData>` |
| Success path | `onSuccess` callback fires | Promise resolves AND `onSuccess` fires |
| Failure path | `onError` callback fires; **no exception bubbles** | Promise rejects AND `onError` fires |
| Use when | Caller doesn't need to wait | Caller needs to await (sequential mutations, modal coordination) |

**Rule of thumb:** prefer `mutate`. It's the simpler API and keeps your call sites synchronous. Reach for `mutateAsync` only when something downstream awaits the result — a modal coordinating its "Saving..." state, sequential dependent mutations, etc.

**The gotcha with `mutateAsync`:** if you don't `try/catch` it and the mutation fails, you get an unhandled rejection. Two ways to handle:
```tsx
// Option A: try/catch — onError still ran, just preventing unhandled rejection
try {
  await m.mutateAsync(vars);
} catch {}

// Option B: chain .catch — same effect
await m.mutateAsync(vars).catch(() => {});
```
We use option A in this PR — easier to read at a glance.

### `onSuccess` is where you invalidate

```tsx
useMutation({
  mutationFn: ...,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
  },
});
```

Three things to know about `invalidateQueries`:

1. **Key prefix matching.** `invalidateQueries({ queryKey: ['admin'] })` invalidates *everything* under `['admin']` — users, functions, designations, settings. `invalidateQueries({ queryKey: ['admin', 'users'] })` invalidates only the users branch. This is why we plan keys like a URL hierarchy.

2. **It's idempotent.** Invalidating an already-stale or already-fetching query is a no-op. Safe to call from anywhere.

3. **It returns a Promise.** Optional — you can `await` it if you want to know when the refetch resolves. We mostly don't, and use `void` to silence ESLint's `no-floating-promises`:
   ```tsx
   void queryClient.invalidateQueries({ queryKey: ['admin', 'users'] });
   ```

### `setQueryData` — the surgical alternative

`invalidateQueries` says "refetch." `setQueryData` says "I already have the fresh data — just put it in the cache, no network round-trip needed":

```tsx
queryClient.setQueryData(['admin', 'settings'], freshSettings);
```

When to use it:
- Your mutation's response **is** the canonical new server state (PATCH endpoints that return the updated row, our settings save)
- You want to skip the extra GET that invalidate would trigger

When NOT to use it:
- The server computes related state your mutation didn't return (timestamps, related counts, derived fields you don't have)
- You want the source of truth to always be a fresh fetch

For user CRUD we use `invalidateQueries` (safer, the server may have computed fields). For settings save we use `setQueryData` (the PATCH response is the truth, and the round-trip is wasteful).

---

## Part 3 — The work, step by step

### Step 1 — Replace the four bootstrap fetches with four queries

**Before:**
```tsx
const [users, setUsers] = useState<UserResponse[]>([]);
const [functions, setFunctions] = useState<FunctionBrief[]>([]);
const [designations, setDesignations] = useState<DesignationBrief[]>([]);
const [settings, setSettings] = useState<SystemSettings | null>(null);
const [isLoading, setIsLoading] = useState(true);

const loadData = useCallback(async () => {
  setIsLoading(true);
  try {
    const [usersData, funcData, desigData, settingsData] = await Promise.all([
      adminService.getUsers(),
      adminService.getFunctions(),
      adminService.getDesignations(),
      adminService.getSettings(),
    ]);
    setUsers(usersData);
    setFunctions(funcData);
    setDesignations(desigData);
    setSettings(settingsData);
    // 8 setX(settingsData.x) calls for the settings form ...
  } finally {
    setIsLoading(false);
  }
}, []);

useEffect(() => { void loadData(); }, [loadData]);
```

**After:**
```tsx
const usersQuery = useQuery({
  queryKey: ["admin", "users"],
  queryFn: adminService.getUsers,
});
const functionsQuery = useQuery({
  queryKey: ["admin", "functions"],
  queryFn: adminService.getFunctions,
});
const designationsQuery = useQuery({
  queryKey: ["admin", "designations"],
  queryFn: adminService.getDesignations,
});
const settingsQuery = useQuery({
  queryKey: ["admin", "settings"],
  queryFn: adminService.getSettings,
  refetchOnWindowFocus: false,            // ← see below
});

const users = usersQuery.data ?? [];
const functions = functionsQuery.data ?? [];
const designations = designationsQuery.data ?? [];
const settings = settingsQuery.data ?? null;
const isLoading = usersQuery.isPending;
```

**What just happened:**
- Four parallel queries that fire on mount (TanStack Query doesn't serialise them)
- The `?? []` defaults keep downstream `.filter(...)` and `.map(...)` working without `?.` chains
- Each query has its own `isPending` — we use the users one for the table skeleton; the others usually arrive in the same tick

**Why `refetchOnWindowFocus: false` on `settingsQuery`:**
The settings form has 9 controlled inputs initialized from `settings`. If HR is mid-edit and alt-tabs away, the default refetch-on-focus would refetch settings and (via the effect below) overwrite their in-progress edits. Disabling it for this one query is the cleanest fix.

This is a **per-query override** of a global default. You'll do this any time a global default isn't right for a specific resource. Common candidates:
- Forms: disable focus-refetch
- Real-time-feeling dashboards: shorter `staleTime`
- Reference data that changes rarely: longer `staleTime`

### Step 2 — Initialize the form ONCE on first arrival

The form has 9 useStates that need to be seeded from the server's current settings on first load:

```tsx
const [hasInitializedForm, setHasInitializedForm] = useState(false);
useEffect(() => {
  if (settings && !hasInitializedForm) {
    setCycleType((settings.cycle_type as CycleType) ?? "half_yearly");
    setFiscalStartMonth(settings.fiscal_start_month ?? 4);
    setAnnualReviewsEnabled(settings.annual_reviews_enabled ?? false);
    // ... 5 more setX calls ...
    setHasInitializedForm(true);
  }
}, [settings, hasInitializedForm]);
```

**Why the gate.** Without `hasInitializedForm`, any future `settings` change (a manual `invalidateQueries`, a programmatic refetch elsewhere) would re-run the body and clobber in-progress edits. The gate ensures we only seed once.

**Post-save sync happens elsewhere.** When the user clicks Save and the mutation succeeds, the mutation's `onSuccess` callback (Step 4 below) re-syncs the form state from the response. So the gate's "initialize once" is correct: the only other time the form needs syncing is after a save, and the mutation handles that explicitly.

### Step 3 — User mutations (4 of them, same pattern)

```tsx
const createUserMutation = useMutation({
  mutationFn: (payload: UserCreatePayload) =>
    adminService.createUser(payload),
  onSuccess: (created) => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    closeUserModal();
    toast.success(`${created.full_name} created.`);
  },
  onError: (err) => setModalError(getErrorMessage(err)),
});

const updateUserMutation = useMutation({
  mutationFn: (vars: { id: number; payload: UserUpdatePayload }) =>
    adminService.updateUser(vars.id, vars.payload),
  onSuccess: (updated) => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    closeUserModal();
    toast.success(`${updated.full_name} updated.`);
  },
  onError: (err) => setModalError(getErrorMessage(err)),
});

const deactivateMutation = useMutation({
  // Returns the user object so onSuccess gets full_name for the toast
  // without needing a closure
  mutationFn: async (target: UserResponse) => {
    await adminService.deactivateUser(target.id);
    return target;
  },
  onSuccess: (target) => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    toast.success(`${target.full_name} deactivated.`);
  },
  onError: (err) => snackbar.error(getErrorMessage(err)),
});

const reactivateMutation = useMutation({
  mutationFn: (target: UserResponse) =>
    adminService.reactivateUser(target.id),
  onSuccess: (updated) => {
    void queryClient.invalidateQueries({ queryKey: ["admin", "users"] });
    toast.success(`${updated.full_name} reactivated.`);
  },
  onError: (err) => snackbar.error(getErrorMessage(err)),
});
```

**Things to internalize:**

1. **All four invalidate the same key** — `['admin', 'users']`. One key, many writers. The users query refetches once after each mutation; every observer sees the new list.

2. **`deactivateMutation` returns the target user** so `onSuccess` has access to `target.full_name` for the toast. Without this, we'd need a closure or a separate state. The pattern "return the input from the mutationFn so onSuccess has the context it needs" comes up often.

3. **Errors route to different surfaces.** Create/update errors → `setModalError` (the user is in the modal and that's where they expect to see it). Deactivate/reactivate errors → snackbar (the user is on the table, no modal open). This is product-specific UX, not a TanStack Query concern.

4. **Each mutation has its own `isPending`.** `createUserMutation.isPending`, `deactivateMutation.isPending`, etc. We OR the two that the modal cares about:
   ```tsx
   const isSavingUser = createUserMutation.isPending || updateUserMutation.isPending;
   ```
   This is passed to the modal as `isSaving={isSavingUser}`.

### Step 4 — Settings mutation (with `setQueryData` instead of invalidate)

```tsx
const updateSettingsMutation = useMutation({
  mutationFn: (payload: AdminSettingsUpdatePayload) =>
    adminService.updateSettings(payload),
  onSuccess: (fresh) => {
    // The PATCH response IS the canonical new server state — no need
    // for an extra GET. setQueryData is synchronous and free.
    queryClient.setQueryData(["admin", "settings"], fresh);

    // Re-sync form state from the response (server may have computed
    // fields we didn't send — active_cycle, simulation_allowed, etc.)
    setCycleType((fresh.cycle_type as CycleType) ?? "half_yearly");
    setFiscalStartMonth(fresh.fiscal_start_month ?? 4);
    // ... 6 more setX calls ...

    // SystemSettingsProvider keeps its own context-cached copy that
    // drives banners and gates across the app — tell it to refresh too.
    void refreshSettings();

    toast.success("Configuration saved.");
  },
  onError: (err) => snackbar.error(getErrorMessage(err)),
});
```

**Why `setQueryData` here but `invalidateQueries` for users:**
- Users mutations: response is one user. The list query (`['admin', 'users']`) is an array. `setQueryData` would mean splicing the response into the array manually, which is fragile (sort order, dedup) and we already pay a list GET on most operations. Invalidate is simpler and the cost is one round-trip.
- Settings mutation: response is the *entire updated settings object*. It's literally what the next `['admin', 'settings']` GET would return. Skip the GET.

**The `setQueryData` cache update triggers downstream re-syncs:**
1. `setQueryData(['admin', 'settings'], fresh)` updates the cache entry
2. The `settings` useEffect (Step 2) is keyed on `settings` — but `hasInitializedForm` is true, so it doesn't re-init
3. We **manually** call `setX(fresh.x)` for each form field — this is the post-save re-sync we need (Step 2's gate prevented automatic re-sync on purpose)
4. `refreshSettings()` propagates the new values to the SystemSettingsProvider context (which a separate banner/gate system reads from)

This is the most intricate flow in the file. Trace through it once and you'll see why we explicitly own the form-state sync rather than trying to do it implicitly via reactive effects.

### Step 5 — Call sites get simpler

```tsx
// Save user (used by UserModal). Uses mutateAsync because the modal
// awaits onSave to drive its internal "Saving..." spinner.
const handleSaveUser = async (
  payload: UserCreatePayload | UserUpdatePayload,
): Promise<void> => {
  setModalError("");
  try {
    if (editingUser) {
      await updateUserMutation.mutateAsync({
        id: editingUser.id,
        payload: payload as UserUpdatePayload,
      });
    } else {
      await createUserMutation.mutateAsync(payload as UserCreatePayload);
    }
  } catch {
    // onError already set modalError; swallow so the modal's await
    // never sees an exception (preserves the legacy contract)
  }
};

// Deactivate / reactivate — fire-and-forget, no caller needs to await
const handleDeactivate = async (target: UserResponse) => {
  const ok = await confirm({ ... });
  if (!ok) return;
  deactivateMutation.mutate(target);
};

// Settings save — same fire-and-forget pattern
const handleSaveSettings = () => {
  const payload: AdminSettingsUpdatePayload = { ... };
  updateSettingsMutation.mutate(payload);
};
```

Three observations:

1. **`mutateAsync` for the modal**, `mutate` for everything else. Pick based on whether the caller awaits.
2. **The `try/catch` around `mutateAsync` is purely defensive** — `onError` already ran and updated UI; the catch just stops the unhandled rejection from bubbling. Wrap every `mutateAsync` call this way unless you're doing sequential dependent mutations.
3. **`handleSaveSettings` is now synchronous** (no `async` keyword, no `await`). The mutation runs in the background; the UI's "Saving..." spinner comes from `updateSettingsMutation.isPending` which the JSX wires through to the SystemSettingsTab.

---

## Part 4 — Final scorecard

### Files changed
| File | Lines | What |
|---|---|---|
| `frontend/src/pages/AdminPanel.tsx` | ~+85 / −90 | 4 queries + 5 mutations migrated; form-init gate; loadData deleted |

Net: ~−5 lines, but the **shape** changed dramatically — no more `useState` arrays for server data, no more `isLoading` flag, no `loadData` callback, no manual state-mutation after each write.

### Bundle impact
| Chunk | PR #19 (before) | This PR (after) | Δ |
|---|---|---|---|
| query-vendor | 10.14 KB gzip | 10.58 KB | +0.44 KB |
| AdminPanel | 14.91 KB | 15.05 KB | +0.14 KB |
| Other chunks | — | — | unchanged |

The +0.5 KB total covers the `useMutation` runtime that wasn't tree-shaken into the vendor chunk before (PR #19 only imported `useQuery`). Worth every byte.

### Capability gains

- ✅ Cross-component refresh: any future view of `['admin', 'users']` updates automatically when AdminPanel mutates
- ✅ Manual array-splicing is gone (`setUsers((prev) => [created, ...prev])` etc.)
- ✅ `isSaving` state is now derived from the mutation, not manually tracked
- ✅ Form-state sync after save is explicit and predictable (single point of control in `onSuccess`)
- ✅ Mutation errors auto-route through `onError` — no try/catch boilerplate in call sites

---

## Part 5 — Trade-offs we deliberately made

### Why `invalidateQueries` for users instead of `setQueryData`

A "smart" version of the users mutations could do:
```tsx
onSuccess: (created) => {
  queryClient.setQueryData(['admin', 'users'], (old: UserResponse[] = []) =>
    [created, ...old],
  );
  ...
},
```
…and avoid the extra GET. But:
1. The server might compute related counts or denormalize fields we don't see
2. Sort order is a list-level concern; splicing at `[0]` assumes "newest first" which might shift
3. Two callers writing different splice logic for the same key risks divergence

For non-hot-path mutations (user CRUD happens a few times a day, not a few times a minute), the extra GET is fine and the simpler code is worth it. **Use `setQueryData` when the response IS the canonical entire-cache-entry**, like our settings PATCH which returns the whole updated row.

### Why we kept `getSettingsPreflight` imperative

Inside `SystemSettingsTab`, the toggle-off handler calls:
```tsx
const preflight = await adminService.getSettingsPreflight();
```
This is **not** migrated to `useQuery`. Two reasons:

1. **It's on-demand.** The user clicks a toggle. We want the freshest count at that moment, not cached data from earlier in the session.
2. **It's a query-once-and-throw-away pattern.** No component is "subscribed" to the preflight result. Putting it in the cache adds memory and gc complexity for no benefit.

**Heuristic:** if the data backs a UI element that's mounted (a table, a card, a form), it belongs in the cache. If it's a transient lookup that informs a one-shot decision (a preflight check, a "does this name conflict?" probe), call the service directly.

You'll see this pattern repeat. Not every server call belongs in `useQuery`.

### Why we re-sync form state manually in `onSuccess`

Pure-reactive alternatives existed:
- **Option A:** Drop the form `useState`s entirely; bind inputs to `settings.cycle_type` directly. **Problem:** can't edit. The user types into the field and the server hasn't seen it; the value would snap back on render.
- **Option B:** Make the form `useState`s default to `settings.cycle_type` but allow user edits. **Problem:** "default to" is a React anti-pattern — re-renders re-evaluate defaults and lose user input.
- **Option C (chosen):** Local `useState`s, initialized once on first server arrival, re-synced explicitly after save.

Option C is the only one that handles "user has unsaved edits when the server data changes" predictably. The `hasInitializedForm` gate is what makes it predictable.

### `mutateAsync` is dangerous if you forget the catch

Forgetting `try/catch` around `mutateAsync` is the most common bug we'll see going forward:
```tsx
// 🚨 will produce an unhandled rejection if the mutation fails
const handleSave = async () => {
  await m.mutateAsync(vars);
};
```
The reason: `onError` ran AND the promise rejected. Two error paths. The rejection isn't "handled" by the onError callback — they're independent. So even though the UI is fine (onError showed the toast), Node/browser logs an unhandled rejection warning.

**ESLint rule worth adding:** `@typescript-eslint/no-floating-promises` would catch some of these. We don't have it on yet — note for the next PR.

---

## Part 6 — Verify it works

```bash
cd frontend
npm run build       # passes? good
npm run dev         # for the click-around tests
```

In the app:

1. **Open `/admin`.** TanStack DevTools (bottom-left) — confirm four queries appear:
   - `["admin", "users"]`
   - `["admin", "functions"]`
   - `["admin", "designations"]`
   - `["admin", "settings"]`
   All green within ~1 second.

2. **Create a user.**
   - DevTools should show `["admin", "users"]` flash blue (refetch) then green
   - The new user appears in the table
   - Toast: "X created."

3. **Update a user.**
   - Same flash on `["admin", "users"]`
   - Toast: "X updated."

4. **Deactivate a user.**
   - Confirm modal opens
   - Confirm → query refetches → row gets the deactivated treatment
   - Toast: "X deactivated."

5. **Reactivate a user.**
   - Same flow in reverse.

6. **Settings tab — save.**
   - Mutation fires
   - DevTools shows `["admin", "settings"]` data updates **without a network request** (setQueryData, not invalidate)
   - SystemSettingsProvider's separate cache also refreshes (banners across the app update if any toggle changed)
   - Toast: "Configuration saved."

7. **Form-state isolation test:**
   - Open Settings tab. Change cycle type from "half_yearly" to "quarterly" but don't save.
   - Alt-tab to another browser window for 5 seconds, then back.
   - Form state should stay "quarterly" (the `refetchOnWindowFocus: false` is working).
   - Other queries (users, etc.) DO refetch on focus — verify in DevTools they flash blue.

8. **Error path:**
   - Try to create a user with a duplicate email.
   - Backend rejects with 400. `modalError` should display the message *inside the modal*.
   - Modal stays open (mutation failed → `closeUserModal()` in `onSuccess` didn't run).
   - DevTools shows the mutation under the "Mutations" tab in error state.

If all of the above behaves as described, the migration is sound.

---

## Part 7 — What you should now know cold

1. The difference between `mutate` (fire-and-forget) and `mutateAsync` (returns Promise), and when to use each.
2. Why `mutationFn` takes one argument, and the "pack into an object" pattern for multi-arg writes.
3. `invalidateQueries` vs `setQueryData` — what each does, when to prefer one over the other.
4. Why per-query overrides (like `refetchOnWindowFocus: false`) matter for forms.
5. The "initialize form once, re-sync explicitly after save" pattern for forms backed by useQuery.
6. Why `mutateAsync` needs `try/catch` even when `onError` is defined.
7. When NOT to use `useQuery` (transient on-demand lookups like `getSettingsPreflight`).
8. Why cross-component cache invalidation is the *architectural* win, not just an optimization.

---

## Part 8 — What's deliberately not done here

- **ProjectsTab migration.** Has its own queries and mutations (create/update/delete project). Its own PR.
- **ExportsTab migration.** HR-only, mostly button-clicks-that-trigger-downloads. The download flow has no cache; migration is minimal.
- **SystemSettingsTab's `getSettingsPreflight` call.** Left imperative on purpose (see Part 5).
- **Optimistic UI updates.** `onMutate` with `setQueryData` for instant UI feedback before the server responds. Powerful but adds complexity. Deferred to a later doc focused specifically on perceived performance.
- **A query keys factory** (`src/lib/queryKeys.ts`). Worth introducing once we have ~10 distinct keys; we now have 6 (`['admin', 'users' | 'functions' | 'designations' | 'settings']`, `['dashboard', 'summary']`, `['dashboard', 'hr-summary', fy]`, `['mentees', 'summaries']`). One more migration and it's worth doing.
- **`@typescript-eslint/no-floating-promises`** ESLint rule to catch missed `mutateAsync` catches.
