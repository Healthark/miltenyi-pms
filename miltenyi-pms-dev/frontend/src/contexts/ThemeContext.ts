import { createContext } from "react";
import type { ThemePreference } from "@/services/auth.service";

export interface ThemeContextValue {
  /** Currently-applied theme. */
  readonly theme: ThemePreference;
  /** Convenience flag, identical to `theme === "dark"`. */
  readonly isDark: boolean;
  /** Apply a new theme — updates DOM + localStorage + persists to backend
   *  (best-effort) when the user is authenticated. */
  readonly setTheme: (next: ThemePreference) => void;
  /** Flip between light and dark. */
  readonly toggleTheme: () => void;
}

// Undefined sentinel forces consumers through useTheme(), which throws a
// clear dev-time error when used outside the provider.
export const ThemeContext = createContext<ThemeContextValue | undefined>(
  undefined,
);
