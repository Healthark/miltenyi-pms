/**
 * ProjectModal.tsx — Create/Edit Project with Team Assignments (Revised).
 *
 * Changes:
 *   - Removed allocated hours
 *   - expected_end_date instead of end_date
 *   - "PM Reports To" is a typeable searchable combobox (required)
 *   - "Secondary Evaluator" is a typeable searchable combobox (optional,
 *     project-level — replaces per-member Secondary)
 *   - Members have a single "PM" checkbox (max one across the project);
 *     no more Primary/Secondary dropdown on each row
 *   - Assignment rows include Department dropdown
 *   - Assignment role auto-fills from user's designation when selected
 *
 * Placement: src/components/admin/ProjectModal.tsx
 */

import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { X, Loader2, UserPlus, Trash2 } from "lucide-react";
import {
  projectService,
  type ProjectDetail,
  type AssignmentResponse,
  type AssignmentCreatePayload,
} from "../../services/project.service";
import {
  adminService,
  type UserResponse,
  type DepartmentBrief,
  type DesignationBrief,
} from "../../services/admin.service";
import { getErrorMessage } from "../../utils/errors";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { UserCombobox } from "../common/UserCombobox";

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-text-muted mb-1";

interface ProjectModalProps {
  readonly projectId: number | null;
  readonly users: UserResponse[];
  readonly onClose: () => void;
  readonly onSave: () => void;
}

interface DraftAssignment {
  tempId: string;
  user_id: string;
  assignment_role: string;
  department_id: string;
  is_pm: boolean;
  assigned_date: string;
}

let nextTemp = 0;
function tempId(): string {
  nextTemp += 1;
  return `tmp_${nextTemp}`;
}

function toDateInput(val: string | null | undefined): string {
  if (!val) return "";
  return val.slice(0, 10);
}

export function ProjectModal({
  projectId,
  users,
  onClose,
  onSave,
}: ProjectModalProps) {
  const isEditing = projectId !== null;

  // ── Form State ──────────────────────────────────────────────────
  const [projectCode, setProjectCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [expectedEndDate, setExpectedEndDate] = useState("");
  const [reportsToId, setReportsToId] = useState<number | null>(null);
  const [secondaryEvaluatorId, setSecondaryEvaluatorId] = useState<number | null>(null);

  // ── Reference Data ──────────────────────────────────────────────
  const [departments, setDepartments] = useState<DepartmentBrief[]>([]);
  const [designations, setDesignations] = useState<DesignationBrief[]>([]);

  // ── Assignment State ────────────────────────────────────────────
  const [draftAssignments, setDraftAssignments] = useState<DraftAssignment[]>([]);
  const [existingAssignments, setExistingAssignments] = useState<AssignmentResponse[]>([]);

  // ── UI State ────────────────────────────────────────────────────
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const toast = useToast();
  const snackbar = useSnackbar();

  // ── Load reference data + existing project ──────────────────────
  useEffect(() => {
    const loadRefs = async () => {
      try {
        const [deptData, desigData] = await Promise.all([
          adminService.getDepartments(),
          adminService.getDesignations(),
        ]);
        setDepartments(deptData);
        setDesignations(desigData);
      } catch {
        // dropdowns stay empty
      }
    };
    void loadRefs();
  }, []);

  useEffect(() => {
    if (!isEditing) return;
    setIsLoading(true);
    projectService
      .getProjectDetail(projectId)
      .then((detail: ProjectDetail) => {
        setProjectCode(detail.project_code);
        setName(detail.name);
        setDescription(detail.description ?? "");
        setStartDate(toDateInput(detail.start_date));
        setExpectedEndDate(toDateInput(detail.expected_end_date));
        setReportsToId(detail.reports_to_id ?? null);
        setSecondaryEvaluatorId(detail.secondary_evaluator_id ?? null);
        setExistingAssignments(detail.assignments);
      })
      .catch((err: unknown) => setError(getErrorMessage(err)))
      .finally(() => setIsLoading(false));
  }, [isEditing, projectId]);

  // ── Draft Assignment Helpers ────────────────────────────────────
  const addDraftAssignment = () => {
    setDraftAssignments((prev) => [
      ...prev,
      {
        tempId: tempId(),
        user_id: "",
        assignment_role: "",
        department_id: "",
        is_pm: false,
        assigned_date: "",
      },
    ]);
  };

  const updateDraft = <K extends keyof DraftAssignment>(
    id: string,
    field: K,
    value: DraftAssignment[K],
  ) => {
    setDraftAssignments((prev) =>
      prev.map((a) => (a.tempId === id ? { ...a, [field]: value } : a)),
    );
  };

  /** Toggle PM flag on a draft. At most one draft can be PM at a time;
   *  also blocked if an existing assignment is already PM. */
  const toggleDraftPm = (id: string) => {
    setDraftAssignments((prev) =>
      prev.map((a) =>
        a.tempId === id
          ? { ...a, is_pm: !a.is_pm }
          : a.is_pm
            ? { ...a, is_pm: false }
            : a,
      ),
    );
  };

  /** Auto-fill role and department when user is selected */
  const handleUserSelect = (draftId: string, userId: string) => {
    updateDraft(draftId, "user_id", userId);

    if (!userId) return;

    const selectedUser = users.find((u) => u.id === Number(userId));
    if (!selectedUser) return;

    if (selectedUser.department_id) {
      updateDraft(draftId, "department_id", selectedUser.department_id.toString());
    }
    if (selectedUser.designation) {
      updateDraft(draftId, "assignment_role", selectedUser.designation.name);
    }
  };

  const removeDraft = (id: string) => {
    setDraftAssignments((prev) => prev.filter((a) => a.tempId !== id));
  };

  const removeExisting = async (assignmentId: number) => {
    try {
      await projectService.removeAssignment(assignmentId);
      setExistingAssignments((prev) => prev.filter((a) => a.id !== assignmentId));
    } catch (err: unknown) {
      snackbar.error(getErrorMessage(err));
    }
  };

  // ── Computed ────────────────────────────────────────────────────
  const assignedUserIds = new Set([
    ...existingAssignments.map((a) => a.user_id),
    ...draftAssignments.filter((a) => a.user_id).map((a) => Number(a.user_id)),
  ]);

  const existingPrimary = existingAssignments.find((a) => a.evaluator_type === "Primary") ?? null;
  const draftPrimary = draftAssignments.find((a) => a.is_pm) ?? null;
  const hasPrimary = !!existingPrimary || !!draftPrimary;

  // Validation requirements (for create + final save):
  //   - PM checked on exactly one member
  //   - reports_to_id set
  //   - reports_to_id != PM (a PM cannot review themselves)
  //   - secondary_evaluator_id != PM (no self-review)
  //   - secondary_evaluator_id != reports_to_id (the same person can't
  //     play both reviewer roles — the secondary should be an outside
  //     perspective, not the same senior who already reviews the PM)
  //   - expected_end_date >= start_date when both set
  const pmUserId = existingPrimary?.user_id ?? (draftPrimary && draftPrimary.user_id ? Number(draftPrimary.user_id) : null);
  const reportsToConflict = pmUserId !== null && reportsToId === pmUserId;
  const secondaryConflictWithPm = pmUserId !== null && secondaryEvaluatorId === pmUserId;
  const secondaryConflictWithReportsTo =
    secondaryEvaluatorId !== null && secondaryEvaluatorId === reportsToId;
  const endBeforeStart = !!startDate && !!expectedEndDate && expectedEndDate < startDate;

  // Dropdown exclusions — keep the two reviewer-role pickers from
  // surfacing each other or the PM as candidates.
  const reportsToExclude: number[] = [];
  if (pmUserId !== null) reportsToExclude.push(pmUserId);
  if (secondaryEvaluatorId !== null) reportsToExclude.push(secondaryEvaluatorId);

  const secondaryExclude: number[] = [];
  if (pmUserId !== null) secondaryExclude.push(pmUserId);
  if (reportsToId !== null) secondaryExclude.push(reportsToId);

  const validationError =
    !projectCode.trim()
      ? "Project Code is required."
      : !name.trim()
        ? "Project Name is required."
        : endBeforeStart
          ? "End Date cannot be before Start Date."
          : !isEditing && !hasPrimary
            ? "Mark exactly one member as PM."
            : !isEditing && reportsToId === null
              ? "PM Reports To is required."
              : reportsToConflict
                ? "PM Reports To must be a different user than the PM."
                : secondaryConflictWithPm
                  ? "Secondary Evaluator must be a different user than the PM."
                  : secondaryConflictWithReportsTo
                    ? "Secondary Evaluator must be a different user than PM Reports To."
                    : null;

  // ── Submit ──────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsSaving(true);
    setError("");

    try {
      if (isEditing) {
        await projectService.updateProject(projectId, {
          project_code: projectCode,
          name,
          description: description || null,
          start_date: startDate || null,
          expected_end_date: expectedEndDate || null,
          reports_to_id: reportsToId,
          secondary_evaluator_id: secondaryEvaluatorId,
        });

        for (const draft of draftAssignments) {
          if (!draft.user_id) continue;
          await projectService.addAssignment(projectId, {
            user_id: Number(draft.user_id),
            assignment_role: draft.assignment_role || null,
            department_id: draft.department_id ? Number(draft.department_id) : null,
            evaluator_type: draft.is_pm ? "Primary" : null,
            assigned_date: draft.assigned_date || null,
          });
        }
      } else {
        const assignments: AssignmentCreatePayload[] = draftAssignments
          .filter((a) => a.user_id)
          .map((a) => ({
            user_id: Number(a.user_id),
            assignment_role: a.assignment_role || null,
            department_id: a.department_id ? Number(a.department_id) : null,
            evaluator_type: a.is_pm ? "Primary" : null,
            assigned_date: a.assigned_date || null,
          }));

        // reports_to_id is required by backend; validation above guarantees non-null here.
        await projectService.createProject({
          project_code: projectCode,
          name,
          description: description || null,
          start_date: startDate || null,
          expected_end_date: expectedEndDate || null,
          reports_to_id: reportsToId as number,
          secondary_evaluator_id: secondaryEvaluatorId,
          assignments,
        });
      }

      onSave();
      toast.success(isEditing ? "Project updated." : "Project created.");
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const canSubmit = !validationError && !isSaving;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-modal-title"
    >
      <div className="w-full max-w-2xl rounded-xl bg-surface shadow-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <h2
            id="project-modal-title"
            className="font-display text-base font-semibold text-text-main"
          >
            {isEditing ? "Edit Project" : "Create New Project"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-text-muted">
              <Loader2 className="h-5 w-5 animate-spin mr-2" aria-hidden="true" />
              Loading project…
            </div>
          ) : (
            <>
              {error && (
                <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>
              )}

              {/* ── Project Details ────────────────────────────── */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="proj-code" className={LABEL_CLS}>Project Code *</label>
                  <input id="proj-code" className={INPUT_CLS} value={projectCode} onChange={(e) => setProjectCode(e.target.value)} placeholder="PRJ-001" />
                </div>
                <div>
                  <label htmlFor="proj-name" className={LABEL_CLS}>Project Name *</label>
                  <input id="proj-name" className={INPUT_CLS} value={name} onChange={(e) => setName(e.target.value)} placeholder="Market Access Study Q2" />
                </div>
              </div>

              <div>
                <label htmlFor="proj-desc" className={LABEL_CLS}>Description</label>
                <textarea id="proj-desc" rows={2} className={`${INPUT_CLS} resize-none`} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Brief description of the project scope…" />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="proj-start" className={LABEL_CLS}>Start Date</label>
                  <input id="proj-start" type="date" className={INPUT_CLS} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </div>
                <div>
                  <label htmlFor="proj-end" className={LABEL_CLS}>End Date</label>
                  <input
                    id="proj-end"
                    type="date"
                    className={INPUT_CLS}
                    value={expectedEndDate}
                    min={startDate || undefined}
                    onChange={(e) => setExpectedEndDate(e.target.value)}
                    aria-invalid={endBeforeStart}
                  />
                  {endBeforeStart && (
                    <p className="mt-1 text-xs text-red-600">End Date cannot be before Start Date.</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <UserCombobox
                  users={users}
                  value={reportsToId}
                  onChange={setReportsToId}
                  label="PM Reports To"
                  required
                  excludeIds={reportsToExclude}
                />
                <UserCombobox
                  users={users}
                  value={secondaryEvaluatorId}
                  onChange={setSecondaryEvaluatorId}
                  label="Secondary Evaluator"
                  placeholder="Optional — can be added later"
                  excludeIds={secondaryExclude}
                />
              </div>

              {/* ── Team Members ───────────────────────────────── */}
              <div className="border-t border-border pt-5 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-text-main uppercase tracking-wide">
                    Team Members
                  </p>
                  <button type="button" onClick={addDraftAssignment} className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                    <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add Member
                  </button>
                </div>

                {/* Existing Assignments (Edit Mode) */}
                {existingAssignments.map((a) => (
                  <div key={a.id} className="flex items-center gap-3 rounded-lg border border-border bg-slate-50 px-3 py-2">
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-text-main">{a.user_name}</span>
                      {a.assignment_role && <span className="ml-2 text-xs text-text-muted">({a.assignment_role})</span>}
                    </div>
                    {a.department_name && (
                      <span className="text-xs text-text-muted shrink-0">{a.department_name}</span>
                    )}
                    {a.evaluator_type === "Primary" && (
                      <span className="rounded-full bg-brand-light px-2 py-0.5 text-xs font-medium text-brand shrink-0">PM</span>
                    )}
                    {a.assigned_date && (
                      <span className="text-xs text-text-muted shrink-0">Joined: {a.assigned_date}</span>
                    )}
                    <button type="button" onClick={() => removeExisting(a.id)} className="shrink-0 rounded-md p-1 text-text-muted hover:bg-red-50 hover:text-red-600 transition-colors" aria-label={`Remove ${a.user_name}`}>
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}

                {/* Draft Assignments */}
                {draftAssignments.map((draft) => {
                  const pmDisabled =
                    !draft.is_pm && (!!existingPrimary || !draft.user_id);
                  const pmDisabledReason = !draft.is_pm
                    ? existingPrimary
                      ? `PM already set: ${existingPrimary.user_name}. Remove that member first.`
                      : !draft.user_id
                        ? "Pick an employee first."
                        : null
                    : null;
                  return (
                  <div key={draft.tempId} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="grid grid-cols-12 gap-2 items-end">
                      {/* Employee — 4 cols */}
                      <div className="col-span-4">
                        <label className={LABEL_CLS}>Employee</label>
                        <select
                          className={INPUT_CLS}
                          value={draft.user_id}
                          onChange={(e) => handleUserSelect(draft.tempId, e.target.value)}
                        >
                          <option value="">Select…</option>
                          {users
                            .filter((u) => !assignedUserIds.has(u.id) || String(u.id) === draft.user_id)
                            .map((u) => (
                              <option key={u.id} value={u.id}>{u.full_name}</option>
                            ))}
                        </select>
                      </div>

                      {/* Role (auto-filled from designation) — 3 cols */}
                      <div className="col-span-3">
                        <label className={LABEL_CLS}>Role (Designation)</label>
                        <select
                          className={INPUT_CLS}
                          value={draft.assignment_role}
                          onChange={(e) => updateDraft(draft.tempId, "assignment_role", e.target.value)}
                        >
                          <option value="">— Select —</option>
                          {designations.map((d) => (
                            <option key={d.id} value={d.name}>{d.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* Department — 2 cols */}
                      <div className="col-span-2">
                        <label className={LABEL_CLS}>Department</label>
                        <select
                          className={INPUT_CLS}
                          value={draft.department_id}
                          onChange={(e) => updateDraft(draft.tempId, "department_id", e.target.value)}
                        >
                          <option value="">— Select —</option>
                          {departments.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </div>

                      {/* PM checkbox — 2 cols. Exactly one member can be PM. */}
                      <div className="col-span-2">
                        <label className={LABEL_CLS}>PM</label>
                        <label
                          className={`flex h-9 items-center gap-2 rounded-lg border px-2.5 text-sm ${
                            pmDisabled
                              ? "border-border bg-slate-50 text-text-muted cursor-not-allowed"
                              : draft.is_pm
                                ? "border-brand bg-brand-light text-brand cursor-pointer"
                                : "border-border bg-white text-text-main cursor-pointer hover:bg-slate-50"
                          }`}
                          title={pmDisabledReason ?? undefined}
                        >
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-brand"
                            checked={draft.is_pm}
                            disabled={pmDisabled}
                            onChange={() => toggleDraftPm(draft.tempId)}
                          />
                          <span>is PM</span>
                        </label>
                      </div>

                      {/* Remove — 1 col */}
                      <div className="col-span-1 flex justify-center pb-1">
                        <button type="button" onClick={() => removeDraft(draft.tempId)} className="rounded-md p-1.5 text-text-muted hover:bg-red-50 hover:text-red-600 transition-colors" aria-label="Remove member">
                          <X className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                    </div>

                    {/* Assigned Date — below the row */}
                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-3">
                        <label className={LABEL_CLS}>Joined Date</label>
                        <input
                          type="date"
                          className={INPUT_CLS}
                          value={draft.assigned_date}
                          onChange={(e) => updateDraft(draft.tempId, "assigned_date", e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                  );
                })}

                {existingAssignments.length === 0 && draftAssignments.length === 0 && (
                  <p className="text-xs text-text-muted italic text-center py-3">
                    No team members added yet. Click "Add Member" above.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4 shrink-0">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {isSaving ? "Saving…" : isEditing ? "Save Changes" : "Create Project"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}