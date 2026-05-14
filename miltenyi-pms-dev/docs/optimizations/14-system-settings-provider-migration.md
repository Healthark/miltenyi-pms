# 14 — SystemSettingsProvider: context-cache → useQuery 🏁

> **PR:** [#31](https://github.com/Healthark/miltenyi-pms/pull/31)
> **Files changed:** `frontend/src/lib/queryKeys.ts` (new `systemSettings.current()`), `frontend/src/contexts/SystemSettingsProvider.tsx` (full rewrite — same public context API).
> **Headline result:** Final TanStack Query migration. The hand-rolled `useState + useEffect + useCallback` context-cache becomes a `useQuery` wrapper. 23 consumers of `useSystemSettings()` and 1 mutation site (AdminPanel) change **zero** lines.

This PR closes the rollout. **Every server-state read and write in the codebase now flows through the TanStack Query cache.**

---

## TL;DR

`SystemSettingsProvider` was the original hand-rolled "context-as-cache" in the codebase — it predated TanStack Query by months. It owned its own fetch lifecycle, its own loading state, its own error mapping, and its own `refreshSettings()` callback. Twenty-three components read from its context; one (AdminPanel) imperatively called `refreshSettings()` after saving.

The migration replaces the provider's **internals** with `useQuery`. The **public context API** (`settings`, `isLoading`, `error`, `refreshSettings`) is identical. Twenty-three consumer files don't change. AdminPanel doesn't change. The cache layer absorbs the responsibility for fetch, error handling, refetch-on-focus, and stale-while-revalidate — concerns the hand-rolled provider didn't address.

This is the **smallest scope of any TanStack Query PR** (~75 lines of provider rewrite + 6 lines of factory addition) and the **most conceptually distinct**: it's a context provider, not a page or a hook. It demonstrates that the cache architecture can absorb any encapsulated state pattern — pages, hooks, providers — without consumer changes.

---

## Part 1 — The provider as a "fake cache"

Look at the legacy provider:

```tsx
export function SystemSettingsProvider({ children }) {
  const { user } = useAuth();

  const [settings, setSettings] = useState<SystemSettingsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const refreshSettings = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await systemSettingsService.getSettings();
      setSettings(data);
    } catch (err: unknown) {
      // ... type-narrowing for axios error shape, 404 special-case ...
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) refreshSettings();
    else { setSettings(null); setError(null); }
  }, [user, refreshSettings]);

  const contextValue = useMemo(
    () => ({ settings, isLoading, error, refreshSettings }),
    [settings, isLoading, error, refreshSettings],
  );

  return (
    <SystemSettingsContext.Provider value={contextValue}>
      {children}
    </SystemSettingsContext.Provider>
  );
}
```

What this provider is doing, function by function:

| Pattern | What it's trying to be |
|---|---|
| `useState<SystemSettingsResponse \| null>(null)` | A cache entry |
| `useEffect` gated on `user` | An auto-fetch trigger |
| `refreshSettings` useCallback | Manual cache invalidation API |
| 404 special-case error mapping | Centralized error transformation |
| Memoized `contextValue` | Subscriber-level re-render isolation |

**Every one of these is a feature TanStack Query already provides.** The provider was hand-rolling a cache because the codebase didn't have one yet. Now that it does, the natural move is to delete the duplication and have the provider be a thin wrapper.

---

## Part 2 — The rewrite

```tsx
export function SystemSettingsProvider({ children }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: queryKeys.systemSettings.current(),
    queryFn: systemSettingsService.getSettings,
    enabled: Boolean(user),
  });

  const refreshSettings = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.systemSettings.current(),
    });
  }, [queryClient]);

  const error: string | null = useMemo(() => {
    if (!settingsQuery.isError) return null;
    return mapSettingsError(settingsQuery.error);
  }, [settingsQuery.isError, settingsQuery.error]);

  const contextValue: SystemSettingsContextType = useMemo(
    () => ({
      settings: settingsQuery.data ?? null,
      isLoading: Boolean(user) && settingsQuery.isPending,
      error,
      refreshSettings,
    }),
    [settingsQuery.data, settingsQuery.isPending, user, error, refreshSettings],
  );

  return (
    <SystemSettingsContext.Provider value={contextValue}>
      {children}
    </SystemSettingsContext.Provider>
  );
}

function mapSettingsError(err: unknown): string {
  if (err && typeof err === "object" && "response" in err) {
    const response = (err as { response?: { status?: number } }).response;
    if (response?.status === 404) {
      return "System settings have not been configured for this organization.";
    }
    return "Failed to load system settings. Please try again.";
  }
  return "An unexpected error occurred while loading settings.";
}
```

### What each piece replaces

| Old | New |
|---|---|
| `useState<SystemSettingsResponse \| null>` | `settingsQuery.data ?? null` |
| `useState<boolean>` for isLoading | `Boolean(user) && settingsQuery.isPending` |
| `useState<string \| null>` for error | `useMemo` derived from `settingsQuery.isError` |
| `useEffect` gated on `user` | `enabled: Boolean(user)` on the query |
| `refreshSettings` doing imperative fetch + setState | `refreshSettings` doing `invalidateQueries` |
| 30-line try/catch with type narrowing | `mapSettingsError` helper, called from useMemo |

The whole provider body is now ~25 lines + a 10-line error helper. The legacy was ~70 lines of state management.

### Key semantic preserved: `isLoading` when unauthenticated

The legacy provider's `isLoading` was `false` when `user === null` (no fetch happens). Naive translation:
```ts
isLoading: settingsQuery.isPending,
```
This would be wrong — `query.isPending` is true while the query is parked (`enabled: false`). For an unauthenticated user, this would have `isLoading: true` forever, breaking any consumer that gates UI on `isLoading`.

The fix:
```ts
isLoading: Boolean(user) && settingsQuery.isPending,
```

AND with `Boolean(user)` so the unauthenticated state returns `false` like before. **Same pattern as PR #13's `useReviewDetails`** — when the query is parked, the legacy "is fetching" semantics need an explicit gate.

### What we get for free that we didn't have before

- **Stale-while-revalidate**: navigating between pages keeps the cached settings visible while a background refetch validates freshness. The legacy provider only fetched on mount; subsequent reads were the cached useState.
- **Refetch on window focus**: alt-tab back to the app → settings refresh. Previously stale until manual refresh.
- **Cross-page cache sharing**: any future component that wants to call `useQuery({ queryKey: queryKeys.systemSettings.current() })` directly (instead of via context) hits the same cache entry. The context becomes one of many possible read paths into the same cache.
- **`queryClient.invalidateQueries(systemSettings.current())` from anywhere**: any mutation that affects settings can invalidate this cache without going through the context. Decoupling.

---

## Part 3 — Why we keep the provider at all

You could argue: 23 consumers all importing `useQuery` directly would let us delete the provider, the context file, and the custom hook entirely. Why not?

### Three reasons we keep the provider wrapping

**1. Subscriber count.** The provider is one cache observer. The 23 consumers all read from React context, which has its own re-render semantics. If we deleted the provider and had 23 components calling `useQuery` directly, we'd have 23 observers on the same cache entry. TanStack Query handles that fine (deduplication), but each observer triggers a per-component re-render check when the cache changes. The provider centralizes that.

(Note: this is a "performance theater" argument in practice — the difference for 23 components is unmeasurable. But it's the right shape conceptually.)

**2. The public hook API is well-established.** Twenty-three consumer files already import `useSystemSettings`. The hook returns a known shape. Changing the import path AND the destructuring shape for 23 files would be a churny PR that buys nothing — same data flows through, just renamed.

**3. The "context as a stable migration boundary" pattern.** The provider is the *seam* between the legacy app and the new cache architecture. Future migrations to even-newer state libraries could swap out the provider's internals without touching consumers. It's an abstraction earning its keep — same as PR #13's `useReviewDetails` hook.

### When we'd revisit

If we ever:
- Migrate to a different cache library (signals, Zustand, etc.)
- Drop React context entirely in favor of cache-driven state
- Have to add per-consumer customization (different stale times for different surfaces)

...then revisit. For now, the provider is the right level of abstraction.

---

## Part 4 — Why `systemSettings` is a separate namespace from `admin.settings`

A subtle point worth pausing on. We already had `queryKeys.admin.settings()` from PR #20 (AdminPanel's settings PATCH). Why a NEW namespace for the provider?

**Different endpoints, different response shapes:**

| Service call | Endpoint | Response type |
|---|---|---|
| `systemSettingsService.getSettings()` | `GET /settings/` | `SystemSettingsResponse` (16 fields, public read view) |
| `adminService.getSettings()` | `GET /admin/settings` | `SystemSettings` (similar fields + `simulation_allowed`, etc., HR-only) |

Two different cache entries, two different sets of consumers. If they shared a key, AdminPanel's `setQueryData(admin.settings, fresh)` would overwrite the public view with HR's view — different shapes, broken consumers.

So: `queryKeys.systemSettings.current()` is the public read view; `queryKeys.admin.settings()` is the HR-only admin view. AdminPanel's settings mutation:
1. Calls `adminService.updateSettings()` → server processes the change
2. `setQueryData(admin.settings, fresh)` → updates HR's view of the cache
3. `refreshSettings()` → invalidates `systemSettings.current()` → public view refetches

Step 3 is **already in AdminPanel today** (line 315 of AdminPanel.tsx). After this PR, that call still works identically — `refreshSettings()` now invalidates the cache instead of triggering an imperative refetch. Same UX, cleaner mechanism.

### When two endpoints DO share a key

If two endpoints returned the same response type, the SAME factory key would be correct. They'd be "two ways to read the same data" from the cache's perspective. We've seen examples elsewhere (e.g., `queryKeys.projectReviews.detail(id)` is used by both `useReviewDetails` and `MenteeProjectsTab`'s impact modal — same endpoint, same response, two consumers).

**Rule:** keys identify cache entries by their **content**, not by the consumer or call site. Two endpoints returning the same shape get one key; two endpoints returning different shapes get two keys.

---

## Part 5 — Final scorecard

### Files changed
| File | Lines | What |
|---|---|---|
| `frontend/src/lib/queryKeys.ts` | +9 | New `systemSettings` namespace + `current()` accessor |
| `frontend/src/contexts/SystemSettingsProvider.tsx` | full rewrite (~110 → ~75) | useState/useEffect/useCallback → useQuery + mapSettingsError helper |

Zero consumer changes. Zero AdminPanel changes. The migration is invisible from outside the provider.

### Bundle impact
| Chunk | Before | After | Δ |
|---|---|---|---|
| `index` (app shell, where the provider lives) | 10.27 KB gzip | 10.32 KB | +0.05 KB |
| All other chunks | — | — | unchanged |

The +50 bytes is `useQuery` + `useQueryClient` imports replacing the legacy state machinery. Negligible.

### Capability gains
- ✅ Stale-while-revalidate for system settings (instant on revisit, refetch in background)
- ✅ Focus-refetch when user returns to the app
- ✅ Cross-page cache sharing — any future direct `useQuery` consumer hits the same entry
- ✅ Decoupled invalidation — any mutation anywhere can invalidate via `queryClient.invalidateQueries(queryKeys.systemSettings.current())` without going through the context
- ✅ Less code in the provider — fewer paths through it, fewer state transitions to reason about

---

## Part 6 — The rollout complete

PR | Theme | Status
---|---|---
01 | Bundle splitting + lazy routes + vendor chunks | ✅ #18
02 | Server-state caching foundation + Dashboard | ✅ #19
03 | AdminPanel mutations | ✅ #20
04 | AnnualReviews + TeamReviewTab | ✅ #21
05 | AnnualGoals (broadcast invalidation, setQueryData hot path) | ✅ #22
06 | Query keys factory | ✅ #23
07 | ProjectReviews (cache-warming probe) | ✅ #24
08 | MyMentees + MenteeDetail (dynamic-key, cross-page sharing) | ✅ #25
09 | ManagementReview (modal-driven on-demand query) | ✅ #26
10 | Goal-approval flow (TeamGoalsTab + MenteeGoalsTab) | ✅ #27
11 | Project-review writes (PrimaryEvaluationTab + SecondaryEvalTab) | ✅ #28
12 | MenteeProjectsTab — bridge unwound | ✅ #29
13 | useReviewDetails hook — useReducer → useQuery | ✅ #30
**14** | **SystemSettingsProvider — final migration** | **🏁 THIS PR**

### What "complete" means

After this PR merges:
- **Every server-state read** in the codebase goes through `useQuery` (directly or via a custom hook/provider that wraps it)
- **Every server-state write** goes through `useMutation` with explicit cache invalidation
- **Cache keys** are centralized in `queryKeys.ts` — no inline string arrays anywhere
- **Cross-component cache coordination** is automatic — mutate in one place, every observer of the affected keys refreshes
- **No `useState + useEffect + cancelled-flag`** server-data patterns remain

### What we built along the way

Patterns introduced and documented across the 13 cache-rollout PRs:

| Pattern | First introduced |
|---|---|
| `useQuery` + role-gated `enabled` | PR #04 (annual reviews) |
| `useMutation` + invalidateQueries | PR #03 (admin panel) |
| `setQueryData` for hot paths | PR #05 (annual goals criterion toggle) |
| Broadcast key invalidation via `.all` | PR #05 |
| Multi-key invalidation per mutation | PR #04, #05 |
| Cross-page cache sharing via shared queryKey | PR #08 (mentees roster) |
| Dynamic-key queries (parameterized) | PR #05 (HR dashboard FY picker) |
| Modal-driven on-demand queries (`enabled` on modal open) | PR #09 (management review Rate modal) |
| Cache-warming probe pattern | PR #07 (secondary queue) |
| `?? -1` sentinel for disabled queries with non-nullable keys | PR #09 |
| Bridge callback pattern for parent-migrated-before-child handoffs | PR #08, fully unwound in #12 |
| Render-time derivation vs useState+useEffect | PR #12 |
| Library-shape → domain-shape mapping at the hook/provider boundary | PR #13, #14 |
| Mixed specific + broadcast invalidation (per-entity vs cross-cutting) | PR #12 |
| `variables` argument to onSuccess | PR #11 |
| Two `useMutation` for one endpoint when UX differs | PR #03, #10, #11 |

That's the full vocabulary. Future contributors can read the docs in order and arrive at the same understanding without rebuilding it.

---

## Part 7 — Trade-offs we deliberately made

### Why we kept the three-file rule (context / provider / hook)

The codebase has a documented "three-file rule" for context-based features:
- `XContext.ts` — `createContext` + type interface (no JSX, satisfies Vite Fast Refresh)
- `XProvider.tsx` — the provider component
- `useX.ts` — the public hook

We kept this structure even though the new provider is small enough to inline everything into one file. Reasons:

1. **Consistency with the codebase.** Every other context follows the same shape; breaking the pattern here would be surprising.
2. **The hook still needs the "must be inside provider" check.** The legacy hook throws a dev-time error if used outside the provider. Keeping that protective shape requires the three-file split.
3. **Future-proof.** If we ever add more context-level state (e.g., per-tab settings overrides), the file structure already has the right shape.

The provider got smaller; the file structure didn't change.

### Why `mapSettingsError` is a top-level function, not inlined in useMemo

```tsx
function mapSettingsError(err: unknown): string { /* ... */ }

const error = useMemo(() => {
  if (!settingsQuery.isError) return null;
  return mapSettingsError(settingsQuery.error);
}, [settingsQuery.isError, settingsQuery.error]);
```

Versus the alternative:

```tsx
const error = useMemo(() => {
  if (!settingsQuery.isError) return null;
  const err = settingsQuery.error;
  if (err && typeof err === "object" && "response" in err) {
    /* ... 8 lines of mapping ... */
  }
  return "An unexpected error occurred...";
}, [...]);
```

Top-level helper wins because:
- Easier to test in isolation (pure function)
- Doesn't pollute the component body with type-narrowing logic
- Reusable if some other query ever wants the same "settings-shaped error → friendly string" mapping

Small thing, but it reads better. Inline error mapping is the kind of code that grows messy when 404 needs special handling and 503 needs another and 4xx-validation gets a third treatment.

### Why we don't expose `isFetching` separately

The legacy context interface has `isLoading: boolean`, not `isFetching`. We preserve that. The semantic — "is the initial fetch in flight?" — is correctly mapped to `query.isPending`.

`query.isFetching` (true during ANY in-flight fetch including background refetches) is a useful flag if you want to show a subtle "refreshing..." indicator, but no consumer asked for it. **Don't expose API surface speculatively.** If a future consumer needs it, add it then.

### Why `refreshSettings` returns `Promise<void>` instead of fire-and-forget

The legacy `refreshSettings` did:
```ts
setIsLoading(true);
try {
  const data = await systemSettingsService.getSettings();
  setSettings(data);
} finally { setIsLoading(false); }
```
It awaited the fetch. The Promise resolved when `setSettings(data)` was called.

`queryClient.invalidateQueries(...)` also returns a Promise — it resolves after the refetch completes (if there's an active observer). So awaiting `refreshSettings()` still gives the caller "the new settings are now in the cache by the time this resolves" guarantee.

AdminPanel doesn't actually await `refreshSettings()` today (it uses `void refreshSettings()`), but preserving the Promise contract means any future caller that DOES want to await gets the expected behaviour. Don't break interfaces that nobody uses today but might tomorrow.

---

## Part 8 — What you should now know cold

1. **Provider internals are a great migration target** when the public context API is well-defined and consumers don't need to change.
2. **Cache keys identify content, not consumers.** Two endpoints with the same response = one key (shared). Two endpoints with different responses = two keys, even if they're semantically related.
3. **`isLoading` requires AND-gating** when migrating from legacy "imperative fetch" semantics, because `useQuery.isPending` is true while `enabled: false`.
4. **Helper functions over inline type-narrowing** for error mapping. Pure functions test better and don't clutter the component.
5. **Keep the three-file structure** even when the provider shrinks — consistency with the codebase has its own value.
6. **The rollout is complete.** Patterns are documented; future state-fetching work has templates to copy.

---

## Part 9 — Verify it works

```bash
cd frontend
npm run build
npm run dev
```

Steps:

1. **App boot:**
   - Open the dev server, log in.
   - DevTools (TanStack Query, bottom-left) → confirm a query exists at `["system-settings", "current"]`, status green.
   - Every page consuming `useSystemSettings()` should render normally — Topbar cycle text, AnnualReviews banners, gates, etc.

2. **AdminPanel settings save:**
   - As HR_MyOrg, open `/admin` → Settings tab.
   - Edit any toggle, click Save.
   - DevTools: `["admin", "settings"]` updates via `setQueryData` (existing PR #20 behaviour). `["system-settings", "current"]` flashes blue → green (the `refreshSettings()` invalidation now goes through TanStack Query).
   - Banners / Topbar / gates across the app reflect the new settings.

3. **Logout cache clear:**
   - Log out. DevTools → confirm `["system-settings", "current"]` entry is gone (the `queryClient.clear()` in `AuthProvider.logout` from PR #02 wipes it).
   - Log back in as a different role. DevTools → new fetch fires, new entry populated.

4. **Focus-refetch:**
   - With the app open, alt-tab away for 30+ seconds.
   - Come back. DevTools → `["system-settings", "current"]` briefly flashes blue (background refetch on focus) then green.
   - **This is the win** — pre-migration, settings would stay stale until manual refresh.

5. **404 error path (harder to test without a fresh org):**
   - In a brand-new org with no settings configured, the GET `/settings/` returns 404.
   - The provider should map this to "System settings have not been configured for this organization."
   - Consumers checking `error` should display the friendly message.

6. **Cross-component refresh from a future mutation:**
   - This is theoretical until someone writes such a mutation, but: any code anywhere can do
     ```ts
     queryClient.invalidateQueries({ queryKey: queryKeys.systemSettings.current() });
     ```
     and every component reading `useSystemSettings()` re-renders with fresh data. No context coordination, no callback drilling.

---

## Part 10 — What's deliberately not done here

Nothing in the TanStack Query rollout. **This is the last PR.**

What comes next is a fresh learning arc — different tools, different concepts:

- **Pagination** with `useInfiniteQuery` + cursor-based or offset-based server pagination
- **List virtualization** with `react-window` / `@tanstack/react-virtual` for the large HR tables
- **Server-side filtering** moving the filter logic from client to backend `?filter=` query params
- **Selective re-render optimizations** with `React.memo` / `useMemo` on derived expensive computations (the HR All Goals view sorts/filters thousands of rows client-side today)
- **Optimistic updates** via `onMutate` for hot mutations (criterion toggles, status flips)

The cache rollout was about correctness and coordination. The next theme is about performance at scale. Different problems, same discipline: measure, document, ship in focused PRs.
