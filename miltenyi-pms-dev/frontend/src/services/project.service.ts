/**
 * project.service.ts — Admin/HR Project Management API.
 *
 * PM is now a project-level field (Project.pm_id), restricted to users with
 * role=PM. The Secondary evaluator (Project.secondary_evaluator_id) cannot
 * be a PM or Mentor. Project members are Staff only — the PM is NOT in
 * `assignments` and `assignment.evaluator_type` no longer exists.
 */

import apiClient from "./api.client";

// ── Types ───────────────────────────────────────────────────────────

export interface AssignmentResponse {
  id: number;
  project_id: number;
  user_id: number;
  user_name: string;
  assignment_role: string | null;
  function_id: number | null;
  function_name: string | null;
  assigned_date: string | null;
  created_at: string;
}

export interface AssignmentCreatePayload {
  user_id: number;
  assignment_role?: string | null;
  function_id?: number | null;
  assigned_date?: string | null;
}

export interface AssignmentUpdatePayload {
  assignment_role?: string | null;
  function_id?: number | null;
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
  // Required: the Miltenyi PM (user with role=PM) who reviews team members.
  pm_id: number;
  // Optional: senior who adds an impact statement after the PM submits.
  // Cannot be a PM or Mentor.
  secondary_evaluator_id?: number | null;
  // Staff members assigned to the project. The PM is NOT in this list.
  assignments: AssignmentCreatePayload[];
}

export interface ProjectUpdatePayload {
  project_code?: string;
  name?: string;
  description?: string | null;
  start_date?: string | null;
  expected_end_date?: string | null;
  pm_id?: number | null;
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
