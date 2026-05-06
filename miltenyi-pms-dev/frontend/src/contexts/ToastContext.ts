import { createContext } from "react";

export type ToastVariant = "success" | "info";

/** Inline action shown next to a toast message (e.g. "Undo"). Clicking it
 *  fires `onClick` and immediately dismisses the toast. */
export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** Optional inline action button (e.g. Undo). */
  action?: ToastAction;
  /** Override the default 3s auto-dismiss. Use 6000 for undo flows. */
  durationMs?: number;
}

export interface ToastContextValue {
  success: (message: string, options?: ToastOptions) => void;
  info: (message: string, options?: ToastOptions) => void;
  dismiss: () => void;
}

// Undefined sentinel forces consumers through the useToast hook, which throws
// a clear dev-time error if used outside the Provider.
export const ToastContext = createContext<ToastContextValue | undefined>(
  undefined,
);
