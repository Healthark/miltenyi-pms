import { useState } from "react";
import { BookOpen, ChevronDown, ChevronUp } from "lucide-react";

/**
 * Inline collapsible "View Role Expectations" snippet used inside the
 * My Reviews competency cards. The displayed text comes from the
 * RoleExpectation row's exp_* column for the matching competency; the
 * caller is expected to have pre-resolved the column.
 */
export function ExpectationToggle({
  text,
}: {
  readonly text: string | null | undefined;
}) {
  const [open, setOpen] = useState(false);
  if (!text) return null;

  return (
    <div className="mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 transition-colors"
      >
        <BookOpen className="h-3 w-3" aria-hidden="true" />
        {open ? "Hide" : "View"} Role Expectations
        {open ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
      </button>
      {open && (
        <div className="mt-1.5 rounded-md bg-blue-50 border border-blue-100 px-3 py-2">
          <p className="text-xs text-blue-800 whitespace-pre-wrap leading-relaxed">
            {text.replace(/ \| /g, "\n• ")}
          </p>
        </div>
      )}
    </div>
  );
}
