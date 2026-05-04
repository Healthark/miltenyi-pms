import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

interface ProtectedRouteProps {
  /**
   * When provided, the route additionally checks that the current user's
   * organization has this feature enabled. Unauthenticated users are always
   * redirected to /login regardless of this prop.
   */
  requiredFeature?: string;
  /**
   * When provided, the route additionally checks that the current user's
   * role is included in this array. If not, they are redirected to /unauthorized.
   */
  requiredRole?: string[];
}

/**
 * Four-stage guard:
 *   Stage 1 — Authentication:          No valid session → /login
 *   Stage 2 — Forced password change:  must_change_password is true → /change-password
 *   Stage 3 — Feature Gate:            Feature not enabled for this org → fallback
 *   Stage 4 — Role Gate:               User role not in allowed list → fallback
 *
 * Fallback is /dashboard when the user has the dashboard feature (their
 * legitimate home), and /unauthorized only when they don't — i.e. a
 * genuinely locked-out account with no home to send them to. This avoids
 * the "login → unauthorized" flow that happens when a stale intendedPath
 * gets replayed after a forced re-login.
 *
 * We preserve `location` in state so Login.tsx can redirect back after
 * successful authentication (the "intended destination" pattern).
 */
export function ProtectedRoute({
  requiredFeature,
  requiredRole,
}: Readonly<ProtectedRouteProps>) {
  const { isAuthenticated, hasFeature, user } = useAuth();
  const location = useLocation();

  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Admin-reset password flow: the user must choose a new password before
  // any protected route renders. The /change-password page itself doesn't
  // use ProtectedRoute, so there's no redirect loop.
  if (user?.must_change_password) {
    return <Navigate to="/change-password" replace />;
  }

  // Using hasFeature("dashboard") here (not features.length > 0) avoids a
  // redirect loop: if we sent dashboard-less users to /dashboard, its own
  // feature gate would bounce them right back.
  const fallback = hasFeature("dashboard") ? "/dashboard" : "/unauthorized";

  if (requiredFeature && !hasFeature(requiredFeature)) {
    return <Navigate to={fallback} replace />;
  }

  if (requiredRole && !requiredRole.includes(user?.role ?? "")) {
    return <Navigate to={fallback} replace />;
  }

  return <Outlet />;
}