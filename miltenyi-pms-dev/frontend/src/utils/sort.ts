/**
 * sort.ts — Type-aware comparators for table column sorting.
 *
 * Kinds:
 *   - "alpha"    → case-insensitive string compare. Use for pure alpha labels
 *                  (Project, PM, Employee, Function).
 *   - "natural"  → Intl.Collator with numeric=true, so "PRJ-9" < "PRJ-10".
 *                  Use for mixed alphanumeric keys (project codes, version
 *                  strings). Do NOT use for cycle labels — see "cycle" below.
 *   - "numeric"  → parseFloat then numeric compare. Use for Rating columns
 *                  (values are "1".."5" strings from the API but sort as ints).
 *   - "cycle"    → chronological compare for cycle labels like "H1 FY26",
 *                  "Q3 FY25", or "FY26". Sorts by (fiscal_year, period) so
 *                  "H2 FY25" correctly comes before "H1 FY26" — unlike
 *                  natural/lexicographic ordering, which would group all H1s
 *                  before any H2s and scramble the timeline.
 *
 * Nulls always sort to the end of the list regardless of direction, so a column
 * with missing values never breaks the rhythm of the sorted region.
 */

export type SortDirection = "asc" | "desc";
export type SortKind = "alpha" | "natural" | "numeric" | "cycle";

/** The set of value shapes our table columns ever produce. Tighter than
 *  `unknown` — bans accidentally passing an object (which would stringify
 *  to "[object Object]" and silently break the sorted order). */
export type SortValue = string | number | boolean | null | undefined;

export interface SortState<K extends string = string> {
  key: K;
  direction: SortDirection;
}

const NATURAL_COLLATOR = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * Convert a cycle label into a sortable (fy_year, period) pair.
 *
 *   "H1 FY26" → [2026, 1]     "H2 FY25" → [2025, 2]
 *   "Q3 FY26" → [2026, 3]     "FY26"    → [2026, 0]
 *
 * The two-digit FY suffix is expanded to a 4-digit year (FY25 → 2025) so
 * comparisons stay stable past century boundaries. An unparseable label
 * collapses to [-Infinity, 0] so it sorts to the bottom of an asc list —
 * `compareValues` additionally treats null/"" as always-last.
 */
function cycleOrderKey(value: string): [number, number] {
  const fyMatch = /FY(\d{2,4})/i.exec(value);
  if (!fyMatch) return [Number.NEGATIVE_INFINITY, 0];
  const raw = fyMatch[1];
  const year = raw.length <= 2 ? 2000 + Number(raw) : Number(raw);
  const periodMatch = /^[HQ](\d)/i.exec(value.trim());
  const period = periodMatch ? Number(periodMatch[1]) : 0;
  return [year, period];
}

// Per-kind comparators. Each one assumes its inputs are non-empty —
// the empty-value short-circuit lives in `compareValues` so each
// comparator stays small and single-purpose. Splitting them keeps the
// main dispatcher readable and lets each kind's edge cases (NaN for
// numeric, FY parsing for cycle, etc.) live next to the logic that
// owns them.

function compareNumeric(a: SortValue, b: SortValue): number {
  const na = Number(a);
  const nb = Number(b);
  const aValid = Number.isFinite(na);
  const bValid = Number.isFinite(nb);
  // Happy path first — both convert to a finite number, do the maths.
  // Then handle each unhappy case explicitly: if only one is invalid,
  // the invalid one sorts after the valid one (positive return =
  // "a goes after b"). Both invalid → equal.
  if (aValid && bValid) return na - nb;
  if (aValid) return -1;
  if (bValid) return 1;
  return 0;
}

function compareNatural(a: SortValue, b: SortValue): number {
  return NATURAL_COLLATOR.compare(`${a}`, `${b}`);
}

function compareCycle(a: SortValue, b: SortValue): number {
  const [ay, ap] = cycleOrderKey(`${a}`);
  const [by, bp] = cycleOrderKey(`${b}`);
  return ay !== by ? ay - by : ap - bp;
}

function compareAlpha(a: SortValue, b: SortValue): number {
  return `${a}`.localeCompare(`${b}`, undefined, { sensitivity: "base" });
}

const COMPARERS: Record<SortKind, (a: SortValue, b: SortValue) => number> = {
  numeric: compareNumeric,
  natural: compareNatural,
  cycle: compareCycle,
  alpha: compareAlpha,
};

/**
 * Compare two values for a given column kind + direction.
 * Null / undefined / "" values always sort to the bottom (independent of direction).
 */
export function compareValues(
  a: SortValue,
  b: SortValue,
  kind: SortKind,
  direction: SortDirection,
): number {
  const aEmpty = a == null || a === "";
  const bEmpty = b == null || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  const cmp = COMPARERS[kind](a, b);
  return direction === "asc" ? cmp : -cmp;
}

/**
 * Toggle sort state. If the clicked column matches the current key, flip direction;
 * otherwise switch to the new column with ascending direction.
 */
export function toggleSort<K extends string>(
  current: SortState<K> | null,
  key: K,
): SortState<K> {
  if (current && current.key === key) {
    return { key, direction: current.direction === "asc" ? "desc" : "asc" };
  }
  return { key, direction: "asc" };
}
