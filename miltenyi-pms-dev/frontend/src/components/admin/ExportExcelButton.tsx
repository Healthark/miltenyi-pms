/**
 * ExportExcelButton — small toolbar button that downloads one of the
 * single-sheet HR exports.
 *
 * The button auto-hides based on the caller's role so callers don't have
 * to repeat the gate in every toolbar:
 *   HR_MyOrg     — visible for every kind
 *   HR_Miltenyi  — visible for `users`, `projects`, and `project-reviews`
 *                  (the surfaces in their scope); annual goals and annual
 *                  reviews remain HR_MyOrg-only
 *   anyone else  — hidden
 *
 * Toast + snackbar feedback mirrors the rest of the admin surfaces.
 */

import { useState } from "react";
import { FileSpreadsheet, Loader2 } from "lucide-react";
import { exportService, type ExportKind } from "@/services/export.service";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { useSnackbar } from "@/hooks/useSnackbar";
import { getErrorMessage } from "@/utils/errors";

interface ExportExcelButtonProps {
  readonly kind: ExportKind;
  /** Optional override for the visible label. Defaults to "Export Excel". */
  readonly label?: string;
}

export function ExportExcelButton({
  kind,
  label = "Export Excel",
}: ExportExcelButtonProps) {
  const { user } = useAuth();
  const toast = useToast();
  const snackbar = useSnackbar();
  const [isExporting, setIsExporting] = useState(false);

  // HR_MyOrg sees the button on every kind. HR_Miltenyi sees it on the
  // kinds within their scope: users + projects (Admin tabs) and
  // project-reviews (Project Reviews page). Annual goals and annual
  // reviews stay HR_MyOrg-only since those flows are out of Miltenyi
  // HR's scope. Role — not Function/Department — is the gate because
  // Miltenyi org has no "HR" function row to key off.
  const role = user?.role;
  const miltenyiAllowedKinds: ReadonlySet<ExportKind> = new Set([
    "users",
    "projects",
    "project-reviews",
  ]);
  const canExport =
    role === "HR_MyOrg" ||
    (role === "HR_Miltenyi" && miltenyiAllowedKinds.has(kind));
  if (!canExport) return null;

  const handleClick = async () => {
    setIsExporting(true);
    try {
      await exportService.downloadSingleSheet(kind);
      toast.success("Export downloaded.");
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
      title="Download all rows you can view as an Excel file"
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
