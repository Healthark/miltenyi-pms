const ROLE_STYLES: Record<string, string> = {
  Admin: "bg-blue-100 text-blue-700",
  Manager: "bg-amber-100 text-amber-700",
  Principal: "bg-purple-100 text-purple-700",
  Staff: "bg-slate-100 text-slate-600",
};

interface RoleBadgeProps {
  readonly role: string;
}

export function RoleBadge({ role }: RoleBadgeProps) {
  const cls = ROLE_STYLES[role] ?? "bg-slate-100 text-slate-600";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {role}
    </span>
  );
}
