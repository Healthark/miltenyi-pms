/**
 * export.service.ts — HR_MyOrg Excel-export downloads.
 *
 * Hits the backend's GET /export/*.xlsx endpoints as binary blobs and
 * triggers a browser download via an in-memory `<a download>` anchor.
 * Filename is taken from the server's `Content-Disposition` header so
 * the user gets the same `pms-{kind}-YYYY-MM-DD.xlsx` shape the
 * exporter routes generate.
 *
 * Per-tab buttons call `downloadSingleSheet`. The centralised Exports
 * admin tab calls `downloadWorkbook` with an optional FY-year filter.
 */

import type { AxiosResponse } from "axios";
import apiClient from "@/services/api.client";

export type ExportKind =
  | "users"
  | "goals"
  | "annual-reviews"
  | "project-reviews"
  | "projects";

/** Read the server-supplied filename from Content-Disposition. Browsers
 *  don't surface this for blob-typed XHR responses, so we parse it
 *  ourselves and feed it to `link.download` (which overrides whatever
 *  the browser would otherwise infer from the URL). */
function filenameFromResponse(
  res: AxiosResponse,
  fallback: string,
): string {
  const cd = res.headers["content-disposition"];
  if (typeof cd !== "string") return fallback;
  const match = /filename="([^"]+)"/.exec(cd) ?? /filename=([^;]+)/.exec(cd);
  return match?.[1]?.trim() ?? fallback;
}

/** Synthesise an `<a download>` click. Keeps the anchor in the DOM for
 *  one tick so Safari (which is picky about detached anchors) honours
 *  the click, then cleans up. */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

export const exportService = {
  /** Download one of the four single-sheet exports (per-tab buttons). */
  async downloadSingleSheet(kind: ExportKind): Promise<void> {
    const res = await apiClient.get(`/export/${kind}.xlsx`, {
      responseType: "blob",
    });
    const filename = filenameFromResponse(res, `pms-${kind}.xlsx`);
    triggerDownload(res.data as Blob, filename);
  },

  /** Download the combined 5-sheet workbook. `fyYears` narrows scope
   *  on goals / annual reviews / project reviews; pass `[]` or omit
   *  for "all time". Users and Projects sheets are always full org-wide. */
  async downloadWorkbook(fyYears: number[] = []): Promise<void> {
    const params: Record<string, string> = {};
    if (fyYears.length > 0) {
      params.fy = fyYears.join(",");
    }
    const res = await apiClient.get(`/export/all.xlsx`, {
      responseType: "blob",
      params,
    });
    const filename = filenameFromResponse(res, `pms-workbook.xlsx`);
    triggerDownload(res.data as Blob, filename);
  },

  /** Download the Miltenyi HR workbook — three sheets (Users, Projects,
   *  Project Reviews). Annual goals / annual reviews are intentionally
   *  excluded since Miltenyi HR's scope doesn't include those flows.
   *  `fyYears` narrows Project Reviews; Users and Projects sheets are
   *  always full org-wide. Backend gates on role == HR_Miltenyi. */
  async downloadMiltenyiWorkbook(fyYears: number[] = []): Promise<void> {
    const params: Record<string, string> = {};
    if (fyYears.length > 0) {
      params.fy = fyYears.join(",");
    }
    const res = await apiClient.get(`/export/miltenyi.xlsx`, {
      responseType: "blob",
      params,
    });
    const filename = filenameFromResponse(
      res,
      `pms-miltenyi-workbook.xlsx`,
    );
    triggerDownload(res.data as Blob, filename);
  },

  /** Download a single employee's complete record — five sheets covering
   *  profile, goals, annual reviews, project assignments, project
   *  reviews. When `fyYears` is non-empty, every FY-aware sheet is
   *  narrowed to rows overlapping the selected fiscal years (matches
   *  the combined-workbook FY filter behavior). */
  async downloadEmployee(userId: number, fyYears: number[] = []): Promise<void> {
    const fy = fyYears.length > 0 ? fyYears.join(",") : undefined;
    const res = await apiClient.get(`/export/employee/${userId}.xlsx`, {
      responseType: "blob",
      params: fy ? { fy } : undefined,
    });
    const filename = filenameFromResponse(
      res,
      `pms-employee-${userId}.xlsx`,
    );
    triggerDownload(res.data as Blob, filename);
  },
};
