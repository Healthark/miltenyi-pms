import {
  ArrowRight,
  AlertTriangle,
  BadgeCheck,
  Mail,
  Phone,
  Building2,
  Briefcase,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { MenteeSummary } from "../../services/mentee.service";

interface MenteeCardProps {
  readonly mentee: MenteeSummary;
}

function initialsFor(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function MenteeCard({ mentee }: MenteeCardProps) {
  const hasPending = mentee.pending_actions_count > 0;
  const initials = initialsFor(mentee.full_name);

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm transition hover:shadow-md">
      {/* Header — avatar, name, active dot, attention pill */}
      <div className="flex items-center gap-3">
        <div
          className="flex h-11 w-11 items-center justify-center rounded-full bg-brand text-sm font-bold text-white shrink-0"
          aria-hidden="true"
        >
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-text-main">{mentee.full_name}</p>
          <p className="truncate text-xs text-text-muted">{mentee.role}</p>
        </div>
        {hasPending && (
          <span
            className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 shrink-0"
            title={`${mentee.pending_actions_count} item${
              mentee.pending_actions_count === 1 ? "" : "s"
            } need${mentee.pending_actions_count === 1 ? "s" : ""} your attention`}
          >
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            Attention
          </span>
        )}
        <span
          className={`flex h-2.5 w-2.5 shrink-0 rounded-full ${
            mentee.is_active ? "bg-green-500" : "bg-slate-300"
          }`}
          aria-label={mentee.is_active ? "Active" : "Inactive"}
        />
      </div>

      {/* Info grid */}
      <div className="flex flex-col gap-2 rounded-md bg-slate-50 px-3 py-2.5">
        <InfoRow icon={BadgeCheck} label="Emp Code" value={mentee.employee_code} />
        <InfoRow icon={Mail} label="Email" value={mentee.email} />
        <InfoRow icon={Phone} label="Phone" value={mentee.phone} />
        <InfoRow icon={Building2} label="Department" value={mentee.department_name} />
        <InfoRow icon={Briefcase} label="Designation" value={mentee.designation_name} />
      </div>

      {/* Footer — view details */}
      <div className="flex items-center justify-end border-t border-border pt-3">
        <Link
          to={`/my-mentees/${mentee.user_id}`}
          className="flex items-center gap-1 text-xs font-medium text-brand hover:underline"
        >
          View details <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  readonly icon: typeof Mail;
  readonly label: string;
  readonly value: string | null;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
      <p className="text-[11px] font-medium uppercase tracking-wide text-text-muted w-[88px] shrink-0">
        {label}
      </p>
      <p className="truncate text-xs text-text-main">{value ?? "—"}</p>
    </div>
  );
}
