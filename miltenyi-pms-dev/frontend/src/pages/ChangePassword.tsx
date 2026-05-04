import { Navigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { PasswordChangeCard } from "../components/profile/PasswordChangeCard";

/**
 * Forced change-password screen shown when an admin has reset the user's
 * password to a temporary one (user.must_change_password === true).
 *
 * Intentionally bypasses the Sidebar/Topbar shell so the user cannot
 * navigate away. Rendered at /change-password; ProtectedRoute redirects
 * every other authenticated route here while the flag is set. Once the
 * PasswordChangeCard succeeds, it calls AuthProvider.refreshSession() which
 * flips the flag and this page falls through the Navigate below.
 */
export function ChangePassword() {
  const { user } = useAuth();

  // Flag already cleared — bounce back to dashboard.
  if (!user?.must_change_password) {
    return <Navigate to="/dashboard" replace />;
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 py-12">
      <div className="w-full max-w-md space-y-5">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="rounded-xl bg-amber-50 p-3">
            <KeyRound className="h-6 w-6 text-amber-600" aria-hidden="true" />
          </div>
          <h1 className="font-display text-lg font-semibold text-text-main">
            Set a new password
          </h1>
          <p className="text-sm text-text-muted max-w-sm">
            An administrator reset your password. Choose a new one to continue
            using your account.
          </p>
        </div>
        <PasswordChangeCard />
      </div>
    </div>
  );
}
