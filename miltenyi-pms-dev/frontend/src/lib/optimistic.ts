/**
 * optimistic.ts — helpers for optimistic-update cache mutations.
 *
 * The TanStack Query optimistic-update recipe is well-known:
 *   1. `onMutate`: snapshot cache state, apply optimistic patch, return rollback context
 *   2. `onError`:  restore from snapshot
 *   3. `onSettled`: invalidate to revalidate against server truth
 *
 * Step 2 (patch) is the part with shape-specific code: our cache holds
 * BOTH array values (e.g. `useQuery<Goal[]>`) AND paginated values
 * (`useInfiniteQuery<Paginated<Review>>` with `{ pages: [{ items: [...] }] }`).
 * Theme 5 also baked filter/sort into many query keys, so a single
 * affected row might live in many cache entries that all need patching.
 *
 * These helpers paper over the two shapes + the multi-entry case, so
 * mutation call sites stay ~5 lines instead of 15.
 *
 * Usage:
 *   onMutate: async (vars) => {
 *     await queryClient.cancelQueries({ queryKey: queryKeys.annualReviews.all });
 *     const snapshot = patchRowsAcross(queryClient,
 *       queryKeys.annualReviews.all,
 *       (r) => r.id === vars.reviewId,
 *       { status: "completed", final_performance_rating: vars.rating },
 *     );
 *     return { snapshot };  // returned to onError + onSettled
 *   },
 *   onError: (_err, _vars, ctx) => ctx?.snapshot.restore(),
 *   onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.annualReviews.all }),
 *
 * Why the multi-entry shape:
 *   The same row can appear in multiple cache entries when filter/sort
 *   variants are loaded. E.g. HR has `/annual-reviews/all?status=draft`
 *   and `/annual-reviews/all?function=Eng` both cached — a row matching
 *   both should be patched in both. Iterating via `getQueriesData({ queryKey: prefix })`
 *   finds every entry; the patch runs per-entry.
 *
 * Why we don't try to be clever about "filter doesn't match anymore":
 *   When optimistic patch changes the row's status to "completed", the
 *   row may no longer match the active `?status=draft` filter. We do
 *   NOT remove it from the page — `onSettled` triggers an invalidation
 *   that revalidates against the server, which will remove the row if
 *   the filter genuinely excludes it. The brief visual blip (1 cache
 *   entry shows a row under a filter it no longer matches) is
 *   acceptable; "row temporarily under wrong filter" is much less
 *   jarring than "click 'set rating' and nothing happens for 200ms."
 */

import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { Paginated } from "@/lib/pagination";

/**
 * Snapshot returned by patchRowsAcross. Pass to `onError` to restore.
 * Holds the previous cache contents keyed by the EXACT cache-entry
 * key, so restoration is identity-preserving (the cache observers
 * see the same reference they had before the optimistic patch).
 */
export interface OptimisticSnapshot {
  /** Roll back every patched cache entry to its pre-patch value. */
  restore: () => void;
}

/**
 * Patch rows across every cache entry under a prefix that contains a
 * matching row. Handles both array-shape and `useInfiniteQuery`-shape
 * (paginated `{ pages: [{ items: T[] }] }`) automatically.
 *
 * Returns a snapshot that the caller stores in mutation context and
 * passes to `onError` for rollback.
 *
 * Caveat — the caller is responsible for calling
 * `await queryClient.cancelQueries({ queryKey: prefix })` BEFORE this
 * helper. Otherwise an in-flight refetch could land AFTER the patch
 * and overwrite the optimistic state with stale server data.
 */
export function patchRowsAcross<T>(
  queryClient: QueryClient,
  prefix: QueryKey,
  predicate: (row: T) => boolean,
  patch: Partial<T> | ((row: T) => T),
): OptimisticSnapshot {
  const entries = queryClient.getQueriesData({ queryKey: prefix });
  const restoreList: Array<{ key: QueryKey; data: unknown }> = [];

  const applyPatch = (row: T): T =>
    typeof patch === "function" ? patch(row) : { ...row, ...patch };

  for (const [key, data] of entries) {
    if (data === undefined) continue;

    // Detect the cache-entry shape. `useInfiniteQuery` cache values
    // look like `{ pages: [...], pageParams: [...] }`; useQuery
    // returns the raw `queryFn` value (here usually `T[]`).
    if (isInfiniteData<T>(data)) {
      // Walk pages → items, patch matching rows. Snapshot the ORIGINAL
      // reference so restore is identity-preserving.
      let touched = false;
      const nextPages = data.pages.map((page) => {
        if (!page.items.some(predicate)) return page;
        touched = true;
        return {
          ...page,
          items: page.items.map((row) =>
            predicate(row) ? applyPatch(row) : row,
          ),
        };
      });
      if (touched) {
        restoreList.push({ key, data });
        queryClient.setQueryData(key, { ...data, pages: nextPages });
      }
    } else if (Array.isArray(data)) {
      // Plain array (useQuery<T[]>). Patch in place.
      const arr = data as T[];
      if (!arr.some(predicate)) continue;
      restoreList.push({ key, data });
      queryClient.setQueryData(
        key,
        arr.map((row) => (predicate(row) ? applyPatch(row) : row)),
      );
    } else {
      // Single-entity cache (useQuery<T>). Patch if it matches.
      const row = data as T;
      if (row && typeof row === "object" && "id" in row && predicate(row)) {
        restoreList.push({ key, data });
        queryClient.setQueryData(key, applyPatch(row));
      }
    }
  }

  return {
    restore: () => {
      for (const { key, data } of restoreList) {
        queryClient.setQueryData(key, data);
      }
    },
  };
}

/**
 * Detect TanStack Query's `useInfiniteQuery` cache shape. Duck-typed
 * because the library's `InfiniteData<T>` type isn't imported here —
 * we don't want a hard dependency on the version-specific export.
 */
function isInfiniteData<T>(
  data: unknown,
): data is { pages: Paginated<T>[]; pageParams: unknown[] } {
  return (
    typeof data === "object" &&
    data !== null &&
    "pages" in data &&
    "pageParams" in data &&
    Array.isArray((data as { pages: unknown }).pages)
  );
}
