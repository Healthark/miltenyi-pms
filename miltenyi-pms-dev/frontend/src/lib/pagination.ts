/**
 * pagination.ts — shared generic wrapper for every paginated API
 * response in the frontend.
 *
 * Why a shared type?
 *   The shape mirrors `backend/app/schemas/pagination.py:Paginated[T]`,
 *   which is reused across every paginated endpoint we ship in the
 *   optimization theme #4 ("server-side pagination"). Defining it once
 *   on each side guarantees the wire-format stays uniform — the same
 *   `useInfiniteQuery({ getNextPageParam })` recipe works for every
 *   endpoint, the same "Load more" button reads `has_more`, and a
 *   future migration to cursor-based pagination has one shape to edit
 *   instead of N service files.
 *
 * Originally landed inline in `annual-review.service.ts` (PR #36 —
 * doc 19). Extracted here in PR #37 (doc 20 — paginating /goals/all)
 * once a second caller needed it. The old `Paginated<T>` /
 * `PaginatedAnnualReviews` aliases are now re-exported from there for
 * back-compat; new code should import from this module directly.
 *
 * Field semantics:
 *   - `items`     The rows ON THIS PAGE (length ≤ `limit`).
 *   - `total`     The total count of rows the underlying query
 *                 matches. NOT just this page. Used by the UI to
 *                 render a "Loaded N of T" counter so HR knows what
 *                 fraction they've scrolled through.
 *                 NOTE: for "list-of-parents" pagination (e.g.
 *                 /goals/all paginates by user, ships all goals for
 *                 those users), `total` is the PARENT count — see
 *                 each service for the exact unit.
 *   - `limit`     The page size the server honoured. May differ from
 *                 what the client requested if the server clamps.
 *   - `offset`    Rows (or parents) skipped before this page.
 *   - `has_more`  True iff (offset + items.length) < total. Saves the
 *                 UI from doing the arithmetic itself.
 */

export interface Paginated<T> {
  /** Rows on THIS page (length ≤ limit). */
  items: T[];
  /** Total rows (or parents — see service docs) matching the
   *  underlying query. NOT just this page. */
  total: number;
  /** Page size the server honoured. */
  limit: number;
  /** Rows skipped before this page. */
  offset: number;
  /** True iff (offset + items.length) < total — saves the UI an
   *  arithmetic check when deciding "show Load More?" */
  has_more: boolean;
}
