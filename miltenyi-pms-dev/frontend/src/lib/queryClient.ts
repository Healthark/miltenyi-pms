import { QueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";

/**
 * The application's TanStack Query cache singleton.
 *
 * Lives in its own module (rather than inline in main.tsx) for two reasons:
 *   1. Mutations elsewhere in the app can `import { queryClient }` and call
 *      `queryClient.invalidateQueries({ queryKey: [...] })` after a write.
 *   2. AuthProvider.logout() calls `queryClient.clear()` to wipe the cache
 *      so the next user on the same machine doesn't see flashes of the
 *      previous user's cached data.
 *
 * ── Defaults (read these comments before tuning) ─────────────────────
 *
 *   staleTime: 30s
 *     "How long after a successful fetch is the data considered fresh?"
 *     During this window, mounting a component with the same queryKey
 *     reads from cache and does NOT trigger a background refetch.
 *     After this window, the data is "stale" — cache is still served
 *     instantly on mount (stale-while-revalidate), but a background
 *     refetch fires to confirm.
 *     30s is a deliberate sweet spot for an HR app: navigating between
 *     pages feels instant, and going to lunch + coming back triggers
 *     fresh data automatically.
 *
 *   gcTime: 5 min  (was called cacheTime in v4)
 *     "How long does an UNUSED query (zero subscribers) stay in cache
 *     before being garbage-collected?" Default. Keeps memory usage
 *     bounded while still serving fast revisits within a normal
 *     working window.
 *
 *   refetchOnWindowFocus: true
 *     Default. When the user tabs back into the app, every active
 *     query is checked against staleTime and silently refetched if
 *     stale. This is the "I left this tab open all night and it just
 *     fixed itself" feature. Disable per-query for things that
 *     shouldn't refetch on focus (e.g., a paginated export view).
 *
 *   retry: skip 4xx, retry up to 2× on network/5xx
 *     For 401/403 the api.client interceptor already runs forceLogout
 *     and redirects. Retrying those would just hammer a dead session.
 *     For 4xx in general (validation errors, not-found), retrying
 *     never changes the outcome — fail fast. Network and 5xx errors
 *     are worth a couple of attempts (exponential backoff is built-in).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      retry: (failureCount, error) => {
        if (isAxiosError(error)) {
          const status = error.response?.status;
          if (status !== undefined && status >= 400 && status < 500) {
            return false;
          }
        }
        return failureCount < 2;
      },
    },
    mutations: {
      // Mutations only retry on network blips, never on server-side
      // rejections. A failed write should surface immediately so the
      // user can react — silently retrying a 400 is misleading.
      retry: (failureCount, error) => {
        if (isAxiosError(error) && error.response) {
          return false;
        }
        return failureCount < 1;
      },
    },
  },
});
