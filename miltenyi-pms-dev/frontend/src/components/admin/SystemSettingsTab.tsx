import { useCallback, useState } from "react";
import { Save, Info, FlaskConical } from "lucide-react";
import type { CycleType } from "@/services/system-settings.service";
import { adminService } from "@/services/admin.service";
import { useConfirm } from "@/hooks/useConfirm";

/** Keys we can wire a preflight warning to. Visibility flags are
 *  listed but always come back with count 0 from the backend, so the
 *  confirm dialog never fires for them — listing them keeps the type
 *  exhaustive against `SettingsPreflight` in case we ever want to add
 *  warnings to one. */
type GuardedKey =
  | "annual_goals_edit_enabled"
  | "annual_reviews_enabled"
  | "project_ratings_visible"
  | "annual_review_final_rating_visible";

interface SystemSettingsTabProps {
  readonly activeCycleName: string;
  readonly cycleType: CycleType;
  readonly fiscalStartMonth: number;
  // Annual review controls
  readonly annualReviewsEnabled: boolean;
  readonly onAnnualReviewsEnabledChange: (val: boolean) => void;
  readonly annualReviewFinalRatingVisible: boolean;
  readonly onAnnualReviewFinalRatingVisibleChange: (val: boolean) => void;
  // Goal access controls
  readonly annualGoalsEditEnabled: boolean;
  readonly onAnnualGoalsEditEnabledChange: (val: boolean) => void;
  readonly projectRatingsVisible: boolean;
  readonly onProjectRatingsVisibleChange: (val: boolean) => void;
  // Dev / QA date simulation
  readonly simulatedToday: string | null;
  readonly simulationAllowed: boolean;
  readonly onSimulatedTodayChange: (date: string) => void;
  readonly onClearSimulatedToday: () => void;
  readonly onSave: () => void;
  readonly isSaving: boolean;
}

const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];

interface ToggleRowProps {
  readonly label: string;
  readonly description: string;
  readonly checked: boolean;
  readonly onChange: (val: boolean) => void;
}

function ToggleRow({ label, description, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-text-main">{label}</p>
        <p className="text-xs text-text-muted mt-0.5">{description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1 ${
          checked ? "bg-brand" : "bg-slate-300 dark:bg-slate-400"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white dark:bg-slate-100 shadow transition duration-200 ${
            checked ? "translate-x-4" : "translate-x-0"
          }`}
        />
      </button>
    </div>
  );
}

export function SystemSettingsTab({
  activeCycleName,
  cycleType,
  fiscalStartMonth,
  annualReviewsEnabled,
  onAnnualReviewsEnabledChange,
  annualReviewFinalRatingVisible,
  onAnnualReviewFinalRatingVisibleChange,
  annualGoalsEditEnabled,
  onAnnualGoalsEditEnabledChange,
  projectRatingsVisible,
  onProjectRatingsVisibleChange,
  simulatedToday,
  simulationAllowed,
  onSimulatedTodayChange,
  onClearSimulatedToday,
  onSave,
  isSaving,
}: SystemSettingsTabProps) {
  const confirm = useConfirm();

  /** Wraps a setter so that an off-flip first asks the backend whether
   *  any in-flight users would get stranded. If the count is > 0, we
   *  open a confirm modal with the count + warning copy. Cancel keeps
   *  the toggle as-is; confirm flips it. Going on->off only — flipping
   *  on never strands anyone. */
  const guardedToggle = useCallback(
    async (
      key: GuardedKey,
      label: string,
      nextValue: boolean,
      apply: (val: boolean) => void,
    ) => {
      if (nextValue === true) {
        apply(true);
        return;
      }
      try {
        const preflight = await adminService.getSettingsPreflight();
        const entry = preflight[key];
        if (entry && entry.in_flight_count > 0 && entry.warning) {
          const ok = await confirm({
            title: `Disable ${label}?`,
            message: entry.warning,
            variant: "warning",
            confirmText: "Disable Anyway",
          });
          if (!ok) return;
        }
      } catch {
        // Preflight is advisory — if it fails (e.g. backend hiccup),
        // don't block the toggle. Worst case HR proceeds without the
        // warning and re-enables once they realise.
      }
      apply(false);
    },
    [confirm],
  );

  return (
    <div className="p-6 max-w-mx-auto space-y-6">

      {/* ── Annual Review Settings ───────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg font-semibold text-text-main">
            Annual Review Settings
          </h3>
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving}
            className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-70 disabled:cursor-not-allowed transition-all shadow-sm"
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            {isSaving ? "Saving…" : "Save Configuration"}
          </button>
        </div>
        <div className="bg-surface rounded-xl border border-border shadow-sm divide-y divide-border">
          <div className="px-5 py-4">
            <div className="divide-y divide-border/60">
              <ToggleRow
                label="Enable Annual Reviews"
                description="When on, employees can submit self-reviews. Disabling pauses new submissions; existing reviews stay readable."
                checked={annualReviewsEnabled}
                onChange={(next) =>
                  guardedToggle(
                    "annual_reviews_enabled",
                    "Annual Reviews",
                    next,
                    onAnnualReviewsEnabledChange,
                  )
                }
              />
              <ToggleRow
                label="Show Ratings on Annual Reviews"
                description="When on, the Ratings column is visible on Mentee/Team Review tabs and final ratings are revealed to employees once published."
                checked={annualReviewFinalRatingVisible}
                onChange={(next) =>
                  guardedToggle(
                    "annual_review_final_rating_visible",
                    "Final Rating Visibility",
                    next,
                    onAnnualReviewFinalRatingVisibleChange,
                  )
                }
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Goal & Review Access Controls ───────────────────────────── */}
      <div>
        <h3 className="font-display text-lg font-semibold text-text-main mb-4">
          Goal & Review Access Controls
        </h3>
        <div className="bg-surface rounded-xl border border-border shadow-sm divide-y divide-border">

          {/* Annual Goal Settings */}
          <div className="px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">
              Annual Goal Settings
            </p>
            <div className="divide-y divide-border/60">
              <ToggleRow
                label="Edit Access for Annual Goals"
                description="When off, no one in the org can create or edit annual goals."
                checked={annualGoalsEditEnabled}
                onChange={(next) =>
                  guardedToggle(
                    "annual_goals_edit_enabled",
                    "Annual Goal Edit Access",
                    next,
                    onAnnualGoalsEditEnabledChange,
                  )
                }
              />
            </div>
          </div>

          {/* Project Settings */}
          <div className="px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">
              Project Settings
            </p>
            <div className="divide-y divide-border/60">
              <ToggleRow
                label="View Project Ratings"
                description="When on, employees can see their project performance ratings."
                checked={projectRatingsVisible}
                onChange={(next) =>
                  guardedToggle(
                    "project_ratings_visible",
                    "Project Rating Visibility",
                    next,
                    onProjectRatingsVisibleChange,
                  )
                }
              />
            </div>
          </div>

        </div>
      </div>
      {/* ── Performance Cycle Configuration ────────────────────────── */}
      <div>
        <h3 className="font-display text-lg font-semibold text-text-main mb-4">
          Performance Cycle Configuration
        </h3>
        <div className="space-y-6 bg-surface p-5 rounded-xl border border-border shadow-sm">

          {/* Current Active Cycle (Read-Only) */}
          <div>
            <label className="block text-sm font-medium text-text-main mb-1">
              Current Active Cycle
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={activeCycleName || "System Calculated..."}
                disabled
                className="w-full sm:w-64 rounded-lg border border-border bg-gray-50 px-3 py-2 text-sm text-text-muted cursor-not-allowed"
              />
              <span className="flex items-center gap-1.5 text-xs text-text-muted bg-gray-100 px-2 py-1 rounded-md border border-gray-200">
                <Info className="w-3.5 h-3.5" />
                System Calculated
              </span>
            </div>
            <p className="mt-1.5 text-xs text-text-muted">
              Dynamically generated from the cadence and fiscal start month below.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Cadence (Read-Only) */}
            <div>
              <label htmlFor="cycle-type" className="block text-sm font-medium text-text-main mb-1">
                Cycle Cadence
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="cycle-type"
                  type="text"
                  value={cycleType === "half_yearly" ? "Half-Yearly" : cycleType === "annual" ? "Annual" : "Quarterly"}
                  disabled
                  className="w-full rounded-lg border border-border bg-gray-50 px-3 py-2 text-sm text-text-muted cursor-not-allowed"
                />
                <span className="flex items-center gap-1.5 text-xs text-text-muted bg-gray-100 px-2 py-1 rounded-md border border-gray-200 shrink-0">
                  <Info className="w-3.5 h-3.5" />
                  Read Only
                </span>
              </div>
            </div>

            {/* Fiscal Start Month (Read-Only) */}
            <div>
              <label htmlFor="fiscal-start" className="block text-sm font-medium text-text-main mb-1">
                Fiscal Start Month
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="fiscal-start"
                  type="text"
                  value={MONTHS.find((m) => m.value === fiscalStartMonth)?.label ?? "—"}
                  disabled
                  className="w-full rounded-lg border border-border bg-gray-50 px-3 py-2 text-sm text-text-muted cursor-not-allowed"
                />
                <span className="flex items-center gap-1.5 text-xs text-text-muted bg-gray-100 px-2 py-1 rounded-md border border-gray-200 shrink-0">
                  <Info className="w-3.5 h-3.5" />
                  Read Only
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Developer: Date Simulation ──────────────────────────────
          Hidden in production. The backend's ALLOW_DATE_SIMULATION env
          flag drives `simulationAllowed`; when false this whole block
          stays off the page so non-dev orgs never see it. */}
      {simulationAllowed && (
        <div>
          <h3 className="font-display text-lg font-semibold text-text-main mb-4 flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-amber-600" aria-hidden="true" />
            Developer · Date Simulation
          </h3>
          <div className="space-y-3 bg-surface p-5 rounded-xl border border-amber-200 dark:border-amber-500/40 shadow-sm">
            <p className="text-xs text-text-muted">
              Pin a fake "today" for cycle determination, review window
              checks, and dashboards. The whole app shows an amber banner
              while this is active so other users know.
              <br />
              Audit timestamps (project completion, assignment end,
              export filenames) always use the real wall clock and ignore
              this setting.
            </p>
            <div className="flex items-end gap-2 flex-wrap">
              <div>
                <label
                  htmlFor="simulated-today"
                  className="block text-xs font-medium text-text-muted mb-1"
                >
                  Simulated Today
                </label>
                <input
                  id="simulated-today"
                  type="date"
                  value={simulatedToday ?? ""}
                  onChange={(e) => onSimulatedTodayChange(e.target.value)}
                  className="rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main outline-none focus:border-brand sm:w-52"
                />
              </div>
              {simulatedToday && (
                <button
                  type="button"
                  onClick={onClearSimulatedToday}
                  className="rounded-lg border border-border bg-white px-3 py-2 text-sm font-medium text-text-muted hover:bg-slate-50"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
