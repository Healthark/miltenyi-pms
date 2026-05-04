import { Target, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { DashboardSummary } from "../../services/dashboard.service";

interface GoalsWidgetProps {
  readonly summary: DashboardSummary;
}

interface StatRowProps {
  readonly label: string;
  readonly count: number;
  readonly dotClass: string;
}

function StatRow({ label, count, dotClass }: StatRowProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span
          className={`h-2 w-2 rounded-full ${dotClass}`}
          aria-hidden="true"
        />
        <span className="text-sm text-text-muted">{label}</span>
      </div>
      <span className="text-sm font-semibold text-text-main">{count}</span>
    </div>
  );
}

export function GoalsWidget({ summary }: GoalsWidgetProps) {
  const {
    total_goals,
    draft_goals,
    submitted_goals,
    approved_goals,
    changes_requested_goals,
    completion_percent,
  } = summary;

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light">
            <Target className="h-5 w-5 text-brand" aria-hidden="true" />
          </div>
          <div>
            <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
              Annual Goals
            </p>
            <p className="font-display text-2xl font-semibold text-text-main leading-tight">
              {total_goals}
            </p>
          </div>
        </div>
      </div>

      {/* Completion — derived from criteria, not a separate status field */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-text-muted">
            Completion (approved goals)
          </span>
          <span className="text-xs font-medium text-text-main">
            {completion_percent}%
          </span>
        </div>
        <div
          className="h-1.5 w-full rounded-full bg-slate-100"
          role="progressbar"
          aria-valuenow={completion_percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-1.5 rounded-full bg-brand transition-all duration-500"
            style={{ width: `${completion_percent}%` }}
          />
        </div>
      </div>

      {/* Approval-state breakdown */}
      <div className="space-y-2 border-t border-border pt-3">
        <StatRow label="Draft" count={draft_goals} dotClass="bg-slate-400" />
        <StatRow
          label="Awaiting Approval"
          count={submitted_goals}
          dotClass="bg-blue-400"
        />
        <StatRow
          label="Changes Requested"
          count={changes_requested_goals}
          dotClass="bg-amber-400"
        />
        <StatRow
          label="Approved"
          count={approved_goals}
          dotClass="bg-green-400"
        />
      </div>

      {/* CTA */}
      <Link
        to="/annual-goals"
        className="flex items-center gap-1 text-xs font-medium text-brand hover:underline mt-auto"
      >
        View all goals <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}
