/**
 * frameworkDraft — the shape of a framework column being edited and the
 * 100% rule, shared by the Framework tab (role columns) and the
 * personal-framework modal (16 Oct 2026). The editor components live in
 * frameworkEditor.tsx.
 */
import type { FrameworkKpiInput } from "@/services/goal-framework.service";

export interface FrameworkDraft<K extends FrameworkKpiInput = FrameworkKpiInput> {
  title: string;
  business_outcomes: string;
  functional_goals: string;
  kpis: K[];
  /** The pinned "Additional goals" row: editable weightage, never deleted. */
  extra_goal_weightage: number;
}

export const kpiTotal = (kpis: FrameworkKpiInput[]) => kpis.reduce((a, k) => a + (Number(k.weightage) || 0), 0);
/** KPIs plus the Additional goals row — this is what must be 100. */
export const draftTotal = (d: FrameworkDraft) => kpiTotal(d.kpis) + (Number(d.extra_goal_weightage) || 0);
export const draftValid = (d: FrameworkDraft) =>
  draftTotal(d) === 100 && d.kpis.length > 0 && d.kpis.every((k) => k.text.trim()) && !!d.title.trim() && !!d.business_outcomes.trim() && !!d.functional_goals.trim();
