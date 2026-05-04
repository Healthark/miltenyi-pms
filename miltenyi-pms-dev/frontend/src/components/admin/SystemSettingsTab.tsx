import { Save, Info } from "lucide-react";
import type { CycleType } from "../../services/system-settings.service";

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
  readonly finalRatingVisible: boolean;
  readonly onFinalRatingVisibleChange: (val: boolean) => void;
  readonly projectRatingsVisible: boolean;
  readonly onProjectRatingsVisibleChange: (val: boolean) => void;
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
          checked ? "bg-brand" : "bg-slate-200"
        }`}
      >
        <span
          className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition duration-200 ${
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
  finalRatingVisible,
  onFinalRatingVisibleChange,
  projectRatingsVisible,
  onProjectRatingsVisibleChange,
  onSave,
  isSaving,
}: SystemSettingsTabProps) {

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
                description="When on, the Annual Reviews module is active and employees can submit self-reviews."
                checked={annualReviewsEnabled}
                onChange={onAnnualReviewsEnabledChange}
              />
              <ToggleRow
                label="Show Ratings on Annual Reviews"
                description="When on, the Ratings column is visible on Mentee/Team Review tabs and final ratings are revealed to employees once published."
                checked={annualReviewFinalRatingVisible}
                onChange={onAnnualReviewFinalRatingVisibleChange}
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
                onChange={onAnnualGoalsEditEnabledChange}
              />
              <ToggleRow
                label="View Final Rating for Annual Goals"
                description="When on, employees can see their final rating on annual reviews."
                checked={finalRatingVisible}
                onChange={onFinalRatingVisibleChange}
              />
            </div>
          </div>

          {/* Project Goal Settings */}
          <div className="px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted mb-1">
              Project Goal Settings
            </p>
            <div className="divide-y divide-border/60">
              <ToggleRow
                label="View Ratings for Project Goals"
                description="When on, employees can see their project performance ratings."
                checked={projectRatingsVisible}
                onChange={onProjectRatingsVisibleChange}
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

    </div>
  );
}
