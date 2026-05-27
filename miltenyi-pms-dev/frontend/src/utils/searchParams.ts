/**
 * URL search-param helpers for the page-level filter write-back loop.
 *
 * Pattern (used by AnnualGoals, AnnualReviews, ManagementReview, UsersTab):
 *   1. Read URL on mount via `useSearchParams` → seed state (existing).
 *   2. Add a write-back useEffect that mirrors the current filter
 *      state to URL via `setOrDeleteParam` + `setSearchParams`. Guards
 *      against the first-render race by gating on the same ref the
 *      reader uses (`defaultedRef.current`) so it doesn't overwrite
 *      URL params before the reader has had a chance to seed state
 *      from them.
 *
 * Why this exists:
 *   The previous pattern kept filters in `useState` only — refresh,
 *   share-link, or a browser-back across an external nav wiped them.
 *   Mirroring to URL fixes refresh + share-link. (Back-button within
 *   the same page intentionally doesn't restore filter state — that
 *   would require URL-as-source-of-truth, a bigger refactor.)
 */

/**
 * Set the param when `value` is meaningful; delete it otherwise.
 *
 * Empty values that should NOT appear in URL (kept off so the URL
 * stays clean and queryKey hashing stays stable):
 *   - `undefined`, `null`     — "no filter applied" baseline
 *   - empty string `""`       — combobox-cleared sentinel
 *   - `"all"`                 — explicit "no filter" sentinel used by
 *                               our select dropdowns (RoleFilter,
 *                               StatusFilter, etc.)
 *
 * Numbers serialise via `String(value)`; callers parse back to
 * `Number(...)` on the reader side.
 */
export function setOrDeleteParam(
  params: URLSearchParams,
  key: string,
  value: string | number | undefined | null,
): void {
  if (value === undefined || value === null || value === "" || value === "all") {
    params.delete(key);
  } else {
    params.set(key, String(value));
  }
}

/**
 * True if `next` would actually change the URL relative to `current`.
 * Used to skip no-op `setSearchParams` calls — React Router treats a
 * structurally-equal-but-different-object as a navigation, which can
 * cause subtle effect re-runs.
 *
 * Compares the serialised query string (so insertion order matters,
 * which is acceptable here because we always rebuild `next` from
 * `current` in the same key order).
 */
export function searchParamsChanged(
  current: URLSearchParams,
  next: URLSearchParams,
): boolean {
  return current.toString() !== next.toString();
}
