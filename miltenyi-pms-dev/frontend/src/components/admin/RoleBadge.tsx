/**
 * RoleBadge — small pill rendering a user's role with role-specific color.
 *
 * Roles align with the backend `Role` enum in user_models.py:
 *   HR_MyOrg     — full super-admin (Healthark HR)
 *   HR_Miltenyi  — limited admin (Miltenyi HR)
 *   Mentor       — fixed mentor (reviews mentee goals + annual reviews)
 *   PM           — Miltenyi project manager
 *   Employee     — Miltenyi employee (default)
 */

const ROLE_LABELS: Record<string, string> = {
  HR_MyOrg: "HR · Healthark",
  HR_Miltenyi: "HR · Miltenyi",
  Mentor: "Mentor",
  PM: "PM",
  Employee: "Employee",
};

const ROLE_STYLES: Record<string, string> = {
  HR_MyOrg: "bg-blue-100 text-blue-700",
  HR_Miltenyi: "bg-purple-100 text-purple-700",
  Mentor: "bg-emerald-100 text-emerald-700",
  PM: "bg-amber-100 text-amber-700",
  Employee: "bg-slate-100 text-slate-600",
};

interface RoleBadgeProps {
  readonly role: string;
}

export function RoleBadge({ role }: RoleBadgeProps) {
  const cls = ROLE_STYLES[role] ?? "bg-slate-100 text-slate-600";
  const label = ROLE_LABELS[role] ?? role;
  return (
    // Compact pill: text-[11px] + px-1.5 saves ~15% horizontal space
    // vs the previous text-xs + px-2.5 layout, so the longest labels
    // ("HR · Healthark" / "HR · Miltenyi") fit in the narrowed Role
    // column without wrapping. `whitespace-nowrap` is the safety net —
    // if the column is ever tight enough that even the compact pill
    // would wrap, it instead overflows horizontally into the table's
    // outer `overflow-x-auto` wrapper rather than breaking onto two
    // misaligned lines.
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-full px-1.5 py-0.5 text-[11px] font-medium ${cls}`}
    >
      {label}
    </span>
  );
}
