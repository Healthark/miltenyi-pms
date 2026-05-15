# 28 — Server-side filters on `/project-reviews/all`: the controlled / uncontrolled component shape

> **PR:** _pending_
> **Files changed:** `backend/app/api/routes/project_review_routes.py`, `frontend/src/services/project-review.service.ts`, `frontend/src/lib/queryKeys.ts`, `frontend/src/pages/ProjectReviews.tsx`.
> **Headline result:** Third application of the server-side filter template (docs 26 + 27). The **backend** half is mechanical — five new query params, conditional joins, same `aliased(User)` trick from doc 27 (Project's PM is a second FK to `users` alongside the employee-side join). The **interesting** half is the frontend: `ReadOnlyReviewsList` is shared by HR (paginated, needs server filters) AND Mentor (unpaginated, fine with client filters). The component grows an optional controlled-mode set of props so HR can drive filters from the page level while Mentor keeps the legacy local-state path. Bundle: ProjectReviews **73.67 → 74.26 KB raw, 12.92 → 13.23 KB gzip** (+0.31 KB gzip).

---

## TL;DR

`/project-reviews/all` is a flat-row endpoint (no list-of-parents twist), so the backend filter work follows doc 26 almost exactly:

```python
if cycle:
    base_q = base_q.filter(ProjectReview.cycle == cycle)
if status_:
    base_q = base_q.filter(ProjectReview.status == status_)

if pm or project:
    base_q = base_q.join(Project, Project.id == ProjectReview.project_id)
    if project:
        base_q = base_q.filter(Project.name == project)
    if pm:
        PMUserAlias = aliased(User)
        base_q = base_q.join(PMUserAlias, PMUserAlias.id == Project.pm_id).filter(
            PMUserAlias.full_name == pm
        )

if employee:
    base_q = base_q.join(User, User.id == ProjectReview.user_id).filter(
        User.full_name == employee
    )
```

The only "new" backend wrinkle is that **two FKs reach `users`** here: `ProjectReview.user_id` (the employee/subject) and `Project.pm_id` (the project's assigned PM). Doc 27 introduced `aliased()` for this exact situation; we use it again, this time the alias is `PMUserAlias` joining via `Project.pm_id`.

The doc's real content is the **frontend** — specifically, how to add server-side filtering to a component that's already used by two consumers with different needs.

---

## Part 1 — Two consumers, two filter modes

`ReadOnlyReviewsList` is used by:

| Consumer | Source query | Paginated? | Filtered? |
|---|---|---|---|
| Mentor's "Mentees' Reviews" tab | `getMenteeReviews` | No | Client-side (today, no change) |
| HR's "All Reviews" tab | `getAllReviews` (paginated) | Yes | **Server-side** (new) |

Pre-PR, the component held its own filter state (`useState` × 5) and did client-side narrowing in a memoised loop. That's fine for Mentor; HR needs filters to flow into the queryKey instead.

Three options for handling this:

| Option | Approach | Verdict |
|---|---|---|
| **A. Lift filter state out for both consumers** | Both Mentor and HR pass filters in as props. Component becomes purely presentational. | Touches Mentor's working code for no Mentor-side gain. Larger diff, more regression surface. |
| **B. Split into two components** | `MentorReviewsList` (local-state filters) + `HRReviewsList` (controlled filters), sharing a presentational table. | Cleanest architecturally but duplicates ~200 lines of render + filter UI. Over-engineered. |
| **C. Make the component dual-mode** | One component, optional `filters` + `onFiltersChange` + `serverTotal` props. When all three are provided → controlled / server-filter mode. When omitted → uncontrolled / local-state mode. | Smallest change, both consumers stay simple. |

**We shipped C.** It's the standard React "controlled / uncontrolled" idiom applied at the prop level rather than the input level. The cost is a tiny bit of branching inside the component; the benefit is that the Mentor consumer doesn't change at all.

### The shape

```tsx
function ReadOnlyReviewsList({
  isLoading, reviews, projectRatingsVisible,
  employeeColumnLabel, emptyTitle, emptySubtitle,
  // Optional controlled-mode props (PR #45 / doc 28)
  filters,
  onFiltersChange,
  serverTotal,
}: {
  // … existing props
  readonly filters?: AllProjectReviewsFilters;
  readonly onFiltersChange?: (next: AllProjectReviewsFilters) => void;
  readonly serverTotal?: number;
}) {
  // Local-state fallback — only used when not controlled.
  const [localFilters, setLocalFilters] = useState<AllProjectReviewsFilters>({});
  const isControlled = filters !== undefined && onFiltersChange !== undefined;
  const activeFilters = filters ?? localFilters;
  const setActiveFilters = onFiltersChange ?? setLocalFilters;

  // … filter UI reads from activeFilters, writes via setActiveFilters
}
```

This is a textbook "controlled component" pattern, just expanded from "single input" to "filter-set state":

- React `<input>` has the same pattern: `value` + `onChange` together → controlled; neither → uses local `defaultValue`.
- Here `filters` + `onFiltersChange` together → controlled; neither → uses `localFilters`.
- `serverTotal` is the extra piece that makes the counter honest in controlled mode.

### Skipping the filter loop in controlled mode

The component still has a `.filter()` loop. For uncontrolled mode (Mentor) it does the actual narrowing. For controlled mode (HR), `reviews` already matches the active filter set because the server pre-filtered. The loop would just pass everything through.

Cleaner to short-circuit:

```tsx
const filtered = useMemo(() => {
  if (isControlled) return reviews;
  return reviews.filter((r) => { /* …client-side narrowing… */ });
}, [reviews, activeFilters, isControlled]);
```

The skip is cosmetic at limit=50 rows (the loop is fast), but it's the honest version of "server already did the work."

---

## Part 2 — `aliased(User)` again (Project.pm_id is the second FK)

Same lesson as doc 27, applied to a different model:

| Doc | Model | First FK to `users` | Second FK to `users` |
|---|---|---|---|
| 27 | `Goal` | `Goal.user_id` (owner) | `Goal.manager_id` (mentor) |
| 28 (this) | `Project` (joined via `ProjectReview`) | `ProjectReview.user_id` (employee) | `Project.pm_id` (PM) |

When the `pm` filter is set, we need to join `users` for the PM's name. But `users` might already be in scope (if `employee` filter is also set on the same query). SQLAlchemy can't pick a join condition without disambiguation.

`aliased()` produces `users AS pm_user_alias_1` in the emitted SQL. The original employee join compiles to `users AS users_1`. Both can coexist; WHERE clauses reference the alias they need.

Worth re-stating because this is the **structural takeaway for any model with multiple FKs to the same table**:

> When you join a table you've already joined (or implied a join to), alias the second join. Without it, SQLAlchemy raises `InvalidRequestError`; with it, you get clean SQL and unambiguous WHERE.

---

## Part 3 — Where the dropdowns get their options

Same faceted-style trade-off as doc 26 Part 4 + doc 27. Dropdown options derive from `reviews` — the loaded array:

```tsx
const cycles = useMemo(
  () => Array.from(new Set(reviews.map((r) => r.cycle).filter(Boolean))),
  [reviews],
);
const projects = useMemo(/* … */);
const pms = useMemo(/* … */);
const employees = useMemo(/* … */);
```

In **uncontrolled** mode (Mentor), `reviews` is the full mentee set — dropdowns show everything that exists. Same as today's behavior.

In **controlled** mode (HR), `reviews` is the server-filtered set — dropdowns shrink as filters narrow. Faceted-search behaviour. The "facets endpoint" follow-up sketched in doc 26 Part 4 would solve this when needed; not in this PR.

---

## Part 4 — The PM filter: subtlety on display vs. filter

The frontend already treats `pm_name` with a fallback: `r.pm_name ?? r.reviewer_name`. The reasoning is that `reviewer_id` is only stamped at submit, but the project has a PM assigned from creation — for unreviewed rows, the PM_name fallback is the project's PM, not the reviewer.

For **client-side filtering** (uncontrolled mode), the legacy code matched the resolved name:

```tsx
if (pmFilter !== "all" && (r.pm_name ?? r.reviewer_name) !== pmFilter) return false;
```

For **server-side filtering** (controlled mode), the backend filters on `Project.pm_id`'s `User.full_name` — the actual PM, not the reviewer-fallback. The two narrow to slightly different sets when a review is unreviewed:

| Review state | Client filter `pm=Alice` matches when | Server filter `pm=Alice` matches when |
|---|---|---|
| Reviewed (reviewer set) | `pm_name == Alice` OR `reviewer_name == Alice` (after `?? fallback`) | `Project.pm.full_name == Alice` |
| Pending (no reviewer) | `pm_name == Alice` | `Project.pm.full_name == Alice` |

In practice these usually agree — the PM almost always reviews their own team's project. They CAN diverge if a secondary evaluator submitted (the `reviewer_id` is then the secondary, not the PM). Server-side filtering picks the cleaner semantics: "match by the project's assigned PM," not "match by whoever stamped this review."

We're shipping this divergence intentionally — server semantics is the canonical one, and "all reviews under this PM's projects" is what HR usually wants. Documented here so a future reader doesn't try to "fix" it.

If we ever need the legacy "OR reviewer" semantics on the server, the change is small: `OR Project.pm.full_name == pm OR reviewer_alias.full_name == pm`. But the cleaner behaviour is the right default.

---

## Part 5 — Counter + empty-state branching, now consumer-aware

The toolbar counter renders different text in each mode:

```tsx
{isControlled
  ? `${serverTotal ?? 0} ${(serverTotal ?? 0) === 1 ? "match" : "matches"}`
  : `${filtered.length} of ${reviews.length}`}
```

- Controlled (HR): `{serverTotal} matches` — the filtered universe size from the server.
- Uncontrolled (Mentor): `{filtered.length} of {reviews.length}` — legacy filtered/total.

Similarly the early-return empty state:

```tsx
const filtersEmpty = isControlled && hasActiveFilters;
// …
<p>{filtersEmpty ? "No reviews match these filters" : emptyTitle}</p>
<p>{filtersEmpty ? "Try clearing one or more filters above to broaden the result." : emptySubtitle}</p>
```

- Controlled + active filters + zero results → "No reviews match these filters" with remediation copy.
- Otherwise → legacy `emptyTitle` / `emptySubtitle` (consumer-provided).

The Mentor consumer's `emptyTitle` ("No mentee project reviews yet") stays correct because `filtersEmpty` is false for them (they're uncontrolled). One component, two consumer-specific empty narratives.

---

## Part 6 — What this PR does NOT solve

- **Server-side sort.** Still client-side. The conceptual jump comes in a later theme-5 PR.
- **Substring search.** Combobox commits exact values; server matches exact-equality. Partial-match would need `ILIKE` + frontend debouncing.
- **Faceted-dropdown refinement.** Same trade-off as doc 26 Part 4. Dropdowns shrink under HR filters; the "facets endpoint" sketch is the workaround.
- **Mentor's `/project-reviews/mentees` filtering.** Stays client-side. Mentor scale is small enough that this is fine.
- **Remaining endpoints:** `/annual-reviews/calibration`, `/annual-reviews/mentees`. Same template, smaller PRs.

---

## Trade-offs

- **Dual-mode component.** Worth it given two consumers with different needs. Cost: `isControlled` branching at three sites (filter loop skip, counter, empty state).
- **PM filter semantics diverge slightly between client and server modes.** Documented in Part 4 — server semantics is the cleaner choice. If a user ever notices the divergence, the fix is small.
- **No URL-state sync.** Future polish PR. Filters live in React state; refresh loses them. Acceptable cost for now.

---

## Verification

```bash
cd frontend
npm run build
```

Expected:
- `dist/assets/ProjectReviews-*.js` ~74.26 KB raw / **~13.23 KB gzip** (vs 73.67 / 12.92 baseline — +0.31 KB gzip).
- Backend: `cd backend && python -c "from app.api.routes import project_review_routes; print('OK')"` succeeds.

End-to-end:
- As HR_MyOrg, open `/project-reviews` → "All Reviews" tab → DevTools Network: first request is `GET /project-reviews/all?limit=50&offset=0` (no filter params).
- Pick "Status = Reviewed" → second request: `GET /project-reviews/all?status=reviewed&limit=50&offset=0`. `total` shrinks; toolbar reads "{total} matches".
- Pick "PM = Some PM" → third request adds `pm=Some+PM`. AND semantics.
- Pick "Cycle = Q1 FY26-27" + "Project = Some Project" → fourth request has all four params. Counter updates.
- Combination with no matches → empty state shows "No reviews match these filters" + remediation copy.
- Clear filters → request fires without those params; counts return to org-wide.
- Cache HIT verification: change filters, change back → React Query DevTools shows cache hit.
- As Mentor (NOT HR), open `/project-reviews` → "Mentees' Reviews" tab → DevTools Network: NO `GET /project-reviews/all` request (the HR-only query has `enabled: isHR`). The mentee reviews tab still works with its **client-side** filters (this is the uncontrolled-mode path).
- Verify mentor's filter dropdowns still narrow rows in-place (client-side filtering is intact).
- As Staff (NOT HR, NOT Mentor) → "My Reviews" tab works as before. No `/all` request.

---

## What the next PR teaches

After three filter applications:

- **PR #29: Apply to `/annual-reviews/calibration`.** Pure user-level filtering (every Staff = one row; no parent/child split). Should be shortest doc.
- **PR #30: Apply to `/annual-reviews/mentees`.** Small consumer, consistency play. Tiny doc.
- **PR #31: Server-side sort.** The conceptual pivot — sort interacts with the OFFSET/LIMIT tiebreaker. Lets the frontend ditch client-side sort entirely.
- **PR #32 (optional): URL-state sync.** Bookmark/share filtered views.
