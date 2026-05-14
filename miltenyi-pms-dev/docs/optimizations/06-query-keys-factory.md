# 06 — Query keys factory: single source of truth for every cache key

> **PR:** _pending_
> **Files changed:** new `frontend/src/lib/queryKeys.ts`; 7 consumer files (`AdminPanel`, `StaffDashboard`, `MentorDashboard`, `HrDashboard`, `AnnualReviews`, `TeamReviewTab`, `AnnualGoals`).
> **Headline result:** Every `queryKey: [...]`, `invalidateQueries({ queryKey: [...] })`, and `setQueryData([...], ...)` call site now goes through a typed factory. Typos are compile errors. Renaming a key only touches the factory.

---

## TL;DR

Five PRs of inline `["admin", "users"]`-style keys have accumulated ~25 distinct call sites across 7 files. Today they're plain string arrays — a typo (`["aadmin", ...]`) silently creates a phantom cache entry that never matches anything, and "rename this key" means a grep-and-replace party.

We collapsed all of them into one `queryKeys` factory in `src/lib/queryKeys.ts`. Every consumer now imports `queryKeys` and uses typed accessors like `queryKeys.admin.users()` or `queryKeys.dashboard.hrSummary(fy)`. The factory `.all` properties enable broadcast invalidation (`queryKeys.goals.all`) without anyone having to remember the namespace string.

While we were at it, we renamed two awkward keys: `['annual-reviews', 'all']` → `['annual-reviews', 'org']` and `['goals', 'all']` → `['goals', 'org']`. The literal `'all'` was ambiguous with the factory's `.all` broadcast accessor; `'org'` reads cleanly as "the org-wide view."

This is a **pure refactor** — no runtime behaviour changes, no new features, no bundle-size impact.

---

## Part 1 — Why this matters now (and didn't matter in PR #19)

When we introduced TanStack Query in PR #19, we had **one inline key**: `['dashboard', 'summary']`. By PR #22 we had **13+ distinct keys** spread across **6 namespaces** with **~25 call sites**:

```
['admin', 'users']                  ['mentees', 'summaries']
['admin', 'functions']              ['annual-reviews', 'mine']
['admin', 'designations']           ['annual-reviews', 'all']
['admin', 'settings']               ['annual-reviews', 'mentees']
['dashboard', 'summary']            ['goals', 'mine', 'annual']
['dashboard', 'hr-summary', fy]     ['goals', 'all']
['profile', 'expectations']         ['goals']         ← broadcast only
                                    ['dashboard']     ← broadcast only
```

At this scale, **inline keys become a maintenance liability**:

1. **Typo invisibility.** `queryClient.invalidateQueries({ queryKey: ["admnin", "users"] })` doesn't error. The invalidation silently no-ops because nothing matches. The bug surfaces as "users list isn't refreshing after create" — hours to debug.

2. **Renames are a grep party.** "Let's rename `'all'` to `'org'`" required finding every literal across 7 files. Easy to miss one (especially in a call site you don't have open).

3. **No discoverability.** "What queries exist?" requires grepping. New contributors can't see the schema at a glance.

4. **Drift.** Two places using `['goals', 'mine']` and `['goals', 'mine', 'annual']` would each create their own cache entry. Subtle bugs where two components fetch the "same" data but don't share cache.

5. **Broadcast keys are stringly-typed too.** `invalidateQueries({ queryKey: ['goals'] })` works because no one bothered making `'goals'` a constant. Anyone could write `['goal']` (missing 's') and the broadcast silently invalidates nothing.

The factory fixes all five.

**Why didn't we do this in PR #19?** Premature abstraction is worse than no abstraction. With one key, a factory is overhead. With 13, it's load-bearing infrastructure. The exact threshold isn't a magic number — but **"I keep writing the same string in multiple files"** is the signal. By PR #21 we were duplicating `['annual-reviews', 'mine']` four times across two files. PR #22 added `['goals']` invalidations in two more places. That's the threshold this PR crosses.

---

## Part 2 — The factory shape

```ts
export const queryKeys = {
  admin: {
    all: ["admin"] as const,
    users: () => [...queryKeys.admin.all, "users"] as const,
    functions: () => [...queryKeys.admin.all, "functions"] as const,
    designations: () => [...queryKeys.admin.all, "designations"] as const,
    settings: () => [...queryKeys.admin.all, "settings"] as const,
  },
  dashboard: {
    all: ["dashboard"] as const,
    summary: () => [...queryKeys.dashboard.all, "summary"] as const,
    hrSummary: (fy: number | null) =>
      [...queryKeys.dashboard.all, "hr-summary", fy] as const,
  },
  mentees: {
    all: ["mentees"] as const,
    summaries: () => [...queryKeys.mentees.all, "summaries"] as const,
  },
  annualReviews: {
    all: ["annual-reviews"] as const,
    mine: () => [...queryKeys.annualReviews.all, "mine"] as const,
    org: () => [...queryKeys.annualReviews.all, "org"] as const,
    mentees: () => [...queryKeys.annualReviews.all, "mentees"] as const,
  },
  goals: {
    all: ["goals"] as const,
    mine: (type: "annual" | "project" = "annual") =>
      [...queryKeys.goals.all, "mine", type] as const,
    org: () => [...queryKeys.goals.all, "org"] as const,
    mentees: () => [...queryKeys.goals.all, "mentees"] as const,
  },
  profile: {
    all: ["profile"] as const,
    expectations: () => [...queryKeys.profile.all, "expectations"] as const,
  },
} as const;
```

Three patterns repeat across every namespace, intentionally. Read them once and you've read the whole file.

### Pattern A — `.all` is the broadcast key

Every namespace has an `.all` property: the bare namespace tuple. That's the key you pass to `invalidateQueries` when you want to invalidate **every cache entry under this namespace**:

```tsx
queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
// Catches ['goals','mine','annual'], ['goals','org'], ['goals','mentees'],
// and any future ['goals', ...whatever] that gets added later.
```

This is **TanStack Query's prefix-matching** — see doc #05 part 2 for the deep dive. The factory just gives the broadcast key a name. Without it, you'd write `["goals"]` inline, which works but is stringly-typed (`["goal"]` typos silently no-op).

### Pattern B — Methods return the exact tuple, with `as const`

```ts
users: () => [...queryKeys.admin.all, "users"] as const,
```

Three small things doing real work:
- **It's a function**, not a property. The function is called at the call site (`queryKeys.admin.users()`), which gives us:
  - Parameterized keys (`hrSummary(fy)`) work the same way
  - Calling vs. accessing distinguishes specific keys from broadcast keys in source (`queryKeys.admin.all` vs `queryKeys.admin.users()`)
- **`...queryKeys.admin.all`** spreads the broadcast key as the prefix. If we ever rename `'admin'` → `'organization'` (extremely unlikely, but as an example), we change `.all` once and every method inherits it.
- **`as const`** makes the array a readonly literal tuple. TanStack Query's structural matcher relies on tuple equality, and the literal types let TypeScript catch typos at every consumer call site.

### Pattern C — Parameterized keys take params as function args

```ts
hrSummary: (fy: number | null) =>
  [...queryKeys.dashboard.all, "hr-summary", fy] as const,
```

`hrSummary` takes the FY year as a parameter and embeds it in the key. Switching FY from `2026` to `2027` produces `['dashboard', 'hr-summary', 2027]` — a new cache entry, a new fetch. Switching back is instant (cache hit on `['dashboard', 'hr-summary', 2026]`).

The factory enforces the type signature: `hrSummary("2026")` (string instead of number) is a compile error. Inline keys had no such guard.

### Self-reference quirk

The methods reference `queryKeys.<ns>.all` inside their own object literal. TypeScript allows this because **method bodies don't execute during object construction** — they're closures invoked later. The pattern is documented in TanStack Query's official examples; it's idiomatic.

If you wanted to avoid the self-reference, you could extract each namespace root to a top-level const:
```ts
const adminRoot = ["admin"] as const;
const dashboardRoot = ["dashboard"] as const;
// ...
export const queryKeys = {
  admin: { all: adminRoot, users: () => [...adminRoot, "users"] as const, ... },
  // ...
};
```
Functionally identical, slightly more lines. We chose the self-referencing form because it keeps each namespace self-contained and matches the canonical TanStack docs example.

---

## Part 3 — The migration

Before/after at every call site looks like this:

| Before | After |
|---|---|
| `queryKey: ["admin", "users"]` | `queryKey: queryKeys.admin.users()` |
| `queryKey: ["dashboard", "hr-summary", selectedFy]` | `queryKey: queryKeys.dashboard.hrSummary(selectedFy)` |
| `queryClient.invalidateQueries({ queryKey: ["admin", "users"] })` | `queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() })` |
| `queryClient.invalidateQueries({ queryKey: ["goals"] })` | `queryClient.invalidateQueries({ queryKey: queryKeys.goals.all })` |
| `queryClient.setQueryData(["admin", "settings"], fresh)` | `queryClient.setQueryData(queryKeys.admin.settings(), fresh)` |

Notice the **broadcast invalidation** distinction:
- Specific key: `queryKeys.admin.users()` (calling — function returns a tuple)
- Broadcast key: `queryKeys.goals.all` (accessing — property is a tuple)

The two forms look almost identical at the call site, but the semantic difference is real: parentheses produce a specific cache entry, no parentheses get the namespace root.

### The `'all'` → `'org'` rename

Two existing keys had `'all'` as a literal element:
- `['annual-reviews', 'all']` (HR's org-wide view of every review)
- `['goals', 'all']` (HR's org-wide view of every goal)

The literal `'all'` collided with the factory's `.all` broadcast accessor. After the factory we have `queryKeys.annualReviews.all` (broadcast tuple, value `['annual-reviews']`) AND `queryKeys.annualReviews.org()` (specific tuple, value `['annual-reviews', 'org']`). The renamed literal is clearer in DevTools — `['goals', 'org']` reads unambiguously as "the org-wide view" instead of "all of something."

The rename happens at the same time as the factory introduction. Since this is a single migration PR, the user never sees an intermediate state where old keys and new keys coexist.

### Files migrated, calls migrated

| File | Queries | Invalidates | `setQueryData` |
|---|---|---|---|
| AdminPanel.tsx | 4 | 4 | 1 |
| StaffDashboard.tsx | 1 | — | — |
| MentorDashboard.tsx | 2 | — | — |
| HrDashboard.tsx | 1 | — | — |
| AnnualReviews.tsx | 2 | 4 | — |
| TeamReviewTab.tsx | 1 | — | — |
| AnnualGoals.tsx | 3 | 3 | 1 |
| **Total** | **14** | **11** | **2** |

27 call sites total. Each is a 1-line change. Zero behaviour change.

---

## Part 4 — Final scorecard

### Files changed

| File | Lines | What |
|---|---|---|
| `frontend/src/lib/queryKeys.ts` | +new | The factory |
| 7 consumer files | small swaps | Inline keys → factory calls |

### Bundle impact
| Chunk | Before | After | Δ |
|---|---|---|---|
| AdminPanel | 15.05 KB gzip | 15.06 KB | +0.01 KB |
| Dashboard | 8.39 KB | 8.40 KB | +0.01 KB |
| AnnualGoals | 14.49 KB | 14.51 KB | +0.02 KB |
| Others | — | — | unchanged |

Sub-100-byte deltas from the indirection (function calls vs literal arrays). Negligible.

### Capability gains

- ✅ Typos at call sites are compile errors (`queryKeys.aadmin` won't typecheck)
- ✅ Renaming a key is a single edit in the factory — TS finds every consumer
- ✅ Broadcast keys are typed (`queryKeys.goals.all` vs the typo-prone `["goal"]`)
- ✅ New contributors see the schema at a glance in `queryKeys.ts`
- ✅ DevTools keys are now consistent (`['annual-reviews', 'org']`, not the ambiguous `['annual-reviews', 'all']`)

---

## Part 5 — Trade-offs we deliberately made

### Why functions, not plain arrays

We could have written:
```ts
admin: {
  all: ["admin"] as const,
  users: ["admin", "users"] as const,         // plain property, not a function
}
```

…and saved the parentheses at every call site. Two reasons we didn't:

1. **Parameterized keys need to be functions** (`hrSummary(fy)`). Mixing properties and functions in the same factory is confusing.
2. **The function form distinguishes specific keys from broadcast keys.** `queryKeys.goals.all` (no parens) is the broadcast key; `queryKeys.goals.org()` (parens) is a specific key. Readers learn the convention once and never confuse them.

Cost: a few extra characters at each call site. Worth it.

### Why we renamed `'all'` → `'org'` rather than leaving it

Three options at PR-design time:

| Option | Pros | Cons |
|---|---|---|
| Keep `'all'` literal, name factory method `.all` too | Zero renames | Naming collision — `queryKeys.goals.all` and `queryKeys.goals.all()` would both exist; ambiguous |
| Keep `'all'` literal, name factory method something else (`.org`) | Zero renames | API says one thing, DevTools says another — cognitive overhead forever |
| Rename literal to `'org'` (chosen) | Consistent API and DevTools | One-time rename across 4 call sites |

The rename pays for itself in clarity. It also doubles as a semantic improvement: `['goals', 'all']` is genuinely ambiguous ("all my goals" vs "all org goals"); `['goals', 'org']` is not.

### Why we didn't put the factory in `services/` or `hooks/`

The factory is consumed by **both pages and services-adjacent code** (like the queryClient.ts logout cache clear path, hypothetically). Putting it in `services/` would imply it's a service. Putting it in `hooks/` would imply it's a hook.

`src/lib/` is the right home — alongside `queryClient.ts`. The two files form a "TanStack Query setup" group: one defines the cache, the other defines what keys live in it.

### Why we didn't add a global `queryFn` registry

A maximalist version of this pattern bundles both keys AND fetch functions:

```ts
admin: {
  users: {
    key: () => [...adminAll, "users"] as const,
    fetch: () => adminService.getUsers(),
  },
},
```

Then every `useQuery({ queryKey: queryKeys.admin.users.key(), queryFn: queryKeys.admin.users.fetch })` becomes more uniform.

We didn't do this because:
1. The services are already in their own files; duplicating the bindings here adds maintenance burden
2. Some queries need parameterized fetch functions (`() => goalService.getMyGoals("annual")`) — the registry pattern fights that
3. The win is small compared to "make keys typed" — diminishing returns

Possible future evolution: define typed query option objects (`adminQueries.users` returning `{ queryKey, queryFn }`). For now, keys-only is the right scope.

### Why we didn't migrate `EvalDrawer` / `useReviewDetails`

Same reason as in PR #21: those files don't currently use `useQuery` or `useMutation`. They're imperative service callers. When they get migrated in their own PR, they'll naturally adopt the factory — there's nothing to migrate proactively.

---

## Part 6 — How to add a new key

```ts
// Want to add ['admin', 'audit-log'] for a new audit log view?
// Edit queryKeys.ts:

admin: {
  all: ["admin"] as const,
  users: () => [...queryKeys.admin.all, "users"] as const,
  functions: () => [...queryKeys.admin.all, "functions"] as const,
  designations: () => [...queryKeys.admin.all, "designations"] as const,
  settings: () => [...queryKeys.admin.all, "settings"] as const,
  auditLog: () => [...queryKeys.admin.all, "audit-log"] as const,   // ← new
},
```

Use it:
```ts
const auditLogQuery = useQuery({
  queryKey: queryKeys.admin.auditLog(),
  queryFn: adminService.getAuditLog,
});
```

Need a parameter (e.g. user-scoped audit log)?
```ts
auditLog: (userId: number | null) =>
  [...queryKeys.admin.all, "audit-log", userId] as const,
```

The TS signature flows to every call site automatically. If a caller forgets the param, compile error.

---

## Part 7 — What you should now know cold

1. The factory pattern (`.all` for broadcast, methods for specific keys, `as const` everywhere).
2. The function-vs-property distinction (parens = specific key, no parens = broadcast key).
3. Why the factory's self-reference works (deferred function-body evaluation).
4. The threshold for introducing the factory (~10+ keys, multiple files, broadcast keys becoming common).
5. Why we rename `'all'` → `'org'` (factory API and DevTools literal should stay consistent).
6. How to add a new key (one line in the factory; TS catches every consumer).

---

## Part 8 — Verification checklist

```bash
cd frontend
npm run build       # passes? good
npm run dev
```

In the app:

1. **DevTools keys read identically to before for unchanged namespaces.** Open `/admin` — `["admin", "users"]`, `["admin", "settings"]`, etc. unchanged.

2. **Renamed keys show their new literals.** As HR, open `/annual-reviews` — DevTools shows `["annual-reviews", "org"]` (was `"all"`). Open `/annual-goals` — `["goals", "org"]` (was `"all"`).

3. **Broadcast invalidation still works.** As Staff, submit a goal. DevTools shows `["goals", "mine", "annual"]` AND `["dashboard", "summary"]` flash blue → green. The `queryKeys.goals.all` and `queryKeys.dashboard.all` broadcasts catch them as before.

4. **Cache-key parameterization still works.** As HR on the dashboard, switch the FY picker. DevTools shows a new query mount per FY (`["dashboard", "hr-summary", 2026]`, `["dashboard", "hr-summary", 2027]`).

5. **TS catches typos.** Edit a call site to `queryKeys.aadmin.users()` and run `npx tsc --noEmit`. You should see "Property 'aadmin' does not exist on type ...". Revert.

If all four behave as described, the migration is correct.

---

## Part 9 — What's deliberately not done here

- **`EvalDrawer` / `useReviewDetails` mentor evaluation mutations.** Not migrated to TanStack Query yet (per PR #21 scope). When they are, they'll adopt the factory from day one.
- **`ManagementReview.tsx`, `MenteeDetail.tsx`, `MyMentees.tsx`.** Same — page-level migrations are own PRs; they'll use the factory when migrated.
- **Query options factory** (the maximalist version that bundles `queryFn` too — see Part 5). Worth revisiting if/when most pages have moved to the new patterns and we want one more layer of consolidation.
- **ESLint rule to forbid inline `queryKey:` arrays.** Would catch any future inline-key drift. Easy to add (`no-restricted-syntax` matching `Property[key.name='queryKey'][value.type='ArrayExpression']`). Skipped to keep this PR focused; worth adding in a "tighten linting" follow-up.
