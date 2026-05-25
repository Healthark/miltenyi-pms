/**
 * RoleExpectationsModal — read-only modal showing the current user's
 * GCC role expectations across all six competencies.
 *
 * Opened from a button on the Annual Goals → My Goals tab. Stays
 * dismiss-able via Esc / X / backdrop. The parent owns the open
 * state and the data (the modal is conditionally mounted only when
 * both are ready).
 */

import { createPortal } from "react-dom";
import { BookOpen, X } from "lucide-react";
import type { UserRoleExpectation } from "@/services/profile.service";
import { useEffect } from "react";
import { GCC_COMPETENCIES } from "@/constants/gccFramework";

interface RoleExpectationsModalProps {
  readonly expectation: UserRoleExpectation;
  readonly onClose: () => void;
}

export function RoleExpectationsModal({
  expectation,
  onClose,
}: RoleExpectationsModalProps) {
  // Esc-to-close. The backdrop and the X button handle the other paths.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="role-exp-modal-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl rounded-xl bg-surface shadow-xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
              <BookOpen className="h-4 w-4 text-blue-600" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="role-exp-modal-title"
                className="font-display text-base font-semibold text-text-main"
              >
                Your Role Expectations
              </h2>
              <p className="mt-0.5 text-xs text-text-muted">
                {expectation.function_name ?? "—"} ·{" "}
                {expectation.designation_name ?? "—"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body — scrollable grid of all eight competencies. Two columns
            on md+ screens so a reader can scan related competencies side
            by side; single column below md so paragraph-length text
            stays readable on narrow viewports. Each cell is a self-
            contained card with the numbered badge sitting in its own
            column to keep the title and body aligned even when the
            role's expectation is a multi-sentence paragraph. */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <ol className="grid grid-cols-1 gap-x-6 gap-y-5 md:grid-cols-2">
            {GCC_COMPETENCIES.map(({ expKey, label }, idx) => {
              // UserRoleExpectation shares its exp_* field shape with
              // the RoleExpectation type that backs GCC_COMPETENCIES, so
              // we can index it with expKey directly.
              const text = (expectation as Record<string, string | null | number | undefined>)[expKey];
              if (!text || typeof text !== "string") return null;
              return (
                <li
                  key={expKey}
                  className="rounded-lg border border-border/60 bg-slate-50/40 p-4"
                >
                  <div className="flex items-start gap-3">
                    {/* Numbered badge — subtle blue to echo the
                        BookOpen accent in the header without competing
                        with it. shrink-0 prevents the badge from
                        squishing when the title wraps. */}
                    <span
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-[12px] font-bold text-blue-700"
                      aria-hidden="true"
                    >
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className="text-[12px] font-semibold text-text-main leading-snug">
                        {label}
                      </h3>
                      <p className="mt-1 text-[11px] text-text-muted whitespace-pre-wrap leading-snug">
                        {/* The backend serialises bullet-style content
                            with " | " separators; render them as a
                            real bulleted list. Paragraph-style content
                            passes through unchanged. */}
                        {text.replace(/ \| /g, "\n• ")}
                      </p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        {/* Footer — single Close action so the dismiss target is obvious. */}
        <div className="flex justify-end border-t border-border px-6 py-3 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
