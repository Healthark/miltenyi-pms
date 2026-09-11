import { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, Unlock, X } from "lucide-react";
import { quarterDisplay, type UnlockPayload } from "@/services/project-goals.service";
import { BTN_GHOST, BTN_WARN, TEXTAREA_CLS, NOTE_MAX } from "@/components/project-goals/ui";

interface UnlockModalProps {
  readonly target: UnlockPayload["target"];
  /** The quarter whose review is unlocked (target "review"). */
  readonly cycleLabel?: string | null;
  readonly ownerName: string;
  readonly onClose: () => void;
  readonly onConfirm: (payload: UnlockPayload) => Promise<void>;
  readonly isSaving: boolean;
  readonly error: string;
}

/** Admin only. A reason is required and is written to the change log. */
export function UnlockModal({ target, cycleLabel, ownerName, onClose, onConfirm, isSaving, error }: UnlockModalProps) {
  const [reason, setReason] = useState("");
  const what = target === "goals" ? "goals" : `${quarterDisplay(cycleLabel)} review`;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-text-main">Unlock {what}</h2>
            <p className="mt-0.5 text-xs text-text-muted">{ownerName}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3 px-6 py-5 text-sm text-text-main">
          {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
          <p>
            {target === "goals"
              ? "The set goes back to Draft so the staff member can edit the Goal column. The approval record is cleared. This is refused once any quarter's self-review or review has been submitted."
              : "The review goes back to draft so the mentor can correct it. The staff member's acknowledgement for this quarter is cleared; their self-review is kept."}{" "}
            The reason is logged and both the staff member and the mentor are notified.
          </p>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-text-main">Reason *</span>
            <textarea rows={3} maxLength={NOTE_MAX} className={TEXTAREA_CLS} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this being unlocked?" />
          </label>
        </div>
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button type="button" onClick={onClose} className={BTN_GHOST}>Cancel</button>
          <button
            type="button"
            disabled={reason.trim().length < 3 || isSaving}
            onClick={() => onConfirm({ target, cycle_label: target === "review" ? cycleLabel ?? null : null, reason: reason.trim() })}
            className={BTN_WARN}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlock className="h-4 w-4" />}
            Unlock {target === "goals" ? "goals" : "review"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
