/**
 * text — shared identity-field helpers.
 *
 * These mirror the backend validators in
 * `backend/app/api/routes/admin_routes.py` (`_validate_email`,
 * `_validate_name_chars`, `_normalize_full_name`). The backend is the
 * hard gate; this file exists so the UI can render inline errors and
 * snap the displayed casing before the user ever clicks Save.
 *
 * If the rules change, update BOTH files in the same change-set —
 * otherwise the frontend will let the user submit something the
 * backend then rejects with a 400.
 */

/** Every account belongs to a Healthark employee. */
const HEALTHARK_DOMAIN = "healthark.ai";

/**
 * Title-case each whitespace-separated word; collapse internal
 * whitespace; trim ends.
 *
 *   "zAAhid vOHra"        → "Zaahid Vohra"
 *   "zAAhid fIrOz vOHra"  → "Zaahid Firoz Vohra"
 *   "  jane   smith  "    → "Jane Smith"
 *
 * Pure function — call it on blur of the Full Name input, or
 * immediately before submitting.
 */
export function normalizeFullName(value: string): string {
  return value
    .split(/\s+/)
    .filter((p) => p.length > 0)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join(" ");
}

/**
 * Return true if `value` is composed of nothing but letters (any
 * script — Unicode-aware), whitespace, and full stops.
 *
 * Empty string returns false — the modal's "required" check covers
 * the empty case separately, and an empty name should never be
 * considered "valid characters."
 *
 * The `\p{L}` regex class needs the `u` flag; without it, characters
 * like ü or श्रुति would fail.
 */
export function isValidNameChars(value: string): boolean {
  if (value.length === 0) return false;
  return /^[\p{L}\s.]+$/u.test(value);
}

/**
 * Return true if the email is an @healthark.ai address. Case-insensitive
 * on the domain (the local part is left alone). An email without "@"
 * returns false so the modal can show the domain error rather than
 * letting the user submit a clearly-broken value.
 */
export function isValidEmail(email: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return email.slice(at + 1).toLowerCase() === HEALTHARK_DOMAIN;
}

/** Inline helper text under the email field. */
export function emailDomainHint(): string {
  return `Accounts must use a @${HEALTHARK_DOMAIN} email address.`;
}
