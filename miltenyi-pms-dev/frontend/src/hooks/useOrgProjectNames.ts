/**
 * useOrgProjectNames — canonical Project filter options.
 *
 * Calls `/projects/?include_completed=true` to get the org's full
 * project list (active + completed) and returns sorted display names.
 * Used by HR's "All Reviews" tabs where the visible reviews list is
 * server-filtered — without a canonical source the Project dropdown
 * would shrink to only the selected value once a filter is picked.
 *
 * The endpoint allows authenticated users to list projects in their
 * org. HR_MyOrg always gets the unrestricted list (active + completed).
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { projectService } from "@/services/project.service";

// Local query key — no shared `queryKeys.projects` namespace today.
// If a broader projects-cache effort lands later, this should move to
// `frontend/src/lib/queryKeys.ts` and be invalidated by project
// mutations.
const ORG_PROJECT_NAMES_QUERY_KEY = ["projects", "all", "include_completed"] as const;

/**
 * @param enabled  Gate the underlying fetch. Defaults to true. Pass
 *                 `enabled={isHR}` from shared components mounted in
 *                 non-HR contexts so the query doesn't fire when the
 *                 data isn't going to be consumed.
 */
export function useOrgProjectNames(enabled: boolean = true) {
  const projectsQuery = useQuery({
    queryKey: ORG_PROJECT_NAMES_QUERY_KEY,
    queryFn: () => projectService.listProjects(true),
    enabled,
  });

  const projectNames = useMemo(
    () =>
      (projectsQuery.data ?? [])
        .map((p) => p.name)
        .sort((a, b) => a.localeCompare(b)),
    [projectsQuery.data],
  );

  return { projectNames, isLoading: projectsQuery.isPending };
}
