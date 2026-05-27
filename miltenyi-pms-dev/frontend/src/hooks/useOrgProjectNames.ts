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
import { queryKeys } from "@/lib/queryKeys";

/**
 * @param enabled  Gate the underlying fetch. Defaults to true. Pass
 *                 `enabled={isHR}` from shared components mounted in
 *                 non-HR contexts so the query doesn't fire when the
 *                 data isn't going to be consumed.
 *
 * Shares the `queryKeys.projects.list()` cache entry with
 * `ProjectsTab` — meaning AdminPanel creates/edits/deletes broadcast
 * via `queryKeys.projects.all` and this hook re-renders with the
 * fresh list automatically (no manual refetch needed).
 */
export function useOrgProjectNames(enabled: boolean = true) {
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list(),
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
