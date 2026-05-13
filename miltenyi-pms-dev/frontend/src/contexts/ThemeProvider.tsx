import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ThemeContext, type ThemeContextValue } from "@/contexts/ThemeContext";
import { useAuth } from "@/hooks/useAuth";
import { authService, type ThemePreference } from "@/services/auth.service";

const THEME_STORAGE_KEY = "theme";

function readStoredTheme(): ThemePreference {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (raw === "dark" || raw === "light") return raw;
  } catch {
    /* localStorage unavailable — fall through to default */
  }
  return "light";
}

function applyThemeToDom(theme: ThemePreference): void {
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
}

interface ThemeProviderProps {
  readonly children: ReactNode;
}

/**
 * Owns the light/dark theme bit. Resolution order:
 *   1. Server-side value from the authenticated user — once it loads.
 *   2. `localStorage["theme"]` for the device's last-known choice
 *      (avoids a flash for repeat visitors before auth resolves).
 *   3. "light" as the seed.
 *
 * Writes happen optimistically — DOM + localStorage update synchronously
 * and the API PATCH fires asynchronously. A failed PATCH is logged but
 * does not roll back the local state; the next session refresh will
 * either re-sync or surface the divergence.
 */
export function ThemeProvider({ children }: Readonly<ThemeProviderProps>) {
  const { user, isAuthenticated, refreshSession } = useAuth();

  // Seed from localStorage so the very first paint after a refresh
  // matches the user's previous choice on this device.
  const [theme, setThemeState] = useState<ThemePreference>(readStoredTheme);

  // Apply on mount so the seed actually paints. Subsequent setTheme()
  // calls re-apply directly without needing this effect to fire again.
  useEffect(() => {
    applyThemeToDom(theme);
    // Intentionally empty dep array — we only want the mount-time apply.
    // Subsequent changes flow through setTheme() below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the auth claims arrive (or refresh), the server's saved value
  // wins. This catches the case where the user toggled on Device A and
  // is now logging in on Device B — Device B should pick up the saved
  // preference instead of whatever localStorage cached.
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    const serverTheme = user.theme_preference;
    if (serverTheme && serverTheme !== theme) {
      setThemeState(serverTheme);
      applyThemeToDom(serverTheme);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, serverTheme);
      } catch {
        /* ignore */
      }
    }
  }, [isAuthenticated, user, theme]);

  const setTheme = useCallback(
    (next: ThemePreference) => {
      setThemeState(next);
      applyThemeToDom(next);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
      if (isAuthenticated) {
        authService
          .updateTheme(next)
          .then(() => {
            // Pull the latest session so the AuthProvider's cached
            // claims agree with the server (and other tabs sync via
            // the storage event).
            void refreshSession();
          })
          .catch(() => {
            // Best-effort — keep the local change. A subsequent
            // refreshSession will reconcile.
          });
      }
    },
    [isAuthenticated, refreshSession],
  );

  const toggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      isDark: theme === "dark",
      setTheme,
      toggleTheme,
    }),
    [theme, setTheme, toggleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
