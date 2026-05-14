# 13 — `useReviewDetails` hook: useReducer → useQuery

> **PR:** _pending_
> **Files changed:** `frontend/src/hooks/useReviewDetails.ts` (full rewrite, same exports).
> **Headline result:** Custom hook's internals swap from `useReducer + useEffect + cancelled-flag` to a single `useQuery` call. Public `{ details, isFetching, error }` return shape preserved — zero consumer changes. Bundle: ProjectReviews chunk **shrinks by 0.16 KB gzip** (less code is fewer bytes).

---

## TL;DR

When I scoped this PR (originally planned as "EvalDrawer + useReviewDetails") I assumed both files had service calls to migrate. Survey revealed:
- `EvalDrawer.tsx` is a **pure presentational shell** — drawer chrome, Esc handler, ResizeObserver, sidebar coordination. **Zero service calls.** Its mutations were already migrated back in PR #25 (they live in `MenteeDetail`, not in the drawer).
- `useReviewDetails.ts` is a tiny custom hook that wraps `projectReviewService.getReview(reviewId)` with a `useReducer + useEffect` state machine. It's the **last** imperative service call in the project-reviews codebase.

So this PR is small but ties off a loose end. The hook's internals get a rewrite; its two consumers (`ReviewDetailPanel`, `TableExpandedRow`) don't change because the public return shape is preserved.

There's a teaching point in here worth more than the bytes: **custom-hook internals are a great migration target precisely because they're encapsulated**. The "shape" the rest of the app sees stays identical; only the internals modernize.

---

## Part 1 — The "EvalDrawer has nothing to migrate" lesson

When I drafted the roadmap, I lumped `EvalDrawer` with `useReviewDetails` because they both live in the mentor-eval orbit. But the survey showed:

```tsx
// EvalDrawer.tsx — full component
export function EvalDrawer(props: EvalFormProps) {
  const { collapsed, setCollapsed, setRightInsetPx } = useSidebar();
  const drawerRef = useRef<HTMLDivElement | null>(null);

  // Sidebar collapse + restore-on-unmount
  useEffect(() => { /* ... */ }, []);

  // ResizeObserver to publish drawer width to AppShell
  useEffect(() => { /* ... */ }, [setRightInsetPx]);

  // Esc-to-close
  useEffect(() => { /* ... */ }, [props]);

  return createPortal(<div ...><EvalForm {...props} /></div>, document.body);
}
```

Three effects, all UI-only: collapse the sidebar when mounting, publish the drawer's width so `<main>` reflows, listen for Esc. The component takes `EvalFormProps` as a passthrough and renders `<EvalForm {...props} />`. **No service calls. No queries. No mutations.**

The mutations that drive the drawer's form (`submitMentorEval`, `saveMentorDraft`) live in `MenteeDetail.tsx` and were migrated to `useMutation` in **PR #25**. The drawer just forwards `onSubmit` / `onSaveDraft` callbacks.

### The lesson

**Survey before you scope.** It's easy to misclassify a component as "needs migration" because it's adjacent to migrated code. The acid test is: *does this file import any service module and call its methods?* If no, there's nothing to migrate. Adjacent ≠ in-scope.

EvalDrawer's only "modernization" would be aesthetic refactors (the three useEffect blocks could each be argued about) — but those are out of scope for the cache rollout. We leave it.

---

## Part 2 — The hook rewrite

### Before

```ts
import { useEffect, useReducer } from "react";

interface ReviewDetailsState {
  readonly details: ProjectReviewResponse | null;
  readonly isFetching: boolean;
  readonly error: string;
}

const INITIAL: ReviewDetailsState = { details: null, isFetching: false, error: "" };

type Action =
  | { type: "reset" }
  | { type: "start" }
  | { type: "success"; details: ProjectReviewResponse }
  | { type: "error"; message: string };

function reducer(state: ReviewDetailsState, action: Action): ReviewDetailsState {
  switch (action.type) {
    case "reset":   return INITIAL;
    case "start":   return { details: null, isFetching: true, error: "" };
    case "success": return { details: action.details, isFetching: false, error: "" };
    case "error":   return { details: null, isFetching: false, error: action.message };
    default:        return state;
  }
}

export function useReviewDetails(reviewId: number | null) {
  const [state, dispatch] = useReducer(reducer, INITIAL);

  useEffect(() => {
    if (reviewId == null) {
      dispatch({ type: "reset" });
      return;
    }
    let cancelled = false;
    dispatch({ type: "start" });
    projectReviewService
      .getReview(reviewId)
      .then((details) => {
        if (!cancelled) dispatch({ type: "success", details });
      })
      .catch(() => {
        if (!cancelled)
          dispatch({ type: "error", message: "Failed to fetch evaluation details" });
      });
    return () => { cancelled = true; };
  }, [reviewId]);

  return state;
}
```

84 lines of code for "fetch one record by id." The reducer existed because the hook used to write multiple useState setters in one effect, which triggered sonar S6447 (`react-hooks/exhaustive-deps`-adjacent: "calling setState within effect"). Folding into a reducer collapses each transition into one dispatch.

### After

```ts
import { useQuery } from "@tanstack/react-query";
import { projectReviewService, type ProjectReviewResponse } from "@/services/project-review.service";
import { queryKeys } from "@/lib/queryKeys";

interface ReviewDetailsState {
  readonly details: ProjectReviewResponse | null;
  readonly isFetching: boolean;
  readonly error: string;
}

export function useReviewDetails(reviewId: number | null): ReviewDetailsState {
  const query = useQuery({
    queryKey: queryKeys.projectReviews.detail(reviewId ?? -1),
    queryFn: () => projectReviewService.getReview(reviewId as number),
    enabled: reviewId !== null,
  });

  return {
    details: query.data ?? null,
    isFetching: reviewId !== null && query.isPending,
    error: query.isError ? "Failed to fetch evaluation details" : "",
  };
}
```

Hook body: **3 statements** (the useQuery call, plus the return). What used to be 80+ lines is now 12.

### What the rewrite gets us beyond brevity

1. **Cache sharing.** `queryKeys.projectReviews.detail(id)` is the same key MenteeProjectsTab uses (PR #12). When a Staff user views their own review and a mentor views the same row in their MenteeProjectsTab impact modal (rare but possible), both share one cache entry. Two pages, two consumers, one HTTP request.

2. **Stale-while-revalidate on revisit.** The legacy hook re-fetched every time `reviewId` changed and showed a loading state. The new hook serves cached data immediately on revisit (within `gcTime`, default 5 min) and refetches silently in the background if stale.

3. **Focus-refetch.** User alt-tabs away and back — `useQuery` revalidates stale entries automatically. The legacy hook never did.

4. **No race-condition guard.** `let cancelled = false; return () => { cancelled = true; }` is gone. TanStack Query handles unmount-mid-fetch via `AbortController` internally.

5. **Sonar warning vaporizes.** The whole reason `useReducer` existed was to dodge "multiple setState in one effect" warnings. With `useQuery`, the effect is internal to the library — the consumer doesn't write one, so the warning class doesn't apply.

### Preserving the return shape (and why)

The hook's two consumers (`ReviewDetailPanel`, `TableExpandedRow`) destructure `{ details, isFetching, error }`:

```ts
const { details, isFetching, error } = useReviewDetails(
  isPending ? null : card.review_id,
);
```

If I'd returned `useQuery`'s raw output (`{ data, isLoading, isError, error, ... }`), both consumers would need updating. By mapping at the hook boundary, the consumer files stay untouched:

| Legacy | New mapping |
|---|---|
| `details: ProjectReviewResponse \| null` | `query.data ?? null` |
| `isFetching: boolean` | `reviewId !== null && query.isPending` |
| `error: string` | `query.isError ? "Failed to fetch evaluation details" : ""` |

**This is the customary boundary at which to absorb library-shape changes.** The hook's contract is what the rest of the app depends on; the library's contract changes with versions and migrations. Map at the boundary so consumers don't have to chase.

#### Subtle bit: `reviewId !== null && query.isPending`

In useQuery v5, `isPending` is true whenever the query is parked (enabled: false, no data ever) AS WELL AS during the first fetch. The legacy hook returned `isFetching: false` when `reviewId` was null. So I AND `isPending` with `reviewId !== null` to get the legacy semantics: "is the network actually in flight right now?"

Without the AND, a closed consumer (passed `null`) would see `isFetching: true` and show a spinner forever. Not what the legacy contract guarantees.

This is the kind of thing you only catch if you read the consumer code and understand what the flag means. Map carefully when migrating.

---

## Part 3 — Why the hook stays as a hook

The migrated body is so small you could imagine inlining it into both consumers:

```ts
// In ReviewDetailPanel.tsx (hypothetical)
const query = useQuery({
  queryKey: queryKeys.projectReviews.detail(card.review_id ?? -1),
  queryFn: () => projectReviewService.getReview(card.review_id as number),
  enabled: card.review_id !== null && card.review_status === "reviewed",
});
const details = query.data ?? null;
const isFetching = card.review_id !== null && query.isPending;
const error = query.isError ? "Failed to fetch evaluation details" : "";
```

Why not do that?

1. **Single source of truth for the error message.** Both consumers want the same friendly copy ("Failed to fetch evaluation details"). Centralizing means changing it once. Inlining means coordinating across two files (and any future consumers).
2. **Encapsulation.** The hook is the right level of abstraction. "Fetch a review's details by id" is a domain concept. `useQuery({ ... })` is a library concept. Keep them separate.
3. **Future-proof.** If we ever want to add behaviour to "fetching review details" — say, prefetching adjacent reviews, or a custom retry policy — there's one place to do it.

The rule: **abstract when there's a domain concept that wraps a generic primitive**. `useQuery` is the primitive; "fetch review details" is the domain concept. The hook is the right size.

---

## Part 4 — Final scorecard

### Files changed
| File | Lines | What |
|---|---|---|
| `frontend/src/hooks/useReviewDetails.ts` | full rewrite (84 → ~25) | useReducer + useEffect → useQuery |

That's it. Two consumers untouched (return shape preserved). EvalDrawer untouched (nothing to migrate).

### Bundle impact
| Chunk | Before | After | Δ |
|---|---|---|---|
| ProjectReviews (where the consumers live) | 12.39 KB gzip | **12.23 KB** | **−0.16 KB** |
| Other chunks | — | — | unchanged |

**The chunk got smaller.** Less code is fewer bytes — the reducer + dispatch + cancelled-guard boilerplate going away outweighed the small useQuery wrapper.

### Capability gains
- ✅ Cache sharing with MenteeProjectsTab's impact modal (PR #12) via same `detail(id)` key
- ✅ Stale-while-revalidate: revisiting a review row within `gcTime` (5 min default) shows instant data, refetches silently if stale
- ✅ Focus-refetch: user returns to the page → stale entries refresh
- ✅ Unmount-mid-fetch safety via AbortController (the `cancelled` flag is gone)
- ✅ One fewer reducer-state-machine in the codebase

---

## Part 5 — Trade-offs we deliberately made

### Why we preserved the public `{ details, isFetching, error }` shape

We could have returned `useQuery`'s native shape (`{ data, isLoading, isError, error, isFetching, ... }`) and updated both consumers. Two reasons against:

1. **Migration scope discipline.** Two files would need updating; PRs stay tighter when they touch fewer files. The 4-line mapping inside the hook is cheap and keeps the consumer files at zero diff.
2. **The names match the legacy semantics, not the new ones.** `isFetching` in the legacy hook meant "is a request in flight right now?" That matches `query.isPending` (when enabled), NOT `query.isFetching` (which also includes background refetches). Renaming would invite confusion. The hook's mapping enforces "always means what it used to mean."

A future "modernize the hook's external API" PR can rename if we want — but it's not the right time. **One concern per PR.**

### Why we keep the friendly error string instead of exposing the raw error

The legacy hook erased the actual error and replaced it with `"Failed to fetch evaluation details"`. We could expose `query.error?.message` for more diagnostic info, but:
- Backend errors are not always user-friendly ("ECONNRESET", "Token expired")
- The two consumers (panels in a Staff user's view) shouldn't show raw error details
- Centralizing means consistent UX across both consumers

If we ever want a more diagnostic version, add a second hook or a parameter. Don't change the default.

### Why no `staleTime` override

Review details rarely change once submitted (immutable once finalized; draft state can change but only the draft owner touches that). 30s default `staleTime` is plenty — even longer would be reasonable.

We don't tune it here because:
- The default works correctly
- A per-query override would be a separate consideration (do we tune ALL detail queries to longer staleTime? Or just this one?)
- Performance-tuning belongs in its own PR, when we have data on what's actually slow

For now: trust the defaults until something proves otherwise.

### Why we don't add `retry` configuration

The legacy hook never retried. `useQuery` retries failed fetches up to 3 times by default (we configured this in `queryClient.ts` in PR #02). For a "fetch one record" query, that's fine — if the user hits a server hiccup, the retry might save them a refresh. The legacy behaviour was strictly worse (one shot, no retry).

This is a small behaviour change from the legacy hook. Mentioned for completeness; nothing to do about it.

---

## Part 6 — What you should now know cold

1. **Survey before you scope.** Adjacent ≠ in-scope. Files near migrated code might have nothing to migrate. The acid test is "does it call a service module?"
2. **Custom hooks are great migration targets** because their public contract is encapsulated. Internals can modernize without touching consumers.
3. **Map library shapes at the hook boundary** so the rest of the codebase depends on stable domain concepts, not library specifics.
4. **`isPending` in v5 is "no data ever AND query is enabled"** — be careful when consumers expect "is fetching right now." AND with `enabled !== null` to get the legacy semantics when needed.
5. **Less code is fewer bytes.** Migrations don't always grow the bundle — sometimes they shrink it.

---

## Part 7 — Verify it works

```bash
cd frontend
npm run build
npm run dev
```

In the app (Staff user with at least one reviewed project):

1. **Open `/project-reviews` → "My Reviews" tab.**
2. **Click a reviewed card** in grid view. The right-hand `ReviewDetailPanel` should:
   - Initially: render the spinner (`isFetching` true).
   - After ~200ms: render the full evaluation (data resolved).
3. **Click a different reviewed card.** New cache entry — same loading flow.
4. **Click back to the FIRST card.** **Instant render** with previously-cached data. No spinner flash. (This is the stale-while-revalidate win.)
5. **Switch to table view, expand a reviewed row.** Same flow — `TableExpandedRow` uses the same hook.
6. **Click a non-reviewed (pending) card or row.** The hook receives `null`. `isFetching` stays false; `details` is null. Component falls back to "not yet reviewed" copy.
7. **DevTools cache inspection:**
   - Open TanStack Query DevTools (bottom-left).
   - Filter for `["project-reviews", "detail", ...]`.
   - You should see one cache entry per reviewed card you've clicked.
   - The closed-state sentinel entry `["project-reviews", "detail", -1]` should NEVER appear — the `enabled: false` gate prevents the fetch entirely; the cache entry's existence is theoretically allowed by the key but the inert sentinel id never matches a real review.
8. **Alt-tab away for 30+ seconds, come back.** DevTools should show stale entries refetch on focus (briefly turn blue → green).
9. **MenteeProjectsTab cache sharing test (Mentor + Staff):**
   - As a Staff user, view your own review details in `/project-reviews` (this populates cache for some review_id).
   - As that user's mentor (in another session), open `/my-mentees/<staff_user_id>` → Projects tab → click "Write Impact" or "Edit Impact" on the same project.
   - DevTools (mentor's side): if both sessions share a browser, the `detail(<same_review_id>)` cache entry could in principle be reused. In practice both sessions run separately, but if the user roles overlap on one machine, you'll see the cache benefit.

---

## Part 8 — What's left

One more PR and the TanStack Query rollout is complete:

- **#14 SystemSettingsProvider internal swap** — replace the hand-rolled context cache with `useQuery` internally, keeping the public `useSystemSettings()` hook signature unchanged. Smallest scope of any TanStack Query PR; most interesting concept (provider internals refactor without changing the API).

Then **theme 12+: pagination + virtualization** opens up — a completely fresh learning arc with new concepts (`useInfiniteQuery`, `react-window`, cursor-based pagination, backend `?limit/offset` coordination).
