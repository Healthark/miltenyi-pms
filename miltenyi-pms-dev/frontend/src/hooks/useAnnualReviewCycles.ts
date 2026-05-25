/**
 * useAnnualReviewCycles — canonical Cycle filter options for the
 * AnnualReviews HR "All Reviews" tab.
 *
 * Returns the distinct `cycle_name` values that actually have annual
 * reviews in this org (newest first), plus the currently-active FY
 * token even if no review row exists for it yet — so HR can always
 * filter to "this year" while it's pre-population.
 *
 * The active cycle from settings is stored as a project-review token
 * (e.g. "Q1 FY26-27") but annual reviews are tagged with the bare FY
 * token ("FY26-27"). We extract the FY token via `extractFyToken`
 * before merging.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { annualReviewService } from "@/services/annual-review.service";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { extractFyToken } from "@/utils/fy";

const QUERY_KEY = ["annual-reviews", "all", "distinct-cycles"] as const;

/**
 * @param enabled  Gate the fetch (the underlying endpoint is HR_MyOrg-
 *                 only). Defaults to true.
 */
export function useAnnualReviewCycles(enabled: boolean = true) {
  const { settings } = useSystemSettings();
  const cyclesQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: annualReviewService.getDistinctCycles,
    enabled,
  });

  const cycles = useMemo(() => {
    const dataCycles = cyclesQuery.data ?? [];
    const activeFyToken = settings?.active_cycle_name
      ? extractFyToken(settings.active_cycle_name)
      : "";
    const merged = new Set<string>(dataCycles);
    if (activeFyToken) merged.add(activeFyToken);
    // Sort descending by string so "FY26-27" > "FY25-26" > "FY24-25".
    return Array.from(merged).sort((a, b) => b.localeCompare(a));
  }, [cyclesQuery.data, settings?.active_cycle_name]);

  return { cycles, isLoading: cyclesQuery.isPending };
}
