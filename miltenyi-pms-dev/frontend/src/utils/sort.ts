/**
 * sort.ts — Type-aware comparators for table column sorting.
 *
 * Kinds:
 *   - "alpha"    → case-insensitive string compare. Use for pure alpha labels
 *                  (Project, PM, Employee, Department).
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

/**
 * Compare two values for a given column kind + direction.
 * Null / undefined / "" values always sort to the bottom (independent of direction).
 */
export function compareValues(
  a: unknown,
  b: unknown,
  kind: SortKind,
  direction: SortDirection,
): number {
  const aEmpty = a == null || a === "";
  const bEmpty = b == null || b === "";
  if (aEmpty && bEmpty) return 0;
  if (aEmpty) return 1;
  if (bEmpty) return -1;

  let cmp: number;
  if (kind === "numeric") {
    const na = Number(a);
    const nb = Number(b);
    const aNum = Number.isFinite(na);
    const bNum = Number.isFinite(nb);
    if (!aNum && !bNum) cmp = 0;
    else if (!aNum) cmp = 1;
    else if (!bNum) cmp = -1;
    else cmp = na - nb;
  } else if (kind === "natural") {
    cmp = NATURAL_COLLATOR.compare(String(a), String(b));
  } else if (kind === "cycle") {
    const [ay, ap] = cycleOrderKey(String(a));
    const [by, bp] = cycleOrderKey(String(b));
    cmp = ay !== by ? ay - by : ap - bp;
  } else {
    cmp = String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
  }

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
