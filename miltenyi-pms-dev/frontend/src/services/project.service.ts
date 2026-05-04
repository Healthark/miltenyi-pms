/**
 * project.service.ts — Admin/HR Project Management API (Revised).
 *
 * Changes:
 *   - Removed allocated_hours
 *   - expected_end_date instead of end_date
 *   - Added reports_to_id/reports_to_name on Project (required on create)
 *   - Added pm_id/pm_name on Project (Primary evaluator, resolved server-side)
 *   - Added secondary_evaluator_id/secondary_evaluator_name on Project (single,
 *     project-level Secondary; replaces multi-row Secondary assignments)
 *   - Added department_id/department_name on Assignment
 *   - Assignment.evaluator_type: "Primary" | null only
 */

import apiClient from "./api.client";

// ── Types ───────────────────────────────────────────────────────────

export interface AssignmentResponse {
  id: number;
  project_id: number;
  user_id: number;
  user_name: string;
  assignment_role: string | null;
  department_id: number | null;
  department_name: string | null;
  evaluator_type: string | null; // "Primary" | "Secondary" | null
  assigned_date: string | null;
  created_at: string;
}

export interface AssignmentCreatePayload {
  user_id: number;
  assignment_role?: string | null;
  department_id?: number | null;
  evaluator_type?: "Primary" | null;
  assigned_date?: string | null;
}

export interface AssignmentUpdatePayload {
  assignment_role?: string | null;
  department_id?: number | null;
  evaluator_type?: "Primary" | null;
  assigned_date?: string | null;
}

export interface ProjectResponse {
  id: number;
  org_id: number;
  project_code: string;
  name: string;
  description: string | null;
  start_date: string | null;
  expected_end_date: string | null;
  reports_to_id: number | null;
  reports_to_name: string | null;
  pm_id: number | null;
  pm_name: string | null;
  secondary_evaluator_id: number | null;
  secondary_evaluator_name: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string | null;
  member_count: number;
}

export interface ProjectDetail extends ProjectResponse {
  assignments: AssignmentResponse[];
}

export interface ProjectCreatePayload {
  project_code: string;
  name: string;
  description?: string | null;
  start_date?: string | null;
  expected_end_date?: string | null;
  // Required by the backend Pydantic validator.
  reports_to_id: number;
  secondary_evaluator_id?: number | null;
  // Must contain exactly one entry with evaluator_type === "Primary".
  assignments: AssignmentCreatePayload[];
}

export interface ProjectUpdatePayload {
  project_code?: string;
  name?: string;
  description?: string | null;
  start_date?: string | null;
  expected_end_date?: string | null;
  reports_to_id?: number | null;
  secondary_evaluator_id?: number | null;
}

// ── Service ─────────────────────────────────────────────────────────

export const projectService = {
  listProjects: async (): Promise<ProjectResponse[]> => {
    const res = await apiClient.get<ProjectResponse[]>("/projects/");
    return res.data;
  },

  createProject: async (payload: ProjectCreatePayload): Promise<ProjectDetail> => {
    const res = await apiClient.post<ProjectDetail>("/projects/", payload);
    return res.data;
  },

  getProjectDetail: async (projectId: number): Promise<ProjectDetail> => {
    const res = await apiClient.get<ProjectDetail>(`/projects/${projectId}`);
    return res.data;
  },

  updateProject: async (projectId: number, payload: ProjectUpdatePayload): Promise<ProjectResponse> => {
    const res = await apiClient.patch<ProjectResponse>(`/projects/${projectId}`, payload);
    return res.data;
  },

  deleteProject: async (projectId: number): Promise<void> => {
    await apiClient.delete(`/projects/${projectId}`);
  },

  addAssignment: async (projectId: number, payload: AssignmentCreatePayload): Promise<AssignmentResponse> => {
    const res = await apiClient.post<AssignmentResponse>(`/projects/${projectId}/assignments`, payload);
    return res.data;
  },

  updateAssignment: async (assignmentId: number, payload: AssignmentUpdatePayload): Promise<AssignmentResponse> => {
    const res = await apiClient.patch<AssignmentResponse>(`/projects/assignments/${assignmentId}`, payload);
    return res.data;
  },

  removeAssignment: async (assignmentId: number): Promise<void> => {
    await apiClient.delete(`/projects/assignments/${assignmentId}`);
  },
};