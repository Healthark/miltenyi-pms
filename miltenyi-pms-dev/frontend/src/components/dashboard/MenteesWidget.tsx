import { Users, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { DashboardSummary } from "../../services/dashboard.service";

interface MenteesWidgetProps {
  readonly summary: DashboardSummary;
}

export function MenteesWidget({ summary }: MenteesWidgetProps) {
  const { mentee_count } = summary;

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light">
          <Users className="h-5 w-5 text-brand" aria-hidden="true" />
        </div>
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
          My Mentees
        </p>
      </div>

      {/* Count */}
      <p className="font-display text-2xl font-semibold text-text-main">
        {mentee_count}
      </p>

      {/* Context */}
      <p className="text-sm text-text-muted -mt-2">
        {mentee_count === 0
          ? "No mentees currently assigned to you."
          : `${mentee_count} ${mentee_count === 1 ? "employee" : "employees"} reporting to you.`}
      </p>

      {/* CTA */}
      {mentee_count > 0 && (
        <Link
          to="/my-mentees"
          className="flex items-center gap-1 text-xs font-medium text-brand hover:underline mt-auto"
        >
          View mentees <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      )}
    </div>
  );
}
