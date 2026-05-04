import apiClient from "./api.client";

// ---------------------------------------------------------------------------
// Response types — mirror backend admin_schemas.py exactly
// ---------------------------------------------------------------------------

export interface DepartmentBrief {
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
  department_id: number | null;
  designation_id: number | null;
  mentor_id: number | null;
  is_deleted: boolean;
  created_at: string;
  department: DepartmentBrief | null;
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
  annual_goals_final_rating_visible: boolean;
  project_ratings_visible: boolean;
  annual_reviews_enabled: boolean;
  annual_review_final_rating_visible: boolean;
  updated_at: string | null;
}

export interface AdminSettingsUpdatePayload {
  cycle_type?: string;
  fiscal_start_month?: number;
  goals_edit_enabled?: boolean;
  annual_goals_edit_enabled?: boolean;
  annual_goals_final_rating_visible?: boolean;
  project_ratings_visible?: boolean;
  annual_reviews_enabled?: boolean;
  annual_review_final_rating_visible?: boolean;
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
  department_id?: number | null;
  designation_id?: number | null;
  mentor_id?: number | null;
  password: string;
}

export interface UserUpdatePayload {
  full_name?: string;
  phone?: string;
  role?: string;
  employee_code?: string;
  department_id?: number | null;
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
  getDepartments: async (): Promise<DepartmentBrief[]> => {
    const res = await apiClient.get<DepartmentBrief[]>("/admin/departments");
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
};
