# 16 — Variable-height virtualization: AnnualReviews AllReviewsTab

> **PR:** _pending_
> **Files changed:** `frontend/src/pages/AnnualReviews.tsx` only.
> **Headline result:** Second virtualization target. Where PR #15 had fixed-height rows, this one has **inline expansion** — clicking a row reveals a self+mentor narrative panel of variable text length. The pattern is the same library (`@tanstack/react-virtual`) with one new API: **`measureElement`** for letting the virtualizer learn each row's actual rendered height.

---

## TL;DR

PR #15 (ManagementReview) virtualized a flat table where every row was exactly 52px. The virtualizer didn't need to measure anything — `estimateSize: () => 52` was the truth.

`AnnualReviews` `AllReviewsTab` is harder. Clicking a row toggles `expandedId`, which renders a `ReviewNarrativePanel` (self review text + mentor review text, side-by-side) inside the row. The narrative is plain text, sometimes one paragraph, sometimes ten. Row height now depends on:
- Whether it's the expanded row (one at a time)
- How much narrative text the expanded row contains

For this we use **`measureElement`** — a callback ref that lets the virtualizer observe each row's real height after it renders. The first paint uses `estimateSize` as a guess; once a row has rendered, the virtualizer's internal size cache updates to the measured value; the total list height adjusts; the scrollbar adjusts; other rows' `translateY` offsets recompute.

This is the **variable-height virtualization pattern**. It's the harder lesson — about 80% of the same shape as fixed-height, plus one critical bit of plumbing.

---

## Part 1 — The two-mode virtualizer

`useVirtualizer`'s API surface is the same; you just opt in to measurement by attaching `rowVirtualizer.measureElement` as a `ref` to each row's outer element:

```tsx
const rowVirtualizer = useVirtualizer({
  count: sorted.length,
  getScrollElement: () => scrollContainerRef.current,
  estimateSize: () => 48,     // starting guess; not the truth
  overscan: 5,
});

// In the row JSX:
<div
  ref={rowVirtualizer.measureElement}
  data-index={virtualRow.index}   // REQUIRED — see below
  style={{
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    transform: `translateY(${virtualRow.start}px)`,
    // NOTE: NO explicit height. Let content determine the natural size.
  }}
>
  {/* row content, including optional expansion panel */}
</div>
```

### The three lines that make it variable

1. **`ref={rowVirtualizer.measureElement}`** — `measureElement` is a function ref. When the row mounts, the virtualizer attaches a `ResizeObserver` to the DOM node. When the row's size changes (mount, expansion toggle, content reflow), the observer fires.
2. **`data-index={virtualRow.index}`** — required. The virtualizer's measurement callback receives the DOM node; `data-index` is how it maps that node back to a row index in its internal size cache. Forgetting this is the #1 bug in variable-height virtualization — the library silently uses `estimateSize` for every row and your scroll is wrong.
3. **NO explicit `height` style on the row** — if you set `height`, the row IS that height, and `measureElement` measures the (artificial) height you set. Let content size it naturally; let the virtualizer learn what natural is.

That's the whole API delta from PR #15.

### The internal model

The virtualizer maintains an internal `Map<index, measured-size>`. Initially empty. As rows render:

| Index | Cache state after render | `getSize(index)` returns |
|---|---|---|
| 0 | not yet seen | `estimateSize(0) = 48` (the guess) |
| 0 | rendered (collapsed) → ResizeObserver fires → cache: `{0: 46}` | `46` |
| 0 | user expands → height changes → ResizeObserver fires → cache: `{0: 348}` | `348` |
| 0 | user collapses → height changes → ResizeObserver fires → cache: `{0: 46}` | `46` |

`getTotalSize()` is the sum of all known sizes (using the estimate for unmeasured ones). When the cache updates, `getTotalSize()` updates; React re-renders; the inner sizing div grows or shrinks; the scrollbar redraws.

This whole choreography happens for free as long as `data-index` and the `ref` are wired correctly.

---

## Part 2 — What changed in the JSX

### Before

The legacy table emitted **two `<tr>` elements** per logical row using `<Fragment>`:

```tsx
<Fragment key={r.id}>
  <tr onClick={() => setExpandedId(...)}>{/* base row */}</tr>
  {isExpanded && (
    <tr>
      <td colSpan={8}>
        <ReviewNarrativePanel review={r} />
      </td>
    </tr>
  )}
</Fragment>
```

This works because tables natively support a "tall expansion row spanning the full width" via `colSpan`. The two rows are siblings in the DOM, but visually they belong to the same logical record.

### After

The virtualized version emits **ONE outer div** per logical row, with the expansion conditionally rendered INSIDE:

```tsx
<div
  ref={rowVirtualizer.measureElement}
  data-index={virtualRow.index}
  onClick={() => setExpandedId(isExpanded ? null : r.id)}
  style={{ position: "absolute", top: 0, left: 0, width: "100%",
           transform: `translateY(${virtualRow.start}px)` }}
>
  <div className="grid" style={{ gridTemplateColumns: ... }}>
    {/* base row cells */}
  </div>
  {isExpanded && (
    <div className="bg-slate-50/40 border-t border-brand/10 px-5 py-5">
      <ReviewNarrativePanel review={r} />
    </div>
  )}
</div>
```

This matters for virtualization because **`measureElement` measures the entire ref'd element**. If the expansion were a sibling div (like the legacy `<tr>`), the virtualizer would see two separate rows in the size cache and the wiring would get complicated.

Wrapping both base + expansion inside ONE measured element means **a single row index = a single measured height**, regardless of whether the expansion is showing. That's exactly what the virtualizer wants.

### The `Fragment` import disappears

The legacy code imported `Fragment` from React for the dual-row pattern. After this refactor, no `Fragment` use remains — dropped from the imports. Build catches if anything else used it (nothing did).

---

## Part 3 — `aria-expanded` on the row

The base row is the click target for toggling. To communicate the expansion state to screen readers, the outer row div gets `aria-expanded={isExpanded}`:

```tsx
<div role="row" aria-expanded={isExpanded} aria-rowindex={virtualRow.index + 1}>
```

AT users hear "row 47 of 1000, collapsed" or "row 47 of 1000, expanded" when they reach it. The chevron icon's rotation is purely visual; ARIA carries the state for non-visual users.

This isn't specific to virtualization — it's an accessibility best practice for any expandable list pattern. The legacy code didn't have it; this refactor adds it.

---

## Part 4 — Why `overscan: 5` instead of `8` (from PR #15)

Each rendered row pays a small cost: React render + DOM layout + (for measured rows) ResizeObserver wiring. With fixed-height rows the cost is essentially DOM-only — cheap. With measured rows there's a ResizeObserver instance per rendered row and a callback firing whenever any of them resize.

We dialed overscan from 8 → 5 here because:
- Measurement work is more expensive than fixed-size lookup
- The narrative panels can be tall (200-600px) — over-rendering them costs more than over-rendering 52px rows
- On slower devices the cost is more noticeable

Tune up if real users on slow hardware report "flash of empty row" while scrolling. The trade is: lower overscan = less DOM = faster paint, but more flash risk; higher overscan = smoother scroll, more measurement work.

---

## Part 5 — What happens when expansion toggles

This is the part worth tracing through carefully because it's where measurement actually pays off:

1. User clicks row 47. `setExpandedId(47)` fires.
2. The component re-renders. Row 47's outer div now includes the `<ReviewNarrativePanel>` inside.
3. The narrative panel renders. The row's natural height changes from ~46px to (say) ~340px.
4. The `ResizeObserver` watching row 47's outer element fires with `contentRect.height = 340`.
5. The virtualizer's internal size cache updates: `{47: 340}`. `getTotalSize()` adjusts.
6. The inner sizing div grows (from `48 × 100 = 4800px` to `48 × 99 + 340 = 5092px`).
7. Subsequent virtual items past row 47 get new `start` offsets — their `translateY` values recompute on the next render.
8. The browser scrollbar updates to reflect the new total content height.
9. If the user collapses (clicks 47 again): panel disappears, row shrinks, ResizeObserver fires, cache updates `{47: 46}`, total size shrinks back.

Steps 4–8 happen automatically. The only thing we wrote was "let content size naturally + attach `measureElement` ref + set `data-index`." Everything else is library plumbing.

---

## Part 6 — Final scorecard

### Files changed
| File | What |
|---|---|
| `frontend/src/pages/AnnualReviews.tsx` | `AllReviewsTab` table → virtualized variable-height div-grid; dropped `Fragment` import |

### Bundle impact
| Chunk | Before | After | Δ |
|---|---|---|---|
| `AnnualReviews` | 7.65 KB gzip | **8.05 KB** | +0.40 KB (virtualizer wiring + grid layout) |
| `query-vendor` | 16.44 KB | 16.44 KB | unchanged (library already installed in PR #15) |

The library is cached across deploys; subsequent virtualization PRs add only the per-table wiring cost.

### Capability gains
- ✅ At HR scale (1000+ reviews across cycles), DOM holds ~20 rows instead of 1000+
- ✅ Expansion toggles correctly resize the virtual list (collapse + scrollbar adjust)
- ✅ Screen-reader expansion state via `aria-expanded`
- ✅ `aria-rowindex` lets AT users navigate by row position
- ✅ Pattern templated for AnnualGoals AllGoalsTab + ProjectReviews ReadOnlyReviewsList

---

## Part 7 — Trade-offs we deliberately made

### Why `overscan: 5` (lower than PR #15)

Discussed in Part 4. Measurement work + tall expansion panels = each over-rendered row is more expensive. Lower overscan trades scroll smoothness for less work. Tunable.

### Why we kept the no-matches branch as a separate path

When `sorted.length === 0`, we skip the virtualized container entirely and render a plain centered message. Two reasons:
- The virtualized scroll container's fixed 600px height would leave a big empty area below a "no matches" message — ugly
- `useVirtualizer({ count: 0 })` works but renders nothing; the "no matches" message wouldn't appear inside it anyway

The branch is a few extra lines for a cleaner empty-state UX. Worth it.

### Why we put `aria-expanded` on the row (not on the chevron icon)

`aria-expanded` belongs on the element that **controls the expansion** AND **owns the expandable region**. In this design, clicking anywhere on the row toggles — so the row IS the control. The chevron is purely visual; if we put `aria-expanded` on it, AT users navigating cell-by-cell wouldn't get the cue.

This matches the ARIA Authoring Practices for "row as disclosure widget" patterns.

### Why we didn't extract a `<VirtualRow>` component

The body of each virtualized row is ~80 lines (8 cells + the expansion panel + the layout wrapper). Extracting to `<VirtualRow row={r} isExpanded={...} onToggle={...} measureRef={...} />` would shave file length but adds:
- A new component to context-switch through during reading
- Prop-drilling for the measureElement ref + the data-index attribute
- Test-coverage scope creep

For one virtualized table, inline is fine. If a second AllReviewsTab-like component ever materializes, we'd extract. Until then, KISS.

### Why we didn't memoize the row JSX

Each rendered row could theoretically be wrapped in `React.memo` to prevent re-renders when its data hasn't changed. But:
- The virtualizer is already minimizing the number of rendered rows
- Row props include `isExpanded` and the `r` object — memoization gates would need careful shallow comparison logic
- We have no observed performance issue today

Premature optimization. Revisit if profiling shows row re-renders are a hot path (unlikely with virtualization already in place).

---

## Part 8 — What you should now know cold

1. **Variable-height virtualization = `measureElement` + `data-index` + no explicit row height.** Three things, in concert.
2. **Wrap base + expansion inside one measured element.** The virtualizer tracks one height per index; making the expansion a separate measured element fights the model.
3. **ResizeObserver is doing the work under the hood.** When a row's content changes, the observer fires, the cache updates, the total resizes, everything cascades.
4. **`overscan` trades scroll smoothness for measurement work cost.** Tune lower for tables with heavy/tall rows.
5. **`aria-expanded` on the row, not the chevron.** The clickable control IS the row.
6. **Empty states are NOT virtualized.** Render the "no matches" message outside the virtualized container.

---

## Part 9 — Verify it works

```bash
cd frontend
npm run build       # passes? good
npm run dev
```

In the app, log in as `HR_MyOrg` and open `/annual-reviews`:

1. **Default view (no expansion).** The table renders with all rows collapsed. Filters/search work as before; clicking a column header sorts.
2. **Expand a row.** Click any row — chevron rotates 180°, narrative panel appears below the base row. The panel shows self + mentor narrative side-by-side.
3. **Collapse the same row.** Click again — panel disappears, chevron rotates back, rows below slide up. **No layout jump or flash.**
4. **Expand a DIFFERENT row.** Click row B while row A is expanded — A collapses, B expands. The list re-flows correctly.
5. **DOM verification (the win).**
   - Open DevTools → Elements panel. Find the inner `role="rowgroup"` (the body).
   - Count children. Should be ~15-20 rows (visible window + overscan), regardless of total row count.
   - Scroll the table — rows mount and unmount in real time.
6. **Expansion-while-scrolling.** Expand a row near the top, then scroll down. The expanded row should leave the viewport and the rows below should be correctly positioned. Scroll back up — the expanded row should still be expanded (state preserved by `expandedId`).
7. **Filter to empty.** Type a non-matching search query. The table should show "No matching reviews" — NOT a 600px tall empty virtualized container.
8. **Screen reader sanity** (optional). VoiceOver/NVDA on a row should announce something like "row 47 of 200, collapsed" or "expanded." Clicking the row should re-announce with the new state.

---

## Part 10 — What's next in the scaling arc

Two more child tables to virtualize using this same variable-height pattern:

- **#17 `ProjectReviews` `ReadOnlyReviewsList`** — Mentor + HR consume this; has expansion behaviour. Same pattern, two consumers.
- **#18 `AnnualGoals` `AllGoalsTab`** — biggest and most complex (HR view groups by user; each user has multiple goals listed under them). May need a different shape — possibly two-level virtualization (users + their goals) or just per-row variable height.

Then the architectural shift:

- **#19 Server-side pagination foundation** — backend `?limit/offset` + frontend `useInfiniteQuery`. Now we're solving network + DB cost, not just DOM cost.

The vocabulary keeps building.
