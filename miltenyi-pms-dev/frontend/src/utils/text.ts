/**
 * text — shared identity-field helpers.
 *
 * These mirror the backend validators in
 * `backend/app/api/routes/admin_routes.py` (`_validate_email_for_role`,
 * `_validate_name_chars`, `_normalize_full_name`). The backend is the
 * hard gate; this file exists so the UI can render inline errors and
 * snap the displayed casing before the user ever clicks Save.
 *
 * If the rules change, update BOTH files in the same change-set —
 * otherwise the frontend will let the user submit something the
 * backend then rejects with a 400.
 */

/** Roles whose users must use a `@healthark.ai` email. */
const HEALTHARK_ROLES = new Set<string>(["HR_MyOrg", "Mentor"]);
/** Roles whose users must use a Miltenyi domain. */
const MILTENYI_ROLES = new Set<string>(["HR_Miltenyi", "PM", "Employee"]);

const HEALTHARK_DOMAIN = "healthark.ai";
const MILTENYI_DOMAINS = ["miltenyi.com", "external.miltenyi.com"] as const;

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
 * Return true if the email's domain matches the role's required
 * domain. Case-insensitive on the domain (the local part is left
 * alone — we don't lowercase it).
 *
 * Roles outside the known set return true (defensive — the role
 * dropdown only offers known values, but unknown values shouldn't
 * trigger a spurious "wrong domain" error in the UI).
 *
 * An email without "@" returns false so the modal can show the
 * domain error rather than letting the user submit a clearly-broken
 * value.
 */
export function isValidEmailForRole(email: string, role: string): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  const domain = email.slice(at + 1).toLowerCase();
  if (HEALTHARK_ROLES.has(role)) {
    return domain === HEALTHARK_DOMAIN;
  }
  if (MILTENYI_ROLES.has(role)) {
    return (MILTENYI_DOMAINS as readonly string[]).includes(domain);
  }
  return true;
}

/**
 * Human-readable explanation of which domain(s) a role accepts.
 * Used as the inline error message under the email input so the user
 * knows exactly what to type. Returns empty string for unknown
 * roles, which the caller can use to suppress the error row.
 */
export function emailDomainHintForRole(role: string): string {
  if (HEALTHARK_ROLES.has(role)) {
    return `${role} accounts must use a @${HEALTHARK_DOMAIN} email address.`;
  }
  if (MILTENYI_ROLES.has(role)) {
    const allowed = MILTENYI_DOMAINS.map((d) => `@${d}`).join(" or ");
    return `${role} accounts must use ${allowed} email addresses.`;
  }
  return "";
}
