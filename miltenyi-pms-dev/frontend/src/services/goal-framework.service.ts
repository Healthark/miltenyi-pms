/**
 * goal-framework.service.ts — Admin maintenance of the Project Goals
 * framework (matrix editor + "Add Function"), the staff mapping view, the
 * per-period switches and the quarter roll-out. Mirrors backend
 * goal_framework_routes.py.
 */

import apiClient from "@/services/api.client";
import type { DesignationBrief as AdminDesignationBrief, FunctionBrief } from "@/services/admin.service";
import type { FrameworkRow, PeriodBrief, PeriodSettings, Quarter } from "@/services/project-goals.service";

export interface DesignationBrief {
  id: number;
  name: string;
  career_level: number | null;
  career_level_label: string | null;
}

export interface FrameworkFunction {
  function_id: number;
  function_name: string;
  designations: DesignationBrief[];
  /** 0..4 rows, one per defined level. */
  rows: FrameworkRow[];
}

export interface FrameworkMatrix {
  period_label: string;
  functions: FrameworkFunction[];
}

export interface FrameworkKpiInput {
  text: string;
  weightage: number;
}

export interface FrameworkRowCreatePayload {
  function_id: number;
  level: number;
  period_label?: string;
  title: string;
  business_outcomes: string;
  functional_goals: string;
  kpis: FrameworkKpiInput[];
}

export interface FrameworkRowUpdatePayload {
  title: string;
  business_outcomes: string;
  functional_goals: string;
  kpis: FrameworkKpiInput[];
}

export type MappingStatus = "mapped" | "no_framework" | "no_designation" | "no_function";

export interface MappingRow {
  user_id: number;
  full_name: string;
  email: string;
  function_id: number | null;
  function_name: string | null;
  designation_id: number | null;
  designation_name: string | null;
  level: number | null;
  level_label: string | null;
  mentor_id: number | null;
  mentor_name: string | null;
  miltenyi_reviewer_name: string | null;
  status: MappingStatus;
  /** Function / designation are locked while this year's goal set exists. */
  has_active_set: boolean;
  active_set_status: string | null;
}

export interface DesignationCreatePayload {
  name: string;
  function_id: number;
  career_level: number;
}

export interface DesignationUpdatePayload {
  name?: string;
  career_level?: number;
}

/** Yearly switches. The review window is not a switch — see the cycle.
 *  `backfill_open` matters for a past year only. */
export interface PeriodSettingsUpdatePayload {
  is_active?: boolean;
  entry_open?: boolean;
  weightages_visible?: boolean;
  backfill_open?: boolean;
  extra_goal_enabled?: boolean;
  extra_goal_weightage?: number;
}

/** Per-quarter switches; send only what changed. */
export interface QuarterUpdatePayload {
  ratings_visible?: boolean;
  backfill_open?: boolean;
}

export interface QuarterPreflight {
  seq: number;
  cycle_label: string;
  self_pending: number;
  review_pending: number;
  reviews_submitted: number;
}

/** Who a switch flip would affect — shown in the Save confirmation. */
export interface PeriodPreflight {
  period_label: string;
  staff_total: number;
  staff_without_set: number;
  sets_draft: number;
  sets_submitted: number;
  sets_approved: number;
  quarters: QuarterPreflight[];
}

/** What the quarter roll-out card shows, in one call. */
export interface CycleStatus {
  period_label: string;
  current_seq: number | null;
  current_label: string | null;
  next_seq: number;
  next_label: string;
  /** Differs from period_label when the roll-out starts a new year. */
  next_period_label: string;
  crosses_year: boolean;
  requires_typed_confirmation: boolean;
  /** The quarter before the last move — powers "Roll back". */
  previous_label: string | null;
  quarters: Quarter[];
}

export interface CycleLogEntry {
  id: number;
  from_label: string | null;
  to_label: string;
  kind: "rollout" | "set" | "rollback" | string;
  actor_name: string | null;
  created_at: string;
}

const BASE = "/admin/goal-frameworks";

export const goalFrameworkService = {
  getMatrix: async (period?: string): Promise<FrameworkMatrix> =>
    (await apiClient.get<FrameworkMatrix>(`${BASE}/`, { params: period ? { period } : undefined })).data,
  createRow: async (payload: FrameworkRowCreatePayload): Promise<FrameworkRow> =>
    (await apiClient.post<FrameworkRow>(`${BASE}/`, payload)).data,
  updateRow: async (rowId: number, payload: FrameworkRowUpdatePayload): Promise<FrameworkRow> =>
    (await apiClient.put<FrameworkRow>(`${BASE}/${rowId}`, payload)).data,
  deleteRow: async (rowId: number): Promise<void> => {
    await apiClient.delete(`${BASE}/${rowId}`);
  },
  updateDesignation: async (designationId: number, payload: DesignationUpdatePayload): Promise<DesignationBrief> =>
    (await apiClient.patch<DesignationBrief>(`${BASE}/designations/${designationId}`, payload)).data,

  // Reference data (functions and designations are org-wide; the Users tab reads the same lists)
  createFunction: async (name: string): Promise<FunctionBrief> =>
    (await apiClient.post<FunctionBrief>("/admin/functions", { name })).data,
  renameFunction: async (functionId: number, name: string): Promise<FunctionBrief> =>
    (await apiClient.patch<FunctionBrief>(`/admin/functions/${functionId}`, { name })).data,
  createDesignation: async (payload: DesignationCreatePayload): Promise<AdminDesignationBrief> =>
    (await apiClient.post<AdminDesignationBrief>("/admin/designations", payload)).data,
  getMapping: async (period?: string): Promise<MappingRow[]> =>
    (await apiClient.get<MappingRow[]>(`${BASE}/mapping`, { params: period ? { period } : undefined })).data,

  // Period switches
  getPeriods: async (): Promise<PeriodBrief[]> => (await apiClient.get<PeriodBrief[]>(`${BASE}/periods`)).data,
  getPreflight: async (period?: string | null): Promise<PeriodPreflight> =>
    (await apiClient.get<PeriodPreflight>(`${BASE}/settings/preflight`, { params: period ? { period } : undefined })).data,
  getSettings: async (period?: string): Promise<PeriodSettings> =>
    (await apiClient.get<PeriodSettings>(`${BASE}/settings`, { params: period ? { period } : undefined })).data,
  updateSettings: async (payload: PeriodSettingsUpdatePayload, period?: string): Promise<PeriodSettings> =>
    (await apiClient.patch<PeriodSettings>(`${BASE}/settings`, payload, { params: period ? { period } : undefined })).data,

  // Quarter roll-out
  getCycle: async (): Promise<CycleStatus> => (await apiClient.get<CycleStatus>(`${BASE}/cycle`)).data,
  rollout: async (confirmation?: string): Promise<CycleStatus> =>
    (await apiClient.post<CycleStatus>(`${BASE}/cycle/rollout`, { confirmation: confirmation ?? null })).data,
  setCycle: async (targetLabel: string): Promise<CycleStatus> =>
    (await apiClient.post<CycleStatus>(`${BASE}/cycle/set`, { target_label: targetLabel })).data,
  rollback: async (): Promise<CycleStatus> => (await apiClient.post<CycleStatus>(`${BASE}/cycle/rollback`)).data,
  getCycleLog: async (limit = 10): Promise<CycleLogEntry[]> =>
    (await apiClient.get<CycleLogEntry[]>(`${BASE}/cycle/log`, { params: { limit } })).data,
  updateQuarter: async (seq: number, payload: QuarterUpdatePayload, period?: string | null): Promise<Quarter> =>
    (await apiClient.patch<Quarter>(`${BASE}/quarters/${seq}`, payload, { params: period ? { period } : undefined })).data,
};
