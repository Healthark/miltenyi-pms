/**
 * useOrgUsers — fetches the org's full active user list and returns
 * canonical name buckets for filter dropdowns.
 *
 * Use this on pages whose primary dataset is **server-filtered**
 * (Annual Goals AllGoalsTab, Annual Reviews AllReviewsTab, Management
 * Review, Project Reviews HR All Reviews). Their local `goals` /
 * `reviews` / `rows` shrinks when filters narrow the result set, so
 * deriving employee / mentor / PM dropdown options from that list
 * shrinks the dropdown to only the currently-selected entry — the
 * same class of bug we already fixed for Function and Designation
 * via `useOrgReferenceData`.
 *
 * Access note: this calls the admin endpoint `/admin/users` which
 * is HR-only on the backend. Every page that needs canonical user
 * lists is already an HR-only surface (HR_MyOrg or HR_Miltenyi), so
 * the access boundary matches.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { adminService } from "@/services/admin.service";
import { queryKeys } from "@/lib/queryKeys";

/**
 * @param enabled  Gate the underlying admin fetch. Defaults to true.
 *                 Pass `enabled={isHR}` from shared components mounted
 *                 in non-HR contexts so the query doesn't 403.
 */
export function useOrgUsers(enabled: boolean = true) {
  const usersQuery = useQuery({
    queryKey: queryKeys.admin.users(),
    queryFn: adminService.getUsers,
    enabled,
  });

  const buckets = useMemo(() => {
    const all = (usersQuery.data ?? []).filter((u) => !u.is_deleted);
    const sortByName = (a: string, b: string) => a.localeCompare(b);

    const employees = all
      .filter((u) => u.role === "Employee")
      .map((u) => u.full_name)
      .sort(sortByName);

    const mentors = all
      .filter((u) => u.role === "Mentor")
      .map((u) => u.full_name)
      .sort(sortByName);

    const pms = all
      .filter((u) => u.role === "PM")
      .map((u) => u.full_name)
      .sort(sortByName);

    // Every active user's full name — useful for filters that don't
    // care about role (e.g. AnnualReviews' "Employee" filter is really
    // "any user reviewed" which includes promoted ex-Employees).
    const allNames = all.map((u) => u.full_name).sort(sortByName);

    return { employees, mentors, pms, allNames };
  }, [usersQuery.data]);

  return {
    employeeNames: buckets.employees,
    mentorNames: buckets.mentors,
    pmNames: buckets.pms,
    allUserNames: buckets.allNames,
    isLoading: usersQuery.isPending,
  };
}
