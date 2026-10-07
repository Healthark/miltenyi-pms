import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

interface RequestChangesModalProps {
  readonly ownerName: string;
  readonly onSend: (feedback: string) => Promise<void>;
  readonly onClose: () => void;
  readonly isSaving: boolean;
  readonly error: string;
}

/** The mentor's "Request changes" note on a submitted annual goal. */
export function RequestChangesModal({ ownerName, onSend, onClose, isSaving, error }: RequestChangesModalProps) {
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isSaving) onClose();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [onClose, isSaving]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="request-changes-title"
    >
      <div className="w-full max-w-md rounded-xl bg-surface shadow-xl">
        <div className="border-b border-border px-6 py-4">
          <h2 id="request-changes-title" className="font-display text-base font-semibold text-text-main">
            Request changes
          </h2>
          <p className="mt-0.5 text-sm text-text-muted">
            Tell <strong>{ownerName}</strong> what to revise. The goal goes back to them to edit and submit again.
          </p>
        </div>

        <div className="space-y-3 px-6 py-5">
          {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
          <label htmlFor="request-changes-text" className="mb-1 block text-xs font-medium text-text-muted">
            Feedback *
          </label>
          <textarea
            id="request-changes-text"
            rows={5}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            placeholder="Make the second goal measurable: what result, by when."
            className="w-full resize-none rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
            maxLength={5000}
          />
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void onSend(feedback.trim())}
            disabled={isSaving || !feedback.trim()}
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-amber-600 disabled:opacity-50"
          >
            {isSaving ? "Sending…" : "Send feedback"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
