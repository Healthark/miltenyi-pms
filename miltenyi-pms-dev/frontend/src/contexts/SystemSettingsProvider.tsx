/**
 * SystemSettingsProvider.tsx — State Logic & Data Fetching.
 *
 * Three-File Rule (Step 2 of 3):
 *   This file exports exactly ONE component. The cache layer
 *   (TanStack Query) holds the actual state; this provider is a thin
 *   shim that exposes the cache through the legacy context API.
 *
 * Lifecycle:
 *   1. On mount with an authenticated user, useQuery fires GET /settings/.
 *   2. Settings + loading/error state are exposed via context to the
 *      entire component tree.
 *   3. refreshSettings() invalidates the cache entry, triggering a
 *      background refetch — Admin Panel calls this after saving so
 *      the Topbar / banners / gates update immediately.
 *
 * Why a Provider at all (vs. having consumers call useQuery directly):
 *   - 23 consumers across the codebase read these settings. Hoisting
 *     the query into one place keeps the cache observer count low
 *     (one subscriber feeding context vs. 23 separate observers).
 *   - The public { settings, isLoading, error, refreshSettings }
 *     contract is well-known; preserving it means zero changes at
 *     consumer call sites.
 *   - Backwards-compat: any future call site that wants to drop the
 *     context and use useQuery directly can do so freely — they'll
 *     hit the same cache entry under queryKeys.systemSettings.current().
 *
 * Migration note (PR #14):
 *   The previous useState + useEffect + useCallback machinery is gone.
 *   useQuery handles fetch-on-mount, unmount cancellation,
 *   stale-while-revalidate, and focus-refetch. The provider now does
 *   nothing but map the library's return shape to the legacy
 *   context shape.
 */

import { useCallback, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  SystemSettingsContext,
  type SystemSettingsContextType,
} from "@/contexts/SystemSettingsContext";
import { systemSettingsService } from "@/services/system-settings.service";
import { useAuth } from "@/hooks/useAuth";
import { queryKeys } from "@/lib/queryKeys";

/**
 * Map an unknown error (likely an AxiosError) to the human-facing
 * message the legacy provider returned. 404 gets a "not configured"
 * special-case so HR sees an actionable message instead of a generic
 * fetch failure.
 */
function mapSettingsError(err: unknown): string {
  if (err && typeof err === "object" && "response" in err) {
    const response = (err as { response?: { status?: number } }).response;
    if (response?.status === 404) {
      return "System settings have not been configured for this organization.";
    }
    return "Failed to load system settings. Please try again.";
  }
  return "An unexpected error occurred while loading settings.";
}

export function SystemSettingsProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // The query observer for the public read view. Gated on the user
  // being authenticated — there's nothing to fetch on the /login route.
  // queryClient.clear() in AuthProvider.logout (PR #19) wipes the
  // cached value when the user signs out, so subsequent renders see
  // settings: null.
  const settingsQuery = useQuery({
    queryKey: queryKeys.systemSettings.current(),
    queryFn: systemSettingsService.getSettings,
    enabled: Boolean(user),
  });

  // refreshSettings preserves the legacy contract (Promise<void>) so
  // existing callers — currently only AdminPanel.handleSaveSettings
  // after the updateSettings mutation — keep working without changes.
  // Under the hood it's now a cache invalidation; the actual refetch
  // happens whenever an observer remounts or focus returns.
  //
  // We await invalidateQueries so the returned Promise resolves only
  // after the refetch lands (matching the legacy hook's behaviour of
  // resolving when setSettings(data) completed). This matters when
  // callers do `await refreshSettings(); doSomething();` and expect
  // `settings` to reflect the new value before `doSomething()` runs.
  const refreshSettings = useCallback(async (): Promise<void> => {
    await queryClient.invalidateQueries({
      queryKey: queryKeys.systemSettings.current(),
    });
  }, [queryClient]);

  // Map library shape → legacy context shape. Same pattern as PR #13
  // (useReviewDetails). useMemo on `error` to avoid recomputing the
  // string on every render when nothing changed.
  const error: string | null = useMemo(() => {
    if (!settingsQuery.isError) return null;
    return mapSettingsError(settingsQuery.error);
  }, [settingsQuery.isError, settingsQuery.error]);

  // `isLoading` matches the legacy semantics: true only when we're
  // actually fetching for an authenticated user. For an unauthenticated
  // user (query parked via `enabled: false`), legacy code returned
  // false; AND with `Boolean(user)` matches that.
  const contextValue: SystemSettingsContextType = useMemo(
    () => ({
      settings: settingsQuery.data ?? null,
      isLoading: Boolean(user) && settingsQuery.isPending,
      error,
      refreshSettings,
    }),
    [settingsQuery.data, settingsQuery.isPending, user, error, refreshSettings],
  );

  return (
    <SystemSettingsContext.Provider value={contextValue}>
      {children}
    </SystemSettingsContext.Provider>
  );
}
