/**
 * ProjectModal.tsx — Create/Edit Project with Team Assignments.
 *
 * The PM is a project-level field (combobox at the top), filtered to users
 * with role=PM. The Secondary Evaluator is also a project-level combobox
 * (filtered to non-PM, non-Mentor). Team Members are Staff users only —
 * the PM is NOT in the assignments list.
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
} from "@/services/project.service";
import {
  adminService,
  type UserResponse,
  type FunctionBrief,
  type DesignationBrief,
} from "@/services/admin.service";
import { getErrorMessage } from "@/utils/errors";
import { useToast } from "@/hooks/useToast";
import { useSnackbar } from "@/hooks/useSnackbar";
import { useConfirm } from "@/hooks/useConfirm";
import { UserCombobox } from "@/components/common/UserCombobox";

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
  function_id: string;
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
  const [pmId, setPmId] = useState<number | null>(null);
  const [secondaryEvaluatorId, setSecondaryEvaluatorId] = useState<number | null>(null);
  // Display names captured from /projects/{id}. Used to build a stub
  // user entry for the combobox when the saved PM or Secondary isn't
  // in the parent's `users` list (e.g. they belong to a different org,
  // or were hard-deleted from the directory after being assigned).
  const [pmDisplayName, setPmDisplayName] = useState<string | null>(null);
  const [secondaryDisplayName, setSecondaryDisplayName] = useState<string | null>(null);

  // ── Reference Data ──────────────────────────────────────────────
  const [functions, setFunctions] = useState<FunctionBrief[]>([]);
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
  const confirm = useConfirm();

  // Pre-bucket users by role for dropdown filtering. Active users only.
  const activeUsers = users.filter((u) => !u.is_deleted);
  const pmCandidates = activeUsers.filter((u) => u.role === "PM");
  const secondaryCandidates = activeUsers.filter(
    (u) => u.role !== "PM" && u.role !== "Mentor",
  );
  const memberCandidates = activeUsers.filter((u) => u.role === "Staff");

  // The combobox uses its `users` prop both for the suggestion list and
  // for resolving the currently-selected id back to a label. If the
  // project's saved PM/Secondary isn't in the role-filtered pool above
  // (deactivated, role changed) OR isn't in the parent's `users` list
  // at all (e.g. cross-org Miltenyi PM that the current HR can't see
  // in the directory), the field renders blank even though the id is
  // set. We synthesize a stub UserResponse from `pm_name` /
  // `secondary_evaluator_name` (returned by /projects/{id}) so the
  // combobox can always show the current value.
  const stubUser = (
    id: number,
    fullName: string,
    role: string,
  ): UserResponse => ({
    id,
    org_id: 0,
    employee_code: "",
    full_name: fullName,
    email: "",
    phone: null,
    role,
    function_id: null,
    designation_id: null,
    mentor_id: null,
    is_deleted: false,
    created_at: "",
    function: null,
    designation: null,
  });
  const augmentWithCurrent = (
    pool: UserResponse[],
    currentId: number | null,
    displayName: string | null,
    fallbackRole: string,
  ): UserResponse[] => {
    if (currentId === null) return pool;
    if (pool.some((u) => u.id === currentId)) return pool;
    const fromDirectory = users.find((u) => u.id === currentId);
    if (fromDirectory) return [...pool, fromDirectory];
    if (displayName) return [...pool, stubUser(currentId, displayName, fallbackRole)];
    return pool;
  };
  const pmComboboxUsers = augmentWithCurrent(
    pmCandidates,
    pmId,
    pmDisplayName,
    "PM",
  );
  const secondaryComboboxUsers = augmentWithCurrent(
    secondaryCandidates,
    secondaryEvaluatorId,
    secondaryDisplayName,
    "Staff",
  );

  // ── Load reference data + existing project ──────────────────────
  useEffect(() => {
    const loadRefs = async () => {
      try {
        const [funcData, desigData] = await Promise.all([
          adminService.getFunctions(),
          adminService.getDesignations(),
        ]);
        setFunctions(funcData);
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
        setPmId(detail.pm_id ?? null);
        setSecondaryEvaluatorId(detail.secondary_evaluator_id ?? null);
        setPmDisplayName(detail.pm_name ?? null);
        setSecondaryDisplayName(detail.secondary_evaluator_name ?? null);
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
        function_id: "",
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

  /** Auto-fill role and function when user is selected */
  const handleUserSelect = (draftId: string, userId: string) => {
    updateDraft(draftId, "user_id", userId);
    if (!userId) return;

    const selectedUser = users.find((u) => u.id === Number(userId));
    if (!selectedUser) return;

    if (selectedUser.function_id) {
      updateDraft(draftId, "function_id", selectedUser.function_id.toString());
    }
    if (selectedUser.designation) {
      updateDraft(draftId, "assignment_role", selectedUser.designation.name);
    }
  };

  const removeDraft = (id: string) => {
    setDraftAssignments((prev) => prev.filter((a) => a.tempId !== id));
  };

  const removeExisting = async (assignment: AssignmentResponse) => {
    const ok = await confirm({
      title: "End this assignment?",
      message:
        `Remove ${assignment.user_name} from the project. ` +
        "Their existing reviews stay in their history; future cycles " +
        "won't generate new pending reviews for them on this project. " +
        "You'll have a few seconds to undo from the toast.",
      variant: "danger",
      confirmText: "End Assignment",
    });
    if (!ok) return;

    // Optimistically reflect the soft-end. The toast that pops next
    // gives a 6s Undo window backed by the /restore endpoint — clicking
    // Undo flips the row back to active. Doing the optimistic update
    // here (before the network call) keeps the UI feeling snappy.
    const todayIso = new Date().toISOString().slice(0, 10);
    const previousState = assignment;
    setExistingAssignments((prev) =>
      prev.map((a) =>
        a.id === assignment.id
          ? { ...a, end_date: todayIso }
          : a,
      ),
    );

    try {
      await projectService.endAssignment(assignment.id);
    } catch (err: unknown) {
      // Roll back the optimistic update on failure.
      setExistingAssignments((prev) =>
        prev.map((a) => (a.id === assignment.id ? previousState : a)),
      );
      snackbar.error(getErrorMessage(err));
      return;
    }

    toast.success(`Removed ${assignment.user_name} from the project.`, {
      durationMs: 6000,
      action: {
        label: "Undo",
        onClick: async () => {
          try {
            const restored = await projectService.restoreAssignment(assignment.id);
            setExistingAssignments((prev) =>
              prev.map((a) => (a.id === assignment.id ? restored : a)),
            );
          } catch (err: unknown) {
            snackbar.error(getErrorMessage(err));
          }
        },
      },
    });
  };

  // ── Computed ────────────────────────────────────────────────────
  // Only ACTIVE assignments block re-adding a user — end-dated ones
  // are historical and the same user is allowed to rejoin (soft-end
  // → fresh active row).
  const assignedUserIds = new Set([
    ...existingAssignments.filter((a) => !a.end_date).map((a) => a.user_id),
    ...draftAssignments.filter((a) => a.user_id).map((a) => Number(a.user_id)),
  ]);

  // Validation requirements:
  //   - pm_id is set
  //   - pm_id !== secondary_evaluator_id
  //   - pm_id is not in any assignment row (PMs aren't members)
  //   - expected_end_date >= start_date when both set
  const pmInAssignments =
    pmId !== null &&
    (existingAssignments.some((a) => a.user_id === pmId) ||
      draftAssignments.some((a) => a.user_id && Number(a.user_id) === pmId));
  const secondaryConflictWithPm =
    pmId !== null && secondaryEvaluatorId === pmId;
  const endBeforeStart =
    !!startDate && !!expectedEndDate && expectedEndDate < startDate;

  const validationError =
    !projectCode.trim()
      ? "Project Code is required."
      : !name.trim()
        ? "Project Name is required."
        : endBeforeStart
          ? "End Date cannot be before Start Date."
          : pmId === null
            ? "PM is required — pick the Miltenyi project manager who reviews the team."
            : secondaryConflictWithPm
              ? "Secondary Evaluator must be a different user than the PM."
              : pmInAssignments
                ? "The PM cannot also appear in the team members list. Remove them from members."
                : null;

  // Dropdown exclusion: secondary cannot be the PM
  const secondaryExclude: number[] = [];
  if (pmId !== null) secondaryExclude.push(pmId);

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
          pm_id: pmId,
          secondary_evaluator_id: secondaryEvaluatorId,
        });

        for (const draft of draftAssignments) {
          if (!draft.user_id) continue;
          await projectService.addAssignment(projectId, {
            user_id: Number(draft.user_id),
            assignment_role: draft.assignment_role || null,
            function_id: draft.function_id ? Number(draft.function_id) : null,
            assigned_date: draft.assigned_date || null,
          });
        }
      } else {
        const assignments: AssignmentCreatePayload[] = draftAssignments
          .filter((a) => a.user_id)
          .map((a) => ({
            user_id: Number(a.user_id),
            assignment_role: a.assignment_role || null,
            function_id: a.function_id ? Number(a.function_id) : null,
            assigned_date: a.assigned_date || null,
          }));

        // pm_id is required by backend; validation above guarantees non-null here.
        await projectService.createProject({
          project_code: projectCode,
          name,
          description: description || null,
          start_date: startDate || null,
          expected_end_date: expectedEndDate || null,
          pm_id: pmId as number,
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

              {/* PM and Secondary Evaluator — both project-level fields */}
              <div className="grid grid-cols-2 gap-4">
                <UserCombobox
                  users={pmComboboxUsers}
                  value={pmId}
                  onChange={setPmId}
                  label="Project Manager (Miltenyi)"
                  required
                  placeholder={pmCandidates.length === 0 ? "No PM users in directory" : "Select a PM"}
                />
                <UserCombobox
                  users={secondaryComboboxUsers}
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
                    Team Members (Staff)
                  </p>
                  <button type="button" onClick={addDraftAssignment} className="flex items-center gap-1 text-xs font-medium text-brand hover:underline">
                    <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
                    Add Member
                  </button>
                </div>

                {/* Existing Assignments (Edit Mode).
                    Active rows first, then ended ones (most recently ended on top)
                    rendered greyed-out as historical context. */}
                {[...existingAssignments]
                  .sort((a, b) => {
                    const aEnded = a.end_date != null;
                    const bEnded = b.end_date != null;
                    if (aEnded !== bEnded) return aEnded ? 1 : -1;
                    if (!aEnded) return 0;
                    return (b.end_date ?? "").localeCompare(a.end_date ?? "");
                  })
                  .map((a) => {
                    const isEnded = a.end_date != null;
                    return (
                      <div
                        key={a.id}
                        className={
                          isEnded
                            ? "flex items-center gap-3 rounded-lg border border-dashed border-border bg-slate-100/60 px-3 py-2 opacity-70"
                            : "flex items-center gap-3 rounded-lg border border-border bg-slate-50 px-3 py-2"
                        }
                      >
                        <div className="flex-1 min-w-0">
                          <span className="text-sm font-medium text-text-main">{a.user_name}</span>
                          {a.assignment_role && <span className="ml-2 text-xs text-text-muted">({a.assignment_role})</span>}
                          {isEnded && (
                            <span className="ml-2 inline-flex items-center rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-700">
                              Ended {a.end_date}
                              {a.ended_by_name ? ` · by ${a.ended_by_name}` : ""}
                            </span>
                          )}
                        </div>
                        {a.function_name && (
                          <span className="text-xs text-text-muted shrink-0">{a.function_name}</span>
                        )}
                        {a.assigned_date && (
                          <span className="text-xs text-text-muted shrink-0">Joined: {a.assigned_date}</span>
                        )}
                        {!isEnded && (
                          <button
                            type="button"
                            onClick={() => removeExisting(a)}
                            className="shrink-0 rounded-md p-1 text-text-muted hover:bg-red-50 hover:text-red-600 transition-colors"
                            aria-label={`End assignment for ${a.user_name}`}
                            title="End this assignment (soft-end; history is kept)"
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    );
                  })}

                {/* Draft Assignments */}
                {draftAssignments.map((draft) => (
                  <div key={draft.tempId} className="rounded-lg border border-border p-3 space-y-2">
                    <div className="grid grid-cols-12 gap-2 items-end">
                      {/* Employee — 5 cols */}
                      <div className="col-span-5">
                        <label className={LABEL_CLS}>Employee (Staff)</label>
                        <select
                          className={INPUT_CLS}
                          value={draft.user_id}
                          onChange={(e) => handleUserSelect(draft.tempId, e.target.value)}
                        >
                          <option value="">Select…</option>
                          {memberCandidates
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

                      {/* Function — 3 cols */}
                      <div className="col-span-3">
                        <label className={LABEL_CLS}>Function</label>
                        <select
                          className={INPUT_CLS}
                          value={draft.function_id}
                          onChange={(e) => updateDraft(draft.tempId, "function_id", e.target.value)}
                        >
                          <option value="">— Select —</option>
                          {functions.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
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
                ))}

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
