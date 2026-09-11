/**
 * SystemSettingsTab — every switch in one place.
 *
 *   1. Annual Reviews · FY      per-fiscal-year (system_settings_year_overrides)
 *   2. Annual Goals · FY        per-fiscal-year
 *   3. Project Goals · year     yearly switches + the quarter roll-out (the review window)
 *   4. Calendar                 read-only anchors: current cycle, fiscal start, timezone
 *   5. Developer                H1/H2 window bypass; date simulation (env-gated)
 *
 * The per-FY toggles are staged and saved together (with a preflight
 * confirmation). The Project Goals and Developer switches save on click.
 * Framework content (rows, KPIs, designation levels) is on the Framework
 * tab; nothing there gates anything.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Save, Info, FlaskConical, AlertTriangle, ClipboardList, CalendarDays } from "lucide-react";
import {
  adminService,
  type YearPreflight,
  type YearSettingsUpdatePayload,
} from "@/services/admin.service";
import { systemSettingsService } from "@/services/system-settings.service";
import { goalFrameworkService, type PeriodSettingsUpdatePayload } from "@/services/goal-framework.service";
import { ToggleRow } from "@/components/admin/ToggleRow";
import { QuarterRolloutCard } from "@/components/admin/QuarterRolloutCard";
import { queryKeys } from "@/lib/queryKeys";
import { useToast } from "@/hooks/useToast";
import { useSnackbar } from "@/hooks/useSnackbar";
import { getErrorMessage } from "@/utils/errors";
import { useSystemSettings } from "@/hooks/useSystemSettings";

interface SystemSettingsTabProps {
  readonly activeCycleName: string;
  readonly fiscalStartMonth: number;
  /** IANA timezone string. Anchors every backend calendar-day decision. */
  readonly timezone: string;
  readonly onTimezoneChange: (tz: string) => void;
  // Dev / QA date simulation
  readonly simulatedToday: string | null;
  readonly simulationAllowed: boolean;
  readonly onSimulatedTodayChange: (date: string) => void;
  readonly onClearSimulatedToday: () => void;
  /** Called when HR saves the org-wide simulation section. The per-FY
   *  toggles save through their own mutation below. */
  readonly onSaveOrgWide: () => void;
  readonly isSavingOrgWide: boolean;
}

/** Curated short list of IANA timezones that cover the orgs we deploy
 *  to. Keeps the dropdown manageable (a full IANA list is ~500 entries). */
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

const SECTION_TITLE_CLS = "font-display text-lg font-semibold text-text-main mb-4 flex items-center gap-2";
const CARD_CLS = "bg-surface rounded-xl border border-border shadow-sm";
const READONLY_INPUT_CLS =
  "w-full rounded-lg border border-border bg-gray-50 px-3 py-2 text-sm text-text-muted cursor-not-allowed";
const READONLY_TAG_CLS =
  "flex items-center gap-1.5 text-xs text-text-muted bg-gray-100 px-2 py-1 rounded-md border border-gray-200 shrink-0";

/** Labels shown in the diff confirmation card. */
const TOGGLE_LABELS: Record<keyof YearSettingsUpdatePayload, string> = {
  annual_reviews_enabled: "Annual Reviews",
  annual_review_final_rating_visible: "Annual Review Rating Visibility",
  annual_goals_edit_enabled: "Annual Goal Edit Access",
};

const YEAR_TOGGLE_KEYS: ReadonlyArray<keyof YearSettingsUpdatePayload> = [
  "annual_reviews_enabled",
  "annual_review_final_rating_visible",
  "annual_goals_edit_enabled",
];

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
 *  committing. */
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
                <li key={d.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-text-main">{TOGGLE_LABELS[d.key]}</span>
                  <span className="font-mono text-xs">
                    <span className={d.from ? "text-green-700" : "text-text-muted"}>{d.from ? "ON" : "OFF"}</span>
                    <span className="mx-2 text-text-muted">→</span>
                    <span className={d.to ? "text-green-700" : "text-text-muted"}>{d.to ? "ON" : "OFF"}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {flips.length > 0 && (
          <div className="mt-3 space-y-2">
            {preflightLoading && <p className="text-xs text-text-muted">Checking who would be affected…</p>}
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

/** Project Goals — the yearly switches (goal entry, weightages) and the
 *  quarter roll-out. There is no "self-review window" switch: the current
 *  quarter IS the window (Healthark PMS model); ratings are released per
 *  quarter inside the roll-out card. */
const PERIOD_SWITCHES: ReadonlyArray<[keyof PeriodSettingsUpdatePayload, string, string]> = [
  ["entry_open", "Goal entry open", "Staff can draft and submit their goal set for this year. Goals are set once and reviewed every quarter."],
  ["weightages_visible", "Weightages visible to staff", "Show the % next to each KPI. Weightages are informational — there is one rating per quarter, not per KPI."],
];

function ProjectGoalsSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const snackbar = useSnackbar();
  const q = useQuery({
    queryKey: queryKeys.admin.goalPeriodSettings(),
    queryFn: () => goalFrameworkService.getSettings(),
  });
  const settings = q.data;
  const update = useMutation({
    mutationFn: (patch: PeriodSettingsUpdatePayload) => goalFrameworkService.updateSettings(patch),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.projectGoals.all });
      toast.success("Setting updated");
    },
    onError: (e) => snackbar.error(getErrorMessage(e)),
  });

  return (
    <div>
      <h3 className={SECTION_TITLE_CLS}>
        <ClipboardList className="h-4 w-4 text-brand" aria-hidden="true" />
        Project Goals
        {settings && <span className="text-xs font-medium text-text-muted">· {settings.period_label}</span>}
      </h3>
      <div className="space-y-4">
        <div className={`${CARD_CLS} px-5 py-4`}>
          <p className="mb-1 text-xs font-bold uppercase tracking-wider text-text-muted">Goal year · {settings?.period_label ?? "…"}</p>
          {q.isError && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{getErrorMessage(q.error)}</p>
          )}
          <div className="divide-y divide-border/60">
            {PERIOD_SWITCHES.map(([key, label, desc]) => (
              <ToggleRow
                key={key}
                label={label}
                description={desc}
                checked={!!settings?.[key]}
                disabled={!settings || update.isPending}
                onChange={(v) => update.mutate({ [key]: v } as PeriodSettingsUpdatePayload)}
              />
            ))}
          </div>
          {settings && !settings.is_active && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                This period is not active.{" "}
                <button type="button" onClick={() => update.mutate({ is_active: true })} className="font-medium underline">
                  Make it the active period
                </button>{" "}
                so staff see it.
              </span>
            </div>
          )}
        </div>

        <div className={`${CARD_CLS} px-5 py-4`}>
          <p className="mb-3 text-xs font-bold uppercase tracking-wider text-text-muted">Quarter roll-out · the review window</p>
          <QuarterRolloutCard />
          <p className="mt-4 text-xs text-text-muted">
            Staff can write the current quarter's self-review and backfill earlier quarters of the year; later quarters are
            locked until rolled out. Q4 → Q1 starts the next goal year (frameworks carried over, goal entry open). The
            framework content itself (role rows, KPIs, weightages, designation levels) is edited on the Framework tab;
            reviewer assignments on Framework Mapping.
          </p>
        </div>
      </div>
    </div>
  );
}

export function SystemSettingsTab({
  activeCycleName,
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
  const { settings: liveSettings, refreshSettings } = useSystemSettings();

  // ── Year dropdown options ────────────────────────────────────────
  const yearsQuery = useQuery({
    queryKey: queryKeys.admin.settingsYears(),
    queryFn: adminService.listSettingsYears,
  });

  const yearOptions = useMemo(() => yearsQuery.data?.years ?? [], [yearsQuery.data]);
  const defaultYear = useMemo(
    () => yearOptions.find((y) => y.is_current)?.fy_label ?? yearOptions[0]?.fy_label ?? null,
    [yearOptions],
  );

  const [selectedYear, setSelectedYear] = useState<string | null>(null);
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

  // ── Local form state for the three per-FY toggles ────────────────
  const [form, setForm] = useState<YearSettingsUpdatePayload>({
    annual_reviews_enabled: false,
    annual_review_final_rating_visible: false,
    annual_goals_edit_enabled: false,
  });
  const [formKey, setFormKey] = useState<string | null>(null);
  if (savedYear && formKey !== savedYear.fy_label) {
    setForm({
      annual_reviews_enabled: savedYear.annual_reviews_enabled,
      annual_review_final_rating_visible: savedYear.annual_review_final_rating_visible,
      annual_goals_edit_enabled: savedYear.annual_goals_edit_enabled,
    });
    setFormKey(savedYear.fy_label);
  }

  const diff = useMemo(() => {
    if (!savedYear) return [];
    return YEAR_TOGGLE_KEYS
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
    mutationFn: () => adminService.updateYearSettings(selectedYear as string, form),
    onSuccess: (fresh) => {
      queryClient.setQueryData(queryKeys.admin.settingsYear(fresh.fy_label), fresh);
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.settingsYears() });
      // Banners on AnnualReviews etc. read /settings/, so refresh that too.
      void refreshSettings();
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.settings() });
      setShowConfirm(false);
      toast.success(`Configuration saved for ${fresh.fy_label}.`);
    },
    onError: (err) => snackbar.error(getErrorMessage(err)),
  });

  // ── Developer: H1/H2 review-window bypass (saves on click) ───────
  const cycleWindowOverride = liveSettings?.cycle_window_override ?? false;
  const bypassMutation = useMutation({
    mutationFn: (value: boolean) => systemSettingsService.updateSettings({ cycle_window_override: value }),
    onSuccess: () => {
      void refreshSettings();
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.settings() });
      toast.success("Setting updated");
    },
    onError: (err) => snackbar.error(getErrorMessage(err)),
  });

  const handleOpenConfirm = () => {
    if (!selectedYear || diff.length === 0) return;
    setShowConfirm(true);
  };

  const selectedOption = yearOptions.find((y) => y.fy_label === selectedYear);
  const yearLoading = yearSettingsQuery.isPending || !savedYear;
  const fyTag = selectedOption ? (
    <span className="text-xs font-medium text-text-muted">· {selectedOption.fy_label}</span>
  ) : null;

  return (
    <div className="p-5 max-w-mx-auto space-y-6">
      {/* ── Year-scoped configuration header ────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex-1 min-w-[240px]">
          <label htmlFor="settings-year" className="block text-sm font-medium text-text-main mb-1">
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
            {!yearsQuery.isPending && yearOptions.length === 0 && <option value="">No years available</option>}
            {yearOptions.map((y) => (
              <option key={y.fy_label} value={y.fy_label}>
                {y.fy_label}
                {y.is_current ? " (Current)" : ""}
                {!y.has_override ? " — unconfigured" : ""}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-text-muted">
            The Annual Reviews and Annual Goals switches below apply only to the selected fiscal year, so a
            past year can stay open after the system has advanced.
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

      {/* ── 1. Annual Reviews · FY ───────────────────────────────────── */}
      <div>
        <h3 className={SECTION_TITLE_CLS}>Annual Reviews {fyTag}</h3>
        <div className={`${CARD_CLS} px-5 py-4`}>
          <div className="divide-y divide-border/60">
            <ToggleRow
              label="Enable Annual Reviews"
              description="When on, staff can submit self-reviews for this fiscal year. Disabling pauses new submissions; existing reviews stay readable."
              checked={form.annual_reviews_enabled}
              disabled={yearLoading}
              onChange={(next) => setForm((prev) => ({ ...prev, annual_reviews_enabled: next }))}
            />
            <ToggleRow
              label="Show Ratings on Annual Reviews"
              description="When on, the Ratings column is visible on Mentee/Team Review tabs and final ratings are revealed to staff once published — for this fiscal year."
              checked={form.annual_review_final_rating_visible}
              disabled={yearLoading}
              onChange={(next) => setForm((prev) => ({ ...prev, annual_review_final_rating_visible: next }))}
            />
          </div>
        </div>
      </div>

      {/* ── 2. Annual Goals · FY ─────────────────────────────────────── */}
      <div>
        <h3 className={SECTION_TITLE_CLS}>Annual Goals {fyTag}</h3>
        <div className={`${CARD_CLS} px-5 py-4`}>
          <div className="divide-y divide-border/60">
            <ToggleRow
              label="Edit Access for Annual Goals"
              description="When off, nobody can create or edit annual goals for this fiscal year."
              checked={form.annual_goals_edit_enabled}
              disabled={yearLoading}
              onChange={(next) => setForm((prev) => ({ ...prev, annual_goals_edit_enabled: next }))}
            />
          </div>
        </div>
      </div>

      {/* ── 3. Project Goals · year + quarter roll-out ──────────────── */}
      <ProjectGoalsSection />

      {/* ── 4. Calendar (read-only anchors) ──────────────────────────── */}
      <div>
        <h3 className={SECTION_TITLE_CLS}>
          <CalendarDays className="h-4 w-4 text-brand" aria-hidden="true" />
          Calendar
        </h3>
        <div className={`${CARD_CLS} space-y-6 p-5`}>
          <div>
            <label className="block text-sm font-medium text-text-main mb-1">Current Cycle</label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={activeCycleName || "System Calculated..."}
                disabled
                className={`${READONLY_INPUT_CLS} sm:w-64`}
              />
              <span className={READONLY_TAG_CLS}>
                <Info className="w-3.5 h-3.5" />
                System Calculated
              </span>
            </div>
            <p className="mt-1.5 text-xs text-text-muted">
              Half-yearly: goal reviews run in H1 and H2, annual reviews per fiscal year. Derived from
              today's date and the fiscal start month.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
                  className={READONLY_INPUT_CLS}
                />
                <span className={READONLY_TAG_CLS}>
                  <Info className="w-3.5 h-3.5" />
                  Read Only
                </span>
              </div>
            </div>

            <div>
              <label htmlFor="org-tz" className="block text-sm font-medium text-text-main mb-1">
                Organization Timezone
              </label>
              <div className="flex items-center gap-2">
                <select
                  id="org-tz"
                  value={TIMEZONE_OPTIONS.some((o) => o.value === timezone) ? timezone : "__other__"}
                  onChange={(e) => {
                    if (e.target.value !== "__other__") onTimezoneChange(e.target.value);
                  }}
                  disabled
                  className={`${READONLY_INPUT_CLS} outline-none disabled:opacity-100`}
                >
                  {TIMEZONE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                  {!TIMEZONE_OPTIONS.some((o) => o.value === timezone) && (
                    <option value="__other__">Other ({timezone})</option>
                  )}
                </select>
                <span className={READONLY_TAG_CLS}>
                  <Info className="w-3.5 h-3.5" />
                  Read Only
                </span>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                Anchors what counts as "today" for cycle gates and date-based deadlines. Audit timestamps
                stay in UTC.
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* ── 5. Developer ─────────────────────────────────────────────── */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display text-lg font-semibold text-text-main flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-amber-600" aria-hidden="true" />
            Developer
          </h3>
          {simulationAllowed && (
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
        <div className="space-y-4 bg-surface p-5 rounded-xl border border-amber-200 dark:border-amber-500/40 shadow-sm">
          <ToggleRow
            label="Bypass the H1 / H2 review-window calendar"
            description="Lets a staff member and mentor complete both halves' goal reviews in one session, without waiting for the second half to start. Leave off in production."
            checked={cycleWindowOverride}
            disabled={!liveSettings || bypassMutation.isPending}
            onChange={(v) => bypassMutation.mutate(v)}
          />

          {/* Date simulation — hidden unless the backend's ALLOW_DATE_SIMULATION
              env flag is on, so non-dev deployments never see it. */}
          {simulationAllowed && (
            <div className="border-t border-border/60 pt-4 space-y-3">
              <p className="text-sm font-medium text-text-main">Date simulation</p>
              <p className="text-xs text-text-muted">
                Pin a fake "today" for cycle determination, review window checks, and dashboards. The whole
                app shows an amber banner while this is active so other users know. Audit timestamps always
                use the real wall clock.
              </p>
              <div className="flex items-end gap-2 flex-wrap">
                <div>
                  <label htmlFor="simulated-today" className="block text-xs font-medium text-text-muted mb-1">
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
          )}
        </div>
      </div>

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
