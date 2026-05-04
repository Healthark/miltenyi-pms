/**
 * Fiscal-year label helpers for the Annual Review surfaces.
 *
 * Annual reviews are strictly yearly — a mentee has one review per fiscal
 * year regardless of whether the org's active cycle is half-yearly or
 * quarterly. The canonical stored token is the spanning form like "FY26-27"
 * (FY 2026 starts April 2026 and runs through March 2027). Older rows and
 * seed data may still carry the bare "FY26" or composite "H1 FY26" forms,
 * so the parser tolerates all three.
 */

/** "FY26-27", "H1 FY26-27", or "FY26" → "FY26-27" / "FY26"; falls back to the input. */
export function extractFyToken(cycleName: string): string {
  return (
    cycleName.split(" ").find((t) => t.toUpperCase().startsWith("FY")) ??
    cycleName
  );
}

/**
 * Render a cycle name as a human-readable FY label.
 *   "FY26-27"     → "FY 2026-27"
 *   "H1 FY26-27"  → "FY 2026-27"
 *   "FY26"        → "FY 2026"     (legacy 2-digit form)
 *   "FY2026"      → "FY 2026"     (legacy 4-digit form)
 * Falls back to the input when no FY token is parseable.
 */
export function formatFyLabel(cycleName: string): string {
  const token = extractFyToken(cycleName);
  // New spanning form: "FY26-27"
  const span = /^FY(\d{2})-(\d{2})$/i.exec(token);
  if (span) {
    return `FY 20${span[1]}-${span[2]}`;
  }
  // Legacy bare form: "FY26" or "FY2026"
  const m = /^FY(\d{2,4})$/i.exec(token);
  if (!m) return cycleName;
  const digits = m[1];
  const year = digits.length === 2 ? `20${digits}` : digits;
  return `FY ${year}`;
}

/**
 * Render a 4-digit fiscal start year as the spanning span label.
 *   2026 → "FY 2026-27"
 *   1999 → "FY 1999-00"
 * Used for goal cards/tables that store the FY as a number rather than a token.
 */
export function formatFyYearSpan(year: number): string {
  const next = (year + 1) % 100;
  return `FY ${year}-${next.toString().padStart(2, "0")}`;
}

/**
 * Resolve a cycle/FY token to the 4-digit fiscal start year so it can be
 * compared against `Goal.fy_year` (which is stored as a number).
 *   "FY26-27"   → 2026
 *   "FY26"      → 2026
 *   "FY2026"    → 2026
 *   "H1 FY26-27"→ 2026
 * Returns null when the input has no parseable FY token.
 */
export function fyTokenToStartYear(token: string): number | null {
  const t = extractFyToken(token);
  const span = /^FY(\d{2})-(\d{2})$/i.exec(t);
  if (span) return 2000 + Number(span[1]);
  const single = /^FY(\d{2,4})$/i.exec(t);
  if (!single) return null;
  const digits = single[1];
  return digits.length === 2 ? 2000 + Number(digits) : Number(digits);
}
