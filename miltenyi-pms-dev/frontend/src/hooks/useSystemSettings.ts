/**
 * useSystemSettings.ts — Public Hook for the SystemSettings Context.
 *
 * Three-File Rule (Step 3 of 3):
 *   This file exports only the hook. It throws a clear dev-time error
 *   if a component tries to consume settings without being wrapped in
 *   the <SystemSettingsProvider>.
 *
 * Usage:
 *   import { useSystemSettings } from "../hooks/useSystemSettings";
 *   const { settings, isLoading } = useSystemSettings();
 */

import { useContext } from "react";
import {
  SystemSettingsContext,
  type SystemSettingsContextType,
} from "../contexts/SystemSettingsContext";

export function useSystemSettings(): SystemSettingsContextType {
  const context = useContext(SystemSettingsContext);

  if (context === undefined) {
    throw new Error(
      "useSystemSettings must be used within a <SystemSettingsProvider>. " +
        "Ensure the provider is mounted in main.tsx, wrapping <App />.",
    );
  }

  return context;
}
