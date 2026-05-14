# 02 — Server-state caching with TanStack Query

> **PR:** _pending_
> **Files changed:** `frontend/package.json` + lockfile (2 new deps), new `frontend/src/lib/queryClient.ts`, `frontend/src/main.tsx`, `frontend/src/contexts/AuthProvider.tsx`, 3 dashboard pages (`StaffDashboard`, `MentorDashboard`, `HrDashboard`), `frontend/vite.config.ts` (added `query-vendor` chunk).
> **Headline result:** Cache + dedup + stale-while-revalidate now available everywhere. Three Dashboard variants migrated as the teaching example. Bundle cost: **+10 KB gzip** in a cacheable vendor chunk.

---

## TL;DR — what we did and why

Every page in the app was doing this:
```tsx
const [data, setData] = useState(null);
useEffect(() => {
  let cancelled = false;
  service.fetch().then((res) => { if (!cancelled) setData(res); });
  return () => { cancelled = true; };
}, []);
```

This is the React tutorial standard. It's **wrong for server data**. Symptoms:
- No dedup (two components asking for the same thing → two HTTP requests)
- No cache across navigation (every revisit refetches)
- No automatic refresh after a focus event ("I left the tab open since this morning")
- Mutations don't notify other components showing the same data
- The `cancelled` flag is boilerplate every component has to remember

We installed **TanStack Query** (formerly React Query), set up a shared `QueryClient`, and migrated the three Dashboard pages as the first teaching example. The pattern now scales to every other page; future PRs will migrate them one resource at a time.

---

## Part 1 — Why this matters: the mental shift

The single most important idea in this PR:

> **Server state is not client state.** They need different tools.

A typical React app has both:

| | **Client state** | **Server state** |
|---|---|---|
| **Owned by** | The browser tab | A remote server |
| **Examples** | "is the modal open", "what's typed in the search input", "active tab" | "list of users", "today's dashboard summary", "system settings" |
| **Source of truth** | The component itself | The backend database |
| **How it changes** | User actions in *this tab* | This tab AND every other tab AND the database directly |
| **Can it become stale?** | Never — this tab IS the truth | Always — the truth is somewhere else |
| **Right tool** | `useState`, `useReducer` | A cache library (TanStack Query, SWR) |

When you put server data in `useState`, you're saying "this component owns it." But the component **doesn't** — the server does. The component just has a snapshot. The moment anyone else changes the data, your snapshot is wrong and you have no way to know.

`useEffect + useState` for server data is like printing a webpage and trying to use the printout as the live website.

### What goes wrong in practice (our app, before this PR)

1. **No dedup.** If two components both call `dashboardService.getSummary()` in mount effects, that's two identical HTTP requests in flight. The browser doesn't dedupe — they're separate `fetch` calls under the hood.

2. **No cache across navigation.** Navigate Dashboard → AdminPanel → Dashboard. The second Dashboard mount refetches even if 200ms passed. User stares at a skeleton they shouldn't see.

3. **No focus refetch.** User opens the app at 9am, goes to lunch, returns at 1pm. The data is 4 hours stale. They have to know to hit refresh — and many won't.

4. **No background refresh.** Even if you wanted to show stale data while fetching fresh in the background, there's no mechanism. It's either "show spinner" or "show stale data forever."

5. **Manual cross-component invalidation.** When AdminPanel creates a user, the users list in AdminPanel knows to refetch (we wrote that code). If anywhere *else* in the app was also showing the users list, it has no idea.

6. **Race-condition boilerplate.** Every component reimplements `let cancelled = false; ... if (!cancelled) setData(res); return () => { cancelled = true; }` to avoid `setState` on unmounted components. Forget it once and you ship a bug.

All of these are symptoms of using a "this tab owns it" tool for "the server owns it" data.

---

## Part 2 — Concept primer

These are the ideas the rest of the PR builds on.

### The cache, keyed by `queryKey`

TanStack Query holds an in-memory `Map<queryKey, queryState>`. Every `useQuery` call registers an **observer** for one key.

```ts
useQuery({
  queryKey: ['dashboard', 'summary'],
  queryFn: dashboardService.getSummary,
});
```

The cache is keyed by a **serializable array**. Keys are matched **structurally** (deep equality), so:

- `['users']` ≠ `['user']`
- `['users']` ≠ `['users', undefined]`
- `['user', 42]` and `['user', 42]` are the same key (deep equal)

### Stale time vs. cache time (gc time)

Two timers, often confused:

```
fetch resolves                  staleTime ends                   gcTime ends
     │                                │                               │
     ▼                                ▼                               ▼
[─── fresh ────][──────── stale (cached) ────────][── garbage-collected ──]
   no refetch          stale-while-revalidate              gone entirely
   on remount      (cache shown, refetch in bg)
```

- **`staleTime`** — How long after a fetch is the data considered "fresh"? While fresh, mounting another component with the same key **does not** trigger a refetch (it just reads cache). After staleTime, the data is "stale" — but the cache is still served instantly on mount, and a silent background refetch fires to check freshness. **Default: 0** (always considered stale, but cache still served). We set it to **30 seconds** in our defaults so rapid back-and-forth navigation doesn't refetch.

- **`gcTime`** — How long does an *unused* query (zero subscribers — no components calling `useQuery` with that key) stay in cache before garbage collection? **Default: 5 minutes**. Within this window, a component that re-mounts with that key gets the cached data instantly (and a stale-revalidate fetch). After gcTime, the cache entry is dropped entirely.

(In v4 this was called `cacheTime`. They renamed it in v5 to disambiguate from staleTime.)

### Stale-while-revalidate (SWR)

The most important UX win. When a component mounts with a key that has stale cache:
1. The cached data is returned **synchronously** to the component — instant render
2. A background `queryFn` call fires
3. When it resolves, the cache updates and any subscribed component re-renders with fresh data

The user sees an instant page, then (a second later) any changes show up. Vastly better than "spinner → data."

### Refetch on window focus

Default `true`. When the browser tab regains focus (alt-tab back, switch from another tab), every **stale** active query refetches in the background. Fresh queries (within staleTime) are left alone.

This is the "I left this tab open all night and it just fixed itself when I came back" feature. Hard to overstate how much UX value it provides for free.

### Mutations + invalidation

For writes (POST/PATCH/DELETE), use `useMutation`:
```tsx
const createUser = useMutation({
  mutationFn: adminService.createUser,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['users'] });
  },
});
```

`invalidateQueries` marks every cached query whose key starts with `['users']` as stale. Any component currently observing those queries refetches immediately; unmounted queries refetch on next mount.

**Key prefix matching is what makes this powerful.** If your keys are organized hierarchically (`['user', 42]`, `['user', 42, 'goals']`, `['user', 42, 'reviews']`), `invalidateQueries({ queryKey: ['user', 42] })` invalidates **that user and everything under them** in one call. Plan your keys like URLs.

### The DevTools

`@tanstack/react-query-devtools` is a floating panel (dev only) that shows:
- Every cached query, its key, status (fresh / stale / fetching / inactive), and last update time
- The data in the cache (you can inspect it inline)
- Action buttons: invalidate, refetch, remove from cache

It is **the** way to debug cache issues. If something feels off ("why isn't this refreshing"), open DevTools, look at the query state. It's also how you verify that dedup is working — you'll see two components share one cache entry instead of two.

---

## Part 3 — The work, step by step

### Step 1 — Install

```bash
npm install @tanstack/react-query @tanstack/react-query-devtools
```

Both go into `dependencies` (not devDependencies). Reason: we import them at runtime from `main.tsx`. Devtools wraps with `import.meta.env.DEV` so Vite tree-shakes them out of prod bundles — but the package itself is in dependencies so npm installs it on the build server. Putting devtools in devDependencies works only if CI installs devDeps (most do, but it's an extra assumption).

### Step 2 — The QueryClient singleton

Lives in its own module so anyone can import it (mutations, logout cleanup, etc.):

```ts
// frontend/src/lib/queryClient.ts
import { QueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,           // 30s — see Part 2
      retry: (failureCount, error) => {
        // 4xx: never retry (auth, validation, not-found — won't change)
        if (isAxiosError(error)) {
          const status = error.response?.status;
          if (status !== undefined && status >= 400 && status < 500) {
            return false;
          }
        }
        // Network / 5xx: 2 retries with exponential backoff (default)
        return failureCount < 2;
      },
    },
    mutations: {
      // Server-side rejection of a write: surface immediately, don't retry.
      // Network blip: one retry.
      retry: (failureCount, error) => {
        if (isAxiosError(error) && error.response) return false;
        return failureCount < 1;
      },
    },
  },
});
```

**Why a separate module:**
- Mutations elsewhere can `import { queryClient }` and call `invalidateQueries`
- `AuthProvider.logout()` calls `queryClient.clear()` (security — see Step 4)
- Future hooks can attach global error listeners via `queryClient.getQueryCache().subscribe(...)`

**Why those retry rules:**
- 401/403: the axios interceptor already redirects to `/login`. Retrying would hammer a dead session.
- 4xx in general (validation, not-found, conflict): retrying never changes the outcome. Fail fast.
- 5xx and network errors: worth a couple of attempts — could be a transient blip.

### Step 3 — QueryClientProvider in `main.tsx`

```tsx
// frontend/src/main.tsx
<QueryClientProvider client={queryClient}>
  <AuthProvider>
    <ThemeProvider>
      <SystemSettingsProvider>
        ...
        <App />
        ...
      </SystemSettingsProvider>
    </ThemeProvider>
  </AuthProvider>
  {import.meta.env.DEV && (
    <ReactQueryDevtools initialIsOpen={false} buttonPosition="bottom-left" />
  )}
</QueryClientProvider>
```

**Critical: `QueryClientProvider` wraps `AuthProvider`** — not the other way around. Reason: `AuthProvider.logout()` calls `queryClient.clear()`, and any hook calling `useQueryClient()` needs the provider above it in the tree. We *could* import `queryClient` directly (since it's a module export), and that's what we do for `AuthProvider`. But future hooks that prefer `useQueryClient()` need the provider order to be right.

**The devtools tree-shaking:** `import.meta.env.DEV` is a build-time constant. Vite replaces it with `true` in `vite dev` and `false` in `vite build`. Rolldown then dead-code-eliminates the whole `<ReactQueryDevtools>` branch in production. Zero bytes shipped to users.

### Step 4 — Cache clear on logout (security)

Without this, when User A logs out and User B logs in on the same machine, B briefly sees A's cached data while their own queries refetch. This is a real session-bleeding bug.

```tsx
// frontend/src/contexts/AuthProvider.tsx
import { queryClient } from "@/lib/queryClient";

const logout = useCallback((): void => {
  void authService.logout();
  localStorage.removeItem("user");
  localStorage.removeItem("csrf_token");
  clearDismissedDashboardBanners();
  queryClient.clear();   // ← NEW: cancels in-flight, drops every cache entry
  setUser(null);
}, []);
```

`queryClient.clear()` is safe to call regardless of whether queries are active — it cancels in-flight fetches, drops all cache entries, and resets all observers.

### Step 5a — Migration: `StaffDashboard` (1 query, no special cases)

**Before:**
```tsx
const [summary, setSummary] = useState<DashboardSummary | null>(null);

useEffect(() => {
  let cancelled = false;
  dashboardService.getSummary()
    .then((res) => { if (!cancelled) setSummary(res); })
    .catch((err) => { if (!cancelled) snackbar.error(getErrorMessage(err)); });
  return () => { cancelled = true; };
}, [snackbar]);
```

**After:**
```tsx
const { data: summary, error } = useQuery({
  queryKey: ["dashboard", "summary"],
  queryFn: dashboardService.getSummary,
});

useEffect(() => {
  if (error) snackbar.error(getErrorMessage(error));
}, [error, snackbar]);
```

**What changed:**
1. `useState + useEffect + cancelled` ceremony → one `useQuery` call
2. `data` *is* the state — owned by the cache, not the component
3. Race condition guard (`cancelled`) is gone — TanStack Query handles unmount-mid-fetch via AbortController internally
4. Errors are still surfaced through snackbar, but via a tiny separate effect

**The JSX (rest of the file) didn't change at all** — it does `summary ? <Widget summary={summary} /> : <CardSkeleton />` and `data` is `undefined` until first load, then the typed object. Same conditional rendering still works.

### Step 5b — Migration: `MentorDashboard` (2 parallel queries)

Same pattern, twice. Both `useQuery` calls fire in **parallel** automatically (TanStack Query doesn't serialise them):

```tsx
const { data: summary, error: summaryError } = useQuery({
  queryKey: ["dashboard", "summary"],
  queryFn: dashboardService.getSummary,
});

const { data: mentees, error: menteesError } = useQuery({
  queryKey: ["mentees", "summaries"],
  queryFn: menteeService.getSummaries,
});

useEffect(() => {
  if (summaryError) snackbar.error(getErrorMessage(summaryError));
}, [summaryError, snackbar]);

useEffect(() => {
  if (menteesError) snackbar.error(getErrorMessage(menteesError));
}, [menteesError, snackbar]);
```

**Notice the queryKey reuse.** `["dashboard", "summary"]` is the **same key** as in `StaffDashboard`. A user who visits both pages (impossible in practice — the dashboard router picks one variant — but instructive) would share the cache entry. More usefully: a future mutation that invalidates `["dashboard"]` would refresh both Staff and Mentor variants in one call.

**The `?? null` bridge:**
```tsx
<MenteeGoalFunnelCard mentees={mentees ?? null} />
```
The dashboard widgets were typed for `MenteeSummary[] | null` (the old useState type). `useQuery` returns `MenteeSummary[] | undefined`. The smallest possible bridge is `?? null` at the call site. Fixing it "properly" means updating every dashboard widget's prop type to accept `undefined` — a follow-up cleanup, not part of this PR.

### Step 5c — Migration: `HrDashboard` (dynamic queryKey by FY)

This is the showcase migration. The FY picker means the query is **parameterized**.

**Before:** Two useStates and a useEffect coordinated to refetch when FY changed, plus a `trackedFy` state machine to wipe stale data on FY switch:
```tsx
const [summary, setSummary] = useState<HrDashboardSummary | null>(null);
const [selectedFy, setSelectedFy] = useState<number | null>(null);
const [trackedFy, setTrackedFy] = useState<number | null>(null);

if (trackedFy !== selectedFy) {
  setTrackedFy(selectedFy);
  setSummary(null);   // wipe stale data before new FY loads
}

useEffect(() => {
  let cancelled = false;
  dashboardService.getHrSummary(selectedFy ?? undefined)
    .then((res) => { if (!cancelled) setSummary(res); })
    .catch((err) => { if (!cancelled) snackbar.error(getErrorMessage(err)); });
  return () => { cancelled = true; };
}, [selectedFy, snackbar]);
```

**After:**
```tsx
const { data: summary, error } = useQuery({
  queryKey: ["dashboard", "hr-summary", selectedFy],
  queryFn: () => dashboardService.getHrSummary(selectedFy ?? undefined),
  enabled: selectedFy !== null,
});

useEffect(() => {
  if (error) snackbar.error(getErrorMessage(error));
}, [error, snackbar]);
```

**What `selectedFy` being part of the queryKey does:**
1. Switch picker from FY26-27 → FY25-26 → the key changes → a new cache entry is born → `data` is `undefined` until the new fetch lands → JSX shows skeleton (because the JSX still does `summary?.foo`)
2. Switch back to FY26-27 → key matches a cached entry → `data` is the cached object instantly → no skeleton, just instant render
3. Each FY's data is independently cached; gc kicks in 5 min after the picker leaves an FY

**The entire `trackedFy` state machine vanished** — the queryKey *is* the trackedFy. No manual coordination, no synchronization bugs, no during-render setState dance.

**The `enabled` gate:** `enabled: selectedFy !== null` tells useQuery "don't fetch yet, the parameter isn't ready." Initially `selectedFy` is null (waiting for SystemSettings to load), so the query stays parked. Once SystemSettings arrives and the during-render compare sets `selectedFy`, the query fires automatically. Without `enabled`, we'd send a meaningless request with `fy=undefined` first, get a default, then immediately discard it when settings arrive.

### Step 6 — Add `query-vendor` chunk

Same pattern we set up in PR #18 for React/axios/lucide. TanStack Query is stable and worth caching across our deploys:

```ts
// frontend/vite.config.ts
if (/[\\/]node_modules[\\/]@tanstack[\\/]/.test(id)) {
  return 'query-vendor';
}
```

Result: a dedicated 10 KB gzip chunk that doesn't change on code-only releases.

---

## Part 4 — Final scorecard

### Files changed

| File | Lines | What |
|---|---|---|
| `frontend/package.json` + lockfile | +2 deps | `@tanstack/react-query`, `@tanstack/react-query-devtools` |
| `frontend/src/lib/queryClient.ts` | +new | Configured QueryClient singleton |
| `frontend/src/main.tsx` | ~+15 / −0 | QueryClientProvider + dev-only DevTools |
| `frontend/src/contexts/AuthProvider.tsx` | +2 | `queryClient.clear()` on logout |
| `frontend/src/pages/StaffDashboard.tsx` | ~+15 / −16 | useQuery migration |
| `frontend/src/pages/MentorDashboard.tsx` | ~+25 / −30 | useQuery migration (2 queries) |
| `frontend/src/pages/HrDashboard.tsx` | ~+15 / −30 | useQuery migration (dynamic key); deleted trackedFy state machine |
| `frontend/vite.config.ts` | +8 | `query-vendor` chunk rule |

### Bundle impact

| Chunk | PR #18 (before) | This PR (after) | Δ |
|---|---|---|---|
| react-vendor | 71.79 KB gzip | 71.63 KB | −0.16 KB |
| **query-vendor** | — | **10.14 KB** | **NEW** |
| http-vendor | 15.86 KB | 15.95 KB | +0.09 KB |
| icons-vendor | 8.96 KB | 8.96 KB | — |
| index (app shell) | 10.08 KB | 10.25 KB | +0.17 KB |
| Dashboard | 8.37 KB | 8.39 KB | +0.02 KB |
| **Total initial load (Dashboard)** | ~115 KB | **~125 KB** | **+10 KB** |

The 10 KB is the cost of the TanStack Query runtime. It buys us cache + dedup + SWR + DevTools + mutations primitives.

### Capability gains (not measurable in KB, but bigger than the KB cost)

- ✅ Dedup: multiple components subscribed to the same key share one HTTP request
- ✅ Stale-while-revalidate: instant cached data on revisit + silent refetch
- ✅ Refetch on window focus: data stays fresh when the user comes back to the tab
- ✅ Mutations + cache invalidation (foundation laid; first uses come in follow-up PRs)
- ✅ DevTools: cache inspection + manual invalidation/refetch
- ✅ No more `let cancelled = false` boilerplate
- ✅ Session-leak safety: `queryClient.clear()` on logout

---

## Part 5 — Trade-offs we deliberately made

### Why we added 10 KB to the bundle

The alternatives were:
- **Build our own cache layer.** Possible but enormous scope. We'd be reinventing TanStack Query badly. Skip.
- **Use SWR instead.** Smaller (~5 KB), simpler API. But weaker mutation story, no DevTools as good as TanStack's. For a write-heavy admin app like ours, TanStack's mutation + invalidation primitives win.
- **Stay with useEffect.** The non-cost path. But every page that's added in the future inherits the same problems.

10 KB vendor-cached is a one-time tax for a foundation every future page benefits from.

### Why we migrated only the Dashboard family in this PR

Scope discipline. The doc and review get unwieldy if we touch 14 pages at once. Three Dashboard variants is enough to:
- Prove the foundation works
- Demonstrate the three core patterns (single read, parallel reads, dynamic key)
- Build muscle memory for the migration template that the next PRs follow

Migration of `AdminPanel` (mutations!), `AnnualGoals`, `AnnualReviews`, `ProjectReviews`, etc. follows in subsequent PRs, each as its own focused change.

### Why we used `?? null` instead of fixing the widget types

The dashboard widgets were typed for `... | null` because that was what useState gave them. useQuery gives `... | undefined`. The proper fix is changing every widget's prop type — that's tens of files. The `?? null` at the call site is a 6-character bridge that keeps this PR focused. Worth doing as a follow-up "Clean up `null` vs `undefined` discipline in widget props."

### Why staleTime is 30 seconds (not 0 or 5 minutes)

- **0 (default):** Every navigation refetches in the background. Cache-hit is instant; the background fetch is invisible to the user. Some teams stick with this. We could too.
- **30 seconds (chosen):** Within 30s of a fetch, navigation back doesn't even trigger the background fetch. Cuts a small amount of server load and network traffic. Within rapid HR clicking-around behaviour, "everything just feels instant."
- **5 minutes or more:** Risks showing very stale data when the user comes back to a page. Refetch-on-focus mitigates this but doesn't eliminate it. Reserve for resources that genuinely change rarely.

30 seconds is a reasonable default that we can tune **per-query** by passing `staleTime` to a specific `useQuery`. The global default is a *floor*, not a ceiling.

### Why we kept refetch-on-window-focus enabled

Some teams disable it because it generates "unexpected" background traffic. Our position: that traffic is the **feature**. Users alt-tabbing back is exactly when their cached data has the highest probability of being wrong. The traffic is silent and the worst-case cost is one extra HTTP request per query. Worth it.

---

## Part 6 — How to use the DevTools

In `npm run dev`, you'll see a floating "TanStack" logo in the bottom-left corner. Click it.

The panel shows:
- **Queries** tab — every cached query keyed by its queryKey, color-coded by status:
  - Green = fresh (within staleTime)
  - Yellow = stale (past staleTime, will background-refetch on next mount)
  - Blue = fetching right now
  - Gray = inactive (no observers, still in cache during gcTime)
- Click any query to see its data and metadata
- Action buttons per query: **Refetch**, **Invalidate**, **Reset**, **Remove**
- **Mutations** tab — every active or recent mutation

**Verification workflow:**
1. Open Dashboard. DevTools shows `["dashboard", "summary"]` green/fresh.
2. Navigate to AdminPanel and back to Dashboard within 30 seconds. The Dashboard chunk loads instantly (PR #18) AND the data renders instantly with no spinner (this PR). DevTools shows the query is still green.
3. Wait 30+ seconds, navigate to AdminPanel and back. Query is yellow/stale. Cache still renders instantly, but a refetch fires in the background — watch DevTools turn blue briefly, then green.
4. Alt-tab away from the browser for a minute, then alt-tab back. Watch every stale query refetch.

**This is how you'll debug cache issues forever now.** Every time something feels off, open DevTools and look at the actual cache state. It removes 90% of the guesswork.

---

## Part 7 — Patterns the rest of the migration will follow

Once you've done one, the rest are templates. Reference cards:

### Read-only query (no params)
```tsx
const { data, error, isPending } = useQuery({
  queryKey: ['users'],
  queryFn: adminService.getUsers,
});
```

### Read query with parameters in the key
```tsx
const { data } = useQuery({
  queryKey: ['user', userId],
  queryFn: () => adminService.getUser(userId),
  enabled: userId !== null,           // gate on the param being ready
});
```

### Mutation with cache invalidation
```tsx
const queryClient = useQueryClient();

const createUser = useMutation({
  mutationFn: adminService.createUser,
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ['users'] });
  },
});

// Then in JSX:
<button onClick={() => createUser.mutate(formData)} disabled={createUser.isPending}>
  {createUser.isPending ? "Creating..." : "Create user"}
</button>
```

### Optimistic update (advanced — for a future doc)
```tsx
const toggleGoal = useMutation({
  mutationFn: goalService.toggleComplete,
  onMutate: async (goalId) => {
    // Snapshot the previous value
    await queryClient.cancelQueries({ queryKey: ['goals'] });
    const previous = queryClient.getQueryData(['goals']);
    // Optimistically update
    queryClient.setQueryData(['goals'], (old: Goal[]) =>
      old.map(g => g.id === goalId ? { ...g, completed: !g.completed } : g),
    );
    return { previous };
  },
  onError: (err, goalId, context) => {
    // Rollback on failure
    queryClient.setQueryData(['goals'], context?.previous);
  },
  onSettled: () => {
    queryClient.invalidateQueries({ queryKey: ['goals'] });
  },
});
```
We don't use optimistic updates yet. They're powerful for UIs where mutations should feel instant (toggles, drag-and-drop reorders, etc.). Cover this in a follow-up doc when we reach a page that benefits.

### Query key conventions (recommended for future PRs)

We used inline keys for the Dashboard migration. For an app this size, a **query keys factory** module is the next-level evolution:

```ts
// frontend/src/lib/queryKeys.ts (FUTURE)
export const queryKeys = {
  dashboard: {
    all: ['dashboard'] as const,
    summary: () => [...queryKeys.dashboard.all, 'summary'] as const,
    hrSummary: (fy: number | undefined) =>
      [...queryKeys.dashboard.all, 'hr-summary', fy ?? 'active'] as const,
  },
  users: {
    all: ['users'] as const,
    detail: (id: number) => [...queryKeys.users.all, id] as const,
  },
  // ...
};

// Usage:
useQuery({ queryKey: queryKeys.dashboard.summary(), queryFn: ... });
queryClient.invalidateQueries({ queryKey: queryKeys.users.all });
```

Benefits: typesafe, refactor-friendly, single source of truth for key structure. We'll introduce this in PR #03 once there are enough keys to justify the abstraction.

---

## Part 8 — What you should now know cold

After reading this doc you should be able to:

1. Explain the difference between client state and server state, with concrete examples from this app.
2. Describe what TanStack Query's cache holds, how `queryKey` indexes it, and what "structurally equal" means.
3. Explain stale-while-revalidate and why it makes the UI feel instant.
4. Explain `staleTime` vs `gcTime`, and pick a reasonable default for a new resource.
5. Justify why `refetch-on-window-focus` is on by default.
6. Read the DevTools and identify which queries are fresh vs stale vs fetching.
7. Write a `useQuery` call with parameters in the key (and explain why the param goes in the key, not the queryFn args).
8. Write a `useMutation` with `onSuccess: invalidateQueries`.
9. Explain why we clear the cache on logout.
10. Explain why we put TanStack Query in `dependencies` even though the DevTools tree-shake out of prod.

---

## Part 9 — What's deliberately *not* done here

These come in follow-up PRs:

- **Migrate AdminPanel.** Has mutations (create/update/deactivate user). Will be the first PR that exercises `useMutation` + `invalidateQueries`. **High priority** — this is where the cross-component refresh win is most visible.
- **Migrate AnnualGoals, AnnualReviews, ProjectReviews, MyMentees.** Read + write heavy pages. Each its own PR.
- **Migrate SystemSettingsProvider internally to useQuery.** Currently a hand-rolled context cache. The public API (`useSystemSettings()`) stays the same; the internals swap.
- **Optimistic updates** on toggles / quick actions.
- **Query keys factory** (`frontend/src/lib/queryKeys.ts`) once we have ~10 keys.
- **Cleanup**: change dashboard widget prop types from `... | null` to `... | undefined` and drop the `?? null` bridges.
- **Per-query staleTime tuning**: SystemSettings should probably be 5+ minutes (changes rarely). Dashboard summary could be longer.
- **`onError` global handler**: instead of one snackbar effect per useQuery, attach a `queryClient.getQueryCache().subscribe(...)` listener that surfaces all unhandled errors. Less boilerplate, single point of control.

---

## Part 10 — Verification checklist

```bash
cd frontend
npm install            # picks up the new deps
npm run build          # smoke-test prod build still works
npm run dev            # for the manual checks below
```

In the running app (`npm run dev`):

1. Open `/dashboard`. Open DevTools (TanStack icon, bottom-left).
2. Confirm `["dashboard", "summary"]` is listed and green.
3. Navigate away to `/profile`, then back to `/dashboard`.
   - Page renders instantly with no skeleton (data was cached)
   - DevTools still shows the query as green (within 30s staleTime — no background refetch needed)
4. Wait ~35 seconds. Navigate away and back.
   - Page still renders instantly (stale cache served)
   - DevTools query turns yellow then briefly blue (background refetch) then green
5. Alt-tab to another browser window for a few seconds, then back.
   - Every stale query refetches in the background (you'll see them flash blue → green in DevTools)
6. Log out and log back in.
   - DevTools shows the cache was cleared (`Queries` tab is empty after logout, repopulates on login)
7. As HR, switch the FY picker on HR Dashboard.
   - DevTools shows a new query appearing for each FY selected
   - Switch back to a previously-selected FY — instant render, query is green

If all of the above behaves as described, the migration is working as designed.
