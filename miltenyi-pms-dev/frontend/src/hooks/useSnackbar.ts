import { useContext } from "react";
import { SnackbarContext } from "../contexts/SnackbarContext";

/**
 * Top-right persistent feedback for errors and warnings.
 *
 *   const snackbar = useSnackbar();
 *   snackbar.error("Couldn't save — network error");
 *   snackbar.warn("Session expires in 5 minutes");
 *
 * Snackbars stack so a cascade of failures doesn't silently overwrite each
 * other. Use `useToast()` for positive / transient feedback.
 */
export function useSnackbar() {
  const ctx = useContext(SnackbarContext);
  if (!ctx) {
    throw new Error("useSnackbar must be used within a <SnackbarProvider>");
  }
  return ctx;
}
