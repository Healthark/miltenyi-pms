import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, Lock, X } from "lucide-react";
import type { ApprovePayload, GoalSet } from "@/services/project-goals.service";
import { BTN_GHOST, BTN_PRIMARY, INPUT_CLS, TEXTAREA_CLS, NOTE_MAX, todayIso } from "@/components/project-goals/ui";

interface ApproveModalProps {
  readonly set: GoalSet;
  readonly onClose: () => void;
  readonly onConfirm: (payload: ApprovePayload) => Promise<void>;
  readonly isSaving: boolean;
  readonly error: string;
}

/** "Mark approved (agreed offline)" — records who agreed the goals and when,
 *  then locks the Goal column. No comment loop. */
export function ApproveModal({ set, onClose, onConfirm, isSaving, error }: ApproveModalProps) {
  const [agreedWith, setAgreedWith] = useState(set.miltenyi_reviewer_name ?? "");
  const [agreedOn, setAgreedOn] = useState(todayIso());
  const [note, setNote] = useState("");

  useEffect(() => {
    setAgreedWith(set.miltenyi_reviewer_name ?? "");
  }, [set.id, set.miltenyi_reviewer_name]);

  const canSubmit = agreedWith.trim().length > 0 && agreedOn.length > 0 && !isSaving;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-text-main">Mark goals approved (agreed offline)</h2>
            <p className="mt-0.5 text-xs text-text-muted">{set.owner_name} · {set.period_label}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 px-6 py-5 text-sm">
          {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-text-main">Approval agreed with *</span>
              <input className={INPUT_CLS} value={agreedWith} onChange={(e) => setAgreedWith(e.target.value)} placeholder="Miltenyi reviewer" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-semibold text-text-main">Agreed on *</span>
              <input type="date" className={INPUT_CLS} value={agreedOn} onChange={(e) => setAgreedOn(e.target.value)} />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-text-main">
              Internal note <span className="font-normal text-text-muted">(mentor and HR only, optional)</span>
            </span>
            <textarea rows={2} maxLength={NOTE_MAX} className={TEXTAREA_CLS} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. confirmed by email; no wording changes" />
          </label>
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>This locks the employee's goals for {set.period_label}. Only Healthark HR can unlock them afterwards, with a logged reason.</span>
          </div>
        </div>
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button type="button" onClick={onClose} className={BTN_GHOST}>Cancel</button>
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => onConfirm({ agreed_with: agreedWith.trim(), agreed_on: agreedOn, note: note.trim() || undefined })}
            className={BTN_PRIMARY}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            Mark approved
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
