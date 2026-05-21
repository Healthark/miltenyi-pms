import apiClient from "@/services/api.client";

/**
 * Live auth claims — mirrors backend SessionResponse. Same fields as the
 * login response minus the token itself, so they can refresh on app mount
 * without issuing a new JWT.
 */
export interface SessionClaims {
  user_id: number;
  full_name: string;
  role: string;
  org_id: number;
  features: string[]; // e.g. ["dashboard", "goals", "project_reviews", "mentoring"]
  // True when at least one active user reports to this user via mentor_id.
  // Drives mentor-only UI (Team Goals tab, etc.) regardless of role.
  has_mentees: boolean;
  // False for CEO/founders (no mentor) or when the mentor has been
  // soft-deleted. Annual goal creation is disabled in either case.
  has_mentor: boolean;
  // True when an admin just reset this user's password to a temporary one.
  // The frontend gates all protected routes to /change-password until cleared.
  must_change_password: boolean;
  // Saved UI theme — "light" | "dark". The frontend applies this at
  // login so the user lands in the appearance they last picked.
  theme_preference: ThemePreference;
  // Active cycle this user last dismissed on their dashboard. When it
  // diverges from `settings.active_cycle_name`, the dashboard shows a
  // "cycle rolled over" banner; click dismiss bumps this to the
  // current cycle. Null until the user dismisses for the first time.
  last_seen_cycle: string | null;
}

export type ThemePreference = "light" | "dark";

// After C12 the JWT lives in an HttpOnly cookie and is NEVER surfaced to JS.
// The login response body carries session claims + the CSRF token value.
// The CSRF token is also set as a readable cookie, but cross-origin
// deployments (Vercel → Render) can't read a foreign-domain cookie, so
// the body field is the cross-origin escape hatch. Same-origin dev ignores it.
export interface AuthResponse extends SessionClaims {
  csrf_token?: string; // present on login, absent on session refresh
}

export const authService = {
  login: async (email: string, password: string): Promise<AuthResponse> => {
    // FastAPI's OAuth2PasswordRequestForm requires form-data, not JSON
    const formData = new URLSearchParams();
    formData.append("username", email);
    formData.append("password", password);

    const response = await apiClient.post<AuthResponse>(
      "/auth/login",
      formData,
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );

    return response.data;
  },

  getSession: async (): Promise<SessionClaims> => {
    const response = await apiClient.get<SessionClaims>("/auth/session");
    return response.data;
  },

  logout: async (): Promise<void> => {
    // Clears the HttpOnly access + csrf cookies on the server. Local
    // state (the cached `user` claims) is cleared by AuthProvider.logout().
    try {
      await apiClient.post("/auth/logout");
    } catch {
      /* best effort — local cleanup still runs */
    }
  },

  /**
   * Self-service password reset request. Backend looks up the email and
   * (if found + active + under per-user quota) issues a reset token +
   * emails the link, using the same template as the admin-triggered reset.
   *
   * Always resolves on 204 — the backend deliberately does not signal
   * "unknown email" or "per-user quota hit" to avoid leaking which
   * addresses have accounts. The UI should treat 204 as "if your email is
   * registered, you'll get a link shortly". Throws on 429 (per-IP
   * rate-limited) or transport failure.
   */
  forgotPassword: async (email: string): Promise<void> => {
    await apiClient.post("/auth/forgot-password", { email });
  },

  /**
   * Persist the user's UI theme preference. Returns refreshed session
   * claims so the caller can update its cached `user` payload.
   */
  updateTheme: async (theme: ThemePreference): Promise<SessionClaims> => {
    const response = await apiClient.patch<SessionClaims>("/auth/me/theme", {
      theme_preference: theme,
    });
    return response.data;
  },

  /**
   * Stamp the user's `last_seen_cycle` to the current active cycle so
   * the dashboard's "cycle rolled over" banner disappears for them.
   * Returns refreshed session claims for the caller to refresh state.
   */
  dismissCycleBanner: async (): Promise<SessionClaims> => {
    const response = await apiClient.post<SessionClaims>(
      "/auth/me/dismiss-cycle-banner",
    );
    return response.data;
  },
};
