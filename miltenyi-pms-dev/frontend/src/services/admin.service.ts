import apiClient from "@/services/api.client";

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
  level: number;
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
}

export interface SystemSettings {
  id: number;
  org_id: number;
  active_cycle: string | null;
  cycle_type: string;
  fiscal_start_month: number;
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

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export const adminService = {
  // Users
  getUsers: async (): Promise<UserResponse[]> => {
    const res = await apiClient.get<UserResponse[]>("/admin/users");
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
};
