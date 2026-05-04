import { useContext } from "react";
import { ToastContext } from "../contexts/ToastContext";

/**
 * Top-center transient feedback for positive actions.
 *
 *   const toast = useToast();
 *   toast.success("User reactivated");
 *   toast.info("Link copied to clipboard");
 *
 * One toast shows at a time — a new call replaces the previous one. Use
 * `useSnackbar()` for errors / warnings that need to stack.
 */
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within a <ToastProvider>");
  }
  return ctx;
}
