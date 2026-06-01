import apiClient from "@/services/api.client";
import type { Paginated } from "@/lib/pagination";

// ---------------------------------------------------------------------------
// Response types — mirror backend admin_schemas.py exactly
// ---------------------------------------------------------------------------

export interface FunctionBrief {
  id: number;
  name: string;
}

export interface DesignationBrief {
  id: number;
  name: string;
  /** Legacy hierarchy sort key — kept for back-compat with the existing
   *  dropdown sort. New GCC career-level lookup uses `career_level`. */
  level: number;
  /** GCC career band 1..4. Null on legacy / non-GCC designations. */
  career_level: number | null;
  /** Human label for the band ("Entry" / "Mid" / "Senior" / "Lead"). */
  career_level_label: string | null;
}

export interface UserResponse {
  id: number;
  org_id: number;
  employee_code: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  function_id: number | null;
  designation_id: number | null;
  mentor_id: number | null;
  is_deleted: boolean;
  created_at: string;
  function: FunctionBrief | null;
  designation: DesignationBrief | null;
  /** Active project managers for this user — sorted, deduplicated full
   *  names of every PM running a project the user is currently assigned
   *  to (assignment.end_date IS NULL). Empty for non-Employee or for Employee
   *  with no active assignments. Drives the Project Manager column in
   *  the Users tab for HR_Miltenyi viewers. */
  project_manager_names: string[];
}

export interface SystemSettings {
  id: number;
  org_id: number;
  active_cycle: string | null;
  cycle_type: string;
  fiscal_start_month: number;
  /** IANA timezone (e.g. "UTC", "Asia/Kolkata", "Europe/Berlin"). Drives
   *  every calendar-day decision on the backend so users near midnight
   *  in non-UTC zones don't hit off-by-one cycle rollovers. */
  timezone: string;
  goals_edit_enabled: boolean;
  annual_goals_edit_enabled: boolean;
  project_ratings_visible: boolean;
  annual_reviews_enabled: boolean;
  annual_review_final_rating_visible: boolean;
  /** ISO date string. Non-null when HR has pinned a simulated "today"
   *  for demo / QA purposes. The whole app shows an amber banner when set. */
  simulated_today: string | null;
  /** Mirrors the backend's ALLOW_DATE_SIMULATION env flag. When false,
   *  the simulated_today field is hidden from the System Settings UI
   *  and PATCHing a non-null value is rejected with 400. */
  simulation_allowed: boolean;
  updated_at: string | null;
}

export interface AdminSettingsUpdatePayload {
  cycle_type?: string;
  fiscal_start_month?: number;
  /** IANA timezone string. Backend rejects values ZoneInfo can't load. */
  timezone?: string;
  goals_edit_enabled?: boolean;
  annual_goals_edit_enabled?: boolean;
  project_ratings_visible?: boolean;
  annual_reviews_enabled?: boolean;
  annual_review_final_rating_visible?: boolean;
  /** ISO date string to set as the simulated "today". Send null + the
   *  companion `clear_simulated_today: true` to clear an existing
   *  value (PATCH semantics treat omission as "leave unchanged"). */
  simulated_today?: string | null;
  clear_simulated_today?: boolean;
}

export interface SettingsPreflightEntry {
  in_flight_count: number;
  warning: string | null;
}

/** Map of setting key → in-flight count + warning copy. Returned by
 *  GET /admin/settings/preflight; the UI consults this before flipping a
 *  toggle off so HR can confirm they're not stranding in-flight users. */
export interface SettingsPreflight {
  annual_goals_edit_enabled: SettingsPreflightEntry;
  annual_reviews_enabled: SettingsPreflightEntry;
  project_ratings_visible: SettingsPreflightEntry;
  annual_review_final_rating_visible: SettingsPreflightEntry;
}

/** Per-fiscal-year access configuration types. The Admin Panel's Year
 *  dropdown drives which FY's row is loaded; each FY has its own copy
 *  of the four access toggles, so HR can keep FY26-27 reviews editable
 *  even after the system advances into FY27-28. */

export interface YearOption {
  fy_label: string;
  is_current: boolean;
  has_override: boolean;
}

export interface YearOptionsResponse {
  years: YearOption[];
}

export interface YearSettings {
  fy_label: string;
  annual_reviews_enabled: boolean;
  annual_review_final_rating_visible: boolean;
  annual_goals_edit_enabled: boolean;
  project_ratings_visible: boolean;
  is_current: boolean;
  updated_at: string | null;
}

export interface YearSettingsUpdatePayload {
  annual_reviews_enabled: boolean;
  annual_review_final_rating_visible: boolean;
  annual_goals_edit_enabled: boolean;
  project_ratings_visible: boolean;
}

export interface YearPreflightEntry {
  in_flight_count: number;
  warning: string | null;
}

export interface YearPreflight {
  fy_label: string;
  annual_goals_edit_enabled: YearPreflightEntry;
  annual_reviews_enabled: YearPreflightEntry;
  project_ratings_visible: YearPreflightEntry;
  annual_review_final_rating_visible: YearPreflightEntry;
}

// ---------------------------------------------------------------------------
// Request payload types
// ---------------------------------------------------------------------------

export interface UserCreatePayload {
  employee_code: string;
  full_name: string;
  email: string;
  phone?: string;
  role: string;
  function_id?: number | null;
  designation_id?: number | null;
  mentor_id?: number | null;
  password: string;
}

export interface UserUpdatePayload {
  full_name?: string;
  phone?: string;
  role?: string;
  employee_code?: string;
  function_id?: number | null;
  designation_id?: number | null;
  mentor_id?: number | null;
}

/** Sort columns the server can ORDER BY on the paginated users
 *  endpoint. Mirrors backend `_USERS_SORT_COLUMNS` exactly. Mentor /
 *  PM-set columns are intentionally absent — they'd require correlated
 *  subqueries; the corresponding column headers stay non-sortable
 *  client-side. */
export type UsersPaginatedSortBy =
  | "full_name"
  | "email"
  | "role"
  | "created_at"
  | "function_name"
  | "designation_name";

/** Query params for GET /admin/users/paginated. Every field optional;
 *  the server treats omission as "no filter" and 'all' as a back-compat
 *  alias for the same. */
export interface GetUsersPaginatedParams {
  limit?: number;
  offset?: number;
  search?: string;
  role?: string;
  /** 'active' | 'inactive' | 'all'. Sent verbatim. */
  status?: string;
  function_name?: string;
  designation_name?: string;
  /** Exact mentor full_name, OR the literal "(No mentor)" sentinel
   *  (matches rows whose mentor_id IS NULL — same wire value the
   *  frontend dropdown uses). */
  mentor_name?: string;
  /** Exact PM full_name — passes rows the user has an active
   *  ProjectAssignment for under a Project whose PM matches. */
  pm_name?: string;
  sort_by?: UsersPaginatedSortBy;
  sort_dir?: "asc" | "desc";
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const adminService = {
  // Users
  getUsers: async (): Promise<UserResponse[]> => {
    const res = await apiClient.get<UserResponse[]>("/admin/users");
    return res.data;
  },

  /** Paginated users endpoint — separate from `getUsers` so dropdown
   *  consumers (`useOrgUsers`, ExportsTab, ProjectModal pickers) keep
   *  receiving the full roster without going through page math. The
   *  admin Users table is the only consumer of this method today. */
  getUsersPaginated: async (
    params: GetUsersPaginatedParams = {},
  ): Promise<Paginated<UserResponse>> => {
    const res = await apiClient.get<Paginated<UserResponse>>(
      "/admin/users/paginated",
      { params },
    );
    return res.data;
  },

  createUser: async (payload: UserCreatePayload): Promise<UserResponse> => {
    const res = await apiClient.post<UserResponse>("/admin/users", payload);
    return res.data;
  },

  updateUser: async (
    userId: number,
    payload: UserUpdatePayload,
  ): Promise<UserResponse> => {
    const res = await apiClient.patch<UserResponse>(
      `/admin/users/${userId}`,
      payload,
    );
    return res.data;
  },

  deactivateUser: async (userId: number): Promise<void> => {
    await apiClient.delete(`/admin/users/${userId}`);
  },

  reactivateUser: async (userId: number): Promise<UserResponse> => {
    const res = await apiClient.post<UserResponse>(
      `/admin/users/${userId}/reactivate`,
    );
    return res.data;
  },

  // Reference data (for form dropdowns)
  getFunctions: async (): Promise<FunctionBrief[]> => {
    const res = await apiClient.get<FunctionBrief[]>("/admin/functions");
    return res.data;
  },

  getDesignations: async (): Promise<DesignationBrief[]> => {
    const res = await apiClient.get<DesignationBrief[]>("/admin/designations");
    return res.data;
  },

  // System Settings
  getSettings: async (): Promise<SystemSettings> => {
    const res = await apiClient.get<SystemSettings>("/admin/settings");
    return res.data;
  },

  updateSettings: async (payload: AdminSettingsUpdatePayload): Promise<SystemSettings> => {
    const res = await apiClient.patch<SystemSettings>("/admin/settings", payload);
    return res.data;
  },

  /** Per-setting "in-flight count" check, used to power the confirm
   *  modal that warns HR before they freeze users mid-cycle. */
  getSettingsPreflight: async (): Promise<SettingsPreflight> => {
    const res = await apiClient.get<SettingsPreflight>("/admin/settings/preflight");
    return res.data;
  },

  // ── Per-FY access configuration ─────────────────────────────────
  // The Admin Panel's Year dropdown loads via listSettingsYears(); the
  // four toggles below it bind to the row returned by getYearSettings.
  // Save fires updateYearSettings (PATCH) with all four values for the
  // selected FY. getYearPreflight powers the confirmation card's
  // in-flight impact warning.

  listSettingsYears: async (): Promise<YearOptionsResponse> => {
    const res = await apiClient.get<YearOptionsResponse>(
      "/admin/settings/years",
    );
    return res.data;
  },

  getYearSettings: async (fyLabel: string): Promise<YearSettings> => {
    const res = await apiClient.get<YearSettings>(
      `/admin/settings/year/${encodeURIComponent(fyLabel)}`,
    );
    return res.data;
  },

  updateYearSettings: async (
    fyLabel: string,
    payload: YearSettingsUpdatePayload,
  ): Promise<YearSettings> => {
    const res = await apiClient.patch<YearSettings>(
      `/admin/settings/year/${encodeURIComponent(fyLabel)}`,
      payload,
    );
    return res.data;
  },

  getYearPreflight: async (fyLabel: string): Promise<YearPreflight> => {
    const res = await apiClient.get<YearPreflight>(
      `/admin/settings/year/${encodeURIComponent(fyLabel)}/preflight`,
    );
    return res.data;
  },
};
