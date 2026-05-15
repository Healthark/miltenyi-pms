# 23 — Paginate `GET /annual-reviews/mentees`: the consistency play

> **PR:** _pending_
> **Files changed:** `backend/app/api/routes/annual_review_routes.py`, `frontend/src/services/annual-review.service.ts`, `frontend/src/components/reviews/TeamReviewTab.tsx`.
> **Headline result:** Fifth paginated endpoint, mechanical application of the foundation template (doc 19). The interesting question is **whether to paginate at all** — mentor scale is small (most callers see < 50 review rows total), so the practical payoff is modest. We paginate anyway, for **template uniformity**. The doc explains why "small N" isn't a reason to skip pagination, and what you give up if you do. Bundle: AnnualReviews **41.32 → 42.08 KB raw, 8.32 → 8.36 KB gzip** (+0.04 KB gzip).

---

## TL;DR

The mentor's "Team Reviews" tab shows every direct mentee's annual review across every cycle. A typical mentor with 5 mentees over 3 cycles sees ~15 review rows. A long-tenured mentor at a stable org over 5 years might see 60-90.

So unlike `/annual-reviews/all` (1000+ rows, HR-scale) or `/calibration` (every Staff user), this endpoint is **small**. The default `limit=50` page covers ~80% of real mentor sessions. The Load More button stays hidden the rest of the time.

Why paginate it then?

| Reason | Detail |
|---|---|
| **Template uniformity** | Every HR/mentor list endpoint in the app now uses the same wire shape (`Paginated[T]`), the same React hook (`useInfiniteQuery`), and the same Load More UI. Future maintainers don't have to remember which endpoints are paginated and which aren't. |
| **Predictable affordance** | When a mentor's history *does* eventually exceed 50 rows (year 5+ of tenure), the Load More button appears naturally. No special-case "this endpoint started paginating today, here's a migration note" event. |
| **Bounded backend cost** | Even at small scale, capping at `limit=200` removes the worst-case payload size. A future mentor with 500 review rows (impossible? unlikely, but org structures vary) doesn't crater the page. |
| **Negligible additional cost** | +0.04 KB gzip, ~30 LOC, zero new concepts. The template is paid for; applying it once more is free. |

The doc is short by design. The fifth time you apply a template, there's no new lesson — but the **decision to apply it** is worth half a page so future-you doesn't second-guess it.

---

## Part 1 — When "small N" is and isn't a reason to skip pagination

The argument *against* paginating a small endpoint goes like this:

> Pagination adds backend complexity (`?limit/offset` params, `Paginated[T]` wrap, ORDER BY tiebreaker, COUNT query) and frontend complexity (`useInfiniteQuery`, flatMap, Load More UI, counter). All of that exists to fix "ship too much data per request." If the data is already small, you're paying the complexity tax for nothing.

It's not a bad argument. It's just outweighed by the four points above. The general principle:

> **Pagination's cost scales with how often you write the template. Once you've shipped the template four times for this codebase, the fifth application is free.**

If `/annual-reviews/mentees` had been the FIRST paginated endpoint, this argument would have flipped — you'd skip it and apply the template first to the endpoints that actually need it. But after doc 19, 20, 21, 22, the template is a near-reflex. The marginal cost is genuinely tiny.

### What you'd lose by skipping pagination here

| Skipping | Consequence |
|---|---|
| Same React hook for every list query (`useInfiniteQuery`) | Some are `useQuery`, some are `useInfiniteQuery`. New contributors have to check each. |
| Same wire shape (`{items, total, limit, offset, has_more}`) | Some endpoints return `T[]`, some return `Paginated<T>`. Defensive coding ("did this come back as an array or an object?") creeps in. |
| Same UI affordance | When the small endpoint eventually grows past 50 rows (years from now), HR/Mentor sees the whole list rendered as one giant scroll, no Load More. The fix becomes a SCHEDULED migration with breaking-API-shape risk. |
| Same backend test setup | We can test pagination edge cases (`offset=total`, `limit=0`, etc.) the same way for every endpoint. |

None of these is huge in isolation. Together, they're the kind of small dis-uniformity that makes a codebase slowly harder to reason about.

---

## Part 2 — The change is mechanical

### Backend

```python
@router.get("/mentees", response_model=Paginated[MenteeAnnualReview])
def get_mentee_reviews(
    db: DbSession,
    current_user: CurrentUser,
    limit: int = Query(50, ge=1, le=200, description="…"),
    offset: int = Query(0, ge=0, description="…"),
):
    settings = _get_settings(db, current_user.org_id)

    mentee_ids = [...]
    if not mentee_ids:
        return Paginated[MenteeAnnualReview](
            items=[], total=0, limit=limit, offset=offset, has_more=False,
        )

    base_q = db.query(AnnualReview).filter(
        AnnualReview.org_id == current_user.org_id,
        AnnualReview.user_id.in_(mentee_ids),
    )
    total = base_q.with_entities(AnnualReview.id).count()
    reviews = (
        base_q.order_by(
            AnnualReview.created_at.desc(),
            AnnualReview.id.desc(),   # ← stable-pagination tiebreaker
        )
        .offset(offset).limit(limit).all()
    )

    # … existing row-enrichment (employee_name, function, designation,
    # final-rating backfill, visibility-gate stripping) is unchanged …

    return Paginated[MenteeAnnualReview](
        items=rows, total=total, limit=limit, offset=offset,
        has_more=(offset + len(rows)) < total,
    )
```

Three additions on top of the legacy endpoint:

1. `?limit/offset` query params.
2. A pre-page `COUNT(*)` over the same filter, so `total` is exact.
3. The `AnnualReview.id.desc()` tiebreaker — same lesson as docs 21 and 22. Without it, two reviews submitted in the same second (test seeds, batch imports) could swap positions across pages.

Everything else — the mentee_ids resolution, the user/function/designation enrichment, the final-rating backfill, the visibility-gate stripping — is identical to the legacy code.

### Frontend

```ts
// service
getMenteeReviews: async (
  params: { limit?: number; offset?: number } = {},
): Promise<PaginatedMenteeReviews> => {
  const res = await apiClient.get<PaginatedMenteeReviews>(
    "/annual-reviews/mentees",
    { params },
  );
  return res.data;
},

export type PaginatedMenteeReviews = Paginated<MenteeAnnualReview>;
```

```tsx
// TeamReviewTab.tsx
const MENTEE_REVIEWS_PAGE_SIZE = 50;
const reviewsQuery = useInfiniteQuery({
  queryKey: queryKeys.annualReviews.mentees(),
  queryFn: ({ pageParam }) =>
    annualReviewService.getMenteeReviews({
      limit: MENTEE_REVIEWS_PAGE_SIZE,
      offset: pageParam,
    }),
  initialPageParam: 0,
  getNextPageParam: (lastPage) =>
    lastPage.has_more ? lastPage.offset + lastPage.limit : undefined,
});
const reviews = reviewsQuery.data?.pages.flatMap((p) => p.items) ?? [];
const totalReviews =
  reviewsQuery.data?.pages[reviewsQuery.data.pages.length - 1]?.total ?? 0;
```

Plus the Load More button below the table/grid view — same JSX template as every other doc-19-through-22 PR.

The cache key is unchanged (`queryKeys.annualReviews.mentees()`), so the existing write-mutations (mentor eval submit / draft save) that invalidate this key continue to refetch loaded pages without changes.

---

## Part 3 — What this PR does NOT solve

- **The other "mentee" endpoint.** `projectReviewService.getMenteeReviews` is a different endpoint (`/project-reviews/mentees`) on a different service. Same shape problem, future PR if/when we paginate the project-reviews mentor flow.
- **Server-side filter/sort.** Year / Status / Mentee filters and the column sort still run client-side on the loaded rows. At mentor scale this is fine; if/when filters cross into the server it's a separate theme.
- **The N+1 follow-up from doc 22** is still pending.

---

## Trade-offs

- **Tiny PR, tiny doc.** This is what "applying" a pattern looks like once you have it. The first PR introduced the template (doc 19). The fourth applied it routinely (doc 22). The fifth — this one — costs less LOC than the doc explaining the decision. That's a healthy ratio.
- **Mentor never sees Load More in practice.** That's fine. Hidden affordances are zero-cost; the absence of one when it isn't needed is the right behaviour.
- **One more endpoint to keep in mind during the future server-side filter/sort migration.** Theme #5 will visit every paginated endpoint to add filter pushdown; this one comes along for the ride.

---

## Verification

```bash
cd frontend
npm run build
```

Expected:
- `dist/assets/AnnualReviews-*.js` ~42.08 KB raw / **~8.36 KB gzip** (vs 41.32 / 8.32 baseline — +0.04 KB gzip).

End-to-end:
- As Mentor, open `/annual-reviews` → "Team Reviews" tab → DevTools Network: first request is `GET /annual-reviews/mentees?limit=50&offset=0`. Response includes `items`, `total`, `limit`, `offset`, `has_more`.
- If the mentor has > 50 mentee review rows across cycles (seed if needed): "Load more" button visible below the table/grid. Click → second request `?offset=50`; counter advances; new rows append.
- Submit a mentor evaluation on any pending review → broadcast invalidation (on the same `queryKeys.annualReviews.mentees()` key) refreshes the loaded pages; the row's status updates to `pending_management` without flashing the initial-load skeleton.
- A mentor with no mentees: empty state renders; Load More button hidden (`has_more=false`).

---

## What the next PR teaches

After this PR, every paginated-eligible read endpoint in the app has the template. Remaining shortlist:

- **N+1 cleanup in `_build_review_response`** (sketched in doc 22 Part 2). Standalone PR.
- **Server-side filter/sort** as theme #5. The conceptually richest next step — once the server understands the filter, pagination becomes "page through the *filtered* universe" and the UI affordance shifts.
- **Mark `/annual-reviews/mine/history` as deliberately NOT paginated** — Staff's own history is bounded by their tenure × cycle cadence (typically < 10 rows). One-doc explainer about when pagination is the wrong tool, completing the taxonomy.
