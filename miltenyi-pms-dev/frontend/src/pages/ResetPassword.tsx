import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { KeyRound, Loader2, Lock, AlertCircle, CheckCircle2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const API_BASE =
  import.meta.env.VITE_API_URL ?? "http://localhost:8000/api/v1";
const MIN_PASSWORD_LENGTH = 8;

/**
 * Public reset-password page reached from the email link.
 *
 * Reads `?token=…` from the URL, lets the user pick a new password, then
 * POSTs to /auth/reset-password. Uses plain fetch (not apiClient) to avoid
 * the auth interceptor's 401 → forceLogout side-effect — the user is
 * unauthenticated by definition while sitting on this page.
 *
 * Two security guards run on mount:
 *
 *   1. URL scrub. The raw token arrives in `?token=…` which means it
 *      ends up in: browser history, server access logs, and any
 *      Referer header sent by third-party assets loaded on this page.
 *      We capture the token into local state once and immediately
 *      `navigate(..., { replace: true })` to drop it from the URL +
 *      history. The backend's global `Referrer-Policy: no-referrer`
 *      header is the second layer of this defence.
 *
 *   2. Force-logout if a logged-in user lands here. If user A is
 *      signed in and clicks user B's reset link (forwarded by mistake,
 *      shared inbox, etc.), the original code would have let A change
 *      B's password while A's session kept a stale JWT. We sign A out
 *      immediately. Combined with the backend's `pwd_iat`-based JWT
 *      revocation (any active token for B is invalidated when B's
 *      password changes), the stranger-link attack is fully closed.
 */
export function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { isAuthenticated, logout } = useAuth();

  // Capture the token once and store in component state. The URL is
  // scrubbed below; subsequent reads of `params` would return null.
  const [token] = useState<string>(
    () => params.get("token") ?? "",
  );

  // One-shot guard for the URL-scrub effect. Without it, the navigate()
  // would re-fire on every re-render after the URL had already been
  // replaced.
  const scrubbedRef = useRef(false);
  useEffect(() => {
    if (scrubbedRef.current) return;
    if (!params.get("token")) return; // nothing to scrub
    scrubbedRef.current = true;
    // Replace removes the token from both URL bar AND browser history;
    // a Back nav doesn't restore it.
    navigate("/reset-password", { replace: true });
  }, [params, navigate]);

  // One-shot logout guard for the authenticated-user case.
  const loggedOutRef = useRef(false);
  useEffect(() => {
    if (loggedOutRef.current) return;
    if (!isAuthenticated) return;
    loggedOutRef.current = true;
    logout();
  }, [isAuthenticated, logout]);

  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // Single password field on this surface (no confirm-re-enter). The
  // user just reached this page via a one-time-use email link — the
  // link itself is the second factor proving intent, so forcing them
  // to type the password twice adds friction without security gain.
  // The Profile page's Change Password flow still keeps the confirm
  // field + the "Update password?" modal because that flow can be
  // triggered from an already-authenticated session (e.g. unlocked
  // screen) where the extra confirmation actually matters.
  const validation = useMemo<string | null>(() => {
    if (!token) return "Reset token is missing from the URL.";
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    return null;
  }, [token, password]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (validation) {
      setError(validation);
      return;
    }
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`${API_BASE}/auth/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, new_password: password }),
      });

      if (res.status === 204) {
        setDone(true);
        // No auto-redirect. The success screen has a prominent "Go to
        // sign in" button; the user clicks when ready. Removed the
        // 2.5s setTimeout because users who tab away mid-message lost
        // context, and the silent navigate broke any back-button
        // intent.
        return;
      }

      let detail: string | null = null;
      try {
        const body = await res.json();
        if (typeof body?.detail === "string") detail = body.detail;
      } catch {
        /* fall through */
      }
      setError(
        detail ??
          "We couldn't reset your password. Try again, or ask your administrator to issue a fresh link.",
      );
    } catch {
      setError("Network error — check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <Shell>
        <div className="flex flex-col items-center text-center">
          <div className="rounded-full bg-green-50 p-3">
            <CheckCircle2 className="h-7 w-7 text-green-600" aria-hidden="true" />
          </div>
          <h1 className="mt-4 font-display text-xl font-semibold text-text-main">
            Password updated
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            You can now sign in with your new password.
          </p>
          <Link
            to="/login"
            className="mt-5 inline-flex items-center justify-center rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            Go to sign in
          </Link>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="flex items-center gap-3">
        <div className="rounded-lg bg-brand-light p-2">
          <KeyRound className="h-5 w-5 text-brand" aria-hidden="true" />
        </div>
        <div>
          <h1 className="font-display text-lg font-semibold text-text-main">
            Choose a new password
          </h1>
          <p className="text-xs text-text-muted">
            This link is one-time-use. Pick a password you'll remember.
          </p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <Field
          id="new-password"
          label="New password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
        />

        <p className="text-xs text-text-muted">
          Must be at least {MIN_PASSWORD_LENGTH} characters.
        </p>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3">
            <AlertCircle
              className="h-4 w-4 shrink-0 text-red-600 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-xs text-red-800">{error}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={submitting || !!validation}
          className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Updating…
            </>
          ) : (
            "Set new password"
          )}
        </button>

        <div className="pt-2 text-center">
          <Link to="/login" className="text-xs font-medium text-brand hover:underline">
            Back to sign in
          </Link>
        </div>
      </form>
    </Shell>
  );
}

function Shell({ children }: { readonly children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-sm">
        {children}
      </div>
    </div>
  );
}

interface FieldProps {
  readonly id: string;
  readonly label: string;
  readonly type: "password" | "text";
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly autoComplete: string;
  readonly minLength: number;
}

function Field({
  id,
  label,
  type,
  value,
  onChange,
  autoComplete,
  minLength,
}: FieldProps) {
  return (
    <div>
      <label
        htmlFor={id}
        className="block text-xs font-medium text-text-muted mb-1"
      >
        {label}
      </label>
      <div className="relative">
        <Lock
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted"
          aria-hidden="true"
        />
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          minLength={minLength}
          required
          className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
        />
      </div>
    </div>
  );
}
