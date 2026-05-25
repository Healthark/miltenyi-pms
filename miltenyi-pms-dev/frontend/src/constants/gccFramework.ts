/**
 * Single source of truth for the Miltenyi GCC competency framework.
 *
 * Replaces the seven local hardcoded `COMPETENCIES` / `ROLE_EXP_FIELDS`
 * arrays that used to live inside individual components (EvalModal,
 * CompetencyBlock, ProjectReviewDetailModal, ExpectationPanel,
 * RoleExpectationsModal, GoalMentorReviewModal, ReviewDetailPanel —
 * the last via CompetencyBlock).
 *
 * One row per GCC competency:
 *   - `key`         — short snake_case slug (used for React keys, log lines).
 *   - `commentKey`  — matches the PM-evaluation payload field name
 *                     (`comment_<slug>`). Used by the EvalModal form
 *                     and the review-display components.
 *   - `expKey`      — matches the RoleExpectation row's field name
 *                     (`exp_<slug>`). Used by the reference panels.
 *   - `label`       — human label shown in headers and form fields.
 *
 * Both `commentKey` and `expKey` are typed against the corresponding
 * service interfaces so the TS compiler catches any drift between
 * frontend literals and backend field names.
 */

import type {
  PMEvaluationPayload,
  RoleExpectation,
} from "@/services/project-review.service";

export interface GccCompetency {
  readonly key: string;
  readonly commentKey: Exclude<
    keyof PMEvaluationPayload,
    "performance_group" | "impact_statement"
  >;
  readonly expKey: Exclude<
    keyof RoleExpectation,
    | "id"
    | "function_name"
    | "career_level"
    | "career_level_label"
    | "designation_names"
  >;
  readonly label: string;
}

export const GCC_COMPETENCIES: readonly GccCompetency[] = [
  {
    key: "scope_of_role",
    commentKey: "comment_scope_of_role",
    expKey: "exp_scope_of_role",
    label: "Scope of Role",
  },
  {
    key: "key_responsibilities",
    commentKey: "comment_key_responsibilities",
    expKey: "exp_key_responsibilities",
    label: "Detailed Key Responsibilities",
  },
  {
    key: "technical_competencies",
    commentKey: "comment_technical_competencies",
    expKey: "exp_technical_competencies",
    label: "Core Technical Competencies",
  },
  {
    key: "delivery_ownership",
    commentKey: "comment_delivery_ownership",
    expKey: "exp_delivery_ownership",
    label: "Delivery Ownership",
  },
  {
    key: "regulatory_compliance",
    commentKey: "comment_regulatory_compliance",
    expKey: "exp_regulatory_compliance",
    label: "Regulatory & Compliance Exposure",
  },
  {
    key: "project_resource_management",
    commentKey: "comment_project_resource_management",
    expKey: "exp_project_resource_management",
    label: "Project and Resource Management",
  },
];
