import { createContext } from "react";

export type ToastVariant = "success" | "info";

export interface ToastContextValue {
  success: (message: string) => void;
  info: (message: string) => void;
  dismiss: () => void;
}

// Undefined sentinel forces consumers through the useToast hook, which throws
// a clear dev-time error if used outside the Provider.
export const ToastContext = createContext<ToastContextValue | undefined>(
  undefined,
);
