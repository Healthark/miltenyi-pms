/**
 * SystemSettingsTab — every switch in one place.
 *
 *   1. Quarter roll-out (full width): where the goal year stands, roll out /
 *      set / roll back. Roll-outs are the only actions that confirm on
 *      their own — they are what creates a new year.
 *   2. One year selector (labelled "CY yy-zz"; the fiscal year and the
 *      Project Goals year are the same April-to-April span) and ONE Save
 *      button for everything staged below it.
 *   3. Two columns for the selected year: Annual Reviews / Annual Goals
 *      (system_settings_year_overrides) on the left, Project Goals switches
 *      (goal entry, weightages, backfill for a past year, per-quarter
 *      ratings) on the right. All staged; Save opens one confirmation that
 *      lists every flip with impact lines from the two preflights.
 *   4. Calendar (read-only anchors). The annual cycle follows the quarter
 *      roll-out, so the old date simulation is gone (25 Sep 2026).
 *
 * Framework content (rows, KPIs, designation levels) is on the Framework
 * tab; nothing there gates anything.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { Save, Info, AlertTriangle, ClipboardList, CalendarDays, CalendarClock } from "lucide-react";
import {
  adminService,
  type YearSettingsUpdatePayload,
} from "@/services/admin.service";
import {
  goalFrameworkService,
  type PeriodPreflight,
  type PeriodSettingsUpdatePayload,
} from "@/services/goal-framework.service";
import { quarterDisplay, type PeriodBrief, type PeriodSettings } from "@/services/project-goals.service";
import { queryKeys } from "@/lib/queryKeys";
import { useToast } from "@/hooks/useToast";
import { useSnackbar } from "@/hooks/useSnackbar";
import { getErrorMessage } from "@/utils/errors";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { Switch, ToggleRow } from "@/components/admin/ToggleRow";
import { QuarterRolloutCard } from "@/components/admin/QuarterRolloutCard";
import { startYearOf, cyLabel, fyLabel, cycleAsCy } from "@/utils/fy";

interface SystemSettingsTabProps {
  readonly activeCycleName: string;
  readonly fiscalStartMonth: number;
  /** IANA timezone string. Anchors every backend calendar-day decision. */
  readonly timezone: string;
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const SECTION_TITLE_CLS = "font-display text-lg font-semibold text-text-main mb-4 flex items-center gap-2";
const CARD_CLS = "bg-surface rounded-xl border border-border shadow-sm";
const SELECT_CLS =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-main focus:outline-none focus:border-brand";
const BTN_SAVE =
  "flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:bg-brand/90 disabled:opacity-70 disabled:cursor-not-allowed transition-all shadow-sm";

// ── Year labels: "FY26-27" and "CY 26-27" are the same span ──────────
// The helpers live in utils/fy.ts (shared with the dashboards and the
// Topbar); re-exported here for existing importers.
export { startYearOf, cyLabel, fyLabel };

// ── Shared confirmation modal ─────────────────────────────────────────

export interface ChangeRow {
  key: string;
  group: string;
  label: string;
  from: boolean;
  to: boolean;
}

function ChangesConfirmModal({
  title,
  subtitle,
  rows,
  warnings,
  warningsLoading,
  isSaving,
  onConfirm,
  onCancel,
}: Readonly<{
  title: string;
  subtitle: string;
  rows: ChangeRow[];
  warnings: string[];
  warningsLoading: boolean;
  isSaving: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSaving) onCancel();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [onCancel, isSaving]);

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
            <h2 className="font-display text-base font-semibold text-text-main">{title}</h2>
            <p className="mt-1 text-sm text-text-muted">{subtitle}</p>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-border bg-background/40 p-3">
          {rows.length === 0 ? (
            <p className="text-sm text-text-muted">No changes to save.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {rows.map((d) => (
                <li key={d.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="text-text-main">
                    <span className="mr-1.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-text-muted">{d.group}</span>
                    {d.label}
                  </span>
                  {d.from === d.to ? (
                    <span className="font-mono text-xs text-text-muted">changed</span>
                  ) : (
                    <span className="font-mono text-xs">
                      <span className={d.from ? "text-green-700" : "text-text-muted"}>{d.from ? "ON" : "OFF"}</span>
                      <span className="mx-2 text-text-muted">→</span>
                      <span className={d.to ? "text-green-700" : "text-text-muted"}>{d.to ? "ON" : "OFF"}</span>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        {(warningsLoading || warnings.length > 0) && (
          <div className="mt-3 space-y-2">
            {warningsLoading && <p className="text-xs text-text-muted">Checking who would be affected…</p>}
            {!warningsLoading &&
              warnings.map((w) => (
                <div
                  key={w}
                  className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200"
                >
                  <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                  <span>{w}</span>
                </div>
              ))}
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
            disabled={isSaving || rows.length === 0}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {isSaving ? "Saving…" : "Apply changes"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Forms ────────────────────────────────────────────────────────────

const FY_LABELS: Record<keyof YearSettingsUpdatePayload, string> = {
  annual_reviews_enabled: "Enable Annual Reviews",
  annual_review_final_rating_visible: "Show Ratings on Annual Reviews",
  annual_goals_edit_enabled: "Edit Access for Annual Goals",
  goal_reviews_visible_h1: "Show H1 Mentor Reviews on Annual Goals",
  goal_reviews_visible_h2: "Show H2 Mentor Reviews on Annual Goals",
  management_review_enabled: "Enable Management Review",
};
const FY_KEYS: ReadonlyArray<keyof YearSettingsUpdatePayload> = [
  "annual_reviews_enabled",
  "annual_review_final_rating_visible",
  "annual_goals_edit_enabled",
  "goal_reviews_visible_h1",
  "goal_reviews_visible_h2",
  "management_review_enabled",
];

interface PeriodForm {
  entry_open: boolean;
  weightages_visible: boolean;
  backfill_open: boolean;
  extra_goal_enabled: boolean;
  extra_goal_weightage: string;
  ratings: Record<number, boolean>;
  quarterBackfill: Record<number, boolean>;
}

const periodFormOf = (s: PeriodSettings): PeriodForm => ({
  entry_open: s.entry_open,
  weightages_visible: s.weightages_visible,
  backfill_open: s.backfill_open,
  extra_goal_enabled: s.extra_goal_enabled,
  extra_goal_weightage: String(s.extra_goal_weightage),
  ratings: Object.fromEntries(s.quarters.map((q) => [q.seq, q.ratings_visible])),
  quarterBackfill: Object.fromEntries(s.quarters.map((q) => [q.seq, q.backfill_open])),
});

const extraWeightOk = (v: string) => /^\d{1,3}$/.test(v.trim()) && Number(v) >= 0 && Number(v) <= 100;

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Impact lines for the Project Goals flips, from the preflight counts. */
function periodWarnings(rows: ChangeRow[], p: PeriodPreflight | null, saved: PeriodSettings): string[] {
  if (!p) return [];
  const out: string[] = [];
  for (const d of rows) {
    const key = d.key.replace(/^pg:/, "");
    if (key === "entry_open" && !d.to) {
      out.push(
        p.staff_without_set + p.sets_draft > 0
          ? `${plural(p.staff_without_set, "staff member")} have not started goals and ${plural(p.sets_draft, "draft set")} are still being written: they can no longer start or submit goals for ${saved.period_label}.`
          : `Nobody is mid-entry for ${saved.period_label}; every staff member has submitted or approved goals.`,
      );
    }
    if (key === "entry_open" && d.to) out.push(`Staff without a ${saved.period_label} goal set can start one; drafts can be submitted again.`);
    if (key === "backfill_open" && !d.to) {
      const pending = p.quarters.filter((q) => q.self_pending > 0 || q.review_pending > 0);
      out.push(
        pending.length
          ? `Closing ${saved.period_label} locks ${pending.map((q) => `${quarterDisplay(q.cycle_label)} (${plural(q.self_pending, "self-review")}, ${plural(q.review_pending, "review")} pending)`).join("; ")}.`
          : `Every started quarter of ${saved.period_label} is fully submitted; closing it makes the year read-only.`,
      );
    }
    if (key === "backfill_open" && d.to) out.push(`${saved.period_label}'s started quarters reopen for backfill.`);
    if (key === "extra_goal_enabled") out.push(d.to
      ? `Every ${saved.period_label} sheet still in Draft gets an "Additional goals" row at the end (${plural(p.sets_draft, "draft set")} now); submitted and approved sheets keep their rows. The row is optional and has no KPI behind it.`
      : `The "Additional goals" row is removed from empty Draft sheets; sheets where it was filled keep it.`);
    if (key === "extra_goal_weightage") out.push(`Draft sheets show the new weightage; submitted and approved sheets keep the weightage they were created with.`);
    const qb = /^backfill_(\d+)$/.exec(key);
    if (qb) {
      const seq = Number(qb[1]);
      const q = p.quarters.find((x) => x.seq === seq);
      const label = q ? quarterDisplay(q.cycle_label) : `Q${seq}`;
      out.push(d.to
        ? `${label} reopens: pending self-reviews and reviews can be completed again.`
        : q && (q.self_pending > 0 || q.review_pending > 0)
          ? `Closing ${label} locks ${plural(q.self_pending, "self-review")} and ${plural(q.review_pending, "review")} still pending.`
          : `${label} is fully submitted; closing it makes the quarter read-only.`);
    }
    if (key.startsWith("ratings_")) {
      const seq = Number(key.slice("ratings_".length));
      const q = p.quarters.find((x) => x.seq === seq);
      const label = q ? quarterDisplay(q.cycle_label) : `Q${seq}`;
      out.push(d.to
        ? `${label}: ${plural(q?.reviews_submitted ?? 0, "submitted review")} will show their final rating to staff.`
        : `${label}: final ratings are hidden from staff again.`);
    }
  }
  return out;
}

interface YearOption {
  startYear: number;
  cy: string;
  fy: string;
  isCurrent: boolean;
  fyUnconfigured: boolean;
  period: PeriodBrief | null;
}

// ── The tab ──────────────────────────────────────────────────────────

export function SystemSettingsTab({
  activeCycleName,
  fiscalStartMonth,
  timezone,
}: SystemSettingsTabProps) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const snackbar = useSnackbar();
  const { refreshSettings } = useSystemSettings();

  // ── One year list for both calendars ─────────────────────────────
  const yearsQ = useQuery({ queryKey: queryKeys.admin.settingsYears(), queryFn: adminService.listSettingsYears });
  const periodsQ = useQuery({ queryKey: queryKeys.admin.goalPeriods(), queryFn: goalFrameworkService.getPeriods });
  const goalCycleQ = useQuery({ queryKey: queryKeys.admin.goalCycle(), queryFn: goalFrameworkService.getCycle });

  const years = useMemo<YearOption[]>(() => {
    const byYear = new Map<number, YearOption>();
    for (const y of yearsQ.data?.years ?? []) {
      const sy = startYearOf(y.fy_label);
      if (sy == null) continue;
      byYear.set(sy, { startYear: sy, cy: cyLabel(sy), fy: y.fy_label, isCurrent: y.is_current, fyUnconfigured: !y.has_override, period: null });
    }
    for (const p of periodsQ.data ?? []) {
      const sy = startYearOf(p.period_label);
      if (sy == null) continue;
      const existing = byYear.get(sy);
      if (existing) {
        existing.period = p;
        existing.isCurrent = existing.isCurrent || p.is_active;
      } else {
        byYear.set(sy, { startYear: sy, cy: cyLabel(sy), fy: fyLabel(sy), isCurrent: p.is_active, fyUnconfigured: true, period: p });
      }
    }
    return Array.from(byYear.values()).sort((a, b) => b.startYear - a.startYear);
  }, [yearsQ.data, periodsQ.data]);

  const defaultYear = useMemo(() => {
    const activeGoal = years.find((y) => y.period?.is_active);
    return (activeGoal ?? years.find((y) => y.isCurrent) ?? years[0])?.cy ?? null;
  }, [years]);
  const [selected, setSelected] = useState<string | null>(null);
  const year = years.find((y) => y.cy === (selected ?? defaultYear)) ?? null;

  // ── Left: per-FY switches ────────────────────────────────────────
  const fyQ = useQuery({
    queryKey: year ? queryKeys.admin.settingsYear(year.fy) : ["admin", "settings", "year", "__unset__"],
    queryFn: () => adminService.getYearSettings(year!.fy),
    enabled: !!year,
  });
  const savedFy = fyQ.data ?? null;
  const [fyForm, setFyForm] = useState<YearSettingsUpdatePayload>({
    annual_reviews_enabled: false,
    annual_review_final_rating_visible: false,
    annual_goals_edit_enabled: false,
    goal_reviews_visible_h1: false,
    goal_reviews_visible_h2: false,
    management_review_enabled: false,
  });
  const [fyKey, setFyKey] = useState<string>("");
  const savedFyKey = savedFy ? `${savedFy.fy_label}|${FY_KEYS.map((k) => savedFy[k]).join(",")}` : "";
  if (savedFy && fyKey !== savedFyKey) {
    setFyForm({
      annual_reviews_enabled: savedFy.annual_reviews_enabled,
      annual_review_final_rating_visible: savedFy.annual_review_final_rating_visible,
      annual_goals_edit_enabled: savedFy.annual_goals_edit_enabled,
      goal_reviews_visible_h1: savedFy.goal_reviews_visible_h1,
      goal_reviews_visible_h2: savedFy.goal_reviews_visible_h2,
      management_review_enabled: savedFy.management_review_enabled,
    });
    setFyKey(savedFyKey);
  }

  // ── Right: Project Goals switches for the same year ──────────────
  const hasPeriod = !!year?.period;
  const pgQ = useQuery({
    queryKey: queryKeys.admin.goalPeriodSettings(year?.cy ?? undefined),
    queryFn: () => goalFrameworkService.getSettings(year!.cy),
    enabled: hasPeriod,
  });
  const savedPg = hasPeriod ? pgQ.data ?? null : null;
  const [pgForm, setPgForm] = useState<PeriodForm | null>(null);
  const [pgKey, setPgKey] = useState<string>("");
  const savedPgKey = savedPg ? `${savedPg.period_label}|${savedPg.entry_open}|${savedPg.weightages_visible}|${savedPg.backfill_open}|${savedPg.extra_goal_enabled}|${savedPg.extra_goal_weightage}|${savedPg.quarters.map((q) => `${q.seq}:${q.ratings_visible}:${q.backfill_open}`).join(",")}` : "";
  if (savedPg && pgKey !== savedPgKey) {
    setPgForm(periodFormOf(savedPg));
    setPgKey(savedPgKey);
  }

  // ── Combined diff → one Save, one confirmation ───────────────────
  const diff = useMemo<ChangeRow[]>(() => {
    const rows: ChangeRow[] = [];
    if (savedFy) {
      for (const k of FY_KEYS) {
        if (fyForm[k] !== savedFy[k]) rows.push({ key: `fy:${k}`, group: "Annual", label: FY_LABELS[k], from: savedFy[k], to: fyForm[k] });
      }
    }
    if (savedPg && pgForm) {
      if (pgForm.entry_open !== savedPg.entry_open) rows.push({ key: "pg:entry_open", group: "Project Goals", label: "Goal entry open", from: savedPg.entry_open, to: pgForm.entry_open });
      if (pgForm.weightages_visible !== savedPg.weightages_visible) rows.push({ key: "pg:weightages_visible", group: "Project Goals", label: "Weightages visible to staff", from: savedPg.weightages_visible, to: pgForm.weightages_visible });
      if (!savedPg.is_active && pgForm.backfill_open !== savedPg.backfill_open) rows.push({ key: "pg:backfill_open", group: "Project Goals", label: "Quarters open for backfill", from: savedPg.backfill_open, to: pgForm.backfill_open });
      if (pgForm.extra_goal_enabled !== savedPg.extra_goal_enabled) rows.push({ key: "pg:extra_goal_enabled", group: "Project Goals", label: "Additional goals row", from: savedPg.extra_goal_enabled, to: pgForm.extra_goal_enabled });
      if (extraWeightOk(pgForm.extra_goal_weightage) && Number(pgForm.extra_goal_weightage) !== savedPg.extra_goal_weightage) rows.push({ key: "pg:extra_goal_weightage", group: "Project Goals", label: `Additional goals weightage ${savedPg.extra_goal_weightage}% → ${Number(pgForm.extra_goal_weightage)}%`, from: true, to: true });
      for (const q of savedPg.quarters) {
        const to = pgForm.ratings[q.seq] ?? q.ratings_visible;
        if (to !== q.ratings_visible) rows.push({ key: `pg:ratings_${q.seq}`, group: "Project Goals", label: `${quarterDisplay(q.cycle_label)} ratings visible to staff`, from: q.ratings_visible, to });
        const bf = pgForm.quarterBackfill[q.seq] ?? q.backfill_open;
        if (bf !== q.backfill_open) rows.push({ key: `pg:backfill_${q.seq}`, group: "Project Goals", label: `${quarterDisplay(q.cycle_label)} open for backfill`, from: q.backfill_open, to: bf });
      }
    }
    return rows;
  }, [fyForm, savedFy, pgForm, savedPg]);
  const fyDiff = diff.filter((d) => d.key.startsWith("fy:"));
  const pgDiff = diff.filter((d) => d.key.startsWith("pg:"));

  const [showConfirm, setShowConfirm] = useState(false);
  const fyPreflightQ = useQuery({
    queryKey: year ? queryKeys.admin.settingsYearPreflight(year.fy) : ["admin", "settings", "year", "__unset__", "preflight"],
    queryFn: () => adminService.getYearPreflight(year!.fy),
    enabled: showConfirm && !!year && fyDiff.length > 0,
  });
  const pgPreflightQ = useQuery({
    queryKey: queryKeys.admin.goalPreflight(savedPg?.period_label),
    queryFn: () => goalFrameworkService.getPreflight(savedPg?.period_label),
    enabled: showConfirm && !!savedPg && pgDiff.length > 0,
  });
  const warnings = useMemo(() => {
    const out: string[] = [];
    const fyPre = fyPreflightQ.data ?? null;
    for (const d of fyDiff) {
      if (!d.to && fyPre) {
        const w = fyPre[d.key.replace(/^fy:/, "") as keyof YearSettingsUpdatePayload]?.warning;
        // The annual preflight speaks in "FY26-27"; the page speaks in "CY 26-27".
        if (w) out.push(w.replace(/FY(\d{2})-(\d{2})/g, "CY $1-$2"));
      }
    }
    if (savedPg) out.push(...periodWarnings(pgDiff, pgPreflightQ.data ?? null, savedPg));
    return out;
  }, [fyDiff, pgDiff, fyPreflightQ.data, pgPreflightQ.data, savedPg]);
  const warningsLoading = (fyDiff.length > 0 && fyPreflightQ.isPending) || (pgDiff.length > 0 && pgPreflightQ.isPending);

  const refreshAll = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.projectGoals.all });
    void refreshSettings();
  };
  const save = useMutation({
    mutationFn: async () => {
      if (year && fyDiff.length > 0) await adminService.updateYearSettings(year.fy, fyForm);
      if (savedPg && pgForm && pgDiff.length > 0) {
        const patch: PeriodSettingsUpdatePayload = {};
        if (pgForm.entry_open !== savedPg.entry_open) patch.entry_open = pgForm.entry_open;
        if (pgForm.weightages_visible !== savedPg.weightages_visible) patch.weightages_visible = pgForm.weightages_visible;
        if (!savedPg.is_active && pgForm.backfill_open !== savedPg.backfill_open) patch.backfill_open = pgForm.backfill_open;
        if (pgForm.extra_goal_enabled !== savedPg.extra_goal_enabled) patch.extra_goal_enabled = pgForm.extra_goal_enabled;
        if (extraWeightOk(pgForm.extra_goal_weightage) && Number(pgForm.extra_goal_weightage) !== savedPg.extra_goal_weightage) patch.extra_goal_weightage = Number(pgForm.extra_goal_weightage);
        if (Object.keys(patch).length) await goalFrameworkService.updateSettings(patch, savedPg.period_label);
        for (const q of savedPg.quarters) {
          const payload: { ratings_visible?: boolean; backfill_open?: boolean } = {};
          const rv = pgForm.ratings[q.seq] ?? q.ratings_visible;
          if (rv !== q.ratings_visible) payload.ratings_visible = rv;
          const bf = pgForm.quarterBackfill[q.seq] ?? q.backfill_open;
          if (bf !== q.backfill_open) payload.backfill_open = bf;
          if (Object.keys(payload).length) await goalFrameworkService.updateQuarter(q.seq, payload, savedPg.period_label);
        }
      }
    },
    onSuccess: () => { setShowConfirm(false); refreshAll(); toast.success(`Configuration saved for ${year?.cy ?? "the year"}.`); },
    onError: (e) => snackbar.error(getErrorMessage(e)),
  });
  const activate = useMutation({
    mutationFn: () => goalFrameworkService.updateSettings({ is_active: true }, year?.cy),
    onSuccess: () => { refreshAll(); toast.success(`${year?.cy} is now the active goal year.`); },
    onError: (e) => snackbar.error(getErrorMessage(e)),
  });

  const noActiveGoalYear = periodsQ.isSuccess && !(periodsQ.data ?? []).some((p) => p.is_active);
  const yearTag = year ? <span className="text-xs font-medium text-text-muted">· {year.cy}</span> : null;
  const loading = yearsQ.isPending || periodsQ.isPending;
  const goalCycle = goalCycleQ.data ?? null;

  return (
    <div className="p-5 space-y-8">
      {/* ── 1. Quarter roll-out — full width ─────────────────────────── */}
      <div>
        <h3 className={SECTION_TITLE_CLS}>
          <CalendarClock className="h-4 w-4 text-brand" aria-hidden="true" />
          Quarter roll-out <span className="text-xs font-medium text-text-muted">· the review window</span>
        </h3>
        <div className={`${CARD_CLS} px-5 py-4`}>
          <QuarterRolloutCard />
          <p className="mt-4 text-xs text-text-muted">
            Staff write the current quarter's self-review and can backfill earlier quarters of the year; later quarters are locked until rolled out. After Q4 the roll-out starts the next goal year all closed, and the year being left stays open for backfill until you close it below.
          </p>
        </div>
      </div>

      {/* ── 2. One year, one Save ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex-1 min-w-[260px]">
          <label htmlFor="settings-year" className="block text-sm font-medium text-text-main mb-1">
            Configure year
          </label>
          <select
            id="settings-year"
            value={year?.cy ?? ""}
            onChange={(e) => setSelected(e.target.value || null)}
            disabled={loading}
            className={`${SELECT_CLS} sm:w-80`}
          >
            {loading && <option value="">Loading…</option>}
            {!loading && years.length === 0 && <option value="">No years available</option>}
            {years.map((y) => (
              <option key={y.cy} value={y.cy}>
                {y.cy}
                {y.isCurrent ? " (Current)" : ""}
                {!y.period ? " — annual only" : y.period.is_active ? "" : y.period.backfill_open ? " — goals open for backfill" : " — goals closed"}
              </option>
            ))}
          </select>
          <p className="mt-1.5 text-xs text-text-muted">
            One April-to-April year for both calendars. Every switch below applies to the selected year only, so a past year can stay open after the system has advanced. Project Goals appear for a year once the roll-out above has moved into it.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { if (diff.length > 0) setShowConfirm(true); }}
          disabled={!year || diff.length === 0 || save.isPending}
          className={BTN_SAVE}
        >
          <Save className="h-4 w-4" aria-hidden="true" />
          {save.isPending ? "Saving…" : `Save ${year?.cy ?? ""} configuration`}
          {diff.length > 0 && <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] font-bold">{diff.length}</span>}
        </button>
      </div>

      {/* ── 3. The two calendars, side by side ───────────────────────── */}
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-6">
          <div>
            <h3 className={SECTION_TITLE_CLS}>Annual Reviews {yearTag}</h3>
            <div className={`${CARD_CLS} px-5 py-4`}>
              {year?.fyUnconfigured && (
                <p className="mb-2 text-[11px] text-text-muted">Not configured yet for {year.cy}: every window starts closed. Saving creates its configuration.</p>
              )}
              <div className="divide-y divide-border/60">
                <ToggleRow
                  label="Enable Annual Reviews"
                  description="When on, staff can submit self-reviews for this year. Disabling pauses new submissions; existing reviews stay readable."
                  checked={fyForm.annual_reviews_enabled}
                  disabled={!savedFy || save.isPending}
                  onChange={(next) => setFyForm((prev) => ({ ...prev, annual_reviews_enabled: next }))}
                />
                <ToggleRow
                  label="Show Ratings on Annual Reviews"
                  description="When on, the Ratings column is visible on Mentee/Team Review tabs and final ratings are revealed to staff once published — for this year."
                  checked={fyForm.annual_review_final_rating_visible}
                  disabled={!savedFy || save.isPending}
                  onChange={(next) => setFyForm((prev) => ({ ...prev, annual_review_final_rating_visible: next }))}
                />
                <ToggleRow
                  label="Enable Management Review"
                  description="When on, the Admin can enter management ratings (calibration) for this year, whether or not staff submissions are still open."
                  checked={fyForm.management_review_enabled}
                  disabled={!savedFy || save.isPending}
                  onChange={(next) => setFyForm((prev) => ({ ...prev, management_review_enabled: next }))}
                />
              </div>
            </div>
          </div>
          <div>
            <h3 className={SECTION_TITLE_CLS}>Annual Goals {yearTag}</h3>
            <div className={`${CARD_CLS} px-5 py-4`}>
              <div className="divide-y divide-border/60">
                <ToggleRow
                  label="Edit Access for Annual Goals"
                  description="When off, nobody can create or edit annual goals for this year."
                  checked={fyForm.annual_goals_edit_enabled}
                  disabled={!savedFy || save.isPending}
                  onChange={(next) => setFyForm((prev) => ({ ...prev, annual_goals_edit_enabled: next }))}
                />
                <ToggleRow
                  label="Show H1 Mentor Reviews on Annual Goals"
                  description="When on, staff can read their mentor's H1 goal review as soon as it is submitted. Off keeps submitted H1 reviews hidden until you publish."
                  checked={fyForm.goal_reviews_visible_h1}
                  disabled={!savedFy || save.isPending}
                  onChange={(next) => setFyForm((prev) => ({ ...prev, goal_reviews_visible_h1: next }))}
                />
                <ToggleRow
                  label="Show H2 Mentor Reviews on Annual Goals"
                  description="Same for the H2 goal reviews of this year."
                  checked={fyForm.goal_reviews_visible_h2}
                  disabled={!savedFy || save.isPending}
                  onChange={(next) => setFyForm((prev) => ({ ...prev, goal_reviews_visible_h2: next }))}
                />
              </div>
            </div>
          </div>
        </div>

        <div>
          <h3 className={SECTION_TITLE_CLS}>
            <ClipboardList className="h-4 w-4 text-brand" aria-hidden="true" />
            Project Goals {yearTag}
          </h3>
          <div className={`${CARD_CLS} px-5 py-4`}>
            {year && !hasPeriod && (
              <div className="flex items-start gap-2 rounded-lg border border-border bg-slate-50 px-3 py-2.5 text-xs text-text-muted">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>No Project Goals year exists for {year.cy}. Goal years are created by the quarter roll-out above; the annual switches on the left still apply.</span>
              </div>
            )}
            {hasPeriod && pgQ.isError && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{getErrorMessage(pgQ.error)}</p>}
            {hasPeriod && (
              <>
                <div className="divide-y divide-border/60">
                  <ToggleRow
                    label="Goal entry open"
                    description="Staff can start, draft and submit their goal set for this year. Goals are set once and reviewed every quarter."
                    checked={!!pgForm?.entry_open}
                    disabled={!pgForm || save.isPending}
                    onChange={(v) => setPgForm((f) => (f ? { ...f, entry_open: v } : f))}
                  />
                  <ToggleRow
                    label="Weightages visible to staff"
                    description="Show the % next to each KPI. Weightages are informational — there is one rating per quarter, not per KPI."
                    checked={!!pgForm?.weightages_visible}
                    disabled={!pgForm || save.isPending}
                    onChange={(v) => setPgForm((f) => (f ? { ...f, weightages_visible: v } : f))}
                  />
                  <div className="flex items-center justify-between gap-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-text-main">Additional goals row</p>
                      <p className="text-xs text-text-muted mt-0.5">One free-text row at the end of every goal sheet where staff write any other goals they are working on. Optional; its weightage is informational, like the KPIs'.</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <label className="flex items-center gap-1.5 text-xs text-text-muted">
                        Weightage
                        <input
                          type="number"
                          min={0}
                          max={100}
                          step={1}
                          value={pgForm?.extra_goal_weightage ?? ""}
                          disabled={!pgForm || !pgForm.extra_goal_enabled || save.isPending}
                          onChange={(e) => setPgForm((f) => (f ? { ...f, extra_goal_weightage: e.target.value } : f))}
                          className={`w-20 rounded-lg border bg-white px-2 py-1 text-right font-mono text-[13px] outline-none focus:border-brand disabled:bg-slate-50 disabled:text-text-muted ${pgForm && !extraWeightOk(pgForm.extra_goal_weightage) ? "border-red-400" : "border-border"}`}
                          aria-label="Additional goals weightage"
                        />
                        %
                      </label>
                      <Switch
                        ariaLabel="Additional goals row"
                        checked={!!pgForm?.extra_goal_enabled}
                        disabled={!pgForm || save.isPending}
                        onChange={(v) => setPgForm((f) => (f ? { ...f, extra_goal_enabled: v } : f))}
                      />
                    </div>
                  </div>
                  {savedPg && !savedPg.is_active && (
                    <ToggleRow
                      label="Year open for backfill"
                      description={`This year is no longer the review year. While on, its started quarters stay writable (each quarter also has its own switch below); turn off to close ${savedPg.period_label} in one go.`}
                      checked={!!pgForm?.backfill_open}
                      disabled={!pgForm || save.isPending}
                      onChange={(v) => setPgForm((f) => (f ? { ...f, backfill_open: v } : f))}
                    />
                  )}
                </div>
                {savedPg && (
                  <div className="mt-3 border-t border-border/60 pt-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-text-muted">Quarters</p>
                    {savedPg.quarters.length === 0 ? (
                      <p className="mt-1 text-xs text-text-muted">No quarter has started in {savedPg.period_label} yet.</p>
                    ) : (
                      <table className="mt-2 w-full text-sm">
                        <thead>
                          <tr className="text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                            <th className="pb-1.5 font-semibold">Quarter</th>
                            <th className="pb-1.5 text-center font-semibold">Open for backfill</th>
                            <th className="pb-1.5 text-center font-semibold">Ratings visible</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {savedPg.quarters.map((q) => {
                            const isCurrent = savedPg.is_active && q.is_current;
                            return (
                              <tr key={q.seq}>
                                <td className="py-2 pr-3">
                                  <div className="flex items-center gap-2 text-sm font-medium text-text-main">
                                    {quarterDisplay(q.cycle_label)}
                                    {isCurrent && <span className="rounded-full bg-brand px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">current</span>}
                                  </div>
                                  {q.opened_at && <div className="text-[11px] text-text-muted">opened {new Date(q.opened_at).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}</div>}
                                </td>
                                <td className="py-2 text-center">
                                  {isCurrent ? (
                                    <span className="rounded-full bg-brand-light px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-accent" title="The review window itself — always open. Roll the quarter forward or back to change it.">always open</span>
                                  ) : (
                                    <Switch
                                      ariaLabel={`${quarterDisplay(q.cycle_label)} open for backfill`}
                                      checked={pgForm?.quarterBackfill[q.seq] ?? q.backfill_open}
                                      disabled={!pgForm || save.isPending}
                                      onChange={(v) => setPgForm((f) => (f ? { ...f, quarterBackfill: { ...f.quarterBackfill, [q.seq]: v } } : f))}
                                    />
                                  )}
                                </td>
                                <td className="py-2 text-center">
                                  <Switch
                                    ariaLabel={`${quarterDisplay(q.cycle_label)} ratings visible to staff`}
                                    checked={pgForm?.ratings[q.seq] ?? q.ratings_visible}
                                    disabled={!pgForm || save.isPending}
                                    onChange={(v) => setPgForm((f) => (f ? { ...f, ratings: { ...f.ratings, [q.seq]: v } } : f))}
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                    <p className="mt-2 text-[11px] text-text-muted">
                      <b>Open for backfill:</b> while on, staff can still write and submit the quarter's self-review and mentors its review, from scratch if need be; the current quarter is always open.{" "}
                      <b>Ratings visible:</b> releases the quarter's final rating on each staff member's page; the reviewer's comments show as soon as the review is submitted.
                    </p>
                  </div>
                )}
                {savedPg && !savedPg.is_active && noActiveGoalYear && (
                  <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      No goal year is active yet.{" "}
                      <button type="button" disabled={activate.isPending} onClick={() => activate.mutate()} className="font-medium underline">
                        Make {savedPg.period_label} the active year
                      </button>{" "}
                      so staff see it, then set the first quarter above.
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── 4. Calendar ─────────────────────────────────────────────── */}
      <div>
        <div>
          <h3 className={SECTION_TITLE_CLS}>
            <CalendarDays className="h-4 w-4 text-brand" aria-hidden="true" />
            Calendar
          </h3>
          <div className={`${CARD_CLS} p-5`}>
            <div className="grid gap-5 sm:grid-cols-2">
              <ReadOnlyValue
                label="Annual goals & reviews"
                value={activeCycleName ? cycleAsCy(activeCycleName) : "System calculated…"}
                note="Half-yearly goal reviews (H1 / H2) and annual reviews per year. Follows the quarter roll-out above: Q1–Q2 are H1, Q3–Q4 are H2, and starting the next goal year starts the next annual year."
              />
              <ReadOnlyValue
                label="Project Goals"
                value={goalCycle ? `${goalCycle.period_label}${goalCycle.current_label ? ` · ${quarterDisplay(goalCycle.current_label).split(" · ")[0]} current` : " · no quarter rolled out"}` : "—"}
                note="Goal years end around April; the Admin rolls the quarters out above."
              />
              <ReadOnlyValue label="Year start month" value={MONTHS[(fiscalStartMonth || 4) - 1] ?? "—"} note="Set at onboarding." />
              <ReadOnlyValue label="Organisation timezone" value={timezone || "UTC"} note='Anchors what counts as "today" for cycle gates and deadlines. Audit timestamps stay in UTC.' />
            </div>
            <p className="mt-4 flex items-center gap-1.5 text-[11px] text-text-muted">
              <Info className="h-3.5 w-3.5" aria-hidden="true" /> These anchors are read-only here.
            </p>
          </div>
        </div>

      </div>

      {showConfirm && year && (
        <ChangesConfirmModal
          title={`Apply changes to ${year.cy}?`}
          subtitle={`The following switches will be saved for ${year.cy}. Other years remain untouched.`}
          rows={diff}
          warnings={warnings}
          warningsLoading={warningsLoading}
          isSaving={save.isPending}
          onConfirm={() => save.mutate()}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}

function ReadOnlyValue({ label, value, note }: Readonly<{ label: string; value: string; note?: string }>) {
  return (
    <div>
      <p className="text-xs font-medium text-text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-text-main">{value}</p>
      {note && <p className="mt-0.5 text-[11px] text-text-muted">{note}</p>}
    </div>
  );
}
