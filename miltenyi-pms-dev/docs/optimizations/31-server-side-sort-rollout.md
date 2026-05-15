# 31 — Server-side sort rollout: 4 endpoints, template at full speed

> **PR:** [#48](https://github.com/Healthark/miltenyi-pms/pull/48)
> **Files changed:** `backend/app/api/routes/goal_routes.py`, `backend/app/api/routes/project_review_routes.py`, `backend/app/api/routes/annual_review_routes.py`, `frontend/src/services/goal.service.ts`, `frontend/src/services/project-review.service.ts`, `frontend/src/services/annual-review.service.ts`, `frontend/src/pages/AnnualGoals.tsx`, `frontend/src/pages/ProjectReviews.tsx`, `frontend/src/pages/ManagementReview.tsx`, `frontend/src/components/reviews/TeamReviewTab.tsx`.
> **Headline result:** Applies doc 30's server-side sort template to the remaining four paginated endpoints (`/goals/all`, `/project-reviews/all`, `/calibration`, `/mentees`). Theme 5 is now complete — every paginated list endpoint in the codebase has server-side filter AND sort. Per-endpoint wrinkles documented (list-of-parents preservation, module-level aliased joins, OUTER JOIN for review-derived columns, deliberate lifecycle → lexical status-sort shift). Three of four bundles shrink; ProjectReviews adds 0.09 KB gzip for dual-mode component plumbing.

---

## TL;DR

By the fifth application of the sort template, the mechanical part is rote. This doc spends its words on the four **per-endpoint wrinkles** worth knowing:

| Endpoint | Wrinkle | Mitigation |
|---|---|---|
| `/goals/all` | Sort applies to USERS (parents); SQL returns goals ordered by `created_at desc`, which doesn't match user pagination order | Python re-sort `goals.sort(key=user_order)` after fetch — Python sort is stable so within-user `created_at` order survives |
| `/goals/all` | Derived columns (`latest_fy_year`, `latest_manager_name`) need correlated `MAX(...)` subqueries to sort server-side | **Deferred** — Year + Mentor headers become plain text (no chevron); see Part 2 |
| `/project-reviews/all` | Sort by `pm_name` needs to reference the same User join as the `pm` filter; local `aliased(User)` inside the conditional can't be reached by a module-level sort map | Promoted to module-level `_ProjectPMUser = aliased(User, name="pm_user")` |
| `/calibration` | Review-derived sort columns (status + ratings) need access to `AnnualReview.<col>`, but the filter uses EXISTS not a join | Added conditional `outerjoin(AnnualReview, ...)` when sort references review columns; status filter keeps its EXISTS — both coexist |
| `/calibration` | Status sort was lifecycle-weighted client-side (Not Started → Completed); SQL `ORDER BY status` is lexical | **Deliberate UX shift.** Documented in Part 3 |

Everything else is the doc-30 template applied four more times.

---

## Part 1 — List-of-parents sort: preserving user-pagination order

`/goals/all` paginates by USER (parent), then fetches all matching goals for the page's users. The previous PR fetched goals ordered by `Goal.created_at desc` and let the frontend's `buildAllGoalsGroups()` assemble groups in insertion order.

That insertion order is determined by which goal each user's first row appears at in the goals array. With `created_at desc`, user A might appear at position 0 because they have the most recent goal, even if alphabetically user A comes after user B who has older goals.

The CLIENT-side sort (deleted in this PR) used to re-sort the assembled groups by `owner_name`, which fixed the UX. Without it, the groups would appear in "most-recent-goal-per-user first" order — a regression.

**The fix: re-sort goals on the server before returning.** Python's `list.sort()` is stable, so sorting by user-order-index preserves the within-user `created_at desc` ordering:

```python
# After SQL fetches goals ordered by created_at desc
user_order = {u.id: i for i, u in enumerate(page_users)}
goals.sort(key=lambda g: user_order.get(g.user_id, len(page_users)))
```

The `len(page_users)` fallback handles goals whose user_id isn't in the page — shouldn't happen given the WHERE clause, but defensively prevents a KeyError.

After this, the frontend's `buildAllGoalsGroups()` produces groups in the same order as the user pagination's `sort_by`. No client-side reordering needed.

### Alternative we considered: ORDER BY user columns in the goals fetch

```python
# Step 4 (the goals fetch) could ORDER BY User.full_name to match step 3
goals = goals_q.join(User).order_by(User.full_name.asc(), Goal.created_at.desc()).all()
```

This works but:
- Requires adding an explicit JOIN to User on top of the existing `joinedload(Goal.owner)` (which uses outer join semantics internally).
- The ORDER BY column varies per sort_by — would need a separate map for the goals-fetch ORDER BY, mirroring the user-pagination ORDER BY.
- For `sort_by=function_name`, the goals query would need to join Function too.

Way more code than the Python re-sort. And the Python sort runs once over `limit × goals_per_user` rows — bounded by `200 × ~10 = 2000` items, well under any noticeable cost.

---

## Part 2 — Deferred: `latest_fy_year` + `latest_manager_name` sort

`/goals/all`'s frontend used to support sorting by `latest_fy_year` (the user's newest goal's FY) and `latest_manager_name` (mentor of their newest goal). Both are **derived columns** — there's no single SQL column to ORDER BY.

To sort by either server-side, you'd need a correlated `MAX(...)` subquery joined into the user pagination:

```python
# Sketch — NOT in this PR
latest_cycle_subq = (
    db.query(func.max(Goal.cycle_name).label("latest_cycle"))
    .filter(
        Goal.user_id == User.id,
        Goal.org_id == current_user.org_id,
        Goal.approval_status != ApprovalStatus.DRAFT.value,
    )
    .correlate(User)
    .scalar_subquery()
)

users_q = users_q.order_by(latest_cycle_subq.asc())
```

Two problems:
1. `MAX(cycle_name)` on a text column gives lexical order: `"FY26-27" > "FY25-26" > "H2 2024"` because `"H" > "F"`. To get "newest fiscal year first" you'd need to parse FY out of the text — possible via a CASE expression, ugly.
2. `latest_manager_name` is "the manager of the goal with the highest cycle_name." A `MAX(...)` over a name column doesn't naturally express that. You'd need a window function (`ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY cycle_name DESC) = 1`) joined back into the pagination.

Neither is impossible. Both are the wrong scope for "apply the template" PR. Deferred.

**Frontend cost: two columns lose their chevron.** The `<SortableHeader>` wrappers for Year / Mentor in AllGoalsTab are replaced with plain `<span>` headers:

```tsx
{/* Year + Mentor headers — not sortable in this PR. Doc 31 Part 2
    explains the deferral. */}
<div role="columnheader" className="text-left px-4 py-2.5">
  <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">
    Year
  </span>
</div>
```

Visually identical to a `SortableHeader` at rest; the affordance (clickable chevron) is what's gone. Users who hovered the column expecting to sort will find nothing happens. A subtle regression, deliberate and reversible.

---

## Part 3 — Module-level aliased joins for sort-column maps

Doc 30 introduced `_ALL_REVIEWS_SORT_COLUMNS = {sort_by_string: SQLAlchemy_column}` as a module-level dict that the route handler reads. The trick works when the column is on a model that the query directly references (e.g. `AnnualReview.status`).

It **breaks** when the column lives on an aliased table that was previously created inline:

```python
# Pre-this-PR pattern (broken for sort)
if pm:
    PMUserAlias = aliased(User)   # ← local; can't be referenced from module-level dict
    base_q = base_q.join(PMUserAlias, PMUserAlias.id == Project.pm_id)
    base_q = base_q.filter(PMUserAlias.full_name == pm)
```

For sort to reference `PMUserAlias.full_name`, the alias has to live at module scope:

```python
# Module level
_ProjectPMUser = aliased(User, name="pm_user")

# Sort map references it stably
_PROJECT_REVIEWS_SORT_COLUMNS = {
    "pm_name": _ProjectPMUser.full_name,
    # …
}

# Route handler uses the same alias
if needs_pm_user_join:
    base_q = base_q.join(_ProjectPMUser, _ProjectPMUser.id == Project.pm_id)
    if pm:
        base_q = base_q.filter(_ProjectPMUser.full_name == pm)
```

The `name="pm_user"` keyword pins the SQL alias literal — without it SQLAlchemy generates `users_1`-style anonymous names, which can change between requests and confuse query plan caching.

`/calibration` uses the same pattern with `_CalibrationMentor`. `/mentees` doesn't need an alias because its only User join is on `AnnualReview.user_id` (no second-FK collision).

### General lesson

> **When the sort-column map needs to reference a join target, that target must live at module scope.** Local aliases inside conditional joins are fine for filter-only use, but they're invisible to module-level data structures. Promote the alias and use the named-alias form (`aliased(User, name=…)`) so its SQL identity is stable.

---

## Part 4 — `/calibration`'s OUTER JOIN for review-derived sort

`/calibration`'s status filter uses an EXISTS subquery (doc 29 Part 4):

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

But sorting by status (or any rating column) needs to ORDER BY `AnnualReview.<col>` — which isn't in scope without a JOIN. EXISTS subqueries don't bring columns into the outer SELECT.

The fix: when sort needs a review column, add an OUTER JOIN to AnnualReview (LEFT JOIN). Users without an active-cycle review get `NULL` for the joined columns, which sorts as Postgres's default (NULLS LAST on ASC, NULLS FIRST on DESC):

```python
review_sort_keys = (
    "status",
    "self_performance_rating",
    "mentor_performance_rating",
    "management_performance_rating",
)
needs_review_join = sort_by in review_sort_keys

if needs_review_join:
    base_q = base_q.outerjoin(
        AnnualReview,
        and_(
            AnnualReview.user_id == User.id,
            AnnualReview.org_id == current_user.org_id,
            AnnualReview.cycle_name == cycle_name,
        ),
    )
```

The OUTER JOIN coexists with the EXISTS subquery (when both are needed). Each does its own job:
- **JOIN**: brings the columns into ORDER BY scope.
- **EXISTS**: provides the WHERE filter semantics (NOT EXISTS for "not_started").

If we ever wanted to retire the EXISTS in favor of using the JOIN for filtering too, that's a follow-up — but the current dual approach is correct and minimally invasive.

### Why LEFT (not INNER) join

A user filtered to "not_started" status has no AnnualReview row — an INNER JOIN would drop them entirely. LEFT JOIN keeps them with NULL in the AnnualReview columns. Sort then orders them at the end (ASC) or start (DESC) of the result set, which is what HR expects when sorting a calibration grid by rating.

---

## Part 5 — Status sort: lifecycle weight → lexical

ManagementReview's client-side sort had a `STATUS_SORT_WEIGHT` map ordering statuses by lifecycle (Not Started → Draft → Pending Mentor → Pending Management → Completed) when sorting status ASC. Toggling DESC reversed that.

SQL `ORDER BY AnnualReview.status` is **lexical** (alphabetical), giving Completed → Draft → Not Started → Pending Management → Pending Mentor. Different order.

**This is a deliberate behaviour shift.** We considered:
- Keeping the lifecycle order via a server-side CASE expression: `ORDER BY CASE status WHEN 'not_started' THEN 0 WHEN 'draft' THEN 1 ... END`. Possible but adds a code path that mirrors the deleted JS map.
- Deleting the lifecycle expectation and accepting lexical order.

We picked the second because:
1. Lexical sort still **groups** all "completed" statuses together, which is the primary use case.
2. The lifecycle order was a soft convention, not a documented requirement.
3. The CASE expression would have to be maintained in the backend in lockstep with the enum order — a sync hazard.
4. Saves ~10 LOC of `STATUS_SORT_WEIGHT` that doc 31 deletes.

If users complain, the CASE-expression option is a small one-PR change.

---

## Part 6 — Per-endpoint summary

| Endpoint | Sort dimensions | Special notes |
|---|---|---|
| `/goals/all` | `owner_name`, `function_name`, `designation_name` | Python re-sort after fetch (Part 1); derived columns deferred (Part 2) |
| `/project-reviews/all` | `project_name`, `employee_name`, `pm_name`, `cycle`, `status`, `performance_group` | Module-level `_ProjectPMUser` alias (Part 3) |
| `/calibration` | `employee_name`, `employee_email`, `mentor_name`, `function`, `designation`, `status`, all 3 ratings | Module-level `_CalibrationMentor` alias; conditional OUTER JOIN for review-derived columns (Part 4); status now lexical (Part 5) |
| `/mentees` | `employee_name`, `cycle_name`, `status`, all 3 ratings | Simplest — direct columns + conditional User join for employee_name |

All four endpoints follow doc 30's tiebreaker rule: `id.desc()` (or `User.id.asc()` for User-base queries) survives as the FINAL ORDER BY clause under any primary sort.

---

## Part 7 — What this PR does NOT solve

- **`/goals/all` derived-column sort (latest_fy_year, latest_manager_name).** Deferred — Part 2.
- **Lifecycle-weighted status sort.** Deliberate shift to lexical — Part 5.
- **The `MyGoalsSortKey` / `MyReviewsSortKey` configs on the Staff-facing "My Goals" / "My Reviews" tabs.** Those are local, unpaginated, client-side — not in theme 5's scope.
- **NULLS FIRST / LAST control.** Currently using Postgres defaults. A future PR could let users pick "show empty values first/last" if it ever matters.
- **URL-state sync.** Filter + sort still live in React state; refresh loses them. Deferred.

---

## Trade-offs

- **`/goals/all`'s deferred derived columns** = small UX regression. Mitigated by keeping the headers visible (just non-clickable). Real users will probably not notice.
- **Status sort lexical** = behaviour change. Documented loudly; reversible via CASE expression if needed.
- **Module-level aliases per endpoint** = small code overhead (2 lines each). Worth it for stable sort-column maps.
- **Python re-sort on `/goals/all`** = `O(N log N)` over at-most 2000 rows. Negligible.
- **Cache memory grows with `(filter, sort)` combos.** Same as docs 26 and 30 — bounded by `gcTime`, fine in practice.

---

## Verification

```bash
cd frontend
npm run build
```

Expected:
- `ManagementReview-*.js` **17.53 KB raw / 4.56 KB gzip** (vs 17.87 / 4.69 — shrinks 0.13 KB).
- `AnnualReviews-*.js` **41.60 KB raw / 8.50 KB gzip** (vs 42.02 / 8.55 — shrinks 0.05 KB).
- `AnnualGoals-*.js` **76.41 KB raw / 15.36 KB gzip** (~flat).
- `ProjectReviews-*.js` **74.44 KB raw / 13.31 KB gzip** (+0.09 KB — dual-mode plumbing).
- Backend: `cd backend && python -c "from app.api.routes import goal_routes, project_review_routes, annual_review_routes; print('OK')"` succeeds.

End-to-end (per endpoint):

**/goals/all** (HR_MyOrg → `/annual-goals` → All Goals):
- First request `?limit=50&offset=0`.
- Click "Employee" / "Function" / "Designation" → `sort_by=…&sort_dir=…`. Groups reorder per user.
- Year + Mentor columns: **headers visible, NOT clickable** (chevron absent). Documented intentional behaviour.
- For each user-sort, expand a user with multiple cycles → goals appear in `created_at desc` order within the group (Python stable-sort preserved this).

**/project-reviews/all** (HR → `/project-reviews` → All Reviews):
- Sort by PM → SQL emits `JOIN users AS pm_user ON ...` and `ORDER BY pm_user.full_name`. Different join from employee.
- Sort + filter compose: pick PM filter + sort by `employee_name` → server filters by PM and orders by employee.

**/calibration** (HR_MyOrg → `/management-review`):
- Default opens sorted by `employee_name asc` — request fires with `sort_by=employee_name&sort_dir=asc` from initial state.
- Click "Self Review" rating column → `sort_by=self_performance_rating`. Server outer-joins AnnualReview; users without a review (rating=NULL) appear at the END on asc.
- Click "Status" column → SQL `ORDER BY AnnualReview.status` lexical. Verify the order is `completed, draft, not_started, pending_management, pending_mentor` ASC (deliberately changed from the lifecycle order).

**/mentees** (Mentor → `/annual-reviews` → Team Reviews):
- Sort by Year (via `cycle_name`) → server orders by cycle_name desc/asc.
- Sort by Self/Mentor/Management rating → numeric server sort.

**Cross-cutting:**
- Bad-input check: `?sort_by=evil` on any endpoint → 422 from FastAPI validation.
- Submit a mutation that broadcasts on the namespace's `.all` key → loaded pages refetch across every `(filter, sort)` variant.

---

## What's next

**Theme 5 is complete.** Every paginated HR/mentor list endpoint in the codebase has server-side filter AND server-side sort. The optimization arc:

| Theme | Concept | PRs |
|---|---|---|
| 1 | Bundle splitting | #18 |
| 2 | TanStack Query rollout | #19–31 |
| 3 | List virtualization | #32–35 |
| 4 | Pagination + N+1 cleanup | #36–42 |
| 5 | Server-side filter + sort | #43–48 |

31 docs across ~30 PRs. The frontend is server-driven all the way down: every paginated list pages through a filtered + sorted universe, no client-side narrowing or ordering remains on those surfaces.

If a Theme 6 happens, the natural candidates from doc-29's closing discussion were:
- **Optimistic updates** — UX-feel theme. TanStack Query's `onMutate` + rollback.
- **Backend test framework** — pytest + query-count fixtures; closes the "verified manually" loop docs 24+ keep noting.
- **Web Vitals + perf budgets in CI** — automates the bundle-delta tracking we've been doing by hand.

For now: **server-side filter + sort rollout is complete**. The arc has a clean stopping point.
