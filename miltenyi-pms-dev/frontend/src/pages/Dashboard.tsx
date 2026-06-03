import { useAuth } from "@/hooks/useAuth";
import { HrDashboard } from "@/pages/HrDashboard";
import { MentorDashboard } from "@/pages/MentorDashboard";
import { EmployeeDashboard } from "@/pages/EmployeeDashboard";

/**
 * Dashboard — role-aware router.
 *
 * Three concrete layouts live behind this entry point:
 *   HR_MyOrg / HR_Miltenyi → HrDashboard       (org-wide rollups)
 *   any role with mentees   → MentorDashboard  (mentee-centric)
 *   everyone else           → EmployeeDashboard (personal queue)
 *
 * `has_mentees` is sourced from the auth context — populated at login,
 * so the routing decision is synchronous and doesn't wait on any fetch.
 * This avoids a layout flash from a "deciding…" intermediate state.
 *
 * PMs land on EmployeeDashboard by default (their pending project reviews
 * are reached via /project-reviews); a PM who also has direct mentees
 * gets MentorDashboard via the has_mentees branch.
 */
export function Dashboard() {
  const { user } = useAuth();

  if (user?.role === "HR_MyOrg" || user?.role === "HR_Miltenyi") {
    return <HrDashboard />;
  }

  if (user?.has_mentees) {
    return <MentorDashboard />;
  }

  return <EmployeeDashboard />;
}
