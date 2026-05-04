/**
 * profile.service.ts — Self-Service API for the Profile Page.
 *
 * Calls:
 *   getProfile()         → GET  /users/me                (rich profile data)
 *   changePassword()     → POST /users/me/password        (current + new password)
 *   getMyExpectations()  → GET  /users/me/expectations    (current user's role expectations)
 *
 * All calls go through the shared apiClient singleton which handles
 * Bearer token injection and global 401 redirects automatically.
 */

import apiClient from "./api.client";

// ── Response Types ──────────────────────────────────────────────────

export interface UserProfile {
  id: number;
  org_id: number;
  org_name: string;
  employee_code: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: string;
  avatar_url: string | null;
  department: string | null;
  designation: string | null;
  mentor_name: string | null;
  created_at: string;
}

/**
 * Resolved role-expectation row for the current user's department × designation.
 * Used by the Goal Self-Review modal to surface Firm Growth and Competency &
 * Skills expectations as a reference panel above the freeform paragraph.
 * Backend fills every field with a "Role expectation not defined" fallback
 * when no mapping exists, so consumers don't have to null-check.
 */
export interface UserRoleExpectation {
  department_name: string | null;
  designation_name: string | null;
  exp_task_execution: string;
  exp_ownership: string;
  exp_project_management: string;
  exp_client_deliverables: string;
  exp_communication: string;
  exp_mentoring: string;
  exp_firm_growth: string;
  exp_competency_skills: string;
}

// ── Request Types ───────────────────────────────────────────────────

export interface PasswordChangePayload {
  current_password: string;
  new_password: string;
}

// ── Service ─────────────────────────────────────────────────────────

export const profileService = {
  /** Fetch the authenticated user's full profile for the Profile page. */
  getProfile: async (): Promise<UserProfile> => {
    const res = await apiClient.get<UserProfile>("/users/me");
    return res.data;
  },

  /** Resolved role expectations for the current user. */
  getMyExpectations: async (): Promise<UserRoleExpectation> => {
    const res = await apiClient.get<UserRoleExpectation>("/users/me/expectations");
    return res.data;
  },

  /** Change the current user's password. Requires the current password. */
  changePassword: async (payload: PasswordChangePayload): Promise<void> => {
    await apiClient.post("/users/me/password", payload);
  },
};
