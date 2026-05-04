import { createContext } from "react";
import type { AuthResponse } from "../services/auth.service";

/**
 * Describes everything a consumer can read from or do with auth state.
 * `hasFeature` is the primary guard utility for Story 1.2.
 */
export interface AuthContextType {
  user: AuthResponse | null;
  isAuthenticated: boolean;
  login: (data: AuthResponse) => void;
  logout: () => void;
  /**
   * Returns true if the current user's organization has the given feature enabled.
   * Usage: hasFeature("goals"), hasFeature("mentoring")
   */
  hasFeature: (feature: string) => boolean;
  /**
   * Re-pull the live auth claims (role, features, mentor/mentee flags,
   * must_change_password). Call after any action that changes one of those
   * (e.g. right after the user successfully changes their password so the
   * admin-reset gate lifts).
   */
  refreshSession: () => Promise<void>;
}

// Undefined sentinel forces consumers through the useAuth hook,
// which throws a clear dev-time error if used outside the Provider.
export const AuthContext = createContext<AuthContextType | undefined>(
  undefined,
);
