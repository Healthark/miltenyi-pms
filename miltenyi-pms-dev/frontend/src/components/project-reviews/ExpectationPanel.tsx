import { useState } from "react";
import { BookOpen, ChevronDown, ChevronUp } from "lucide-react";
import type { RoleExpectation } from "@/services/project-review.service";
import type { GccCompetency } from "@/constants/gccFramework";

/**
 * Collapsible panel that surfaces the role-expectation text for one
 * GCC competency. Used inside evaluation modals so the PM can
 * cross-check against the (function, career_level) canonical
 * expectations.
 */
export function ExpectationPanel({
  expectation,
  expKey,
}: {
  readonly expectation: RoleExpectation | null;
  /** Strictly typed against the GCC framework's exp_* keys — keeps
   *  typos out at compile time. */
  readonly expKey: GccCompetency["expKey"];
}) {
  const [open, setOpen] = useState(false);
  if (!expectation) return null;
  const text = expectation[expKey];
  if (!text) return null;

  // Footer caption: prefer function + career band ("Regulatory Affairs
  // / Senior") since one row covers multiple designations now. Fall
  // back to function only when the label is missing.
  const caption = expectation.career_level_label
    ? `${expectation.function_name} / ${expectation.career_level_label}`
    : expectation.function_name;

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 transition-colors"
      >
        <BookOpen className="h-3 w-3" />
        {open ? "Hide" : "View"} Role Expectations
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
      </button>
      {open && (
        <div className="mt-1.5 rounded-md bg-blue-50 border border-blue-100 px-3 py-2">
          <p className="text-xs text-blue-800 whitespace-pre-wrap leading-relaxed">
            {text.replace(/ \| /g, "\n• ")}
          </p>
          <p className="mt-1 text-[10px] text-blue-500">{caption}</p>
        </div>
      )}
    </div>
  );
}
