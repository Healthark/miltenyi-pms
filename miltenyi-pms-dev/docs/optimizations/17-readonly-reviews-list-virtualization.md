# 17 — Applying the template: ProjectReviews ReadOnlyReviewsList (Mentor + HR)

> **PR:** _pending_
> **Files changed:** `frontend/src/pages/ProjectReviews.tsx` only.
> **Headline result:** Third virtualization target. Same variable-height template from PR #16. **One refactor virtualizes both consumer views** (`ReadOnlyReviewsList` is rendered by both the Mentor "Mentees' Reviews" tab and the HR "All Reviews" tab). No new patterns introduced — this PR teaches the discipline of *applying* a template vs *introducing* one.

---

## TL;DR

PR #16 introduced the variable-height virtualization pattern (`measureElement` + `data-index` + no explicit row height). This PR applies it to a third table without changing the recipe. Same library, same wiring, same ARIA roles, same scroll structure.

What's different here is **the table doesn't strictly need variable-height virtualization**. There's no inline expansion (the "View" button opens a modal portal, not an inline panel). Rows are nearly uniform: ~64px because of the 2-line Project cell (name + code).

We use variable-height anyway. **The doc here is about the reasoning** — when to apply an existing template vs reach for a different one.

---

## Part 1 — Survey: what the table actually looks like

`ReadOnlyReviewsList` is a 7-column table consumed by two views inside `ProjectReviews.tsx`:

```tsx
{isMentor && activeTab === "mentees" && (
  <ReadOnlyReviewsList
    isLoading={isLoading}
    reviews={menteeReviews}
    projectRatingsVisible={projectRatingsVisible}
    employeeColumnLabel="Mentee"
    ...
  />
)}

{isHR && activeTab === "all-reviews" && (
  <ReadOnlyReviewsList
    isLoading={isLoading}
    reviews={allReviews}
    projectRatingsVisible={true}   // HR always sees ratings
    employeeColumnLabel="Employee"
    ...
  />
)}
```

The columns:

| # | Column | Content |
|---|---|---|
| 1 | Project | Two lines: name + code (font-mono). Widest. |
| 2 | Employee / Mentee | Single line. Label parameterized via prop. |
| 3 | PM | Single line (`pm_name ?? reviewer_name ?? "—"`). |
| 4 | Cycle | Small badge. |
| 5 | Status | Badge with icon ("Reviewed" green or "Pending PM" amber). |
| 6 | Rating | Badge OR Lock icon (when `projectRatingsVisible` is false for Mentor's view). |
| 7 | Actions | "View" button (opens modal) OR italic "Awaiting PM". |

**Two important properties** worth pausing on before deciding the virtualization mode:

1. **No inline expansion.** "View" → `<ProjectReviewDetailModal>` which is portaled to `document.body`. The modal is outside the row entirely; the row never grows vertically.
2. **Nearly uniform row height.** Project cell's 2 lines dominate at ~64px. Other cells are single-line and fit in that height. Status and Rating cells use badges that are 22-24px each — well under the row height.

This table is **fixed-height-eligible**. We could use the PR #15 pattern (`estimateSize: () => 64`, no `measureElement`, no `data-index`) and it would work correctly for the typical case.

---

## Part 2 — Why we used variable-height anyway

Two reasons.

### Reason 1: long project names can wrap

A row's Project cell has:
```tsx
<div className="font-medium text-text-main">{r.project_name}</div>
<div className="font-mono text-[11px] text-text-muted">{r.project_code}</div>
```

The project name doesn't have `truncate`. If a project is named "Q4 2025 Customer Implementation – North America Region (Enterprise SaaS Migration)" and the column is narrow (which `minmax(220px, 2.2fr)` can produce on a 1024px viewport), the name wraps to two display lines. Combined with the code below, that's 3 visible lines → row height ~80-90px instead of 64.

Fixed-height virtualization with `estimateSize: () => 64` would still render correctly visually (each row sizes itself based on content), BUT the virtualizer's window-math would be off — it thinks every row is 64px when some are 90px. Scroll position becomes wrong: the scrollbar reports the wrong content size, scrolling to row N puts you somewhere unexpected.

`measureElement` fixes this by recording each row's real rendered height after mount.

### Reason 2: template consistency

PR #16 established the variable-height template. PR #18 (next, `AnnualGoals AllGoalsTab`) will use it too. If we use fixed-height here, the codebase has three virtualized tables with two different patterns — adding cognitive load for anyone reading or maintaining them.

The cost of using variable-height when fixed-height would technically suffice:
- Slightly more measurement work per row (negligible at this scale)
- ResizeObserver instances per rendered row (cheap)

The benefit: every virtualized table in the codebase follows the same recipe. New tables added in the future copy from one template.

**This is the "applying vs introducing" discipline.** When a slightly-different problem walks in, the answer isn't always to invent a slightly-different pattern. Reach for the existing template unless the cost is genuinely outsized.

---

## Part 3 — What changed, structurally

Identical shape to PR #16:

```tsx
<div className="overflow-x-auto rounded-lg border border-border">
  <div role="table" aria-rowcount={sorted.length}>

    {/* Header (non-virtualized, pinned at top of x-scroll viewport) */}
    <div role="rowgroup" className="bg-slate-50/80 border-b border-border">
      <div
        role="row"
        className="grid items-center"
        style={{ gridTemplateColumns: READ_ONLY_GRID_TEMPLATE_COLUMNS }}
      >
        {/* 7 columnheader divs */}
      </div>
    </div>

    {/* Body */}
    {sorted.length === 0 ? (
      <NoMatchesMessage />
    ) : (
      <div ref={scrollContainerRef} role="rowgroup"
           style={{ height: 600 }} className="overflow-y-auto">
        <div style={{ height: rowVirtualizer.getTotalSize(),
                      position: "relative", width: "100%" }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const r = sorted[virtualRow.index];
            return (
              <div
                role="row"
                aria-rowindex={virtualRow.index + 1}
                key={r.id}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                style={{ position: "absolute", top: 0, left: 0, width: "100%",
                         transform: `translateY(${virtualRow.start}px)`,
                         gridTemplateColumns: READ_ONLY_GRID_TEMPLATE_COLUMNS }}
                className="grid items-center hover:bg-slate-50/60 ..."
              >
                {/* 7 role="cell" divs */}
              </div>
            );
          })}
        </div>
      </div>
    )}

  </div>
</div>
```

### One small layout cleanup along the way

The previous JSX wrapped `<th>` cells with `<SortableHeader>` inline. In the migration, each header cell becomes a `<div role="columnheader">` containing the `<SortableHeader>` — no behavioural change, just the wrapper element gets a more accurate ARIA role.

The "Actions" column header (the one without `<SortableHeader>`) was a plain `<th>` with style classes; it becomes a plain `<div role="columnheader">` with the same classes.

### `aria-expanded` is gone (no expansion)

PR #16's rows had `aria-expanded={isExpanded}` because clicking toggled an inline panel. ReadOnlyReviewsList's rows are not expanders — they have an internal "View" button that opens a modal. So `aria-expanded` isn't appropriate here. The row stays a plain `role="row"`; the View button stays a plain `<button>` (which gets ARIA semantics from being a button, no extra attributes needed).

---

## Part 4 — Two consumers, one refactor

```
Mentor's view:                HR's view:
/project-reviews              /project-reviews
└── Mentees' Reviews tab     └── All Reviews tab
    └── <ReadOnlyReviewsList />     └── <ReadOnlyReviewsList />
        (mentees data)               (org-wide data)
```

`ReadOnlyReviewsList` is the **only** shared list-rendering component between the Mentor and HR views in ProjectReviews. Both pass different `reviews` arrays + a few customization props (`employeeColumnLabel`, `projectRatingsVisible`, `emptyTitle`, `emptySubtitle`). The list-rendering and virtualization logic is identical.

**One refactor benefits both views.** This is the practical value of having shared presentation components: a perf improvement in the component lifts every consumer simultaneously.

The configuration props that differ per consumer:
- `employeeColumnLabel` — "Employee" for HR, "Mentee" for Mentor (a header text difference)
- `projectRatingsVisible` — HR always sees ratings; Mentor sees them only if the system flag is on (Lock icon otherwise)

Neither affects the virtualization. Both consumers get the same DOM-cost reduction at scale: from ~1000 rendered rows down to ~20.

---

## Part 5 — Final scorecard

### Files changed
| File | What |
|---|---|
| `frontend/src/pages/ProjectReviews.tsx` | `ReadOnlyReviewsList` table → virtualized variable-height div-grid; layout constants + virtualizer setup |

### Bundle impact
| Chunk | Before | After | Δ |
|---|---|---|---|
| `ProjectReviews` | 12.21 KB gzip | **12.65 KB** | +0.44 KB (virtualizer wiring + grid layout) |
| `query-vendor` | 16.44 KB | 16.44 KB | unchanged — library installed in PR #15 |

### Capability gains
- ✅ At HR scale (1000+ reviews across cycles), DOM holds ~20 rows instead of 1000+
- ✅ At Mentor scale (a senior mentor with 20-30 mentees over multiple cycles), same win — paint cost stops scaling with row count
- ✅ Long project names wrap correctly without breaking virtualization math
- ✅ Screen-reader navigation via `aria-rowindex` (one ARIA improvement that the legacy `<table>` didn't have)
- ✅ Both Mentor view AND HR view benefit from the same refactor (one shared component, two routes)

---

## Part 6 — Trade-offs we deliberately made

### Why variable-height when fixed-height would suffice

Discussed in Part 2. The short version: template consistency across the codebase + safe handling of the project-name-wrap edge case. The cost of "going variable-height when you could have stayed fixed" is small; the cost of "three virtualized tables, two different patterns" is bigger over time.

### `overscan: 6` (between PR #15's 8 and PR #16's 5)

Tuning:
- PR #15 (ManagementReview, fixed-height, simple rows): `overscan: 8` — cheap rows, more overscan = smoother scroll
- PR #16 (AnnualReviews, variable-height with potentially tall expansion panels): `overscan: 5` — measurement is costlier, tall panels make over-rendering more expensive
- PR #17 (this — variable-height but most rows are uniform ~64px): `overscan: 6` — middle ground

If real users complain about scroll jank on slow devices, dial up. If profiling shows row-measure work is a bottleneck, dial down. The doc is the right place to record the reasoning so future maintainers don't guess.

### `estimateSize: () => 64` is correct AND not the truth

For rows with non-wrapping project names, the actual rendered height is ~60-64px. `estimateSize: () => 64` is a good guess. `measureElement` corrects on first render — most rows record exactly that height; a few (long project names) record more.

If we'd set `estimateSize: () => 100`, the initial render would over-reserve space for unmeasured rows. As they render and measure, the virtualizer adjusts. The visible effect is brief: a slightly-too-tall total size that shrinks to fit. Not a bug, just less efficient.

The estimate should match the typical case. The measurement handles the exceptions.

### No `aria-expanded` because no expansion

PR #16's rows are expanders (click → inline panel). PR #17's rows are not — the "View" button is what opens content (and it opens a modal, not an inline panel). So the row doesn't carry expansion state, and `aria-expanded` would be misleading.

Different rows, different ARIA. This is a small but real detail.

---

## Part 7 — What you should now know cold

1. **"Applying a template" vs "introducing a new pattern"** is a distinct discipline. Most virtualization work after PR #16 will be the former, not the latter.
2. **A list might "not need" variable-height** but still benefit from using it — long-content wrap is a common edge case.
3. **Shared components pay back at scale.** One refactor to `ReadOnlyReviewsList` virtualizes both Mentor and HR views.
4. **`aria-expanded` is for expanders, not for any row that opens a modal.** Different interaction = different ARIA.
5. **Overscan tuning is per-table.** Cheap rows → higher overscan; costly measurements → lower overscan.

---

## Part 8 — Verify it works

```bash
cd frontend
npm run build       # passes? good
npm run dev
```

In the app:

1. **As HR_MyOrg**, open `/project-reviews` → "All Reviews" tab. Table renders identically to before (same columns, sort, filters, View buttons).
2. **As Mentor**, open `/project-reviews` → "Mentees' Reviews" tab. Same table, same component, different data (only your mentees' reviews).
3. **DOM verification**: DevTools Elements panel → find inner `role="rowgroup"` body → count visible children. Should be ~15-22 (window + overscan), regardless of total row count. Scroll → children mount/unmount in real time.
4. **Sort still works.** Click any column header → toggles asc/desc → rows resort, scroll resets to top.
5. **Filters still work.** Type in Employee/Project comboboxes, select Cycle/Status/PM dropdowns. Filter narrows the visible list; virtualizer rebuilds with the new count.
6. **Long project name** (if you have one in your dev data): row visually grows to fit the wrap, the virtualizer's total adjusts. Subsequent rows position correctly.
7. **View button** on a reviewed row opens `ProjectReviewDetailModal` — same modal as before. Closing it returns scroll position to where you were.
8. **Empty filter result**: filter combinations that match zero rows show the "No matching reviews" centered message, NOT a 600px empty scroll area.
9. **Screen reader sanity** (optional): VoiceOver/NVDA on a row announces "row 47 of 200." `<SortableHeader>`'s own ARIA handles sort-state announcement.

---

## Part 9 — What's next in the theme

- **#18 AnnualGoals AllGoalsTab** — biggest target. HR view groups by user, each user has multiple goals listed under them. Likely needs the same variable-height pattern but with consideration for the two-level structure (per-user collapsible card → each card contains multiple goals).
- **#19 Server-side pagination foundation** — backend `?limit/offset` + frontend `useInfiniteQuery`. Now we're solving network + DB cost, not just DOM cost.
- **#20+ Server-side filtering, re-render hygiene, optimistic updates.**

After #18, every HR-scale list in the codebase will be virtualized.
