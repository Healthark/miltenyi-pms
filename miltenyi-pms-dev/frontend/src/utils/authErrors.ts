/**
 * authErrors.ts — the sentences the login page shows (28 Sep 2026).
 *
 * The login and forgot-password forms used to show "Connection to server
 * failed" for anything that was not a plain-sentence `detail` from the
 * backend: an empty field (422 with a list of field errors), the rate
 * limit (429 with an `error` key) and a server crash (500 text). This maps
 * every outcome to the right words, and validates the fields before a
 * request is even sent.
 */

export type AuthForm = "login" | "forgot";

const CONNECTION_FAILED = "Connection to server failed. Please try again.";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Blank or malformed fields on the sign-in form; null when fine. */
export function validateLoginFields(email: string, password: string): string | null {
  if (!email.trim() || !password) return "Enter your email and password.";
  if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address.";
  return null;
}

/** Blank or malformed email on the forgot-password form; null when fine. */
export function validateEmailField(email: string): string | null {
  if (!email.trim()) return "Enter your email address.";
  if (!EMAIL_RE.test(email.trim())) return "Enter a valid email address.";
  return null;
}

/** Turn a failed sign-in / forgot-password call into one sentence. */
export function describeAuthError(err: unknown, form: AuthForm = "login"): string {
  if (typeof err !== "object" || err === null || !("response" in err)) {
    return CONNECTION_FAILED;
  }
  const response = (err as { response?: { status?: number; data?: unknown } }).response;
  if (!response) return CONNECTION_FAILED; // axios network error: no answer at all
  const status = response.status ?? 0;
  const data = response.data as { detail?: unknown } | null | undefined;
  const detail = typeof data?.detail === "string" ? data.detail : null;

  if (status === 422) {
    return detail ?? (form === "login" ? "Enter your email and password." : "Enter a valid email address.");
  }
  if (status === 429) return "Too many attempts. Wait a few minutes and try again.";
  if (status >= 500) return "Something went wrong on the server. Try again in a moment.";
  if (detail) return detail;
  return "Something went wrong. Please try again.";
}
