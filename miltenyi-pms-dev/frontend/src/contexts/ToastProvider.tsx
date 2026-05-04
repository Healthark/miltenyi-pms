import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ToastContext, type ToastContextValue, type ToastVariant } from "./ToastContext";
import { Toast } from "../components/feedback/Toast";

const AUTO_DISMISS_MS = 3000;

interface ToastState {
  id: number;
  message: string;
  variant: ToastVariant;
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
    (message: string, variant: ToastVariant) => {
      clearTimer();
      seqRef.current += 1;
      setToast({ id: seqRef.current, message, variant });
      timerRef.current = globalThis.setTimeout(() => {
        setToast(null);
        timerRef.current = null;
      }, AUTO_DISMISS_MS);
    },
    [clearTimer],
  );

  useEffect(() => clearTimer, [clearTimer]);

  const value = useMemo<ToastContextValue>(
    () => ({
      success: (message) => show(message, "success"),
      info: (message) => show(message, "info"),
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
              onDismiss={dismiss}
            />
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
