# 18 — Virtualization arc complete 🏁: AnnualGoals AllGoalsTab

> **PR:** _pending_
> **Files changed:** `frontend/src/pages/AnnualGoals.tsx` only.
> **Headline result:** Final virtualization target — the largest and most structurally complex of the four. Per-user groups with sub-header + N goal rows per expansion. After this PR **every HR-scale list in the codebase is virtualized**. Bundle: +0.51 KB gzip on the AnnualGoals chunk.

---

## TL;DR

`AllGoalsTab` is HR_MyOrg's org-wide view of every annual goal, **grouped by employee**. Each user is one top-level row; clicking expands to reveal a sub-header (Goal / Description / Status / Action) plus one sub-row per goal that user has. A user with one goal expands to ~120px; a user with ten goals expands to ~600px.

This is the most variable expansion shape we've virtualized. Same pattern as PR #16/#17 (`measureElement` + `data-index` + no explicit row height), one new CSS Grid technique introduced: **`gridColumn: span 2`** to translate the legacy `<td colSpan={2}>` Description cell into a grid layout.

After this PR, the virtualization arc (theme #15+ themes 1) is **complete**. Every list where HR can show 100+ rows is now windowed. The next theme is server-side pagination — different concern (network/DB), different mechanics.

---

## Part 1 — Why this table is the densest expansion

A quick visual model:

```
┌─────────────────────────────────────────────────────────────┐
│ HEADER  Employee │ Function │ Designation │ Year │ Mentor  │  ← non-virtualized
├─────────────────────────────────────────────────────────────┤
│ ▶ Alice Adams    │ Engineering │ Senior │ FY26-27 │ Bob R. │  ← group row
├─────────────────────────────────────────────────────────────┤
│ ▼ Charlie Davis  │ Engineering │ Mid    │ FY26-27 │ Eve M. │  ← group row (expanded)
│ ┃ GOAL │  DESCRIPTION              │ STATUS    │ ACTION ┃   ← sub-header
│ ┃ 1. Q1 Goal │ Description text... │ Approved  │ View   ┃   ← per-goal row
│ ┃ 2. Q2 Goal │ Description text... │ Pending   │ —      ┃   ← per-goal row
│ ┃ 3. Q3 Goal │ Description text... │ Approved  │ View   ┃   ← per-goal row
├─────────────────────────────────────────────────────────────┤
│ ▶ Frank Hill     │ Design │ Senior │ FY26-27 │ Iris J.  │  ← next group row
└─────────────────────────────────────────────────────────────┘
```

When Charlie is expanded:
- His group row (always rendered): ~48px
- Sub-header: ~32px
- Per-goal rows: 3 goals × ~50px each = 150px (long descriptions can push higher)
- **Total Charlie row: ~230px**

When Charlie is NOT expanded:
- Just his group row: ~48px

So the same row in the virtualizer is either ~48px or ~230px depending on `expandedUserId`. `measureElement` is what makes that work without breaking scroll math.

Compared to PR #16 (single narrative panel inside expansion): same idea, denser content.

---

## Part 2 — The new technique: `gridColumn: span 2`

The legacy table used `<td colSpan={2}>` on the Description cell so it occupied the visual width of two parent columns (Function + Designation):

```tsx
// Legacy goal sub-row:
<tr>
  <td>Goal title</td>
  <td colSpan={2}>Description text...</td>   {/* spans 2 cols */}
  <td>Status badge</td>
  <td>Action button</td>
</tr>
```

In CSS Grid the equivalent is **`gridColumn: "span 2"`** on the cell that should span:

```tsx
// New goal sub-row:
<div className="grid" style={{ gridTemplateColumns: ALL_GOALS_GRID_TEMPLATE_COLUMNS }}>
  <div>Goal title</div>
  <div style={{ gridColumn: "span 2" }}>Description text...</div>
  <div>Status badge</div>
  <div>Action button</div>
</div>
```

Same 5-column grid as the user-level row. The Description cell takes 2 columns of width; the other cells fill the remaining 3 columns. Header columns and sub-row columns align visually because they share the same `gridTemplateColumns`.

### Why this matters

When you migrate from `<table>` to `<div role="table">`, this is the only `<td>` attribute that doesn't have an obvious 1-to-1 replacement. `rowspan` has the same pattern (`gridRow: "span N"`) but isn't used here. The doc records this so future migrations don't have to rediscover.

### What it doesn't do

`gridColumn: span 2` is **column-flow direction only**. It doesn't change the row's height, doesn't affect other rows, doesn't break grid alignment. It just tells the cell "take 2 of the available 5 column slots."

---

## Part 3 — One outer measured div per group, all content inside

Same wrapping principle as PR #16/#17 — but now there's MORE content inside the measured element:

```tsx
<div
  role="row"
  ref={rowVirtualizer.measureElement}
  data-index={virtualRow.index}
  aria-expanded={isExpanded}
  style={{ position: "absolute", top: 0, left: 0, width: "100%",
           transform: `translateY(${virtualRow.start}px)` }}
>
  {/* User row (always rendered) */}
  <div className="grid" style={{ gridTemplateColumns: ... }} onClick={toggle}>
    {/* 5 cells: Employee, Function, Designation, Year, Mentor */}
  </div>

  {/* Expansion (conditional). Each child below also uses the same
      5-column grid so alignment with the user row is preserved. */}
  {isExpanded && (
    <>
      <div className="grid" style={{ gridTemplateColumns: ... }}>
        {/* Sub-header: Goal | Description (span 2) | Status | Action */}
      </div>
      {group.goals.map((g, gi) => (
        <div className="grid" style={{ gridTemplateColumns: ... }} key={g.id}>
          {/* Per-goal cells: title | description (span 2) | status | action */}
        </div>
      ))}
    </>
  )}
</div>
```

The outer div is what `measureElement` observes. Its `offsetHeight` = sum of:
1. User row height (~48px)
2. Sub-header height (~32px) — only when expanded
3. Each per-goal row height — only when expanded

The ResizeObserver fires whenever any child mounts, unmounts, or changes size. The virtualizer's size cache updates atomically.

### Why three nested grid containers (vs one outer grid)

You might wonder: why not use ONE grid for the whole expanded section, with `gridRow: span N` to stack the user row above N goal rows?

Two reasons:
1. **The user row is always rendered**; sub-header and per-goal rows are conditional. A single grid where some cells are conditional gets messy fast.
2. **The user row's `onClick` should NOT trigger on clicks inside the expansion**. Wrapping the user row's cells in a separate grid container means a click on the Description text inside an expanded goal doesn't bubble up to toggle collapse.

Three separate sibling grids inside the measured outer div = each grid is one logical "row strip," each independently styled, each contributing to the outer div's measured height.

---

## Part 4 — `overscan: 4` (lowest yet)

Tuning across the four virtualized tables:

| PR | Table | Overscan | Reasoning |
|---|---|---|---|
| #15 | ManagementReview | 8 | Fixed-height, cheap rows |
| #16 | AnnualReviews AllReviewsTab | 5 | Variable-height, expansion can be tall |
| #17 | ProjectReviews ReadOnlyReviewsList | 6 | Variable-height but most rows are 64px |
| #18 | AnnualGoals AllGoalsTab | **4** | Densest expansion (multiple sub-rows per group) |

Each expanded group can be 200-700px. Over-rendering tall expansions costs more measurement work than over-rendering uniform short rows. We dialed overscan down to 4 — a tighter window above and below the viewport.

If real users on slow devices report flashing rows during scroll, dial up. The doc records the rationale so future maintainers know what knob to turn first.

---

## Part 5 — Final scorecard

### Files changed
| File | What |
|---|---|
| `frontend/src/pages/AnnualGoals.tsx` | `AllGoalsTab` table → virtualized variable-height div-grid with nested expansion content |

### Bundle impact
| Chunk | Before | After | Δ |
|---|---|---|---|
| `AnnualGoals` | 14.41 KB gzip | **14.92 KB** | +0.51 KB (densest virtualization wiring) |
| `query-vendor` | 16.44 KB | 16.44 KB | unchanged — library already installed |

### Capability gains
- ✅ At HR scale (1000+ goals across 200+ employees), DOM holds ~10-15 user groups instead of 200+
- ✅ Each expansion adds DOM only while open (collapsed groups = one user row strip)
- ✅ `gridColumn: span 2` correctly translates legacy `colSpan` semantics into the grid layout
- ✅ Screen-reader announces `aria-expanded` state on each group row
- ✅ Long goal descriptions wrap correctly without breaking virtualization math

---

## Part 6 — The complete virtualization arc

Every HR-scale list in the codebase is now virtualized:

| # | Table | Pattern | Special considerations |
|---|---|---|---|
| #15 | ManagementReview calibration | Fixed-height | First template; ARIA roles; CSS Grid |
| #16 | AnnualReviews AllReviewsTab | Variable-height (`measureElement`) | Inline expansion → narrative panel; `Fragment` import dropped |
| #17 | ProjectReviews ReadOnlyReviewsList | Variable-height | Two consumers; project-name-wrap edge case; no actual inline expansion |
| #18 | AnnualGoals AllGoalsTab | Variable-height with nested sub-rows | Densest expansion; `gridColumn: span 2` for colSpan equivalent |

### What virtualization gave us
- **DOM cost stops scaling with row count.** At 1000+ rows, only ~20 are in the DOM at any time.
- **Initial paint is constant time.** Mounting these pages takes the same time at 50 rows as at 5000.
- **Scroll is smooth.** Render work per scroll event is bounded.
- **Memory is bounded.** No DOM nodes for off-window rows.

### What virtualization didn't solve
Same framing as PR #15 — repeated here as a reminder of where we're going:

| Problem | Virt fixes? |
|---|---|
| 1000 DOM rows kill paint perf | ✅ Yes (across all four tables) |
| Memory grows linearly with row count | ✅ Yes |
| **Network: backend returns all rows** | ❌ Server-side pagination (next theme) |
| **Filter still iterates all rows client-side** | ❌ Server-side filtering |
| **DB does full table scan** | ❌ Backend pagination + indexes |

The next theme tackles network + DB. The mechanics are different — we coordinate backend `?limit/offset` (or cursor) with frontend `useInfiniteQuery`. We've laid the foundation: TanStack Query is already wired across the app. Adding pagination is now a per-query upgrade.

---

## Part 7 — Trade-offs we deliberately made

### Why three nested grids inside the row (vs one outer grid + gridRow span)

Discussed in Part 3. Short version: the user row is always rendered, the expansion is conditional, and the user row's `onClick` should NOT cover the expansion. Three sibling grids inside one measured outer div is the cleanest factoring.

### `overscan: 4` (lowest of all four virtualizations)

Dense expansions mean over-rendering is expensive. Tuned down to 4. Tunable if real-user testing shows flashing.

### Why we kept the same `gridTemplateColumns` for ALL three nested grids

Sub-header and per-goal rows technically only "need" 4-5 cell slots (Goal | Description-span-2 | Status | Action). We use the same 5-column template as the user row because:

1. **Visual alignment**: the sub-rows line up with the parent row's columns. Goal under Employee, Description under Function+Designation, Status under Year, Action under Mentor.
2. **CSS Grid spans handle the merge**: `gridColumn: "span 2"` on Description is one line of styling, simpler than a different grid template per sub-row type.

If the sub-rows had unrelated visual structure (e.g., timeline view), we'd give them a different grid template. They don't, so we share.

### Why we didn't extract per-row JSX into a `<UserGroupRow>` component

The expansion logic is ~70 lines of JSX. Extracting to a separate component would reduce file length but:
- Adds prop drilling for `expandedUserId`, `setExpandedUserId`, `setViewGoal`
- The component would have one consumer (this exact place)
- We'd need to pass `measureElement` as a callback ref, `virtualRow.start`, `virtualRow.index`, etc.

For a single consumer that's tightly coupled to the virtualizer, inline is fine. KISS.

### Why we didn't reach for nested virtualization

A more aggressive approach: virtualize the OUTER user groups AND virtualize each user's goal list inside when expanded. This would scale to a user with thousands of goals.

We didn't because:
1. No real user has thousands of annual goals (5-10 is typical, 20+ is rare).
2. Nested virtualization complicates `measureElement` — the parent virtualizer needs to know when the inner scroll position changes its own measured height.
3. We have no data showing the typical case is slow.

If a single user ever exceeds 50 goals in a cycle and the page becomes janky, revisit. Until then, the simpler approach is right.

---

## Part 8 — What you should now know cold

1. **The most complex expansion shape is just `measureElement` over a denser outer element.** Same recipe; the contents of the measured div just have more inside.
2. **CSS Grid `gridColumn: "span N"` is the colSpan equivalent.** Single style property, no other adjustments needed.
3. **Three sibling grids inside one measured div** is cleaner than one mega-grid with conditional cells, when expansion content has its own logical structure.
4. **Overscan tunes per table.** Dense expansion = lower overscan.
5. **Virtualization solves DOM cost, not network/DB cost.** The next theme picks up where this one ends.

---

## Part 9 — Verify it works

```bash
cd frontend
npm run build       # passes? good
npm run dev
```

In the app (HR_MyOrg):

1. Open `/annual-goals` → "All Goals" tab. Table renders identically to before (5 columns, sort, filters).
2. **Expand a user**: row tints blue, chevron rotates 180°, sub-header + goal rows appear below.
3. **Visual alignment**: Goal cell aligns under Employee, Description cell spans the Function+Designation visual area, Status under Year, Action under Mentor.
4. **Collapse the same user**: row shrinks back to ~48px, list re-flows below.
5. **Expand a DIFFERENT user**: previous collapses, new expands. List re-flows.
6. **DOM verification**: DevTools Elements → inner `role="rowgroup"` body → count children. Should be ~10-15 (window + overscan = 4), not the full group count.
7. **Expansion-while-scrolling**: expand a user near the top, scroll down. Expanded user leaves viewport, gets unmounted. Scroll back up — `expandedUserId` is preserved by component state, so the user is still expanded when re-rendered.
8. **Filter to narrow**: type an Employee name → groups narrow → scroll resets to top. Try a filter combination that returns zero results: should fall through to the existing empty-state.
9. **Goal view button**: click "View" on a reviewed goal → `GoalReviewDetailsModal` opens. Same modal as before.

---

## Part 10 — What's next

**The virtualization arc is complete.** Theme #15+ shifts to **server-side pagination** starting in PR #19:

- `useInfiniteQuery` from TanStack Query
- Backend `?limit/offset` (or cursor-based) on the same endpoints we already migrated
- Frontend "load more" or auto-fetch-on-scroll patterns
- Coordinating cache invalidation with paginated responses (each page is its own cache entry)

After that:
- **#20 Server-side filtering** — debounced search → query params → backend filters → much smaller payload
- **#21+ Re-render hygiene** — `React.memo` on row components, targeted `useMemo` on derived lists; optimistic updates via `onMutate` for hot mutations

The cache layer (theme #02–#14) and the DOM layer (theme #15–#18) are now production-grade. The remaining themes refine: network, perception, and edge-case behaviour.
