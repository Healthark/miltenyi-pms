# 27 — Server-side filters on `/goals/all`: filter-then-group + aliased FK joins

> **PR:** _pending_
> **Files changed:** `backend/app/api/routes/goal_routes.py`, `frontend/src/services/goal.service.ts`, `frontend/src/lib/queryKeys.ts`, `frontend/src/pages/AnnualGoals.tsx`.
> **Headline result:** Second application of doc 26's server-side filter template, applied to the more interesting "list-of-parents" pagination shape from doc 20. Filters split into two groups — **Goal-level** (`fy_year`, `mentor`) applied INSIDE the EXISTS subquery that finds qualifying parents AND inside the goals fetch, and **User-level** (`employee`, `function`, `designation`) applied on the parent pagination query. New `_apply_goal_level_filters` helper, `aliased(User)` for joining the same table twice via different FKs, LIKE-OR matcher for the year filter bridging modern + legacy `cycle_name` formats. Bundle: AnnualGoals **76.48 → 76.70 KB raw, 15.18 → 15.33 KB gzip** (+0.15 KB gzip).

---

## TL;DR

Doc 26 introduced server-side filters on `/annual-reviews/all` — a flat-row endpoint where every filter just adds a WHERE clause. `/goals/all` is more interesting because:

1. **It paginates by parent (employee), not by row.** Filters need to influence WHICH parents are paginated AND WHICH goals they get back.
2. **Some filters live on `Goal`** (year, mentor) and some live on `User` (employee, function, designation). They're applied in different places.
3. **`mentor` filter requires joining `User` twice** — once for the owner (`Goal.user_id`), once for the manager/mentor (`Goal.manager_id`). SQLAlchemy's `aliased()` is the fix.
4. **`fy_year` has no column** — the schema's `fy_year` is a computed property over `cycle_name`. Server-side filtering needs to reconstruct that logic with SQL `LIKE` patterns.

Each of these is a small thing on its own; together they're a richer "applying the template" PR than doc 27 would have been if it were a flat list.

---

## Part 1 — Where each filter is applied (the goal-level vs user-level split)

Doc 20 established the list-of-parents pipeline for `/goals/all`:

```
1. EXISTS subquery: find user_ids who have ≥ 1 non-DRAFT goal
2. Count + page that user list
3. Fetch all non-DRAFT goals for the page's users
```

Server-side filtering adds WHERE clauses at multiple points. Here's the question: where does each filter dimension belong?

| Filter | Applied to | Why |
|---|---|---|
| `fy_year` | **Both** EXISTS subquery AND goals fetch | If user has FY26 + FY25 goals and HR filters to FY26: subquery decides whether user appears as a parent (yes, they have an FY26 goal); fetch decides which goals to return (only their FY26 goal, not FY25). |
| `mentor` | **Both** EXISTS subquery AND goals fetch | Same logic — narrow which parents qualify AND which goals appear in the expansion. |
| `employee` | Only on `users_q` (parent pagination) | Filters which parents to paginate. No effect on which goals to ship (we want all this user's goals). |
| `function` | Only on `users_q` | Same — narrows parents. |
| `designation` | Only on `users_q` | Same. |

The mental model: **Goal-level filters narrow which goals "count"; User-level filters narrow which parents we paginate.** Both groups eventually narrow `total` (the filtered universe size), but they're applied in different SQL spots.

### The dual-application helper

To avoid copy-pasting the goal-level WHERE clauses in two places, we extract a helper:

```python
def _apply_goal_level_filters(query, filters: _AllGoalsFilters):
    if filters.fy_year is not None:
        yy = filters.fy_year % 100
        query = query.filter(
            or_(
                Goal.cycle_name.like(f"FY{yy:02d}%"),
                Goal.cycle_name.like(f"%{filters.fy_year}%"),
            )
        )
    if filters.mentor:
        ManagerAlias = aliased(User)
        query = query.join(
            ManagerAlias, ManagerAlias.id == Goal.manager_id
        ).filter(ManagerAlias.full_name == filters.mentor)
    return query
```

Called in two spots:

```python
# Spot 1: inside the EXISTS subquery
has_goal_subq_q = db.query(Goal.user_id).filter(...)
has_goal_subq_q = _apply_goal_level_filters(has_goal_subq_q, filters)
has_goal_subq = has_goal_subq_q.exists()

# Spot 2: on the windowed goals fetch
goals_q = db.query(Goal).filter(...)
goals_q = _apply_goal_level_filters(goals_q, filters)
goals = goals_q.order_by(...).all()
```

This is the **dual-application pattern** — a helper that runs in multiple places where the same WHERE clauses must compose with different base queries. It's a generalisation of the "base_q reused for COUNT + windowed fetch" pattern from doc 19, lifted to a per-filter-group abstraction.

User-level filters stay inline on `users_q` because they only have one application site:

```python
if filters.employee:
    users_q = users_q.filter(User.full_name == filters.employee)
if filters.function_name:
    users_q = users_q.join(Function, ...).filter(Function.name == filters.function_name)
if filters.designation_name:
    users_q = users_q.join(Designation, ...).filter(Designation.name == filters.designation_name)
```

When the helper count drops below 2 application sites, **don't extract**. Inline is fine.

---

## Part 2 — `aliased(User)` for the second FK to the same table

`Goal` has two FKs to `User`:

```python
class Goal(Base):
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False)  # owner
    manager_id = Column(Integer, ForeignKey("users.id"), nullable=True)   # mentor
    owner   = relationship("User", foreign_keys=[user_id], backref="goals")
    manager = relationship("User", foreign_keys=[manager_id])
```

When the `mentor` filter is set, we need to join `User` *as the manager* and filter on `User.full_name`. But `users_q` may **already** have a User in scope (the EXISTS subquery joins `Goal.user_id == User.id` for the owner). Joining `User` again would produce an ambiguous reference: which join is `User.full_name` talking about?

SQLAlchemy's `aliased()` fix:

```python
ManagerAlias = aliased(User)
query = query.join(
    ManagerAlias, ManagerAlias.id == Goal.manager_id
).filter(ManagerAlias.full_name == filters.mentor)
```

`ManagerAlias` is a SQLAlchemy entity that compiles to `users AS manager_alias_1` in the emitted SQL. The original `User` reference (for the owner) compiles to `users AS users_1`. Each join has its own alias; WHERE clauses can disambiguate which to filter on.

This is the **fundamental SQL pattern for "the same table appearing twice in one query"** — JOIN one table multiple times via different FKs. Without `aliased()`, you'd hit `sqlalchemy.exc.InvalidRequestError: Don't know how to join to <Mapper at 0x...; User>`; the orm can't pick a join condition because both FKs are equally valid.

### Why we don't ALSO need to alias the owner

In our case `User` is only used by name once — the EXISTS subquery references it via `Goal.user_id == User.id`. The user-level filters on `users_q` (employee/function/designation) reference `User` only on the *outer* query, not inside the inner EXISTS. The inner EXISTS uses `User.id` as a correlation, which Postgres resolves to the outer-scope `users` row. So we have:

- Outer scope `users` (the iteration target, where we apply user-level filters).
- Inner scope `users` referenced by `Goal.user_id == User.id` (the correlation).
- Inner scope optional `users AS manager_alias_1` when mentor filter is set.

The first two are the same physical table reference, just used in different scopes. Postgres handles correlation transparently. The third is where `aliased()` is mandatory — same scope as the second, different FK.

This is one of those "things that look like they should be ambiguous until you stare at the SQL" moments. The fix is local; the lesson — **always alias when joining the same table twice in one scope** — is general.

---

## Part 3 — The `fy_year` LIKE-OR matcher: bridging modern + legacy

The frontend's dropdown options for "Year" are derived from `goal.fy_year`, which is a Pydantic `computed_field`:

```python
@computed_field
@property
def fy_year(self) -> Optional[int]:
    """4-digit fiscal start year extracted from cycle_name."""
    if not self.cycle_name:
        return None
    for token in self.cycle_name.upper().split():
        if token.startswith("FY"):
            head = token[2:].split("-", 1)[0]
            if head.isdigit():
                if len(head) == 2:
                    return 2000 + int(head)
                if len(head) == 4:
                    return int(head)
        if token.isdigit() and len(token) == 4:
            return int(token)
    return None
```

It accepts THREE formats:

| `cycle_name` value | Computed `fy_year` |
|---|---|
| `"FY26"` | 2026 |
| `"FY26-27"` | 2026 |
| `"FY2026"` | 2026 |
| `"H1 2026"` (legacy) | 2026 |
| `"H2 2026"` (legacy) | 2026 |

Server-side filter needs to match the SAME set of cycle_name values when `fy_year=2026` arrives on the wire. There's no `fy_year` column to index on — only `cycle_name` (text). So we reconstruct:

```python
yy = filters.fy_year % 100   # 26
query = query.filter(
    or_(
        Goal.cycle_name.like(f"FY{yy:02d}%"),     # "FY26", "FY26-27", "FY26..."
        Goal.cycle_name.like(f"%{filters.fy_year}%"),  # "H1 2026", "FY2026"
    )
)
```

The first LIKE has a leading anchor (`FY26%`) so the planner can use an index if `cycle_name` is indexed. The second is fully unanchored (`%2026%`) which forces a sequential scan, but it only fires when both patterns matter (legacy + modern coexist), which is a minority case.

### Why we didn't index `fy_year` as a separate column

The cleanest solution would be to add an integer `fy_year` column to `Goal`, populated at insert time, indexed. Then the filter is `WHERE fy_year = ?`. But:

- Schema migration touches every Goal row in every deployed org.
- The computed field already does the parsing on every response; the column would be data duplication.
- At our scale, the unanchored LIKE is fast enough — `cycle_name` is short text, the table fits in cache, scan cost is negligible compared to the parent-pagination logic surrounding it.

Documented as a deferred optimisation for if scale-out reveals query-plan pain. Until then, the LIKE-OR matcher is the right scope/cost trade-off.

---

## Part 4 — Frontend: same shape as doc 26, one extra wrinkle

The frontend changes mirror doc 26 almost exactly:

1. Add `AllGoalsFilters` and `AllGoalsRequestParams` types in the service.
2. Update `getAllGoals(params)` to spread filter values into the request.
3. Update `queryKeys.goals.org(filters?)` to bake filters into the cache key.
4. Lift filter state from `AllGoalsTab` to the page; `AllGoalsTab` becomes a controlled component receiving `filters` + `onFiltersChange`.
5. Drop the client-side `filtered` loop. `goals` (= `allGoals` flatMapped from pages) IS the filtered universe.
6. Adjust the toolbar counter to read server `totalEmployees` and loaded `goals.length`.
7. Branch the empty state — "no goals recorded" vs "no goals match these filters" with distinct remediation copy.

The one wrinkle: **`fy_year` is a number on the wire but the dropdown's `value` is a string** (HTML `<select>` always stores strings). We handle the type coercion in a dedicated setter:

```tsx
const setYearFilter = (value: string) => {
  onFiltersChange({
    ...filters,
    fy_year: value === "" || value === "all" ? undefined : Number(value),
  });
};
```

The dropdown's `value` prop reads `filters.fy_year === undefined ? "all" : String(filters.fy_year)` for the round-trip. Cosmetic friction; doesn't affect cache-key semantics because the queryKey gets the actual `number` (1) which deep-equals correctly across re-renders.

The rest of the dimensions (employee, function, designation, mentor) are all strings; the generic `setFilter` helper from doc 26 handles them.

---

## Part 5 — The implicit "filter then group" guarantee

This is worth calling out because it's *why* the goal-level filters have to be applied in both spots.

The frontend's grouping function:

```tsx
const groups = buildAllGoalsGroups(goals);
```

`buildAllGoalsGroups` produces one group per distinct user_id present in `goals`. For each group, it sorts the goals newest-first and reads `latest_fy_year` / `latest_manager_name` from `goals[0]`.

If the server returned a user's UNFILTERED goal set (e.g. their FY26 + FY25), the group's `latest_fy_year` could be wrong:
- User has FY26 + FY25.
- HR filters fy_year=2025.
- Subquery sees user qualifies (has an FY25 goal).
- If fetch returned all their goals (FY26 + FY25 both), the group's `goals[0]` is the newer FY26 — but FY26 doesn't match the filter. The group would *appear* to be a 2026 user.

By applying `fy_year` to the fetch as well, we return ONLY the matching goals (just FY25), so `goals[0]` is the correct FY25 entry. The group's columns reflect the filtered view of that user, not their entire history.

This is the principle: **after filtering, what the group displays must reflect the filter set, not the user's full data.** Applying filters in both spots is what makes this guarantee atomic at the SQL level — there's no Python-level post-filter step that could drift from the parent-determining filter.

---

## Part 6 — What this PR does NOT solve

- **Server-side sort.** Same as doc 26 Part 6 — still client-side, deferred to a later theme-5 PR.
- **Substring search on employee/mentor.** Exact-equality only. Frontend combobox commits exact values; substring would need backend `ILIKE` + frontend debouncing.
- **Faceted-dropdown refinement.** Same trade-off as doc 26 Part 4. The "facets endpoint" sketch applies here too — a single GET returning all distinct values for each dimension regardless of current filters.
- **`fy_year` as a column.** See Part 3. LIKE-OR is fine at our scale.
- **Other endpoints.** `/project-reviews/all`, `/annual-reviews/calibration`, `/annual-reviews/mentees`. Same pattern; future PRs in this theme.

---

## Trade-offs

- **Filter applied twice (helper).** The `_apply_goal_level_filters` helper runs in two SQL spots; each invocation adds a small overhead. Worth it: extracting the helper guarantees the goal-level filters stay in sync between the parent-determining EXISTS and the goals fetch. If they ever diverged, the "filter then group" guarantee (Part 5) would break.
- **Unanchored LIKE on year filter.** Legacy format support costs a scan. Acceptable at our scale; the modern-format LIKE has the leading anchor that supports an index.
- **Dual-application discipline.** Future contributors adding a new goal-level filter dimension MUST remember to add it to the helper, not inline in one site. Mitigation: the helper has a docstring + cross-ref to this doc.
- **Cache memory grows with filter combos.** Same as doc 26 — bounded by TanStack Query's `gcTime`, fine in practice.

---

## Verification

```bash
cd frontend
npm run build
```

Expected:
- `dist/assets/AnnualGoals-*.js` ~76.70 KB raw / **~15.33 KB gzip** (vs 76.48 / 15.18 baseline — +0.15 KB gzip).
- Backend: `cd backend && python -c "from app.api.routes import goal_routes; print('OK')"` succeeds.

End-to-end:
- As HR_MyOrg, open `/annual-goals` → "All Goals" tab → DevTools Network: first request is `GET /goals/all?limit=50&offset=0` (no filter params).
- Pick "Function = Engineering" → second request: `GET /goals/all?function=Engineering&limit=50&offset=0`. `total` shrinks to count of Engineering employees with goals. Toolbar reads "{total} employees · {loaded goal count} goals".
- Pick "Year = FY26" on top of Function → third request: `?function=Engineering&fy_year=2026&...`.
- Pick "Mentor = Some Mentor Name" → fourth request: `?function=Engineering&fy_year=2026&mentor=...&...`. AND semantics across all four dims.
- Expand any user's group with multiple cycles of goals + year filter active → only matching goals appear in the expansion (a user with FY26 + FY25 history filtered to FY26 shows ONLY FY26).
- Combination with no matches → empty state shows "No goals match these filters" + "Try clearing one or more filters above to broaden the result."
- Clear filters → request fires without those params; counts return to org-wide; expansion shows all the user's goals again.
- Cache HIT verification: change a filter, change back. React Query DevTools should show the second visit as a cache hit (no network round-trip).
- Mutation invariant: as a non-HR_MyOrg user, create / approve a goal → if HR_MyOrg has the All Goals tab open in another session, the broadcast invalidation refetches all loaded filter-variant pages.

---

## What the next PR teaches

After two filter applications, the pattern is solid. Next steps:

- **PR #28: Apply to `/project-reviews/all`.** Doc 22's flat-list endpoint; same shape as doc 26's `/annual-reviews/all`. Should be near-mechanical (no list-of-parents twist).
- **PR #29: Apply to `/annual-reviews/calibration`.** Doc 21's "degenerate list-of-parents" — same template, with the small twist that the user-level filters apply on the parent and the goal-level... wait, calibration has no goal-level filters, it's all about users. Pure user-level filtering. Will look like doc 26 with a slightly different filter set.
- **PR #30: Apply to `/annual-reviews/mentees`.** Doc 23's consistency-play endpoint. Tiny consumer; will trade-off similarly.
- **PR #31: Server-side sort.** The conceptually new piece. Sort interacts with OFFSET/LIMIT tiebreaker (the `id.desc()` we've been adding) and lets the frontend ditch its client-side sort entirely.
- **PR #32 (optional): URL-state sync.** Bookmark/share filtered views.
