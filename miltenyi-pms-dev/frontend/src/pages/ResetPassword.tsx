import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { KeyRound, Loader2, Lock, AlertCircle, CheckCircle2 } from "lucide-react";

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
 */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const validation = useMemo<string | null>(() => {
    if (!token) return "Reset token is missing from the URL.";
    if (password.length < MIN_PASSWORD_LENGTH) {
      return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (confirm !== password) return "Passwords do not match.";
    return null;
  }, [token, password, confirm]);

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
        // Auto-redirect to login after a short pause so the user sees the
        // success state. They can also click through manually.
        setTimeout(() => navigate("/login", { replace: true }), 2500);
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
            You can now sign in with your new password. Redirecting you to the
            login page…
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
        <Field
          id="confirm-password"
          label="Confirm new password"
          type="password"
          value={confirm}
          onChange={setConfirm}
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
