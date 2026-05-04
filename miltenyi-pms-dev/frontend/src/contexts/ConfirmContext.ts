import { createContext } from "react";

export type ConfirmVariant = "default" | "danger" | "warning";

export interface ConfirmOptions {
  title: string;
  message: string;
  variant?: ConfirmVariant;
  confirmText?: string;
  cancelText?: string;
}

export interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

// Undefined sentinel forces consumers through the useConfirm hook, which
// throws a clear dev-time error if used outside the Provider.
export const ConfirmContext = createContext<ConfirmContextValue | undefined>(
  undefined,
);
