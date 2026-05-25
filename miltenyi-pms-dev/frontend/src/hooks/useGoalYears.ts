/**
 * useGoalYears — canonical Year filter options for the AnnualGoals
 * HR "All Goals" tab.
 *
 * Returns the distinct `fy_year` values that actually have annual
 * goals in this org (newest first), plus the currently-active FY
 * even if it has no goals yet — so HR can always filter to "this
 * year" while it's empty waiting for goal submissions.
 *
 * Replaces the earlier hardcoded 5-year lookback (which was anchored
 * on a buggy `settings.active_cycle` field name and silently fell
 * back to `currentYear - 1`, dropping the actual active FY off the
 * dropdown).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { goalService } from "@/services/goal.service";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { fyTokenToStartYear } from "@/utils/fy";

const QUERY_KEY = ["goals", "all", "distinct-years"] as const;

/**
 * @param enabled  Gate the fetch (the underlying endpoint is HR_MyOrg-
 *                 only). Defaults to true. Pass `enabled={isHR}` from
 *                 shared components if the data isn't going to be
 *                 consumed by non-HR viewers anyway.
 */
export function useGoalYears(enabled: boolean = true) {
  const { settings } = useSystemSettings();
  const yearsQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: goalService.getDistinctGoalYears,
    enabled,
  });

  const years = useMemo(() => {
    const dataYears = yearsQuery.data ?? [];
    const activeYear = fyTokenToStartYear(settings?.active_cycle_name ?? "");
    // Always include the currently-active FY (even if no goals exist
    // for it yet) so HR can filter to "this year" while it's empty.
    const merged = new Set<number>(dataYears);
    if (activeYear !== null) merged.add(activeYear);
    return Array.from(merged).sort((a, b) => b - a);
  }, [yearsQuery.data, settings?.active_cycle_name]);

  return { years, isLoading: yearsQuery.isPending };
}
