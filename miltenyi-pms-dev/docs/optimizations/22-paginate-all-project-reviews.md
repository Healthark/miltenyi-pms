# 22 — Paginate `GET /project-reviews/all`: applying the flat-list template + scoping out N+1

> **PR:** _pending_
> **Files changed:** `backend/app/api/routes/project_review_routes.py`, `frontend/src/services/project-review.service.ts`, `frontend/src/pages/ProjectReviews.tsx`.
> **Headline result:** Fourth paginated endpoint. The hand is now fully practised — mechanical application of the flat-list template from doc 19. The interesting parts are (a) **scoping the change cleanly even though there's a known N+1 in `_build_review_response`** that pagination doesn't fix, and (b) **a small UX architecture choice**: where to put the Load More button when the underlying virtualized list is rendered by a shared component (`ReadOnlyReviewsList`) that two different consumers use. Bundle: ProjectReviews **72.87 → 73.67 KB raw, 12.66 → 12.92 KB gzip** (+0.26 KB gzip).

---

## TL;DR

With docs 19, 20, and 21, the template has all three shapes covered:

| Doc | Endpoint | Pagination unit | `total` | Why noteworthy |
|---|---|---|---|---|
| 19 | `/annual-reviews/all` | Row | Row count | Foundation |
| 20 | `/goals/all` | Parent (employee) | Parent count | "List of parents" — group preservation |
| 21 | `/annual-reviews/calibration` | Parent (= row, degenerate) | User count | Sort moves to SQL |
| **22** | **`/project-reviews/all`** | **Row** | **Row count** | **Same shape as doc 19** |

So the *pagination* in this PR is uninteresting — the doc focuses on the two surrounding decisions worth a junior engineer's attention:

1. **Scoping discipline**: `_build_review_response` has a pre-existing N+1 (per-row employee, reviewer, project, PM lookups). Pagination caps the damage but doesn't remove it. Resist the urge to fix everything in one PR. Document the deferred work, ship the focused change.
2. **Component purity vs. parent-owned UI**: `ReadOnlyReviewsList` is shared between Mentor (mentees view, not paginated) and HR (all reviews, now paginated). The Load More button goes at the **parent** page level, outside the shared component — same discipline as "the counter sits next to the affordance it describes" from doc 20.

---

## Part 1 — Backend: applying the foundation template

```python
@router.get("/all", response_model=Paginated[ProjectReviewResponse])
def get_all_reviews(
    db: DbSession,
    current_user: CurrentUser,
    limit: int = Query(50, ge=1, le=200, description="…"),
    offset: int = Query(0, ge=0, description="…"),
):
    if current_user.role not in ADMIN_ROLES:
        raise HTTPException(403, "Only HR users can view all reviews.")

    base_q = db.query(ProjectReview).filter(
        ProjectReview.org_id == current_user.org_id,
        ProjectReview.is_deleted == False,  # noqa: E712
    )

    total = base_q.with_entities(ProjectReview.id).count()

    reviews = (
        base_q
        .order_by(
            ProjectReview.cycle.desc(),
            ProjectReview.created_at.desc(),
            ProjectReview.id.desc(),     # ← NEW: stable tiebreaker
        )
        .offset(offset)
        .limit(limit)
        .all()
    )

    settings_row = _get_settings_row(db, current_user.org_id)
    items = [
        _build_review_response(r, db, viewer=current_user, settings=settings_row)
        for r in reviews
    ]

    return Paginated[ProjectReviewResponse](
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        has_more=(offset + len(items)) < total,
    )
```

Three small things, all earned from prior PRs:

1. **`ProjectReview.id.desc()` as a tiebreaker.** The endpoint already had `ORDER BY cycle DESC, created_at DESC` — that's "stable enough" only if no two rows share a `(cycle, created_at)`. Two reviews created in the same second (test seeds love this) would swap places across page boundaries without the tiebreaker. Same lesson as doc 21 Part 2; cheap to add, expensive to debug if missed.
2. **`settings_row` threaded down.** `_build_review_response` accepts an optional `settings` parameter — pass it in once instead of letting each row fetch its own. This was already correct in the legacy code (`settings_row` was already pre-fetched and threaded), so I'm just noting it as a pattern that survives the pagination change.
3. **`.with_entities(ProjectReview.id).count()`.** Slightly more efficient than `base_q.count()` because Postgres doesn't have to evaluate the SELECT's full column list — just the indexed `id`. The optimizer often does this on its own; being explicit is a hint, not a fix. (For ORDER BY queries with eager loads, this can matter; here it's a small win at most.)

### What about the joinedloads?

The legacy code had **no** `joinedload(...)` options on the ProjectReview query. The eager-loads happen *inside* `_build_review_response`, which does individual fetches per row for related entities. We didn't add joinedloads in this PR for one simple reason: doing so would change the data-loading pattern of the helper, which is a separate concern. See Part 3 for the deferred follow-up.

---

## Part 2 — The N+1 that pagination doesn't fix

Look at `_build_review_response` (excerpt):

```python
employee = db.query(User).filter(User.id == review.user_id).first()
reviewer = db.query(User).filter(User.id == review.reviewer_id).first() if review.reviewer_id else None
project = db.query(Project).filter(Project.id == review.project_id).first()
pm_user = (
    db.query(User).filter(User.id == project.pm_id).first()
    if project and project.pm_id else None
)

for ev in review.secondary_evaluations:
    if ...:
        ev_user = db.query(User).filter(User.id == ev.evaluator_id).first()
        ...
```

Five sequential SELECTs per ProjectReview, plus one per secondary evaluation. At org scale, a 5000-review fetch was issuing ~25000+ queries. **The legacy endpoint was slow for two independent reasons**: (a) it shipped every row, (b) it issued ~5 queries per row.

Pagination fixes (a). It does NOT fix (b) — except by capping its damage. After this PR, each Load More request issues at most `limit × 5` queries = 250 round-trips per click. That's still N+1 in shape, just bounded. A 200-page calibration session at limit=50 used to issue 25000 queries; it now issues 1250 spread across 5 user clicks.

### Why not fix it in this PR

Three reasons, in order of importance:

1. **Scope discipline.** PRs that do one thing land faster, review faster, get debugged faster, and let you flip a single decision if the change goes wrong. Fixing the N+1 means rewriting `_build_review_response` to take pre-fetched lookup maps OR adding eager-loads + collection-loaders on every caller (PM queue, mentee queue, single-review, all, etc.). That's its own PR.
2. **The legacy code's per-row fetches are CORRECT, just slow.** No bug to chase. The pagination change is what HR will notice; the N+1 fix is a hot-path speedup the user won't perceive at limit=50.
3. **Refactoring touches all callers.** `_build_review_response` is called from 7+ places. A safer cleanup PR profiles real query counts first, then does the refactor with a single test that asserts query counts. The Right shape of that PR is "introduce a batched variant + migrate callers one by one," not "rewrite the helper inline."

So the doc says "deferred" loudly. Future PR #N: "Eliminate N+1 in `_build_review_response`." Standalone, single concern, single doc.

### What the N+1 fix looks like (sketch — NOT in this PR)

For posterity / so future-you doesn't re-derive it:

```python
# Pre-fetch lookups for the page's reviews in 3 batched queries.
user_ids = {r.user_id for r in reviews}
user_ids.update(r.reviewer_id for r in reviews if r.reviewer_id is not None)
project_ids = {r.project_id for r in reviews}

users_by_id = {u.id: u for u in db.query(User).filter(User.id.in_(user_ids)).all()}
projects_by_id = {
    p.id: p for p in
    db.query(Project)
      .options(joinedload(Project.pm))  # carries PM in the same fetch
      .filter(Project.id.in_(project_ids))
      .all()
}
# … then call _build_review_response(r, ..., user_map=users_by_id, project_map=projects_by_id)
```

Three queries instead of 5 × limit. Same data. Same shape on the wire. The transformation is mechanical but the helper signature changes, which is the kind of change that wants its own PR + test.

---

## Part 3 — Where to put the Load More button

The HR consumer of `ReadOnlyReviewsList` is now paginated. The Mentor consumer (mentee reviews) isn't. Two ways to handle this:

| Approach | Tradeoff |
|---|---|
| **A.** Thread optional pagination props through `ReadOnlyReviewsList` (`hasNextPage?`, `isFetchingNextPage?`, `onLoadMore?`, `total?`). Renders Load More inside the card when the props are present. | Component knows about pagination. Mentor consumer passes nothing; HR consumer passes everything. Easier to discover ("the table component renders its own Load More") but couples the presentational component to a data-fetching concern. |
| **B.** Keep `ReadOnlyReviewsList` purely presentational (just renders rows). The Load More UI lives at the parent (`ProjectReviews.tsx`) level, **next to** the HR consumer's `<ReadOnlyReviewsList>` invocation. | Component stays a leaf — only knows about rendering rows. Pagination is a concern of the parent that owns the data. Slightly more code at the page level (a few lines of JSX). |

We went with **B**. Reasoning:

1. **`ReadOnlyReviewsList` is still useful for non-paginated callers.** Mentor's mentee-review list will probably never need pagination (a mentor has 5-ish mentees). Keeping the component pure means it won't grow obsolete pagination knobs that one of its two callers never uses.
2. **Same discipline from doc 20 Part 4: "a counter sits next to the affordance it describes."** The affordance here is "load more reviews from the server for HR." The natural place for it is the HR branch of the page, not buried inside a shared rendering helper.
3. **It's literally 12 lines of JSX.** Threading 4 optional props would be more code than this.

The JSX:

```tsx
{isHR && activeTab === "all-reviews" && (
  <>
    <ReadOnlyReviewsList ... reviews={allReviews} ... />

    {allReviewsQuery.hasNextPage && (
      <div className="mt-4 flex items-center gap-3 justify-center">
        <button onClick={() => void allReviewsQuery.fetchNextPage()} ...>
          {allReviewsQuery.isFetchingNextPage ? "Loading…" : "Load more"}
        </button>
        <span className="text-xs text-text-muted">
          Loaded {allReviews.length} of {allReviewsTotal}
        </span>
      </div>
    )}
  </>
)}
```

A `<Fragment>` (`<>...</>`) wraps the list + the Load More so the existing conditional render still emits one element. No restructuring of the surrounding JSX.

---

## Part 4 — What this PR does NOT solve

- **The N+1 in `_build_review_response`.** Documented above. Bounded by `limit=50` now, but worth its own PR.
- **Server-side filter/sort.** Filters and column sorts in `ReadOnlyReviewsList` still operate on the loaded array. At 1000+ reviews, "show me the lowest-rated review across the org" returns the lowest of what HR has loaded so far, not the true minimum. The natural next theme.
- **The other paginated-eligible endpoints in this file.** `/management` (per-project completion overview) is HR-only and could grow with org size. Not in this PR's scope; doc'd separately if/when we touch it.
- **`/annual-reviews/mentees`** still pending — mentor's annual-review roster. Small scale; doc-stub-sized PR.

---

## Trade-offs

- **PR is short and "boring."** That's the point — by the fourth time you apply the template, the change should feel routine. Two surprises would mean the template is wrong.
- **Bounded N+1 vs. real fix.** We chose "smaller PR now, bigger fix later." If profiling shows the round-trip cost dominates at the page size HR actually uses, escalate. Until then, this is the right unit of work.
- **Component-purity choice (Part 3) is a judgement call.** A reasonable maintainer could pick option A and not be wrong. Documenting B's rationale here means future-you doesn't have to re-litigate it.

---

## Verification

```bash
cd frontend
npm run build
```

Expected:
- `dist/assets/ProjectReviews-*.js` ~73.67 KB raw / **~12.92 KB gzip** (vs 72.87 / 12.66 baseline — +0.26 KB gzip for the wiring + Load More UI).

End-to-end:
- As HR_MyOrg or HR_Miltenyi, open `/project-reviews` → "All Reviews" tab → DevTools Network: first request is `GET /project-reviews/all?limit=50&offset=0`. Response shape: `items`, `total`, `limit`, `offset`, `has_more`.
- If the org has > 50 reviews → "Load more" button visible below the virtualized scroll card. Click → second request `?offset=50`; counter advances; new rows append.
- Two reviews with identical `(cycle, created_at)` (seed if possible) appear in a fixed, deterministic order on every page reload — the `id.desc()` tiebreaker is doing its job.
- Mentor (not HR) → "Mentees' Reviews" tab still works exactly as before — Mentor doesn't paginate, no Load More button is rendered.
- Staff (not HR, not Mentor) → "My Reviews" tab works as before; `/project-reviews/all` is **not** fetched (the `enabled: isHR` gate holds).

---

## What the next PR teaches

After this PR, every "every-row across the org" HR endpoint is paginated. Remaining candidates in the arc:

- **`/annual-reviews/mentees`** — flat list of a mentor's mentees' annual reviews. Tiny scale (typically < 20 rows). Worth paginating for **consistency** even though the practical win is small.
- **The N+1 cleanup** described in Part 2. Its own dedicated PR.
- **Server-side filter/sort** as theme #5 — the conceptually richest next step. Pagination becomes "page through the filtered universe" rather than "page through everything," and the Load More button's semantics shift accordingly.
