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
  cycle_start_date: string | null;
  cycle_end_date: string | null;
  goals_submission_open: boolean;
  reviews_submission_open: boolean;
  goals_edit_enabled: boolean;
  /** True when the Admin has opened the annual-goal submission window. */
  annual_goals_edit_enabled: boolean;
  project_ratings_visible: boolean;
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
  cycle_start_date?: string | null;
  cycle_end_date?: string | null;
  goals_submission_open?: boolean;
  reviews_submission_open?: boolean;
  annual_goals_edit_enabled?: boolean;
}

export interface SystemSettingsUpdate {
  active_cycle_name?: string;
  cycle_type?: CycleType;
  fiscal_start_month?: number;
  cycle_start_date?: string | null;
  cycle_end_date?: string | null;
  goals_submission_open?: boolean;
  reviews_submission_open?: boolean;
  goals_edit_enabled?: boolean;
  annual_goals_edit_enabled?: boolean;
  project_ratings_visible?: boolean;
  annual_reviews_enabled?: boolean;
  annual_review_final_rating_visible?: boolean;
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