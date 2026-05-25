/**
 * useOrgReferenceData — fetches the org's canonical Functions and
 * Designations from the admin reference endpoint.
 *
 * Use this on pages whose primary dataset is **server-filtered**
 * (Annual Goals, Annual Reviews, Management Review). Their local
 * `goals` / `reviews` / `rows` shrinks when filters narrow the result
 * set, so deriving dropdown options from that list shrinks the
 * dropdown too — once you pick "Regulatory Affairs Manager", the
 * designation dropdown shows only that one entry. The canonical list
 * never shrinks, so the dropdown stays usable.
 *
 * The two backing queries are cached under the same `queryKeys.admin`
 * keys that the Admin Panel uses, so any page that already loaded
 * them (e.g. the user came from Admin → Users) gets a warm cache.
 *
 * `name`-only lists are exposed because every consumer just maps to
 * names for the `<option>` list. If a caller ever needs the full
 * `{id, name}` objects, return them separately rather than reshaping.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminService } from "@/services/admin.service";
import { queryKeys } from "@/lib/queryKeys";

export function useOrgReferenceData() {
  const functionsQuery = useQuery({
    queryKey: queryKeys.admin.functions(),
    queryFn: adminService.getFunctions,
  });
  const designationsQuery = useQuery({
    queryKey: queryKeys.admin.designations(),
    queryFn: adminService.getDesignations,
  });

  const functionNames = useMemo(
    () =>
      (functionsQuery.data ?? [])
        .map((f) => f.name)
        .sort((a, b) => a.localeCompare(b)),
    [functionsQuery.data],
  );

  const designationNames = useMemo(
    () =>
      (designationsQuery.data ?? [])
        .map((d) => d.name)
        .sort((a, b) => a.localeCompare(b)),
    [designationsQuery.data],
  );

  return {
    functionNames,
    designationNames,
    isLoading: functionsQuery.isPending || designationsQuery.isPending,
  };
}
