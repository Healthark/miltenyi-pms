# 29 — Two endpoints in one PR: `/calibration` + `/mentees` + introducing `useDebouncedValue`

> **PR:** [#46](https://github.com/Healthark/miltenyi-pms/pull/46)
> **Files changed:** `backend/app/api/routes/annual_review_routes.py`, `frontend/src/services/annual-review.service.ts`, `frontend/src/lib/queryKeys.ts`, `frontend/src/pages/ManagementReview.tsx`, `frontend/src/components/reviews/TeamReviewTab.tsx`, `frontend/src/hooks/useDebouncedValue.ts` (new).
> **Headline result:** Fourth and fifth applications of the server-side filter template in a single PR — completes the filter rollout. The template is now uniform across every paginated HR/mentor list endpoint in the codebase. Three things this PR adds beyond mechanical "third + fourth application": (1) a shared `useDebouncedValue<T>` hook so typing in a search box doesn't fire a request per keystroke, (2) multi-column `ILIKE` search on the backend, (3) `EXISTS` / `NOT EXISTS` subquery for the calibration grid's "not_started" status filter (= "users without an active-cycle review row"). Bundle: ManagementReview **17.96 → 17.87 KB raw, 4.66 → 4.69 KB gzip** (+0.03 KB), AnnualReviews **42.30 → 42.50 KB raw, 8.48 → 8.57 KB gzip** (+0.09 KB).

---

## TL;DR

Two endpoints, one PR. By the fourth application, the filter template feels like boilerplate — the doc spends most of its words on the **new** concepts this PR introduces:

| Concept | Where it shows up | Why it matters |
|---|---|---|
| `useDebouncedValue<T>(value, delayMs)` hook | Both `ManagementReview` and `TeamReviewTab` search inputs | Without it, every keystroke into the search box fires a network request. With it, fire once after the user pauses for 300ms. |
| Multi-column `ILIKE` search | `/calibration?search=` matches `User.full_name` OR `User.email` | Server-side substring matching across multiple columns is a small SQL pattern worth naming. |
| `EXISTS` / `NOT EXISTS` for derived status filters | `/calibration?status=not_started` → `NOT EXISTS (active-cycle review)` | The calibration grid's "Not Started" lifecycle state isn't a column value — it's the *absence* of a review row. EXISTS subqueries are how SQL expresses that. |
| FY-token ↔ integer wire-format round-trip | `TeamReviewTab` year dropdown stores `"FY26-27"`, wire param is `2026` | Dropdown UI conventions and backend wire types don't always agree. The right place to translate is at the setter/getter boundary, not by changing one side or the other. |

Everything else (lift state up, bake filters into queryKey, drop client-side filter loop, faceted dropdowns, empty-state branching, counter rework) is the established doc-26-through-28 pattern applied twice.

---

## Part 1 — Two-in-one PRs: when and why

The filter template has now been applied three times (docs 26, 27, 28). The remaining two endpoints (`/calibration`, `/mentees`) are small and share the same shape. Two options:

- **Split into PR #29 + PR #30**: cleaner ledger granularity, but each doc essentially says "applied the template; nothing new."
- **Combine into one PR**: half the ledger overhead, gets us to the sort pivot one PR sooner, demonstrates the template's maturity.

We chose combined. The discipline: **two-endpoint PRs are fine when both endpoints share the new concepts being introduced.** This PR introduces three new things (debouncing, multi-column ILIKE, EXISTS subqueries) that BOTH endpoints exercise. If `/calibration` introduced debouncing and `/mentees` introduced something unrelated, splitting would have been correct.

The combined PR has two unrelated endpoints in its commit history; doc 29 covers both. Future PRs that revisit either endpoint can still cleanly cite "doc 29" as the filter origin.

---

## Part 2 — `useDebouncedValue<T>(value, delayMs)`: a new hook

```ts
// frontend/src/hooks/useDebouncedValue.ts
import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debouncedValue;
}
```

Ten lines. The trick is in the `clearTimeout` cleanup: every time `value` changes, React tears down the previous effect (cancelling the pending timeout) and schedules a new one. Only the last `value` survives a quiet window.

### Why we need it

Filter state flows into the TanStack Query queryKey:

```tsx
const [searchInput, setSearchInput] = useState("");
const debouncedSearch = useDebouncedValue(searchInput, 300);
const effectiveFilters = { ...filters, search: debouncedSearch || undefined };

useInfiniteQuery({
  queryKey: queryKeys.annualReviews.calibration(filterParams),
  queryFn: ({ pageParam }) => annualReviewService.getCalibrationGrid({...}),
  // …
});
```

Without debouncing, typing "Engineering" into the search box would:

1. Set `searchInput = "E"` → queryKey changes → fetch.
2. Set `searchInput = "En"` → queryKey changes → fetch.
3. … 11 fetches in total, most of which the user never sees the response for.

With debouncing at 300ms:

1. User types "Engineering" (takes ~1s).
2. After they pause, `debouncedSearch` updates to "Engineering" → queryKey changes → ONE fetch.

That's an order-of-magnitude reduction in request volume on text input.

### Why 300ms

The "natural" debounce window for typing. Faster (100ms): users who type slowly trigger refetches mid-word. Slower (1000ms): the result lags noticeably after the user stops.

300ms is the de-facto industry default (lodash's `debounce` example, Google search box, etc.). Tune up if a power user complains about extra fetches; tune down if the lag feels sluggish. We picked 300 for both endpoints to keep behaviour consistent.

### What stays bound to the input (vs the debounced value)

Crucial pattern:

```tsx
<input value={searchInput} onChange={e => setSearchInput(e.target.value)} />
```

The input's `value` binds to **`searchInput`** (the immediate state), NOT `debouncedSearch`. If we bound it to the debounced value, the user would see characters appear ~300ms after they typed them — the input would feel dead.

Source of truth: `searchInput` is always current. `debouncedSearch` lags by `delayMs`. The query reads the debounced value. The user sees the immediate value.

### Why not just `setTimeout` inline / why a hook

A common temptation is to inline the timeout in the input's onChange:

```tsx
// DON'T do this
onChange={e => {
  const value = e.target.value;
  setSearchInput(value);
  setTimeout(() => triggerFetch(value), 300);
}}
```

This is wrong in three ways:
1. No cleanup — every keystroke schedules an additional fetch that fires regardless of subsequent typing.
2. The fetch trigger is imperative; TanStack Query is declarative (driven by queryKey).
3. The timeout fires even if the component unmounts.

The hook fixes all three.

### Why not import lodash's `debounce`

Lodash's `debounce` works on **functions**, not values. We'd write:

```tsx
const debouncedSetSearch = useMemo(() => debounce(setDebouncedSearch, 300), []);
```

That's more code, requires `useMemo` to avoid recreating the debounced function on every render, and adds ~4 KB of vendor weight. `useDebouncedValue` works on the value directly and is the more declarative shape for "this thing should lag."

---

## Part 3 — Multi-column ILIKE search

`/calibration`'s search box matches across `User.full_name` AND `User.email`:

```python
if search:
    pattern = f"%{search}%"
    base_q = base_q.filter(
        or_(
            User.full_name.ilike(pattern),
            User.email.ilike(pattern),
        )
    )
```

Three things to notice:

#### 1. `ILIKE` is case-insensitive

Postgres-specific (in MySQL you'd use `LOWER(col) LIKE LOWER(pattern)`). SQLAlchemy maps `.ilike()` to `ILIKE` on Postgres, falls back to a lower-case comparison on engines that don't support it. Use it for free case-insensitivity.

#### 2. `f"%{search}%"` is fully unanchored

No leading anchor means the pattern can't use a btree index — Postgres falls back to a sequential scan. At our scale (`User` table is bounded by org headcount, typically < 10k rows), this is fine. The cost shows up if a user types one or two characters and the result set is large.

Mitigations if we ever hit perf trouble:
- **Trigram index** (`CREATE EXTENSION pg_trgm; CREATE INDEX ON users USING gin (full_name gin_trgm_ops);`) — enables index-supported substring search.
- **Leading-anchored search** (`f"{search}%"`) — index-friendly but matches only the start of the column (which users hate).

Neither is in this PR.

#### 3. `or_()` is the SQLAlchemy way of writing `OR`

Without it you'd get a Python-level `or` short-circuit, which produces wrong SQL. `from sqlalchemy import or_` is the import (added at the top of the file alongside the existing `joinedload`).

### Why `/mentees`'s search is single-column

`TeamReviewTab`'s search box reads "Search mentees…" — its placeholder implies name-only. We mirror that on the server: `User.full_name.ilike(pattern)`. If a future PR wants email search there too, the OR expansion is mechanical.

---

## Part 4 — `EXISTS` / `NOT EXISTS` for derived status filters

The calibration grid's "Status" filter has six options:

| Status | Meaning |
|---|---|
| `not_started` | No AnnualReview row for this user in the active cycle |
| `draft` | AnnualReview.status = "draft" |
| `pending_mentor` | AnnualReview.status = "pending_mentor" |
| `pending_management` | AnnualReview.status = "pending_management" |
| `completed` | AnnualReview.status = "completed" |

For the four review-existing statuses, a regular `WHERE` on `AnnualReview.status` works. But `not_started` is **the absence** of a review row — there's no `User.has_no_review_yet` column.

The SQL pattern for "where some related thing exists / doesn't exist" is `EXISTS` / `NOT EXISTS`:

```python
if status_:
    review_exists = (
        db.query(AnnualReview.id)
        .filter(
            AnnualReview.user_id == User.id,
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == cycle_name,
        )
    )
    if status_ == ReviewStatus.NOT_STARTED.value:
        base_q = base_q.filter(~review_exists.exists())
    else:
        review_exists = review_exists.filter(AnnualReview.status == status_)
        base_q = base_q.filter(review_exists.exists())
```

The subquery is **correlated** — `AnnualReview.user_id == User.id` references the outer `User`. Postgres evaluates the EXISTS for each outer-User row by running the subquery with that user_id pinned. Cheap when indexed (and `AnnualReview.user_id` is via the FK).

The same pattern from doc 27's `/goals/all` returns: there we used EXISTS to find users with at least one matching Goal. Here we use both EXISTS (statuses with reviews) and NOT EXISTS (the "not_started" case). The trick is the `~` operator — SQLAlchemy's negation, compiles to SQL `NOT`.

### Why this is in doc 29 and not earlier

Doc 26 (`/annual-reviews/all`) filtered status on a direct column. Doc 27 (`/goals/all`) used EXISTS but only the positive form (filtering parents who *have* a matching child). Doc 28 (`/project-reviews/all`) again did direct-column status.

Only `/calibration` has the "derived from absence" status semantics. Worth its own section because the `~exists()` form is what most people miss the first time they need it.

---

## Part 5 — FY-token ↔ integer round-trip

The frontend's Year dropdown for `/mentees` stores **FY tokens** like `"FY26-27"`. The backend's wire param expects an **integer** like `2026`.

Why the mismatch:
- Frontend display values are derived from `extractFyToken(cycle_name)` (the canonical token form, used everywhere in the app).
- Backend wire format mirrors `/goals/all`'s `fy_year` param (numeric integer for symmetry across endpoints).

The setter and getter both translate:

```tsx
// On change: token "FY26-27" → integer 2026 (or "all"/"" → undefined)
const setYearFilter = (value: string) => {
  if (value === "" || value === "all") {
    setFilters({ ...filters, fy_year: undefined });
    return;
  }
  const year = fyTokenToStartYear(value);
  setFilters({ ...filters, fy_year: year ?? undefined });
};

// On render: integer 2026 → token "FY26-27" for the dropdown's value prop
value={
  filters.fy_year === undefined
    ? "all"
    : (availableYears.find(
        (tok) => fyTokenToStartYear(tok) === filters.fy_year,
      ) ?? "all")
}
```

The principle: **translate at the boundary between UI conventions and wire types.** Don't change either side to match the other:
- The dropdown's values stay FY tokens (consistent with how the rest of the app handles FY identifiers).
- The wire param stays an integer (consistent with `/goals/all`).
- The component does the translation in two places (setter, render).

This is the same pattern as form input ↔ model state binding in general. The dropdown is the "input"; the filter object is the "model"; the translation lives between them.

---

## Part 6 — Mentor filter semantics on `/calibration`

Worth a brief mention: `/calibration`'s mentor filter targets the user's **live** `User.mentor_id` relationship, not the snapshotted `review.mentor_id`:

```python
if mentor:
    MentorAlias = aliased(User)
    base_q = base_q.join(MentorAlias, MentorAlias.id == User.mentor_id).filter(
        MentorAlias.full_name == mentor
    )
```

The frontend's display column shows the snapshotted value when a review exists, falling back to the live value otherwise. For most rows these are the same. They diverge when a mentor change happened after a review was created.

Same divergence as doc 28's PM filter — server picks the "live" semantic for cleanness; document and move on. The "right" fix would require a COALESCE-style filter (`live OR snapshot`) but the complexity isn't worth it for the edge case.

---

## Part 7 — What this PR does NOT solve

- **Server-side sort.** Still client-side on the loaded pages. Theme #5's next PR.
- **Trigram indexing for ILIKE search.** At our scale the unanchored LIKE is fine. Future optimization if a user complains.
- **URL-state sync.** No filter persistence across refresh. Future polish.
- **Faceted-dropdown refinement.** Same trade-off as doc 26 Part 4 — dropdown options shrink under filters because they derive from loaded rows. The "facets endpoint" sketch applies; not in this PR.
- **Mentor filter divergence.** Documented in Part 6; acceptable for now.

---

## Trade-offs

- **Two-in-one PR.** Saves ledger overhead but conflates two endpoints' diffs. Worth it because both share the new concepts; would be a mistake if they didn't.
- **300ms debounce.** A choice. Power users may notice the lag if they type fast; tune up to 500ms or down to 200ms if usage data points either way.
- **Search across name + email.** A choice. Could add mentor name (would need another aliased join) — deferred.
- **FY-token ↔ integer translation in two places.** Mild redundancy. Could be extracted to a helper if a third endpoint needs the same pattern, but two is below the "extract" threshold.

---

## Verification

```bash
cd frontend
npm run build
```

Expected:
- `dist/assets/ManagementReview-*.js` ~17.87 KB raw / **~4.69 KB gzip** (vs 17.96 / 4.66 baseline — +0.03 KB gzip).
- `dist/assets/AnnualReviews-*.js` ~42.50 KB raw / **~8.57 KB gzip** (vs 42.30 / 8.48 baseline — +0.09 KB gzip).
- Backend: `cd backend && python -c "from app.api.routes import annual_review_routes; print('OK')"` succeeds.

End-to-end /calibration (HR_MyOrg):
- `GET /annual-reviews/calibration?limit=50&offset=0` fires on tab open (no filter params).
- Pick "Function = Engineering" → next request adds `function=Engineering`. Counter updates.
- Pick "Status = Not Started" → next request adds `status=not_started`. `NOT EXISTS` subquery returns users without an active-cycle review row.
- Type in the search box. Observe: **one request fires after you stop typing**, not one per keystroke. Network panel should show debounce in action (300ms window).
- Search matches against `User.full_name` and `User.email`.
- Combo with zero matches → empty state shows "No reviews match your filters" + remediation copy.

End-to-end /mentees (Mentor):
- `GET /annual-reviews/mentees?limit=50&offset=0` fires on tab open.
- Pick "Year = FY26-27" → next request includes `fy_year=2026` (token→integer translation).
- Pick "Mentee = Some Name" → next request includes `mentee=Some+Name`.
- Type in the search box → debounced request fires with `search=…` after pause.
- Active filters → toolbar stays visible even when zero results (so user can clear them).

Cross-cutting:
- Mutation invariant: submit a mentor evaluation → broadcast invalidation on `annualReviews.all` refreshes every loaded filter-variant cache entry.
- Cache HIT verification: change filter A, switch to filter B, switch back to filter A → React Query DevTools shows cache hit on the third visit.

---

## Where the theme stands after this PR

| # | PR | Endpoint | Filter dimensions |
|---|---|---|---|
| 26 | #43 | `/annual-reviews/all` | cycle, status, function, designation, employee |
| 27 | #44 | `/goals/all` | fy_year, mentor, employee, function, designation (goal-level vs user-level split) |
| 28 | #45 | `/project-reviews/all` | cycle, status, pm, employee, project (dual-mode component) |
| 29 (this) | _pending_ | `/calibration` | function, designation, mentor, status (EXISTS), search (multi-col ILIKE) |
| 29 (this) | _pending_ | `/annual-reviews/mentees` | fy_year, status, mentee, search (single-col ILIKE) |

**Every paginated HR/mentor list endpoint in the codebase is now server-side-filtered.** The next pivot is the **server-side sort** PR, which lets the frontend ditch its client-side sort entirely and lets sort interact correctly with OFFSET/LIMIT tiebreakers (per docs 21/22).

---

## What the next PR teaches

**PR #30 (server-side sort)** is the conceptual pivot from filter to sort. Different mechanics:

- Sort interacts with the OFFSET/LIMIT tiebreaker. The stable `id.desc()` we've been adding becomes the secondary sort under whatever the user picked as primary.
- Sort isn't a WHERE clause; it's ORDER BY. Composes with filters but doesn't filter.
- Backend `?sort_by=&sort_dir=` params; frontend lifts sort state up alongside filters (same pattern), bakes into queryKey.
- Frontend can finally **delete the client-side sort entirely** from `AllReviewsTab`, `AllGoalsTab`, `ReadOnlyReviewsList`, `ManagementReview`, `TeamReviewTab`. The functions disappear; the components shrink.

Probably 1-2 PRs depending on whether we batch all five endpoints together (probably yes, by now the template is rote).
