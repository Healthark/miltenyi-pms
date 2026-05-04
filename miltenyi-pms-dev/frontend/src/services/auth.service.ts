import apiClient from "./api.client";

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
  // Sub-role of Admin — always implies role === "Admin". Gates the
  // Management Review tab and its inline rating actions. Backend also
  // gates the corresponding endpoints so this is purely a UI affordance.
  is_management: boolean;
}

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
   * (if found + active) issues a reset token + emails the link, using the
   * same template as the admin-triggered reset.
   *
   * Resolves on 204. Throws on 404 (no account), 429 (rate-limited), or
   * any other non-2xx status — the caller should surface the message.
   */
  forgotPassword: async (email: string): Promise<void> => {
    await apiClient.post("/auth/forgot-password", { email });
  },
};
