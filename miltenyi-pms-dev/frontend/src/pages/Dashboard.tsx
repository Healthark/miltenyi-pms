import { useAuth } from "@/hooks/useAuth";
import { HrDashboard } from "@/pages/HrDashboard";
import { MentorDashboard } from "@/pages/MentorDashboard";
import { EmployeeDashboard } from "@/pages/EmployeeDashboard";

/**
 * Dashboard — role-aware router.
 *
 * Three concrete layouts live behind this entry point:
 *   Admin                        → HrDashboard       (org-wide rollups)
 *   Mentor, or anyone with mentees → MentorDashboard  (mentee-centric)
 *   Staff                        → EmployeeDashboard (personal queue)
 *
 * A Mentor lands on the mentor layout even with no mentees assigned yet
 * (the cards show their empty states); the staff layout offers "start
 * your goals / self-review" calls to action that do not apply to mentors.
 * `has_mentees` comes from the auth claims (refreshed on app mount), so
 * the decision is synchronous and there is no layout flash.
 */
export function Dashboard() {
  const { user } = useAuth();

  if (user?.role === "Admin") {
    return <HrDashboard />;
  }

  if (user?.role === "Mentor" || user?.has_mentees) {
    return <MentorDashboard />;
  }

  return <EmployeeDashboard />;
}
