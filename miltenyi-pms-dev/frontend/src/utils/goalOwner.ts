import type { Goal } from "../services/goal.service";

/**
 * Pull the goal owner's department/designation off the runtime object.
 *
 * The base `Goal` type doesn't declare these fields — they're injected by
 * `list_team_goals` (and other team-facing endpoints) that widen the row
 * with the owner's resolved role. Callers handing a `TeamGoal` here will
 * see them populated; callers handing a plain `Goal` get nulls and the
 * downstream find-by-dept-and-desig falls through gracefully.
 */
export function getOwnerRole(goal: Goal): {
  dept: string | null;
  desig: string | null;
} {
  const t = goal as Goal & {
    owner_department_name?: string | null;
    owner_designation_name?: string | null;
  };
  return {
    dept: t.owner_department_name ?? null,
    desig: t.owner_designation_name ?? null,
  };
}

/** Owner display name, with a sane fallback for copy strings. */
export function getOwnerName(goal: Goal, fallback = "the mentee"): string {
  const t = goal as Goal & { owner_name?: string | null };
  return t.owner_name ?? fallback;
}
