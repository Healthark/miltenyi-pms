import { MessageSquare } from "lucide-react";
import type {
  ProjectReviewResponse,
  RoleExpectation,
} from "@/services/project-review.service";
import { ExpectationToggle } from "@/components/project-reviews/ExpectationToggle";
import { GCC_COMPETENCIES } from "@/constants/gccFramework";

/**
 * Renders the 6 GCC PM-evaluation competency blocks for a reviewed
 * project. Each block surfaces:
 *   - the manager's per-competency comment (the only required content)
 *   - a collapsible role-expectation snippet from the matching
 *     RoleExpectation row
 *
 * `compact` shrinks paddings/typography for use inside the table-view
 * expanded row; the grid-view detail panel uses the spacious default.
 */
export function CompetencyBlock({
  review,
  roleExp,
  compact,
}: {
  readonly review: ProjectReviewResponse;
  readonly roleExp: RoleExpectation | undefined;
  readonly compact?: boolean;
}) {
  return (
    <div className={`flex flex-col ${compact ? "gap-3" : "gap-4"}`}>
      {GCC_COMPETENCIES.map((comp, idx) => {
        const commentValue = review[comp.commentKey];
        if (!commentValue) return null;

        const expText = roleExp ? roleExp[comp.expKey] : null;

        return (
          <div
            key={comp.key}
            className={`flex flex-col gap-2 ${
              compact
                ? "rounded-lg bg-slate-50 p-3 border border-slate-100"
                : "rounded-xl bg-slate-50 p-5 border border-slate-100"
            }`}
          >
            <h3
              className={`font-bold uppercase tracking-widest text-brand ${
                compact ? "text-[12px]" : "text-[13.5px]"
              }`}
            >
              {idx + 1}. {comp.label}
            </h3>

            <ExpectationToggle text={expText} />

            <div className={compact ? "px-0.5" : "px-1 mt-1"}>
              <div className="flex items-center gap-1.5 mb-1">
                <MessageSquare className="h-3.5 w-3.5 text-brand" />
                <span className="text-[11px] font-bold uppercase tracking-wider text-brand">
                  Manager Review
                </span>
              </div>
              <p
                className={`leading-relaxed text-text-main whitespace-pre-wrap ${
                  compact ? "text-[13px]" : "text-[13.5px]"
                }`}
              >
                {commentValue}
              </p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
