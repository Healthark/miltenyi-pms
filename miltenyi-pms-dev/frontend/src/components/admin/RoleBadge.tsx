/**
 * RoleBadge — small pill rendering a user's role with role-specific color.
 *
 * Roles align with the backend `Role` enum in user_models.py:
 *   Admin   — Healthark HR (full admin)
 *   Mentor  — Healthark mentor (mentees' goals, reviews, project-goal entry)
 *   Staff   — Healthark employee placed on Miltenyi work (default)
 *
 * Unknown values (deactivated accounts from the retired PM / Miltenyi-HR
 * roles) fall back to the raw string in a neutral style.
 */

const ROLE_LABELS: Record<string, string> = {
  Admin: "Admin",
  Mentor: "Mentor",
  Staff: "Staff",
};

const ROLE_STYLES: Record<string, string> = {
  Admin: "bg-blue-100 text-blue-700",
  Mentor: "bg-emerald-100 text-emerald-700",
  Staff: "bg-slate-100 text-slate-600",
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
    // ("Mentor") fit in the narrowed Role
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
