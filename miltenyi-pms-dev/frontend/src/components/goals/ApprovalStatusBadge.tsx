import type { ApprovalStatus } from "../../services/goal.service";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { halfDisplayLabel } from "../../utils/goalStatus";

interface ApprovalStatusBadgeProps {
  readonly status: ApprovalStatus;
}

const STATIC_CONFIG: Partial<
  Record<ApprovalStatus, { label: string; cls: string }>
> = {
  draft:             { label: "Draft",                cls: "bg-slate-100 text-slate-600" },
  pending_approval:  { label: "Pending Approval",     cls: "bg-blue-100 text-blue-700" },
  changes_requested: { label: "Changes Requested",    cls: "bg-amber-100 text-amber-700" },
  approved:          { label: "Approved",             cls: "bg-emerald-100 text-emerald-700" },
};

// Per-cycle hue. Self-reviewed and mentor-reviewed share the cycle's
// base palette but differ in saturation so a column of badges remains
// scannable at a glance.
const REVIEW_STATE_CLS: Record<string, string> = {
  h1_self_reviewed:   "bg-teal-100 text-teal-700",
  h1_mentor_reviewed: "bg-cyan-100 text-cyan-700",
  h2_self_reviewed:   "bg-indigo-100 text-indigo-700",
  h2_mentor_reviewed: "bg-violet-100 text-violet-700",
  q1_self_reviewed:   "bg-teal-100 text-teal-700",
  q1_mentor_reviewed: "bg-cyan-100 text-cyan-700",
  q2_self_reviewed:   "bg-sky-100 text-sky-700",
  q2_mentor_reviewed: "bg-blue-100 text-blue-700",
  q3_self_reviewed:   "bg-indigo-100 text-indigo-700",
  q3_mentor_reviewed: "bg-violet-100 text-violet-700",
  q4_self_reviewed:   "bg-fuchsia-100 text-fuchsia-700",
  q4_mentor_reviewed: "bg-pink-100 text-pink-700",
};

const REVIEW_STATE_RE = /^(h[12]|q[1-4])_(self|mentor)_reviewed$/;

export function ApprovalStatusBadge({ status }: ApprovalStatusBadgeProps) {
  const { settings } = useSystemSettings();
  const cycleType = settings?.cycle_type ?? null;

  let label: string;
  let cls: string;

  if (STATIC_CONFIG[status]) {
    ({ label, cls } = STATIC_CONFIG[status]!);
  } else {
    const m = REVIEW_STATE_RE.exec(status);
    if (m) {
      const cycle = m[1].toUpperCase() as
        | "H1" | "H2" | "Q1" | "Q2" | "Q3" | "Q4";
      const action = m[2] === "self" ? "Self-Reviewed" : "Mentor-Reviewed";
      label = `${halfDisplayLabel(cycle, cycleType)} ${action}`;
      cls = REVIEW_STATE_CLS[status] ?? STATIC_CONFIG.draft!.cls;
    } else {
      ({ label, cls } = { label: "Draft", cls: STATIC_CONFIG.draft!.cls });
    }
  }

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${cls}`}
    >
      {label}
    </span>
  );
}
