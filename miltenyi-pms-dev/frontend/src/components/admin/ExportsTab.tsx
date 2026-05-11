/**
 * ExportsTab — centralised "download everything as one workbook" page.
 *
 * HR_MyOrg picks zero or more fiscal years from a row of checkboxes
 * (default: nothing checked = "All time"), then hits a single button
 * to download a 4-sheet .xlsx containing Users / Annual Goals /
 * Annual Reviews / Project Reviews.
 *
 * The Users sheet is never narrowed by FY (it's a directory snapshot).
 * The other three sheets respect whichever years are checked.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  Info,
  Loader2,
  UserCircle,
} from "lucide-react";
import { exportService } from "@/services/export.service";
import { adminService, type UserResponse } from "@/services/admin.service";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { useToast } from "@/hooks/useToast";
import { useSnackbar } from "@/hooks/useSnackbar";
import { fyTokenToStartYear, formatFyYearSpan } from "@/utils/fy";
import { getErrorMessage } from "@/utils/errors";
import { StringCombobox } from "@/components/common/StringCombobox";

/** How many prior FYs to surface alongside the active one. Four total
 *  years comfortably covers the typical "last calibration cycle" pull
 *  without overwhelming the picker. */
const PRIOR_FY_OFFSETS = [0, 1, 2, 3];

export function ExportsTab() {
  const { settings } = useSystemSettings();
  const toast = useToast();
  const snackbar = useSnackbar();

  const [selectedFys, setSelectedFys] = useState<Set<number>>(new Set());
  const [isExporting, setIsExporting] = useState(false);

  // Per-employee export state
  const [allUsers, setAllUsers] = useState<UserResponse[]>([]);
  const [employeePickerValue, setEmployeePickerValue] = useState("");
  const [isEmployeeExporting, setIsEmployeeExporting] = useState(false);

  // Fetch the user roster once on mount. HR_MyOrg sees all users
  // (including soft-deleted ex-employees) via /admin/users.
  useEffect(() => {
    let cancelled = false;
    adminService
      .getUsers()
      .then((users) => {
        if (!cancelled) setAllUsers(users);
      })
      .catch(() => {
        // Non-fatal — picker just stays empty. Backend will 403 the
        // export anyway if the user isn't HR_MyOrg.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Build picker options as "Full Name (deactivated)" strings so HR
  // can search by name and immediately see deactivation state. We map
  // the chosen label back to a user id at submit time.
  const employeeOptions = useMemo(() => {
    return allUsers
      .map((u) => ({
        id: u.id,
        label: u.is_deleted ? `${u.full_name} (deactivated)` : u.full_name,
      }))
      .sort((a, b) =>
        a.label.localeCompare(b.label, undefined, { sensitivity: "base" }),
      );
  }, [allUsers]);

  const employeeLabels = useMemo(
    () => employeeOptions.map((o) => o.label),
    [employeeOptions],
  );

  const selectedEmployee = useMemo(() => {
    if (!employeePickerValue) return null;
    return (
      employeeOptions.find((o) => o.label === employeePickerValue) ?? null
    );
  }, [employeeOptions, employeePickerValue]);

  const handleEmployeeExport = async () => {
    if (!selectedEmployee) return;
    setIsEmployeeExporting(true);
    try {
      await exportService.downloadEmployee(selectedEmployee.id);
      toast.success("Employee record downloaded.");
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    } finally {
      setIsEmployeeExporting(false);
    }
  };

  // Active FY drives the picker's "current" row. settings load is async
  // so be defensive: if it's null we just show an empty picker until it
  // arrives.
  const activeFyStart = useMemo(() => {
    if (!settings?.active_cycle_name) return null;
    return fyTokenToStartYear(settings.active_cycle_name);
  }, [settings?.active_cycle_name]);

  const availableYears = useMemo(() => {
    if (activeFyStart === null) return [];
    return PRIOR_FY_OFFSETS.map((offset) => activeFyStart - offset);
  }, [activeFyStart]);

  const toggleYear = (year: number) => {
    setSelectedFys((prev) => {
      const next = new Set(prev);
      if (next.has(year)) {
        next.delete(year);
      } else {
        next.add(year);
      }
      return next;
    });
  };

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await exportService.downloadWorkbook(Array.from(selectedFys));
      toast.success("Workbook downloaded.");
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    } finally {
      setIsExporting(false);
    }
  };

  const scopeSummary =
    selectedFys.size === 0
      ? "All time"
      : Array.from(selectedFys)
          .sort((a, b) => b - a)
          .map(formatFyYearSpan)
          .join(", ");

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="font-display text-lg font-semibold text-text-main">
          Export Workbook
        </h2>
        <p className="mt-1 text-sm text-text-muted">
          Download a single Excel file with four sheets — Users, Annual
          Goals, Annual Reviews, and Project Reviews — covering every row
          you can view. Each download is logged for compliance.
        </p>
      </div>

      {/* FY filter — checkboxes default unchecked. Empty selection
          means "no FY filter" (everything ever). */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            Filter by Fiscal Year
          </span>
          <span className="text-[11px] text-text-muted italic">
            (leave all unchecked for all-time)
          </span>
        </div>

        {availableYears.length === 0 ? (
          <p className="text-sm text-text-muted italic">
            Loading available years…
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {availableYears.map((year) => {
              const isChecked = selectedFys.has(year);
              return (
                <label
                  key={year}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] cursor-pointer transition-colors ${
                    isChecked
                      ? "border-brand bg-brand/5 text-brand"
                      : "border-border bg-white text-text-main hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    onChange={() => toggleYear(year)}
                    className="h-3.5 w-3.5 accent-brand"
                  />
                  {formatFyYearSpan(year)}
                </label>
              );
            })}
          </div>
        )}
      </div>

      {/* Scope echo + action row */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-slate-50/40 px-4 py-3">
        <div className="flex items-start gap-2 text-sm text-text-muted">
          <Info className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          <div>
            <p>
              Scope:{" "}
              <span className="font-medium text-text-main">{scopeSummary}</span>
            </p>
            <p className="mt-0.5 text-[12px]">
              Users sheet always includes the full directory (active +
              deactivated). The FY filter only narrows Goals, Annual
              Reviews, and Project Reviews.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={isExporting}
          className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity shrink-0"
        >
          {isExporting ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <Download className="h-4 w-4" aria-hidden="true" />
          )}
          {isExporting ? "Exporting…" : "Export Workbook (.xlsx)"}
        </button>
      </div>

      {/* Per-employee deep-dive export — five sheets covering one
          employee's profile, goals, annual reviews, project history,
          and project reviews. Useful for offboarding, transfers, and
          compliance asks ("send us everything about this person"). */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-2 mb-3">
          <UserCircle
            className="h-4 w-4 text-text-muted"
            aria-hidden="true"
          />
          <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            Per-Employee Export
          </span>
        </div>
        <p className="text-[12px] text-text-muted mb-3">
          Search an employee and download a workbook with their profile,
          annual goals, annual reviews, every project assignment (active
          and ended), and every project review received. Deactivated
          ex-employees stay in the picker for forensic exports.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 min-w-[260px]">
            <label
              htmlFor="employee-export-picker"
              className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
            >
              Employee
            </label>
            <StringCombobox
              id="employee-export-picker"
              options={employeeLabels}
              value={employeePickerValue}
              onChange={setEmployeePickerValue}
              placeholder="Type a name…"
            />
          </div>
          <button
            type="button"
            onClick={handleEmployeeExport}
            disabled={!selectedEmployee || isEmployeeExporting}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isEmployeeExporting ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Download className="h-4 w-4" aria-hidden="true" />
            )}
            {isEmployeeExporting ? "Exporting…" : "Export Employee Record"}
          </button>
        </div>
      </div>

      {/* Per-sheet quick downloads — same backend endpoints powering the
          per-tab buttons elsewhere. Handy when HR only wants one slice. */}
      <div className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileSpreadsheet
            className="h-4 w-4 text-text-muted"
            aria-hidden="true"
          />
          <span className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            Per-sheet quick downloads
          </span>
        </div>
        <p className="text-[12px] text-text-muted mb-3">
          These ignore the FY filter above — each one always dumps the
          full authorised dataset.
        </p>
        <div className="flex flex-wrap gap-2">
          <QuickButton kind="users" label="Users" />
          <QuickButton kind="goals" label="Annual Goals" />
          <QuickButton kind="annual-reviews" label="Annual Reviews" />
          <QuickButton kind="projects" label="Projects" />
          <QuickButton kind="project-reviews" label="Project Reviews" />
        </div>
      </div>
    </div>
  );
}

// ── Per-sheet quick button (no FY filter; mirrors the toolbar buttons) ─

function QuickButton({
  kind,
  label,
}: {
  readonly kind:
    | "users"
    | "goals"
    | "annual-reviews"
    | "project-reviews"
    | "projects";
  readonly label: string;
}) {
  const toast = useToast();
  const snackbar = useSnackbar();
  const [isExporting, setIsExporting] = useState(false);

  const handleClick = async () => {
    setIsExporting(true);
    try {
      await exportService.downloadSingleSheet(kind);
      toast.success(`${label} exported.`);
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isExporting}
      className="flex items-center gap-1.5 rounded-lg border border-border bg-white px-3 py-1.5 text-[12px] font-medium text-text-main hover:bg-slate-50 disabled:opacity-50 transition-colors"
    >
      {isExporting ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      ) : (
        <FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />
      )}
      {isExporting ? "Exporting…" : label}
    </button>
  );
}
