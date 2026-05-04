/**
 * SystemSettingsContext.ts — Raw Context Object & TypeScript Interface.
 *
 * Three-File Rule (Step 1 of 3):
 *   This file has NO JSX. It exports only the context object and its type.
 *   Using .ts (not .tsx) satisfies Vite Fast Refresh's one-component-per-file rule.
 */

import { createContext } from "react";
import type { SystemSettingsResponse } from "../services/system-settings.service";

export interface SystemSettingsContextType {
  /** The current org's settings, or null if still loading / not configured. */
  settings: SystemSettingsResponse | null;

  /** True while the initial GET /settings/ call is in-flight. */
  isLoading: boolean;

  /** Non-null if the fetch failed (e.g. 404 = settings not initialized). */
  error: string | null;

  /** Re-fetch settings from the backend (called after Admin saves changes). */
  refreshSettings: () => Promise<void>;
}

/**
 * Default value is undefined — the useSystemSettings hook will throw a
 * dev-time error if consumed outside of <SystemSettingsProvider>.
 */
export const SystemSettingsContext = createContext<
  SystemSettingsContextType | undefined
>(undefined);
