/**
 * useProjectReviewCycles — canonical Cycle filter options for the
 * ProjectReviews HR "All Reviews" tab.
 *
 * Returns the distinct `cycle` values that actually have project
 * reviews in this org (e.g. "Q1 FY26-27", "Q4 FY25-26", ...), plus
 * the currently-active cycle even if no review row exists for it yet
 * — so HR can always filter to "this cycle" while it's pre-population.
 *
 * The active cycle from settings is a full token like "Q1 FY26-27"
 * for quarterly orgs or "H1 FY26-27" for half-yearly orgs — same
 * shape as the cycle values on ProjectReview rows, so merging is a
 * straight set union.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { projectReviewService } from "@/services/project-review.service";
import { useSystemSettings } from "@/hooks/useSystemSettings";

const QUERY_KEY = ["project-reviews", "all", "distinct-cycles"] as const;

/**
 * @param enabled  Gate the fetch (the underlying endpoint is HR-only).
 *                 Defaults to true. Pass `enabled={isHR}` from shared
 *                 components mounted in non-HR contexts.
 */
export function useProjectReviewCycles(enabled: boolean = true) {
  const { settings } = useSystemSettings();
  const cyclesQuery = useQuery({
    queryKey: QUERY_KEY,
    queryFn: projectReviewService.getDistinctCycles,
    enabled,
  });

  const cycles = useMemo(() => {
    const dataCycles = cyclesQuery.data ?? [];
    const active = settings?.active_cycle_name ?? "";
    const merged = new Set<string>(dataCycles);
    if (active) merged.add(active);
    // Descending lexicographic sort matches the table's natural
    // ORDER BY (cycle desc) — newest sub-cycle of newest FY first.
    return Array.from(merged).sort((a, b) => b.localeCompare(a));
  }, [cyclesQuery.data, settings?.active_cycle_name]);

  return { cycles, isLoading: cyclesQuery.isPending };
}
