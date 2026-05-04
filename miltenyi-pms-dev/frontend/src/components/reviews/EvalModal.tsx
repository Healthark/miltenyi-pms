/**
 * EvalModal — centered-overlay shell for the mentor's annual evaluation
 * form. Used by `/annual-reviews` Team Review tab where there's no
 * companion content to read alongside.
 *
 * The form body is in `EvalForm` so it can also be reused by the
 * right-anchored `EvalDrawer` (Annual Summary tab on a mentee's profile).
 *
 * Mounted conditionally by the parent (`{target && <EvalModal review={target} … />}`).
 */

import { createPortal } from "react-dom";
import { EvalForm, type EvalFormProps } from "./EvalForm";

export function EvalModal(props: EvalFormProps) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="w-full max-w-2xl rounded-xl bg-surface shadow-xl max-h-[90vh] flex flex-col">
        <EvalForm {...props} />
      </div>
    </div>,
    document.body,
  );
}
