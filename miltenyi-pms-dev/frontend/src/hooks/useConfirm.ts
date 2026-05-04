import { useContext } from "react";
import { ConfirmContext } from "../contexts/ConfirmContext";

/**
 * Promise-returning confirmation dialog.
 *
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: "Delete project?",
 *     message: "This hides the project from everyone. It can be restored later.",
 *     variant: "danger",
 *     confirmText: "Delete",
 *   });
 *   if (ok) doTheThing();
 *
 * Returning a promise avoids the usual `isOpen` state / onConfirm callback
 * plumbing at every call site.
 */
export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm must be used within a <ConfirmProvider>");
  }
  return ctx.confirm;
}
