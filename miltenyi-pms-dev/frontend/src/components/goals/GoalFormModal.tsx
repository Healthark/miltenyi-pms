/**
 * GoalFormModal.tsx — Create or edit a goal.
 *
 * The form collects the parent objective (title, description, dates,
 * attachment) and, in edit mode for approved goals, optional progress
 * notes for the mentor. The per-criterion checklist that used to live
 * under each goal was retired — progress through the cycle is now
 * tracked via the H1/H2 self + mentor review flow.
 *
 * Placement: src/components/goals/GoalFormModal.tsx
 */

import { useState } from "react";
import { createPortal } from "react-dom";
import type {
  Goal,
  GoalCreatePayload,
  GoalUpdatePayload,
} from "@/services/goal.service";
import { isPostApproved } from "@/utils/goalStatus";

interface GoalFormModalProps {
  readonly onClose: () => void;
  readonly onSave: (
    payload: GoalCreatePayload | GoalUpdatePayload,
  ) => Promise<void>;
  readonly editingGoal: Goal | null;
  readonly isSaving: boolean;
  readonly error: string;
}

interface FormState {
  title: string;
  description: string;
  attachment_url: string;
  start_date: string;
  due_date: string;
  progress_notes: string;
}

const EMPTY: FormState = {
  title: "",
  description: "",
  attachment_url: "",
  start_date: "",
  due_date: "",
  progress_notes: "",
};

function toDateInput(iso: string | null | undefined): string {
  if (!iso) return "";
  return iso.slice(0, 10);
}

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-text-muted mb-1";

// Backend caps — keep in sync with backend/app/schemas/goal_schemas.py.
const MAX_TITLE_LENGTH = 500;
const MAX_DESC_LENGTH = 5000;
const MAX_NOTES_LENGTH = 5000;

/**
 * The parent conditionally mounts this component
 * (`{showModal && <GoalFormModal …>}`) so each open is a fresh React
 * mount; useState initializers run with the current `editingGoal`,
 * no useEffect needed to reset the form.
 */
export function GoalFormModal({
  onClose,
  onSave,
  editingGoal,
  isSaving,
  error,
}: GoalFormModalProps) {
  const isEditing = editingGoal !== null;
  const isApproved = editingGoal
    ? isPostApproved(editingGoal.approval_status)
    : false;

  const [form, setForm] = useState<FormState>(() =>
    editingGoal
      ? {
          title: editingGoal.title,
          description: editingGoal.description ?? "",
          attachment_url: editingGoal.attachment_url ?? "",
          start_date: toDateInput(editingGoal.start_date),
          due_date: toDateInput(editingGoal.due_date),
          progress_notes: editingGoal.progress_notes ?? "",
        }
      : EMPTY,
  );

  const set = (field: keyof FormState, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // ── Submit ────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (isEditing) {
      await onSave({
        title: form.title || undefined,
        description: form.description || null,
        attachment_url: form.attachment_url || null,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
        progress_notes: form.progress_notes || null,
      } satisfies GoalUpdatePayload);
    } else {
      await onSave({
        title: form.title,
        description: form.description || null,
        attachment_url: form.attachment_url || null,
        start_date: form.start_date || null,
        due_date: form.due_date || null,
      } satisfies GoalCreatePayload);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="goal-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl bg-surface shadow-xl">
        {/* Header */}
        <div className="border-b border-border px-6 py-4">
          <h2
            id="goal-modal-title"
            className="font-display text-base font-semibold text-text-main"
          >
            {isEditing ? "Edit Goal" : "Add New Goal"}
          </h2>
          {isApproved && (
            <p className="mt-0.5 text-xs text-text-muted">
              This goal is approved — you can update progress and add notes.
            </p>
          )}
        </div>

        {/* Body */}
        <div className="max-h-[70vh] overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </p>
          )}

          {/* Title */}
          <div>
            <label htmlFor="goal-title" className={LABEL_CLS}>
              Goal Title *
            </label>
            <input
              id="goal-title"
              className={INPUT_CLS}
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="e.g. Complete onboarding certification"
              maxLength={MAX_TITLE_LENGTH}
            />
          </div>

          {/* Description */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="goal-desc" className="text-xs font-medium text-text-muted">
                Goal Description *
              </label>
              <span
                className={`text-[10px] tabular-nums ${
                  form.description.length > MAX_DESC_LENGTH
                    ? "text-red-600 font-semibold"
                    : "text-text-muted"
                }`}
              >
                {form.description.length}/{MAX_DESC_LENGTH}
              </span>
            </div>
            <textarea
              id="goal-desc"
              rows={3}
              className={`${INPUT_CLS} resize-none`}
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="What does success look like?"
              maxLength={MAX_DESC_LENGTH}
            />
          </div>

          {/* Attachment URL */}
          <div>
            <div className="flex items-center gap-1.5 mb-1">
              <label htmlFor="goal-attachment" className={LABEL_CLS + " mb-0"}>
                Attachment (URL){" "}
                <span className="font-normal text-text-muted text-xs">(Optional)</span>
              </label>
              <div className="relative group">
                <span className="flex items-center justify-center w-4 h-4 rounded-full bg-slate-200 text-slate-500 text-[10px] font-bold cursor-default select-none">
                  i
                </span>
                <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-64 rounded-lg bg-slate-800 px-3 py-2 text-xs text-white shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                  Create a folder in Google Drive named after your goal, then
                  paste the folder link here as the attachment URL.
                  <span className="absolute left-1/2 -translate-x-1/2 top-full border-4 border-transparent border-t-slate-800" />
                </div>
              </div>
            </div>
            <input
              id="goal-attachment"
              type="url"
              className={INPUT_CLS}
              value={form.attachment_url}
              onChange={(e) => set("attachment_url", e.target.value)}
              placeholder="https://drive.google.com/drive/folders/..."
            />
          </div>

          {/* Progress notes — only shown when editing an approved goal */}
          {isEditing && isApproved && (
            <div className="rounded-lg border border-brand/20 bg-brand-light/30 p-4 space-y-2">
              <label
                htmlFor="goal-notes"
                className="block text-xs font-semibold text-brand"
              >
                Progress Notes
              </label>
              <p className="text-xs text-text-muted">
                Log completed steps, links, or proof of work. Visible to your
                mentor.
              </p>
              <textarea
                id="goal-notes"
                rows={4}
                className={`${INPUT_CLS} resize-none`}
                value={form.progress_notes}
                onChange={(e) => set("progress_notes", e.target.value)}
                placeholder='e.g. "Completed module 3 on April 9th. Certificate attached in Drive."'
                maxLength={MAX_NOTES_LENGTH}
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving || !form.title.trim() || !form.description.trim()}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSaving ? "Saving…" : isEditing ? "Save Changes" : "Add Goal"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
