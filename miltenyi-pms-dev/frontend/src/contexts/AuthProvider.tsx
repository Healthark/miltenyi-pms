import { useState, useCallback, useMemo, useEffect, type ReactNode } from "react";
import { AuthContext, type AuthContextType } from "./AuthContext";
import { authService, type AuthResponse } from "../services/auth.service";

// Maps outside the component and acts as source of truth
const THEME_MAP: Record<number, string> = {
  1: "healthark",
  2: "miltenyi",
};

/** Browser tab title + favicon per org */
const BRAND_META: Record<number, { title: string; favicon: string }> = {
  1: { title: "Healthark PMS",       favicon: "/healtharklogo-small.png" },
  2: { title: "Miltenyi Biotec PMS", favicon: "/miltenyi-biotech-small.svg" },
};

/** Helper – create or reuse the <link rel="icon"> element */
function setFavicon(href: string): void {
  let link = document.querySelector<HTMLLinkElement>("link[rel='icon']");
  if (!link) {
    link = document.createElement("link");
    link.rel = "icon";
    document.head.appendChild(link);
  }
  link.href = href;
}

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: Readonly<AuthProviderProps>) {
  /**
   * Lazy initializer: runs exactly once on mount.
   * After C12 the JWT lives in an HttpOnly cookie that JS cannot read, so
   * "am I logged in?" is no longer derivable synchronously. We hydrate the
   * cached claims from localStorage (so the UI can skip the login flash for
   * likely-authenticated users) and let the `refreshSession` effect below
   * confirm against the server. If the cookie is gone/expired, /auth/session
   * 401s, the axios interceptor runs forceLogout(), and the user state here
   * gets cleared via the storage event.
   */
  const [user, setUser] = useState<AuthResponse | null>(() => {
    try {
      const savedUser = localStorage.getItem("user");
      if (savedUser) {
        return JSON.parse(savedUser) as AuthResponse;
      }
    } catch {
      localStorage.removeItem("user");
    }
    return null;
  });

  /**
   * Persist session claims and update state atomically. The token is NOT
   * stored here — it lives in an HttpOnly cookie the browser attaches on
   * every request automatically. Post-login navigation is handled by the
   * consuming component (Login.tsx watches `user`).
   */
  const login = useCallback((data: AuthResponse): void => {
    // Store the CSRF token separately so the axios interceptor can read it
    // on cross-origin deployments where document.cookie is domain-scoped.
    if (data.csrf_token) {
      localStorage.setItem("csrf_token", data.csrf_token);
    }
    localStorage.setItem("user", JSON.stringify(data));
    setUser(data);
  }, []);

  const logout = useCallback((): void => {
    // Clear the server-side cookies first (fire-and-forget — local cleanup
    // still runs even if the network call fails).
    void authService.logout();
    localStorage.removeItem("user");
    localStorage.removeItem("csrf_token");
    setUser(null);
  }, []);

  /**
   * Re-pull live auth claims and merge them into state + localStorage. Used
   * on app mount and exposed via the context so consumers can force a
   * refresh after actions that change claims (e.g. self-service password
   * change clears `must_change_password`).
   *
   * No token-presence check — we can't read the HttpOnly cookie. Instead we
   * always ask the server; a 401 tells us the session is dead and the axios
   * interceptor's forceLogout() wipes local state. That makes this call the
   * authoritative bootstrap even for "fresh tab" users whose localStorage
   * has stale claims from a previous logged-in session.
   */
  const refreshSession = useCallback(async (): Promise<void> => {
    try {
      const claims = await authService.getSession();
      setUser((prev) => ({ ...(prev ?? {}), ...claims } as AuthResponse));
      const saved = JSON.parse(localStorage.getItem("user") ?? "null");
      localStorage.setItem(
        "user",
        JSON.stringify({ ...(saved ?? {}), ...claims }),
      );
    } catch {
      /* 401/403 handled by the axios interceptor (forceLogout); other errors
         leave cached claims alone so a flaky network doesn't kick the user out */
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  /**
   * Multi-tab session sync. When another tab logs out (or logs in as a
   * different user), the `user` key changes in localStorage — the `storage`
   * event fires in *other* tabs. Mirror the change here so the whole
   * browser stays on one session. (We no longer store `token`; the browser
   * already shares HttpOnly cookies across tabs of the same origin.)
   */
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key !== "user" && e.key !== null) return;
      const savedUser = localStorage.getItem("user");
      if (!savedUser) {
        setUser(null);
        return;
      }
      try {
        setUser(JSON.parse(savedUser) as AuthResponse);
      } catch {
        setUser(null);
      }
    };
    globalThis.addEventListener("storage", handler);
    return () => globalThis.removeEventListener("storage", handler);
  }, []);

  /**
   * Dynamic Theming Sync
   * Automatically updates the CSS variables on the root document whenever 
   * the authenticated organization changes.
   */
  useEffect(() => {
    if (user?.org_id) {
      const themeKey = THEME_MAP[user.org_id] || "healthark";
      document.documentElement.setAttribute("data-theme", themeKey);

      const meta = BRAND_META[user.org_id] ?? BRAND_META[1];
      document.title = meta.title;
      setFavicon(meta.favicon);
    } else {
      document.documentElement.removeAttribute("data-theme");
      // Reset to Healthark defaults when logged out
      document.title = "Healthark PMS";
      setFavicon("/healtharklogo-small.png");
    }
  }, [user?.org_id]);

  /**
   * The primary Story 1.2 guard. Checks the features array that came
   * from the org's `enabled_features` column at login time.
   */
  const hasFeature = useCallback(
    (feature: string): boolean => {
      return user?.features?.includes(feature) ?? false;
    },
    [user],
  );

  // Derived boolean — avoids null checks scattered across the codebase
  const isAuthenticated = useMemo(() => user !== null, [user]);

  /**
   * useMemo here is non-negotiable: without it, every render creates a new
   * value object, causing all consumers to re-render even with stable state.
   * useCallback on each function ensures the deps array stays stable.
   */
  const value = useMemo<AuthContextType>(
    () => ({ user, isAuthenticated, login, logout, hasFeature, refreshSession }),
    [user, isAuthenticated, login, logout, hasFeature, refreshSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
