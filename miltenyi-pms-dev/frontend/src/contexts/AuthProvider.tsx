import { useState, useCallback, useMemo, useEffect, type ReactNode } from "react";
import { AuthContext, type AuthContextType } from "@/contexts/AuthContext";
import { authService, type AuthResponse } from "@/services/auth.service";
import { queryClient } from "@/lib/queryClient";

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
    // Drop every cached query so the next user on the same machine
    // doesn't see flashes of the previous user's data while their
    // queries refetch. `clear()` cancels in-flight fetches and resets
    // all observers — safe to call even with no active queries.
    queryClient.clear();
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

  // App-bootstrap session refresh + sliding keep-alive. Three triggers:
  //   1. on mount — populate auth context (the page just loaded and we
  //      don't yet know if the user is authenticated).
  //   2. on tab visibility regain — catches "user comes back after lunch":
  //      their role may have changed (risk 1.6) or the JWT may need its
  //      sliding window reset before the next interaction (risk 1.7).
  //   3. every 10 min while visible — pre-empts the 30-min JWT TTL so
  //      idle-but-open tabs don't drop in-flight form work to a silent 401.
  // The periodic ping is guarded by visibilityState so hidden tabs don't
  // burn API calls or phone battery. refreshSession swallows non-auth
  // errors, and the axios interceptor only forces logout on 401/deactivated
  // 403 — a transient 5xx during a background ping leaves cached claims
  // alone.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshSession();

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void refreshSession();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    const intervalId = window.setInterval(
      () => {
        if (document.visibilityState === "visible") {
          void refreshSession();
        }
      },
      10 * 60 * 1000,
    );

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.clearInterval(intervalId);
    };
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
