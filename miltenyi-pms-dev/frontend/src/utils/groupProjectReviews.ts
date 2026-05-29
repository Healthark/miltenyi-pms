/**
 * groupProjectReviews — collapse flat ProjectReviewResponse[] into one
 * row per (employee, project, FY) for the All Reviews / Mentor mentees
 * view.
 *
 * The flat shape (one DB row per cycle) stacks the same person under
 * the same project 2-4 times per year, which both wastes vertical
 * space and forces HR to mentally re-group when answering "how is Bob
 * doing on Alpha?". Grouping collapses those rows into a single line
 * with a chip strip showing per-cycle progress.
 *
 * The function is consumed by `ReadOnlyReviewsList` (shared between
 * HR All Reviews tab + Mentor mentees tab). It's pure — no React,
 * no fetch.
 */

import type { ProjectReviewResponse } from "@/services/project-review.service";
import type { CycleType } from "@/services/system-settings.service";
import { extractCyclePeriod, fyTokenToStartYear } from "@/utils/fy";

/** Visual states a chip can render as. The chip renderer maps each
 *  to a different colour / interactivity.
 *
 * - `reviewed`  — DB row exists, status=reviewed. Click opens detail modal.
 * - `pending`   — Anything PM still owes: row exists with status=pending,
 *                  OR no row exists yet for a past/active cycle in the
 *                  current FY. In practice review rows often pre-exist
 *                  without the PM having engaged, so the "row exists vs
 *                  doesn't" distinction was invisible to HR — we
 *                  collapsed the two prior states (`pending` + `awaiting`)
 *                  into one. Click opens the detail modal IF a row
 *                  exists; otherwise the chip is non-interactive.
 * - `upcoming`  — Cycle hasn't begun yet (future period in the current
 *                  FY, or any period in a future FY). Not clickable.
 */
export type CycleChipState = "reviewed" | "pending" | "upcoming";

export interface CycleSlot {
  /** Period prefix used by the org (`Q1`..`Q4` / `H1`/`H2`). Empty
   *  string for annual cadence orgs whose cycles are bare FY tokens. */
  readonly period: string;
  /** Full composite cycle name (e.g. "Q3 FY26-27" / "FY26-27"). Used
   *  to navigate to the review's detail modal and to lookup against
   *  `settings.active_cycle_name`. */
  readonly cycleName: string;
  /** DB row when one exists for this slot. Null for awaiting/upcoming. */
  readonly review: ProjectReviewResponse | null;
  readonly state: CycleChipState;
}

/** One row in the grouped table — represents a single (employee,
 *  project, FY) triple. */
export interface GroupedReviewRow {
  /** Stable React key + virtualizer item key. */
  readonly key: string;
  readonly user_id: number;
  readonly project_id: number;
  /** Fiscal start year (e.g. 2026 → FY 2026-27). */
  readonly fy_year: number;
  readonly employee_name: string;
  readonly project_name: string;
  readonly project_code: string;
  /** Project's currently-assigned PM. Same value across every cycle
   *  in this group (PM is per-project, not per-cycle). */
  readonly pm_name: string | null;
  /** Cycle slots in calendar order (Q1 / H1 first). For past FYs
   *  contains only slots that have an existing DB row (no fabricated
   *  placeholders). For the current/future FY contains the full
   *  cadence with placeholders for cycles without rows yet. */
  readonly slots: readonly CycleSlot[];
  /** Number of slots with state=reviewed. The fraction in the cell
   *  reads `${reviewedCount} of ${totalSlots} reviewed`. */
  readonly reviewedCount: number;
  /** Denominator for the progress fraction. Equals slots.length. */
  readonly totalSlots: number;
}

/** Ordered period list for each cycle cadence. Used for both the slot
 *  enumeration order (Q1 leftmost, Q4 rightmost) and the "is cycle X
 *  past / active / future" comparison via array index. */
const PERIODS_BY_CYCLE_TYPE: Record<CycleType, readonly string[]> = {
  annual: [""],
  half_yearly: ["H1", "H2"],
  quarterly: ["Q1", "Q2", "Q3", "Q4"],
};

/**
 * Group a flat list of project reviews into per-(employee, project,
 * FY) rows.
 *
 * @param reviews  Flat list returned from `/project-reviews/all` (or
 *                 the Mentor mentees endpoint). Each row is a single
 *                 (user, project, cycle) tuple from the DB.
 * @param cycleType  Org's cadence (`annual` / `half_yearly` /
 *                 `quarterly`). Determines how many slots each group
 *                 renders for current/future FYs. Falls back to
 *                 deriving from the data itself when null (e.g. when
 *                 settings haven't loaded yet) — in that case past
 *                 and current FYs both render only existing rows.
 * @param activeCycle  `settings.active_cycle_name` — the org's
 *                 current cycle. Used to determine which chip slots
 *                 land in `awaiting` vs `upcoming` state. Null while
 *                 settings load — every empty slot becomes
 *                 `upcoming`.
 */
export function groupProjectReviews(
  reviews: readonly ProjectReviewResponse[],
  cycleType: CycleType | null,
  activeCycle: string | null,
): GroupedReviewRow[] {
  const periods = cycleType ? PERIODS_BY_CYCLE_TYPE[cycleType] : null;
  const activePeriod = activeCycle ? extractCyclePeriod(activeCycle) ?? "" : null;
  const activeFyYear = activeCycle ? fyTokenToStartYear(activeCycle) : null;
  const activePeriodIdx =
    periods && activePeriod !== null
      ? periods.indexOf(activePeriod)
      : -1;

  // ── Step 1: bucket reviews by (user_id, project_id, fy_year) ─────
  const buckets = new Map<string, ProjectReviewResponse[]>();
  for (const r of reviews) {
    const fy = r.cycle ? fyTokenToStartYear(r.cycle) : null;
    if (fy === null) continue; // skip rows with un-parseable cycle
    const key = `${r.user_id}_${r.project_id}_${fy}`;
    const arr = buckets.get(key);
    if (arr) arr.push(r);
    else buckets.set(key, [r]);
  }

  // ── Step 2: build a GroupedReviewRow per bucket ──────────────────
  const groups: GroupedReviewRow[] = [];
  for (const [key, bucketReviews] of buckets) {
    const first = bucketReviews[0];
    const fy = fyTokenToStartYear(first.cycle) ?? 0;
    // Decide whether to render the full cadence (with placeholders)
    // or just the existing rows. Heuristic:
    //   * Current FY (== activeFyYear) → full cadence so HR sees what
    //     the year is supposed to look like, with awaiting/upcoming
    //     chips for cycles without rows yet.
    //   * Future FY (> activeFyYear) → full cadence, every slot is
    //     upcoming since the cycles haven't begun.
    //   * Past FY (< activeFyYear) → only existing rows. Don't
    //     fabricate placeholders for cycles that never happened (e.g.
    //     employee joined mid-year — only the cycles they were
    //     assigned for got reviews).
    //   * Settings not loaded yet (activeFyYear null) → defensive
    //     fallback: existing rows only. Avoids painting placeholders
    //     based on a guessed cadence.
    const isCurrentOrFutureFy =
      activeFyYear !== null && fy >= activeFyYear;
    const renderFullCadence =
      isCurrentOrFutureFy && periods !== null && periods.length > 0;

    let slots: CycleSlot[];
    if (renderFullCadence) {
      // Build full-cadence slots, slotting in existing rows by period.
      const byPeriod = new Map<string, ProjectReviewResponse>();
      for (const r of bucketReviews) {
        const p = extractCyclePeriod(r.cycle) ?? "";
        byPeriod.set(p, r);
      }
      slots = (periods as readonly string[]).map((period, idx) => {
        const review = byPeriod.get(period) ?? null;
        if (review) {
          const state: CycleChipState =
            review.status === "reviewed" ? "reviewed" : "pending";
          return {
            period,
            cycleName: review.cycle,
            review,
            state,
          };
        }
        // No row exists. Two cases under the 3-state model:
        //   * cycle has already arrived (past or active period of the
        //     current FY) → `pending` — PM owes this review
        //   * cycle hasn't arrived yet (future period this FY, or any
        //     period of a future FY) → `upcoming`
        const cycleName = period
          ? `${period} ${cycleSpanFromYear(fy)}`
          : cycleSpanFromYear(fy);
        const isPastOrActivePeriod =
          fy === activeFyYear &&
          activePeriodIdx >= 0 &&
          idx <= activePeriodIdx;
        return {
          period,
          cycleName,
          review: null,
          state: isPastOrActivePeriod ? "pending" : "upcoming",
        };
      });
    } else {
      // Past FY (or unknown cadence): one slot per existing row, in
      // period order.
      slots = bucketReviews
        .map((r) => {
          const period = extractCyclePeriod(r.cycle) ?? "";
          const state: CycleChipState =
            r.status === "reviewed" ? "reviewed" : "pending";
          return { period, cycleName: r.cycle, review: r, state };
        })
        .sort((a, b) => a.period.localeCompare(b.period));
    }

    const reviewedCount = slots.filter((s) => s.state === "reviewed").length;
    groups.push({
      key,
      user_id: first.user_id,
      project_id: first.project_id,
      fy_year: fy,
      employee_name: first.employee_name,
      project_name: first.project_name,
      project_code: first.project_code,
      // PM is per-project, so any row in the bucket has the same
      // pm_name. Prefer pm_name (always populated when set on the
      // Project) over reviewer_name (only set after submit).
      pm_name: first.pm_name ?? first.reviewer_name ?? null,
      slots,
      reviewedCount,
      totalSlots: slots.length,
    });
  }

  // Default ordering: employee asc, then year desc (newer FY at top
  // when an employee has multiple FYs visible). Server-controlled
  // sort overrides this externally — this is just the deterministic
  // fallback.
  groups.sort((a, b) => {
    const nameCmp = a.employee_name.localeCompare(b.employee_name);
    if (nameCmp !== 0) return nameCmp;
    return b.fy_year - a.fy_year;
  });

  return groups;
}

/** Render the FY token for a start year. Local mirror of
 *  fyStartYearToToken so we don't introduce a circular import; both
 *  follow the same `FY<yy>-<yy+1>` shape. */
function cycleSpanFromYear(year: number): string {
  const yy = (year % 100).toString().padStart(2, "0");
  const nn = ((year + 1) % 100).toString().padStart(2, "0");
  return `FY${yy}-${nn}`;
}
