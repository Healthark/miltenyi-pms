/**
 * system-settings.service.ts — API Contract for the Active Cycle.
 *
 * All system settings API calls funnel through the shared apiClient singleton,
 * which automatically attaches the Bearer token and handles 401 redirects.
 *
 * No raw fetch() or axios imports — we always go through api.client.ts.
 */

import apiClient from "@/services/api.client";

// ── TypeScript Interfaces ───────────────────────────────────────────
// These mirror the Pydantic schemas on the backend exactly.
// If the backend adds a field, it must be added here too.

export type CycleType = "annual" | "half_yearly" | "quarterly";

export interface SystemSettingsResponse {
  id: number;
  org_id: number;
  active_cycle_name: string;
  cycle_type: CycleType;
  fiscal_start_month: number;
  /** IANA timezone string ("UTC", "Asia/Kolkata", "Europe/Berlin", …).
   *  The backend uses it to anchor every calendar-day decision. The
   *  frontend currently doesn't need to act on it directly — display
   *  timestamps still rely on the browser's local zone. */
  timezone: string;
  /** The three per-FY access toggles, mirrored from the CURRENT fiscal
   *  year's override row by GET /settings/. */
  annual_goals_edit_enabled: boolean;
  annual_reviews_enabled: boolean;
  annual_review_final_rating_visible: boolean;
  /** Demo-only escape hatch — when true, the date-based H1/H2 review-
   *  window gate is bypassed everywhere. Mirrors the backend's
   *  `cycle_window_override` and unlocks the calendar-gated frontend
   *  menus so stakeholders can drive the whole cycle in one session. */
  cycle_window_override: boolean;
  /** Demo / QA date simulation. ISO date string when HR has pinned a
   *  fake "today" for the system; null otherwise. The app shell shows
   *  an amber banner whenever this is set. */
  simulated_today: string | null;
  updated_by_id: number | null;
  created_at: string;
  updated_at: string | null;
}

export interface SystemSettingsCreate {
  active_cycle_name?: string;
  cycle_type?: CycleType;
  fiscal_start_month?: number;
}

/** PATCH /settings/ — org-wide anchors and developer escape hatches only.
 *  Per-FY toggles go through adminService.updateYearSettings; the Project
 *  Goals switches through goalFrameworkService.updateSettings. */
export interface SystemSettingsUpdate {
  fiscal_start_month?: number;
  timezone?: string;
  cycle_window_override?: boolean;
  simulated_today?: string | null;
}

// ── Service Object ──────────────────────────────────────────────────
export const systemSettingsService = {
  getSettings: async (): Promise<SystemSettingsResponse> => {
    const response = await apiClient.get<SystemSettingsResponse>("/settings/");
    return response.data;
  },

  createSettings: async (data: SystemSettingsCreate): Promise<SystemSettingsResponse> => {
    const response = await apiClient.post<SystemSettingsResponse>("/settings/", data);
    return response.data;
  },

  updateSettings: async (data: SystemSettingsUpdate): Promise<SystemSettingsResponse> => {
    const response = await apiClient.patch<SystemSettingsResponse>("/settings/", data);
    return response.data;
  },
};