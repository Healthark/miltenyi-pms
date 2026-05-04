import { createContext } from "react";

export type SnackbarVariant = "error" | "warn";

export interface SnackbarContextValue {
  error: (message: string) => void;
  warn: (message: string) => void;
  dismiss: (id: number) => void;
}

// Undefined sentinel forces consumers through the useSnackbar hook, which
// throws a clear dev-time error if used outside the Provider.
export const SnackbarContext = createContext<SnackbarContextValue | undefined>(
  undefined,
);
