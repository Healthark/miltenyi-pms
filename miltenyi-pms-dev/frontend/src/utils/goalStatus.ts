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
import { fyTokenToStartYear } from "@/utils/fy";

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

// ── Roll-out → cycle code ───────────────────────────────────────────

/** "H2 FY26-27" (or a legacy "Q3 FY26-27") → { half: "H2", fyYear: 2026 }.
 *  Null when the label is unreadable. Since 25 Sep 2026 the annual cycle
 *  follows the Project Goals quarter roll-out: Q1–Q2 are H1, Q3–Q4 are H2,
 *  and starting the next goal year starts the next annual year. */
export function activeHalfAndFy(
  activeCycleName: string | null | undefined,
): { half: "H1" | "H2"; fyYear: number } | null {
  if (!activeCycleName) return null;
  const parts = activeCycleName.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const half = halfOf(parts[0].toUpperCase() as SelfReviewCycleHalf);
  const fyYear = fyTokenToStartYear(parts[parts.length - 1]);
  if (!half || fyYear == null) return null;
  return { half, fyYear };
}

function halfOf(code: SelfReviewCycleHalf): "H1" | "H2" | null {
  if (code === "H1" || code === "Q1" || code === "Q2") return "H1";
  if (code === "H2" || code === "Q3" || code === "Q4") return "H2";
  return null;
}

// ── Time-window gate ────────────────────────────────────────────────

/**
 * Mirror of backend `annual_cycle.is_half_open`.
 *
 * A half is open while the goal's year is the active annual year and the
 * half is the current one or an earlier one (so H1 can be backfilled during
 * H2 of the same year). A later half, or any half of another year, is
 * locked. Returns false when goalFyYear is null (legacy goals without a
 * stamped cycle_name).
 */
export function isHalfWindowOpen(
  cycle: SelfReviewCycleHalf,
  goalFyYear: number | null,
  activeCycleName: string | null | undefined,
): boolean {
  if (goalFyYear == null) return false;
  const current = activeHalfAndFy(activeCycleName);
  if (!current || current.fyYear !== goalFyYear) return false;
  const target = halfOf(cycle);
  if (!target) return false;
  return HALF_KEYS.indexOf(target) <= HALF_KEYS.indexOf(current.half);
}
