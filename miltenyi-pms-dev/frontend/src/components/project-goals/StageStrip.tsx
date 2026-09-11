import { Check } from "lucide-react";
import {
  SET_STATUS_ORDER,
  type ProjectGoalSetStatus,
} from "@/services/project-goals.service";

const LABELS: Record<ProjectGoalSetStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  approved: "Approved · agreed offline",
};

/** Horizontal lifecycle strip of the GOALS (once a year): done steps get a
 *  check, the current step is filled brand, upcoming steps are outlined.
 *  The quarterly self-review / review progress lives in QuarterProgress. */
export function StageStrip({ status }: Readonly<{ status: ProjectGoalSetStatus }>) {
  const idx = SET_STATUS_ORDER.indexOf(status);
  return (
    <ol className="flex flex-wrap items-center gap-2 text-xs" aria-label="Goal set progress">
      {SET_STATUS_ORDER.map((s, i) => {
        const done = i < idx || (i === idx && s === "approved");
        const current = i === idx && !done;
        return (
          <li key={s} className="flex items-center gap-2">
            {done ? (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
                <Check className="h-3 w-3" aria-hidden="true" />
              </span>
            ) : current ? (
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-[10px] font-bold text-white">
                {i + 1}
              </span>
            ) : (
              <span className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-white text-[10px] font-semibold text-text-muted">
                {i + 1}
              </span>
            )}
            <span className={current ? "font-semibold text-text-main" : done ? "text-text-main" : "text-text-muted"}>
              {LABELS[s]}
            </span>
            {i < SET_STATUS_ORDER.length - 1 && <span className="h-px w-6 bg-border" aria-hidden="true" />}
          </li>
        );
      })}
    </ol>
  );
}
