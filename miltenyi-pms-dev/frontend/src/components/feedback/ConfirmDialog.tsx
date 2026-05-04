import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle } from "lucide-react";
import type { ConfirmVariant } from "../../contexts/ConfirmContext";

interface ConfirmDialogProps {
  readonly title: string;
  readonly message: string;
  readonly variant: ConfirmVariant;
  readonly confirmText: string;
  readonly cancelText: string;
  readonly onConfirm: () => void;
  readonly onCancel: () => void;
}

const CONFIRM_BUTTON_STYLES: Record<ConfirmVariant, string> = {
  default: "bg-brand text-white hover:opacity-90",
  danger: "bg-red-600 text-white hover:bg-red-700",
  warning: "bg-amber-600 text-white hover:bg-amber-700",
};

const ICON_STYLES: Record<ConfirmVariant, string> = {
  default: "text-brand bg-brand/10",
  danger: "text-red-600 bg-red-50",
  warning: "text-amber-600 bg-amber-50",
};

/**
 * Generic confirmation modal. Keyboard: Esc cancels, Enter confirms. The
 * confirm button is auto-focused on open so keyboard-first users can
 * immediately dismiss or confirm without Tab-ing.
 */
export function ConfirmDialog({
  title,
  message,
  variant,
  confirmText,
  cancelText,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const confirmBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    confirmBtnRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [onCancel, onConfirm]);

  return createPortal(
    <div
      className="fixed inset-0 z-70 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={(e) => {
        // Backdrop click = cancel. Inner clicks are stopped below.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="w-full max-w-sm rounded-xl bg-surface p-6 shadow-xl">
        <div className="flex items-start gap-3">
          {variant !== "default" && (
            <div className={`rounded-lg p-2 ${ICON_STYLES[variant]}`}>
              <AlertTriangle className="h-5 w-5" aria-hidden="true" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h2
              id="confirm-dialog-title"
              className="font-display text-base font-semibold text-text-main"
            >
              {title}
            </h2>
            <p className="mt-2 text-sm text-text-muted">{message}</p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
          >
            {cancelText}
          </button>
          <button
            ref={confirmBtnRef}
            type="button"
            onClick={onConfirm}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition-opacity ${CONFIRM_BUTTON_STYLES[variant]}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
