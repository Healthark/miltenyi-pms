/**
 * SystemSettingsProvider.tsx — State Logic & Data Fetching.
 *
 * Three-File Rule (Step 2 of 3):
 *   This file exports exactly ONE component. All state management
 *   (useState, useCallback, useMemo, useEffect) lives here.
 *
 * Lifecycle:
 *   1. On mount, if the user is authenticated, fetch GET /settings/.
 *   2. Expose settings + loading/error state to the entire component tree.
 *   3. Provide a refreshSettings() callback for the Admin Panel to call
 *      after saving changes, ensuring the Topbar updates instantly.
 *
 * Performance:
 *   - refreshSettings is wrapped in useCallback (stable reference).
 *   - The context value object is wrapped in useMemo.
 *   - Without BOTH, child components re-render on every parent render.
 */

import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";
import {
  SystemSettingsContext,
  type SystemSettingsContextType,
} from "./SystemSettingsContext";
import { systemSettingsService } from "../services/system-settings.service";
import type { SystemSettingsResponse } from "../services/system-settings.service";
import { useAuth } from "../hooks/useAuth";

export function SystemSettingsProvider({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { user } = useAuth();

  const [settings, setSettings] = useState<SystemSettingsResponse | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch settings from the backend.
   * Stable reference via useCallback — safe to pass as a prop or
   * include in useEffect dependency arrays without causing loops.
   */
  const refreshSettings = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);

    try {
      const data = await systemSettingsService.getSettings();
      setSettings(data);
    } catch (err: unknown) {
      // Type-narrowing guard — never use `as` casting (ESLint/SonarQube rule)
      if (
        err !== null &&
        typeof err === "object" &&
        "response" in err &&
        typeof (err as Record<string, unknown>).response === "object"
      ) {
        const response = (err as { response: { status: number } }).response;
        if (response.status === 404) {
          // Settings not initialized yet — not a crash, just empty state.
          setError(
            "System settings have not been configured for this organization.",
          );
          setSettings(null);
        } else {
          setError("Failed to load system settings. Please try again.");
        }
      } else {
        setError("An unexpected error occurred while loading settings.");
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Auto-fetch on mount when the user is authenticated.
   * When the user logs out (user becomes null), clear settings.
   */
  useEffect(() => {
    if (user) {
      refreshSettings();
    } else {
      setSettings(null);
      setError(null);
    }
  }, [user, refreshSettings]);

  /**
   * Memoized context value — prevents every consumer from re-rendering
   * unless one of these four values actually changes.
   */
  const contextValue: SystemSettingsContextType = useMemo(
    () => ({ settings, isLoading, error, refreshSettings }),
    [settings, isLoading, error, refreshSettings],
  );

  return (
    <SystemSettingsContext.Provider value={contextValue}>
      {children}
    </SystemSettingsContext.Provider>
  );
}
