/**
 * goalStatus.ts — Goal lifecycle helpers shared across the frontend.
 *
 * Goal self-review cadence is HALF-YEARLY (H1 / H2) for every org,
 * independent of the org's `cycle_type`. Project review cadence is
 * separately driven by `cycle_type` (quarterly or half-yearly) — that
 * decoupling is intentional: a quarterly project-review org still
 * reviews goals twice a year.
 *
 * The Q1..Q4 cycle codes remain in the type/value space for backwards
 * compatibility with any persisted rows from the previous cycle-coupled
 * model, but are no longer produced by the goal-review UI.
 */

import type { ApprovalStatus, SelfReviewCycleHalf } from "@/services/goal.service";

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

/** Goal-review cadence is half-yearly for every org — always H1 / H2.
 *  Exported so callers don't have to import the constant directly. */
export function cycleKeysForType(): readonly SelfReviewCycleHalf[] {
  return HALF_KEYS;
}

/** Recover the cadence list from a single cycle code's prefix.
 *  Still prefix-driven so legacy Q1..Q4 rows continue to render correctly. */
export function cycleKeysFor(
  code: SelfReviewCycleHalf,
): readonly SelfReviewCycleHalf[] {
  return code.startsWith("Q") ? QUARTER_KEYS : HALF_KEYS;
}

/** Display label for a cycle code. Pass-through today (the previous
 *  H1 → Q1 translation for quarterly orgs is gone since goal reviews
 *  are uniformly half-yearly), but kept as a function so the call sites
 *  stay stable if we ever add a localisation pass. */
export function halfDisplayLabel(half: SelfReviewCycleHalf): string {
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
