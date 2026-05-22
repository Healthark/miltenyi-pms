import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Save, Info, FlaskConical, AlertTriangle } from "lucide-react";
import type { CycleType } from "@/services/system-settings.service";
import {
  adminService,
  type YearPreflight,
  type YearSettingsUpdatePayload,
} from "@/services/admin.service";
import { queryKeys } from "@/lib/queryKeys";
import { useToast } from "@/hooks/useToast";
import { useSnackbar } from "@/hooks/useSnackbar";
import { getErrorMessage } from "@/utils/errors";
import { useSystemSettings } from "@/hooks/useSystemSettings";

interface SystemSettingsTabProps {
  readonly activeCycleName: string;
  readonly cycleType: CycleType;
  readonly fiscalStartMonth: number;
  /** IANA timezone string. Anchors every backend calendar-day decision. */
  readonly timezone: string;
  readonly onTimezoneChange: (tz: string) => void;
  // Dev / QA date simulation
  readonly simulatedToday: string | null;
  readonly simulationAllowed: boolean;
  readonly onSimulatedTodayChange: (date: string) => void;
  readonly onClearSimulatedToday: () => void;
  /** Called when HR saves the org-wide cadence/simulation section. The
   *  four year-scoped toggles save through their own mutation below. */
  readonly onSaveOrgWide: () => void;
  readonly isSavingOrgWide: boolean;
}

/** Curated short list of IANA timezones that cover the orgs we deploy
 *  to. Keeps the dropdown manageable (a full IANA list is ~500 entries).
 *  Add more as needed; "Other (type below)" lets HR enter any IANA
 *  string the backend's ZoneInfo will accept. */
const TIMEZONE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: "UTC", label: "UTC" },
  { value: "Asia/Kolkata", label: "Asia/Kolkata (India)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (Germany)" },
  { value: "Europe/London", label: "Europe/London (UK)" },
  { value: "America/New_York", label: "America/New_York (US East)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (US West)" },
  { value: "Australia/Sydney", label: "Australia/Sydney" },
];

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
  readonly disabled?: boolean;
}

function ToggleRow({ label, description, checked, onChange, disabled }: ToggleRowProps) {
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
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${
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

/** Labels shown in the diff confirmation card. Mirrors the toggle labels
 *  but is short enough to fit a one-line "Label: ON → OFF" row. */
const TOGGLE_LABELS: Record<keyof YearSettingsUpdatePayload, string> = {
  annual_reviews_enabled: "Annual Reviews",
  annual_review_final_rating_visible: "Annual Review Rating Visibility",
  annual_goals_edit_enabled: "Annual Goal Edit Access",
  project_ratings_visible: "Project Rating Visibility",
};

interface SaveConfirmationModalProps {
  readonly fyLabel: string;
  readonly diff: ReadonlyArray<{
    key: keyof YearSettingsUpdatePayload;
    from: boolean;
    to: boolean;
  }>;
  readonly preflight: YearPreflight | null;
  readonly preflightLoading: boolean;
  readonly isSaving: boolean;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

/** Card that pops up on Save Configuration. Lists each toggle that
 *  changed for the selected FY plus the in-flight impact from the
 *  preflight endpoint, so HR sees who they're affecting before
 *  committing. Built as a local component (not the generic
 *  ConfirmDialog) because the body is structured, not a single string. */
function SaveConfirmationModal({
  fyLabel,
  diff,
  preflight,
  preflightLoading,
  isSaving,
  onConfirm,
  onCancel,
}: SaveConfirmationModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSaving) onCancel();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [onCancel, isSaving]);

  const flips: Array<{ key: keyof YearSettingsUpdatePayload; warning: string | null }> = [];
  for (const d of diff) {
    if (d.to === false && preflight) {
      flips.push({ key: d.key, warning: preflight[d.key]?.warning ?? null });
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-70 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSaving) onCancel();
      }}
    >
      <div className="w-full max-w-lg rounded-xl bg-surface p-6 shadow-xl">
        <div className="flex items-start gap-3">
          <div className="rounded-lg bg-brand/10 p-2 text-brand">
            <Save className="h-5 w-5" aria-hidden="true" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="font-display text-base font-semibold text-text-main">
              Apply changes to {fyLabel}?
            </h2>
            <p className="mt-1 text-sm text-text-muted">
              The following access settings will be saved for the {fyLabel}{" "}
              fiscal year. Other years remain untouched.
            </p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-background/40 p-3">
          {diff.length === 0 ? (
            <p className="text-sm text-text-muted">No changes to save.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {diff.map((d) => (
                <li
                  key={d.key}
                  className="flex items-center justify-between gap-3 py-2 text-sm"
                >
                  <span className="text-text-main">{TOGGLE_LABELS[d.key]}</span>
                  <span className="font-mono text-xs">
                    <span
                      className={d.from ? "text-green-700" : "text-text-muted"}
                    >
                      {d.from ? "ON" : "OFF"}
                    </span>
                    <span className="mx-2 text-text-muted">→</span>
                    <span
                      className={d.to ? "text-green-700" : "text-text-muted"}
                    >
                      {d.to ? "ON" : "OFF"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {flips.length > 0 && (
          <div className="mt-3 space-y-2">
            {preflightLoading && (
              <p className="text-xs text-text-muted">
                Checking who would be affected…
              </p>
            )}
            {!preflightLoading &&
              flips.map((f) =>
                f.warning ? (
                  <div
                    key={f.key}
                    className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
                  >
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>{f.warning}</span>
                  </div>
                ) : null,
              )}
          </div>
        )}

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isSaving || diff.length === 0}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSaving ? "Saving…" : "Apply Configuration"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function SystemSettingsTab({
  activeCycleName,
  cycleType,
  fiscalStartMonth,
  timezone,
  onTimezoneChange,
  simulatedToday,
  simulationAllowed,
  onSimulatedTodayChange,
  onClearSimulatedToday,
  onSaveOrgWide,
  isSavingOrgWide,
}: SystemSettingsTabProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const snackbar = useSnackbar();
  const { refreshSettings } = useSystemSettings();

  // ── Year dropdown options ────────────────────────────────────────
  const yearsQuery = useQuery({
    queryKey: queryKeys.admin.settingsYears(),
    queryFn: adminService.listSettingsYears,
  });

  // Memoised so the `?? []` fallback doesn't manufacture a fresh array
  // each render — keeps downstream useMemo deps stable.
  const yearOptions = useMemo(
    () => yearsQuery.data?.years ?? [],
    [yearsQuery.data],
  );
  const defaultYear = useMemo(
    () => yearOptions.find((y) => y.is_current)?.fy_label ?? yearOptions[0]?.fy_label ?? null,
    [yearOptions],
  );

  const [selectedYear, setSelectedYear] = useState<string | null>(null);
  // Snap to the default once the dropdown options arrive. After that,
  // HR's selection sticks across refetches. Done during render via the
  // "snapshot the prop" pattern (React 19) — the conditional guard
  // prevents an infinite loop.
  if (selectedYear === null && defaultYear !== null) {
    setSelectedYear(defaultYear);
  }

  // ── Selected year's saved values ─────────────────────────────────
  const yearSettingsQuery = useQuery({
    queryKey: selectedYear
      ? queryKeys.admin.settingsYear(selectedYear)
      : ["admin", "settings", "year", "__unset__"],
    queryFn: () => adminService.getYearSettings(selectedYear as string),
    enabled: !!selectedYear,
  });
  const savedYear = yearSettingsQuery.data ?? null;

  // ── Local form state for the four toggles ────────────────────────
  // Reset whenever the selected year changes (or its saved row first
  // resolves) so the toggles reflect that FY's persisted values.
  const [form, setForm] = useState<YearSettingsUpdatePayload>({
    annual_reviews_enabled: false,
    annual_review_final_rating_visible: false,
    annual_goals_edit_enabled: false,
    project_ratings_visible: false,
  });
  const [formKey, setFormKey] = useState<string | null>(null);
  // Re-snapshot the form when HR picks a different FY (or the saved row
  // first resolves). Render-phase setState gated by `formKey` so it only
  // fires once per FY change — the React 19 alternative to a sync effect.
  if (savedYear && formKey !== savedYear.fy_label) {
    setForm({
      annual_reviews_enabled: savedYear.annual_reviews_enabled,
      annual_review_final_rating_visible: savedYear.annual_review_final_rating_visible,
      annual_goals_edit_enabled: savedYear.annual_goals_edit_enabled,
      project_ratings_visible: savedYear.project_ratings_visible,
    });
    setFormKey(savedYear.fy_label);
  }

  // Diff between local form state and last-saved values — drives the
  // confirmation card's row list. Empty when HR hasn't touched anything.
  const diff = useMemo(() => {
    if (!savedYear) return [];
    const keys: Array<keyof YearSettingsUpdatePayload> = [
      "annual_reviews_enabled",
      "annual_review_final_rating_visible",
      "annual_goals_edit_enabled",
      "project_ratings_visible",
    ];
    return keys
      .filter((k) => form[k] !== savedYear[k])
      .map((k) => ({ key: k, from: savedYear[k], to: form[k] }));
  }, [form, savedYear]);

  // ── Save flow ────────────────────────────────────────────────────
  const [showConfirm, setShowConfirm] = useState(false);
  const preflightQuery = useQuery({
    queryKey: selectedYear
      ? queryKeys.admin.settingsYearPreflight(selectedYear)
      : ["admin", "settings", "year", "__unset__", "preflight"],
    queryFn: () => adminService.getYearPreflight(selectedYear as string),
    enabled: showConfirm && !!selectedYear,
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      adminService.updateYearSettings(selectedYear as string, form),
    onSuccess: (fresh) => {
      queryClient.setQueryData(
        queryKeys.admin.settingsYear(fresh.fy_label),
        fresh,
      );
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.settingsYears(),
      });
      // Banners on AnnualReviews etc. read /settings/, so refresh that too.
      void refreshSettings();
      void queryClient.invalidateQueries({
        queryKey: queryKeys.admin.settings(),
      });
      setShowConfirm(false);
      toast.success(`Configuration saved for ${fresh.fy_label}.`);
    },
    onError: (err) => snackbar.error(getErrorMessage(err)),
  });

  const handleOpenConfirm = () => {
    if (!selectedYear || diff.length === 0) return;
    setShowConfirm(true);
  };

  const selectedOption = yearOptions.find((y) => y.fy_label === selectedYear);
  const yearLoading = yearSettingsQuery.isPending || !savedYear;

  return (
    <div className="p-5 max-w-mx-auto space-y-6">
      {/* ── Year-scoped configuration header ────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex-1 min-w-[240px]">
          <label
            htmlFor="settings-year"
            className="block text-sm font-medium text-text-main mb-1"
          >
            Configure Access for Fiscal Year
          </label>
          <select
            id="settings-year"
            value={selectedYear ?? ""}
            onChange={(e) => setSelectedYear(e.target.value || null)}
            disabled={yearsQuery.isPending}
            className="w-full sm:w-72 rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-main focus:outline-none focus:border-brand"
          >
            {yearsQuery.isPending && <option value="">Loading…</option>}
            {!yearsQuery.isPending && yearOptions.length === 0 && (
              <option value="">No years available</option>
            )}
            {yearOptions.map((y) => (
              <option key={y.fy_label} value={y.fy_label}>
                {y.fy_label}
                {y.is_current ? " (Current)" : ""}
                {!y.has_override ? " — unconfigured" : ""}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-text-muted">
            Toggles below apply only to the selected fiscal year. The current
            cycle stays editable for past years even after the system advances.
          </p>
        </div>
        <button
          type="button"
          onClick={handleOpenConfirm}
          disabled={!selectedYear || diff.length === 0 || saveMutation.isPending}
          className="flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-70 disabled:cursor-not-allowed transition-all shadow-sm"
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {saveMutation.isPending ? "Saving…" : "Save Configuration"}
        </button>
      </div>

      {/* ── Annual Review Settings ───────────────────────────────────── */}
      <div>
        <h3 className="font-display text-lg font-semibold text-text-main mb-4">
          Annual Review Settings
          {selectedOption && (
            <span className="ml-2 text-xs font-medium text-text-muted">
              · {selectedOption.fy_label}
            </span>
          )}
        </h3>
        <div className="bg-surface rounded-xl border border-border shadow-sm divide-y divide-border">
          <div className="px-5 py-4">
            <div className="divide-y divide-border/60">
              <ToggleRow
                label="Enable Annual Reviews"
                description="When on, employees can submit self-reviews for this fiscal year. Disabling pauses new submissions; existing reviews stay readable."
                checked={form.annual_reviews_enabled}
                disabled={yearLoading}
                onChange={(next) =>
                  setForm((prev) => ({ ...prev, annual_reviews_enabled: next }))
                }
              />
              <ToggleRow
                label="Show Ratings on Annual Reviews"
                description="When on, the Ratings column is visible on Mentee/Team Review tabs and final ratings are revealed to employees once published — for this fiscal year."
                checked={form.annual_review_final_rating_visible}
                disabled={yearLoading}
                onChange={(next) =>
                  setForm((prev) => ({
                    ...prev,
                    annual_review_final_rating_visible: next,
                  }))
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
          {selectedOption && (
            <span className="ml-2 text-xs font-medium text-text-muted">
              · {selectedOption.fy_label}
            </span>
          )}
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
                description="When off, no one in the org can create or edit annual goals for this fiscal year."
                checked={form.annual_goals_edit_enabled}
                disabled={yearLoading}
                onChange={(next) =>
                  setForm((prev) => ({ ...prev, annual_goals_edit_enabled: next }))
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
                description="When on, employees can see their project performance ratings for this fiscal year."
                checked={form.project_ratings_visible}
                disabled={yearLoading}
                onChange={(next) =>
                  setForm((prev) => ({ ...prev, project_ratings_visible: next }))
                }
              />
            </div>
          </div>

        </div>
      </div>
      {/* ── Performance Cycle Configuration (org-wide, read-only) ─── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg font-semibold text-text-main">
            Performance Cycle Configuration
          </h3>
          {(simulationAllowed) && (
            <button
              type="button"
              onClick={onSaveOrgWide}
              disabled={isSavingOrgWide}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-text-main hover:bg-slate-50 disabled:opacity-70 disabled:cursor-not-allowed"
            >
              <Save className="h-4 w-4" aria-hidden="true" />
              {isSavingOrgWide ? "Saving…" : "Save Simulation"}
            </button>
          )}
        </div>
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

            {/* Organization Timezone — drives every backend calendar-day
                decision (cycle rollover, FY-end gates, assignment end
                dates). Display timestamps continue to render in the
                browser's local zone. Picking the wrong zone won't break
                anything (cycle_utils falls back to UTC), but FY-end
                edge cases will be off by hours/days until corrected. */}
            <div className="md:col-span-2">
              <label htmlFor="org-tz" className="block text-sm font-medium text-text-main mb-1">
                Organization Timezone
              </label>
              <div className="flex items-center gap-2">
                <select
                  id="org-tz"
                  value={
                    TIMEZONE_OPTIONS.some((o) => o.value === timezone)
                      ? timezone
                      : "__other__"
                  }
                  onChange={(e) => {
                    if (e.target.value !== "__other__") {
                      onTimezoneChange(e.target.value);
                    }
                  }}
                  disabled
                  className="w-full rounded-lg border border-border bg-gray-50 px-3 py-2 text-sm text-text-muted outline-none cursor-not-allowed disabled:opacity-100"
                >
                  {TIMEZONE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                  {!TIMEZONE_OPTIONS.some((o) => o.value === timezone) && (
                    <option value="__other__">
                      Other ({timezone}) — custom IANA, edit below
                    </option>
                  )}
                </select>
                <span className="flex items-center gap-1.5 text-xs text-text-muted bg-gray-100 px-2 py-1 rounded-md border border-gray-200 shrink-0">
                  <Info className="w-3.5 h-3.5" />
                  Read Only
                </span>
              </div>
              {!TIMEZONE_OPTIONS.some((o) => o.value === timezone) && (
                <input
                  type="text"
                  value={timezone}
                  onChange={(e) => onTimezoneChange(e.target.value)}
                  placeholder="e.g. Asia/Singapore"
                  disabled
                  className="mt-2 w-full rounded-lg border border-border bg-gray-50 px-3 py-2 text-sm text-text-muted outline-none cursor-not-allowed"
                />
              )}
              <p className="mt-1 text-xs text-text-muted">
                Anchors what counts as "today" for cycle gates and date-
                based deadlines. Audit timestamps stay in UTC.
              </p>
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

      {showConfirm && selectedYear && (
        <SaveConfirmationModal
          fyLabel={selectedYear}
          diff={diff}
          preflight={preflightQuery.data ?? null}
          preflightLoading={preflightQuery.isPending}
          isSaving={saveMutation.isPending}
          onConfirm={() => saveMutation.mutate()}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
