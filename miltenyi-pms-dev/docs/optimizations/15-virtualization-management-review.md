# 15 — Virtualization opener: the ManagementReview calibration grid

> **PR:** [#32](https://github.com/Healthark/miltenyi-pms/pull/32)
> **Files changed:** `frontend/package.json` + lockfile (new dep), `frontend/vite.config.ts` (comment refresh on the existing TanStack vendor rule), `frontend/src/pages/ManagementReview.tsx` (table → virtualized div-grid).
> **Headline result:** Opens the fresh scaling theme. ManagementReview's calibration grid is now virtualized — at 1000 active staff, the DOM holds ~27 rows instead of ~1000. Bundle: **+5.86 KB gzip in `query-vendor`** for the one-time library install (vendor-cached across deploys).

---

## TL;DR — a new kind of problem

Themes #02–#14 fixed problems the app **already had**: stale data, missing refetches, no cross-component coordination. The cache rollout made existing behaviour correct.

Theme #15+ fixes problems the app **doesn't have yet but will**. Today the dev seed is ~50 users; production at full Miltenyi rollout will be ~1000+. The HR All-X tables fetch every row and mount each one as DOM. At 1000 rows that's a hard usability cliff — initial paint stalls, scrolling jitters, memory grows.

We open the theme with the smallest, cleanest target: `ManagementReview`'s calibration grid (HR_MyOrg's view of every active Staff user for setting management ratings). It's a flat list, uniform row height, no inline expansion, no nested rows. Perfect first virtualization target.

The library is **`@tanstack/react-virtual`** — same author as React Query, ships as ESM, lands in our existing `query-vendor` cache chunk automatically. Cost: +5.86 KB gzip, one time.

---

## Part 1 — Why virtualization (and what it does)

### The problem at scale

Browsers render every DOM element you give them. Layout, paint, memory — all O(n) in element count. For a fixed-size scrollable container, this is wasteful: only ~10-20 rows are visible to the user at any moment. Rendering the other 980+ that are scrolled off-screen costs everything (CPU, RAM, GC pressure) while producing zero pixels the user can see.

The pattern is the same as "lazy loading routes" from PR #18, applied to **DOM nodes inside a list**:
- Don't render what the user can't see right now
- When they scroll, render what they're scrolling to
- Recycle DOM nodes that have left the viewport (or remove them and let new ones replace them)

### What virtualization is, mechanically

A virtualizer needs three things:

1. **A scroll container with a fixed (or computed) height.** This is the "window" the user can see through. Without a fixed height, there's no defined "what's visible" — the page would just grow infinitely.

2. **A total content height** equal to `itemCount × rowHeight`. This is what the browser needs to draw a scrollbar of the right size. The container reserves all that vertical space even though most of it is empty.

3. **Per-frame: which item indices are in the window.** As the user scrolls, the virtualizer computes "given the current scroll offset, items 47–73 are visible. Render those 27." Items outside the window are not rendered (and are unmounted as you scroll past them).

So you end up with:
```
Visible viewport (600px high, can fit 12 rows)
[Row 47] ← rendered
[Row 48] ← rendered
...
[Row 58] ← rendered
+ 8 overscan rows above + 8 below = ~27 rows total in DOM
At any moment, ~973 rows are NOT in the DOM.
```

### What this looks like in code

`@tanstack/react-virtual` exposes one hook, `useVirtualizer`:

```tsx
const scrollContainerRef = useRef<HTMLDivElement | null>(null);
const rowVirtualizer = useVirtualizer({
  count: visibleRows.length,
  getScrollElement: () => scrollContainerRef.current,
  estimateSize: () => ROW_HEIGHT_PX,
  overscan: 8,
});
```

Then in the JSX:

```tsx
<div ref={scrollContainerRef} style={{ height: 600, overflowY: "auto" }}>
  <div style={{ height: rowVirtualizer.getTotalSize(), position: "relative" }}>
    {rowVirtualizer.getVirtualItems().map((virtualRow) => (
      <div
        key={visibleRows[virtualRow.index].user_id}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: virtualRow.size,
          transform: `translateY(${virtualRow.start}px)`,
        }}
      >
        {/* row content for visibleRows[virtualRow.index] */}
      </div>
    ))}
  </div>
</div>
```

That's the whole pattern. Three structural pieces:
- **Outer ref'd container** = the scroll viewport (fixed height)
- **Inner sized div** = reserves the total list height so the scrollbar is correct
- **Each rendered row** = absolutely positioned at its computed offset

---

## Part 2 — Why we converted `<table>` to `<div role="table">`

The legacy ManagementReview rendered the grid as `<table><thead><tbody><tr><td>...`. Virtualizing this directly is awkward because rows need `position: absolute` for the windowing math, and **absolutely-positioned `<tr>` elements break table-row cell-width sharing with the `<thead>`**. The header columns and body columns stop aligning unless you pin widths via JavaScript every render — fragile and slow.

The cleanest fix is to swap the `<table>` tag for a `<div role="table">` with `display: grid` columns. CSS Grid gives us per-row alignment that doesn't depend on a shared `<table>` layout context.

### ARIA preservation

Screen readers care about the semantics, not the HTML tag. The mapping:

| HTML | Replacement |
|---|---|
| `<table>` | `<div role="table">` |
| `<thead>` | `<div role="rowgroup">` |
| `<tbody>` | `<div role="rowgroup">` |
| `<tr>` | `<div role="row">` |
| `<th>` | `<div role="columnheader">` |
| `<td>` | `<div role="cell">` |

For an AT (assistive technology) user, this announces identically to the original `<table>`. We also added `aria-rowcount` on the table and `aria-rowindex` on each row so screen readers can announce "row 47 of 1000" — useful when you're navigating a large list.

The active-sort column carries `aria-sort="ascending"` or `"descending"`; unsorted columns get `aria-sort="none"`. This is the standard accessible-table pattern.

### The shared grid template

Header and body rows use the SAME `gridTemplateColumns`:

```ts
const GRID_TEMPLATE_COLUMNS =
  "minmax(160px, 1.6fr) minmax(200px, 2fr) minmax(150px, 1.4fr) " +
  "minmax(130px, 1.2fr) minmax(150px, 1.4fr) minmax(150px, 1.4fr) " +
  "minmax(110px, 1fr) minmax(110px, 1fr) minmax(130px, 1.2fr) " +
  "minmax(120px, 1fr)";
```

`minmax(<floor>, <weight>fr)` means "each column is at least `floor`px wide, but expands proportionally to the leftover space according to weight." The User and Email columns weigh more because they hold longer text; rating-badge columns weigh less.

Without `minmax(floor, ...)`, narrow columns could squeeze to 0px when the table renders in a small container. The floor guarantees readable cells.

---

## Part 3 — Anatomy of `useVirtualizer`'s parameters

```ts
useVirtualizer({
  count: visibleRows.length,
  getScrollElement: () => scrollContainerRef.current,
  estimateSize: () => ROW_HEIGHT_PX,
  overscan: 8,
});
```

### `count`

How many items the virtualizer is windowing over. This changes whenever `visibleRows` changes (filter, sort). Whenever count changes, the virtualizer recomputes its total size and may scroll back to top (depending on configuration).

### `getScrollElement`

A function returning the scroll container DOM node. The virtualizer attaches a `scroll` listener to this element to know when the user scrolls and recompute the window. We use a `useRef` to capture the actual `<div>` after mount.

Why a function instead of the ref itself: on the first render, `scrollContainerRef.current` is `null` (the div doesn't exist yet). The function is called lazily — by the time the virtualizer actually needs the element, the ref has been populated.

### `estimateSize`

Returns the height in pixels for a row at a given index. For uniform rows: `() => 52`. For variable rows (e.g., a long comment that wraps): you'd return a different size per index AND use `measureElement` to let the virtualizer re-measure rows after they render.

We use fixed `ROW_HEIGHT_PX = 52` here. Variable-height virtualization is a follow-up for tables that have inline-expanded narrative rows (AnnualGoals' AllGoalsTab, ProjectReviews' ReadOnlyReviewsList).

### `overscan`

How many rows beyond the viewport to render. Default 1; we set 8.

Higher overscan = smoother scrolling on slow devices (the new rows are already in the DOM when the user reaches them) but more DOM at any moment. Lower overscan = less DOM, more risk of "flash of empty rows" during fast scrolling on slow devices.

8 is a sane default for fixed-height rows. We tune up if real users on slow hardware report flashing.

---

## Part 4 — Why the header lives OUTSIDE the scroll container

A common alternative is to put the header inside the scroll container with `position: sticky; top: 0`. Sticky headers work for short-content pages but get awkward with virtualization because the scrollable area is fixed-size — the sticky header doesn't behave differently than a non-sticky header in that fixed-height context. Putting it outside is clearer and visually identical for this case.

The structure:

```
<div role="table">
  <div role="rowgroup"> ← header (not scrolled)
    <div role="row">
      <div role="columnheader">User</div>
      ...
    </div>
  </div>
  <div ref={scrollContainerRef} style={{ height: 600, overflowY: auto }}>
    <div role="rowgroup">    ← body (scrolled + virtualized)
      <div style={{ height: getTotalSize(), position: relative }}>
        {virtualItems.map(...)}
      </div>
    </div>
  </div>
</div>
```

The two `role="rowgroup"` divs are siblings inside `role="table"`. Screen readers announce them as a single table with all rows. The visual layout is "fixed header, scrollable body" — exactly the standard data-table pattern.

---

## Part 5 — `flex-nowrap` on the action cell (and why it matters here)

The legacy code's action cell had:
```tsx
<div className="flex items-center gap-1.5 flex-wrap">
```

`flex-wrap` would let the action buttons (View + Rate) wrap to a second line if the column was narrow. The row's height would grow.

For non-virtualized rows, this is fine — each row sizes itself. For **virtualized** rows with `estimateSize: () => 52`, variable heights would put the virtualizer out of sync with reality: rows reporting taller than 52px would either overlap their neighbors or leave gaps.

So we switched to `flex-nowrap`. Action buttons stay on one line, row height stays a constant 52px.

If the action cell EVER needs to wrap (e.g., we add a third action button and View+Rate+Reject doesn't fit), the fix is to switch the virtualizer to **variable-height mode** with `measureElement`. The library handles it; we'd just stop using a fixed `estimateSize`. Until then, keep it uniform.

---

## Part 6 — Bundle impact

```
query-vendor:   10.58 KB → 16.44 KB gzip   (+5.86 KB)
ManagementReview: 4.08 KB →  4.44 KB gzip   (+0.36 KB)
```

`+5.86 KB` for the library, vendor-cached. After this PR, every future virtualization target (AnnualGoals AllGoalsTab, AnnualReviews AllReviewsTab, ProjectReviews ReadOnlyReviewsList) costs essentially zero additional bundle — the library is already there.

`+0.36 KB` for ManagementReview's specific code: the virtualizer setup, the grid layout, the extra ARIA attributes. Negligible.

### Why we kept `@tanstack/react-virtual` in `query-vendor` instead of making `virtual-vendor`

The `manualChunks` rule in `vite.config.ts` already matches all `@tanstack/...` packages and bundles them together. We kept that — same author, same versioning cadence (TanStack does coordinated releases), same likelihood of being upgraded together. Splitting into a separate chunk would mean two HTTP requests on first load instead of one.

The chunk name "query-vendor" is slightly inaccurate now (it holds both React Query and React Virtual), but renaming would invalidate every returning visitor's cache (per PR #18's principles). The accuracy gain isn't worth the cache invalidation cost.

---

## Part 7 — What virtualization does NOT solve

Crucial framing for the rest of theme #15+:

| Problem | Virtualization fixes it? |
|---|---|
| Rendering 1000 DOM rows kills paint perf | ✅ Yes — only 27 ever in DOM |
| Browser memory grows linearly with row count | ✅ Yes — same reason |
| Scroll feels janky with many rows | ✅ Yes — fewer elements to lay out per scroll event |
| **Backend returns 1000 rows over the network** | ❌ No — same payload, still slow to download |
| **Filtering 1000 rows client-side is slow** | ❌ No — the filter still runs over all 1000 |
| **Reduce DB load on HR's All-X page** | ❌ No — the backend still computes the full list |

Virtualization fixes **DOM cost**. To fix payload and backend cost we need **server-side pagination** — `?limit=50&offset=0` plus `useInfiniteQuery` on the frontend.

The next PRs in this theme will go after that — moving from "render less" to "fetch less." Today's PR is the prerequisite (you can't paginate a list until rendering it is fast in the first place).

---

## Part 8 — Scoped out of this PR (other tables)

Three other unbounded-list tables exist:

1. **`AnnualGoals` `AllGoalsTab`** — has inline-expanded user rows (variable height per expansion state). Variable-height virtualization required. Its own PR.
2. **`AnnualReviews` `AllReviewsTab`** — has inline-expanded narrative panels per row. Same variable-height concern. Its own PR.
3. **`ProjectReviews` `ReadOnlyReviewsList`** — Mentor & HR view, has expansion behaviour. Its own PR.

For each: same pattern, with `measureElement` instead of fixed `estimateSize`, and a `useEffect` to invalidate the virtualizer when an expansion state changes (the row's height changed).

This PR is the **clean template** for fixed-height virtualization. The follow-ups will document variable-height virtualization separately because the concept warrants its own teaching pass.

---

## Part 9 — Trade-offs we deliberately made

### Fixed scroll-container height (`600px`) instead of viewport-relative

`useVirtualizer` needs a definite container height to know what's in the window. Two options:

- **Fixed pixels** — `height: 600px`. Simple, predictable. Doesn't adapt to the user's viewport.
- **Viewport-relative** — `height: calc(100vh - 320px)` where 320px is the height of "everything else on the page above me." Adapts to viewport size, but the magic number is fragile — if the page header gains a row, 320px is wrong.

We picked fixed 600px for the first virtualization PR. It's simple, the doc covers the trade, and tuning to viewport-relative is a small follow-up if real users complain about wasted space on tall screens.

### Why we converted to `<div role="table">` instead of keeping `<table>`

Discussed in Part 2. Briefly: absolutely-positioned `<tr>` breaks table-row cell-width sharing. CSS Grid on `<div>`s gives clean per-row alignment without that constraint. ARIA roles preserve accessibility.

The cost: TS / IDE no longer recognizes the structure as "this is a table" for some tooling. Worth it for the clean virtualization.

### `flex-nowrap` on action cells

Forces uniform row height (covered in Part 5). If the action set ever grows beyond what fits inline, switch to variable-height virtualization.

### Scroll position resets when filter changes

When `count` changes (filter narrowed), the virtualizer doesn't preserve scroll position. The list jumps back to top. This is **the right UX for HR's calibration workflow**: filtering means "I want to see the matches," so showing the first match is correct.

If we ever wanted scroll preservation across filter changes (e.g., a "ratings between 3 and 5" filter that the user might toggle), we'd need to snapshot the visible top row index, apply the filter, then `rowVirtualizer.scrollToIndex(snapshotIndex)`. Out of scope here.

---

## Part 10 — What you should now know cold

1. **Virtualization is "lazy DOM" for lists.** It fixes paint/memory cost but not network/filter cost.
2. **The three required pieces of any virtualizer:** scroll container with fixed height, total content height, per-frame which-indices-are-in-window computation.
3. **Why tables → divs:** `position: absolute` rows break `<table>` cell-width sharing.
4. **ARIA roles preserve accessibility** when you abandon the HTML table semantics for divs.
5. **`overscan`** trades DOM count for scroll smoothness on slow devices.
6. **Uniform rows are easier than variable** — start with fixed `estimateSize`, only reach for `measureElement` when content actually varies.
7. **Bundle cost is per-library, not per-virtualized-table** — once the lib is installed, virtualizing the next table is ~free.

---

## Part 11 — Verify it works

```bash
cd frontend
npm run build       # passes? good
npm run dev
```

In the app, log in as `HR_MyOrg` and open `/management-review`:

1. **Visual parity.** The table looks identical to before — same columns, same widths, same badges, same View/Rate buttons.
2. **Scroll behaviour.** The HEADER stays fixed at the top of the table area. Only the body scrolls.
3. **Sort still works.** Click a column header → it toggles asc/desc, the rows resort, scroll jumps to top.
4. **Filters still work.** Type in the search box / change the filter dropdowns → the visible rows narrow. Scroll resets to top.
5. **DOM verification (the win).** Open browser DevTools → Elements panel. Find the `role="rowgroup"` for the body. Expand it.
   - At **default 600px height** with ~50 dev-data rows, you should see ~22-27 child rows (the visible window + 8 overscan top + 8 overscan bottom, clamped to the available count).
   - Scroll the table. Watch the DOM in real time — rows are unmounting and remounting as you scroll.
   - Reload with a row count > 50 (you'd need a bigger seed): the number of rendered rows stays ~27. The other 970+ never enter the DOM.
6. **Action buttons.** Click View on a `pending_management` row → modal opens with the details. Click Rate → modal opens in edit mode. Same behaviour as before this PR — the Rate-save flow from PR #26 is unchanged.
7. **Screen reader sanity (optional).** macOS VoiceOver or Windows NVDA on the table area. Should announce as "table, 9 columns, 47 rows" and let you navigate row-by-row. The `aria-rowcount` and `aria-rowindex` attributes guide this.

---

## Part 12 — What's next in the theme

The scaling arc has more steps. Likely sequence:

- **#16 Variable-height virtualization** on `AnnualGoals AllGoalsTab` (HR view) — `measureElement` pattern, the harder lesson
- **#17 Apply virtualization** to `AnnualReviews AllReviewsTab` + `ProjectReviews ReadOnlyReviewsList` — once the variable-height pattern is templated
- **#18 Server-side pagination foundation** — backend `?limit/offset` + frontend `useInfiniteQuery`. Bigger concept; backend coordination required
- **#19 Server-side filtering** — debounced search inputs that round-trip
- **#20+ Re-render hygiene** — `React.memo` on row components, targeted `useMemo` on derived expensive lists

Different problems, same discipline: measure, document, ship in focused PRs.
