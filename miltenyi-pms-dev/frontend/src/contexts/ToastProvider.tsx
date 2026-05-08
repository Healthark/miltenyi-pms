import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  ToastContext, type ToastAction, type ToastContextValue,
  type ToastOptions, type ToastVariant,
} from "@/contexts/ToastContext";
import { Toast } from "@/components/feedback/Toast";

const AUTO_DISMISS_MS = 3000;

interface ToastState {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
}

interface ToastProviderProps {
  readonly children: ReactNode;
}

/**
 * Manages a single toast at a time (replace policy). Any new call dismisses
 * the previous toast immediately and resets the auto-dismiss timer. Good for
 * positive feedback where only the latest event matters. Use SnackbarProvider
 * for errors/warnings that need to stack.
 */
export function ToastProvider({ children }: ToastProviderProps) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<number | null>(null);
  const seqRef = useRef(0);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      globalThis.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    clearTimer();
    setToast(null);
  }, [clearTimer]);

  const show = useCallback(
    (message: string, variant: ToastVariant, options?: ToastOptions) => {
      clearTimer();
      seqRef.current += 1;
      setToast({ id: seqRef.current, message, variant, action: options?.action });
      timerRef.current = globalThis.setTimeout(() => {
        setToast(null);
        timerRef.current = null;
      }, options?.durationMs ?? AUTO_DISMISS_MS);
    },
    [clearTimer],
  );

  useEffect(() => clearTimer, [clearTimer]);

  // Wraps an action's onClick so clicking it also dismisses the toast.
  // Defined here (not inside Toast) so the timer is cleared cleanly.
  const wrapAction = useCallback(
    (action: ToastAction | undefined): ToastAction | undefined =>
      action
        ? {
            label: action.label,
            onClick: () => {
              action.onClick();
              dismiss();
            },
          }
        : undefined,
    [dismiss],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (message, options) => show(message, "success", options),
      info: (message, options) => show(message, "info", options),
      dismiss,
    }),
    [show, dismiss],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast &&
        createPortal(
          <div
            className="pointer-events-none fixed inset-x-0 top-4 z-[60] flex justify-center px-4"
            aria-live="polite"
          >
            <Toast
              key={toast.id}
              message={toast.message}
              variant={toast.variant}
              action={wrapAction(toast.action)}
              onDismiss={dismiss}
            />
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
