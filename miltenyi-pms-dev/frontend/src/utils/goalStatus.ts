/**
 * goalStatus.ts — Goal lifecycle helpers shared across the frontend.
 *
 * Mirrors backend `app/core/cycle_utils.py`. Two cadences are supported:
 *   - Half-yearly orgs use H1 / H2 (two windows per FY).
 *   - Quarterly  orgs use Q1 / Q2 / Q3 / Q4 (four windows per FY).
 * The org's `cycle_type` from SystemSettings decides which family is in
 * play. The cycle code's prefix (`H` vs `Q`) is also a reliable cadence
 * marker on its own — `cycleKeysFor` recovers it without a second arg.
 */

import type { ApprovalStatus, SelfReviewCycleHalf } from "../services/goal.service";

/** Goals in any of these states are locked from employee editing and
 *  count as "approved" in dashboard / mentee-stat rollups. Covers both
 *  cadences so a single check works for any org. */
export const POST_APPROVAL_STATES: readonly ApprovalStatus[] = [
  "approved",
  "h1_self_reviewed",
  "h1_mentor_reviewed",
  "h2_self_reviewed",
  "h2_mentor_reviewed",
  "q1_self_reviewed",
  "q1_mentor_reviewed",
  "q2_self_reviewed",
  "q2_mentor_reviewed",
  "q3_self_reviewed",
  "q3_mentor_reviewed",
  "q4_self_reviewed",
  "q4_mentor_reviewed",
];

const POST_APPROVAL_SET: ReadonlySet<ApprovalStatus> = new Set(
  POST_APPROVAL_STATES,
);

export function isPostApproved(status: ApprovalStatus): boolean {
  return POST_APPROVAL_SET.has(status);
}

// ── Cadence helpers ─────────────────────────────────────────────────

const HALF_KEYS:    readonly SelfReviewCycleHalf[] = ["H1", "H2"];
const QUARTER_KEYS: readonly SelfReviewCycleHalf[] = ["Q1", "Q2", "Q3", "Q4"];

/** Pick the cadence list for an org's `cycle_type`. */
export function cycleKeysForType(
  cycleType: string | null | undefined,
): readonly SelfReviewCycleHalf[] {
  return cycleType === "quarterly" ? QUARTER_KEYS : HALF_KEYS;
}

/** Recover the cadence list from a single cycle code's prefix. */
export function cycleKeysFor(
  code: SelfReviewCycleHalf,
): readonly SelfReviewCycleHalf[] {
  return code.startsWith("Q") ? QUARTER_KEYS : HALF_KEYS;
}

/**
 * Display label for a cycle code. The data column already stores the
 * appropriate prefix (H/Q) per cadence, so this is mostly a passthrough —
 * but the legacy half-yearly→quarterly translation case (cycle_type
 * "quarterly" with H1/H2 stored values) still flips the display.
 */
export function halfDisplayLabel(
  half: SelfReviewCycleHalf,
  cycleType?: string | null,
): string {
  // Legacy: H1/H2 stored on a quarterly org → show as Q1/Q2.
  if (cycleType === "quarterly") {
    if (half === "H1") return "Q1";
    if (half === "H2") return "Q2";
  }
  return half;
}

// ── Calendar → cycle code ───────────────────────────────────────────

/** Same calendar logic as backend `cycle_utils.current_half_and_fy`. */
export function currentHalfAndFy(
  today: Date = new Date(),
  fiscalStartMonth = 4,
): { half: "H1" | "H2"; fyYear: number } {
  const month = today.getMonth() + 1;
  const year = today.getFullYear();
  const fiscalYear = month >= fiscalStartMonth ? year : year - 1;
  const relativeMonth = (((month - fiscalStartMonth) % 12) + 12) % 12;
  const half: "H1" | "H2" = relativeMonth < 6 ? "H1" : "H2";
  return { half, fyYear: fiscalYear };
}

/** Same calendar logic as backend `cycle_utils.current_quarter_and_fy`. */
export function currentQuarterAndFy(
  today: Date = new Date(),
  fiscalStartMonth = 4,
): { quarter: "Q1" | "Q2" | "Q3" | "Q4"; fyYear: number } {
  const month = today.getMonth() + 1;
  const year = today.getFullYear();
  const fiscalYear = month >= fiscalStartMonth ? year : year - 1;
  const relativeMonth = (((month - fiscalStartMonth) % 12) + 12) % 12;
  const qNum = Math.floor(relativeMonth / 3) + 1;
  return { quarter: `Q${qNum}` as "Q1" | "Q2" | "Q3" | "Q4", fyYear: fiscalYear };
}

// ── Time-window gate ────────────────────────────────────────────────

/**
 * Mirror of backend `cycle_utils.is_review_window_open`.
 *
 * A cycle's window opens at the start of that cycle and stays open
 * through the end of the FY (so any earlier cycle can be backfilled
 * during a later one of the same FY). Returns false (locked) when
 * goalFyYear is null (legacy goals without a stamped cycle_name).
 */
export function isHalfWindowOpen(
  cycle: SelfReviewCycleHalf,
  goalFyYear: number | null,
  fiscalStartMonth = 4,
  today: Date = new Date(),
): boolean {
  if (goalFyYear == null) return false;
  const keys = cycleKeysFor(cycle);
  const currentCode =
    keys === HALF_KEYS
      ? currentHalfAndFy(today, fiscalStartMonth).half
      : currentQuarterAndFy(today, fiscalStartMonth).quarter;
  const currentFy =
    keys === HALF_KEYS
      ? currentHalfAndFy(today, fiscalStartMonth).fyYear
      : currentQuarterAndFy(today, fiscalStartMonth).fyYear;
  if (currentFy !== goalFyYear) return false;
  return keys.indexOf(cycle) <= keys.indexOf(currentCode);
}
