import { MessageSquare } from "lucide-react";
import type {
  ProjectReviewResponse,
  RoleExpectation,
} from "../../services/project-review.service";
import { ExpectationToggle } from "./ExpectationToggle";

/**
 * Renders the 7 PM-evaluation competency blocks for a reviewed
 * project. Each block surfaces:
 *   - the manager's per-competency comment (the only required content)
 *   - a collapsible role-expectation snippet from the matching
 *     RoleExpectation row
 *
 * `compact` shrinks paddings/typography for use inside the table-view
 * expanded row; the grid-view detail panel uses the spacious default.
 */

// Static metadata for the 7 competencies. `commentKey` and `expKey`
// are narrowed to just the `comment_*` / `exp_*` template-literal keys
// of the underlying types — that lets `review[commentKey]` resolve to
// `string | null` without a runtime cast and prevents typos like
// `comment_id` from compiling.
type CommentKey = Extract<keyof ProjectReviewResponse, `comment_${string}`>;
type ExpKey = Extract<keyof RoleExpectation, `exp_${string}`>;

export const PROJECT_COMPETENCIES: ReadonlyArray<{
  readonly key: string;
  readonly label: string;
  readonly commentKey: CommentKey;
  readonly expKey: ExpKey;
}> = [
  {
    key: "task_execution",
    label: "Task Execution & Problem Solving",
    commentKey: "comment_task_execution",
    expKey: "exp_task_execution",
  },
  {
    key: "ownership",
    label: "Ownership & Accountability",
    commentKey: "comment_ownership",
    expKey: "exp_ownership",
  },
  {
    key: "project_management",
    label: "Project Management and Risk Mitigation",
    commentKey: "comment_project_management",
    expKey: "exp_project_management",
  },
  {
    key: "client_deliverables",
    label: "Building Client-Ready Deliverables",
    commentKey: "comment_client_deliverables",
    expKey: "exp_client_deliverables",
  },
  {
    key: "communication",
    label: "Communication & Client/Stakeholder Management",
    commentKey: "comment_communication",
    expKey: "exp_communication",
  },
  {
    key: "mentoring",
    label: "Mentoring and Team Development",
    commentKey: "comment_mentoring",
    expKey: "exp_mentoring",
  },
  {
    key: "competency_skills",
    label: "Competency and Skills",
    commentKey: "comment_competency_skills",
    expKey: "exp_competency_skills",
  },
];

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
      {PROJECT_COMPETENCIES.map((comp, idx) => {
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
