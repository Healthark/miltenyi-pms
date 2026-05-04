import { Clock, Loader2, Star, User, UserCircle, X } from "lucide-react";
import type {
  MyProjectCard,
  RoleExpectation,
} from "../../services/project-review.service";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { useReviewDetails } from "../../hooks/useReviewDetails";
import { CompetencyBlock } from "./CompetencyBlock";
import { ImpactBlock } from "./ImpactBlock";

/**
 * Detail panel rendered below the My Reviews grid when a card is
 * selected. Displays the rating bar (gated by the org's
 * project_ratings_visible flag), all 7 competency comments, the PM's
 * overall impact statement, and any secondary impact statements.
 *
 * Loading lifecycle is owned by `useReviewDetails` to keep the effect
 * cascading-render-free.
 */
export function ReviewDetailPanel({
  card,
  expectations,
  onClose,
}: {
  readonly card: MyProjectCard;
  readonly expectations: RoleExpectation[];
  readonly onClose: () => void;
}) {
  const { settings } = useSystemSettings();
  const projectRatingsVisible = settings?.project_ratings_visible ?? false;

  const isPending = card.review_status !== "reviewed";
  const { details, isFetching, error } = useReviewDetails(
    isPending ? null : card.review_id,
  );

  const roleExp = expectations.find(
    (e) =>
      e.department_name === card.department_name &&
      e.designation_name === card.assignment_role,
  );

  return (
    <div className="rounded-xl border border-brand/20 bg-surface shadow-md animate-in slide-in-from-top-2 fade-in duration-300">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-[16px] font-bold text-text-main">
              {card.project_name}
            </h3>
            <span className="text-[11px] font-mono text-text-muted bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
              {card.project_code}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-[12px] text-text-muted">
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" /> PM: {card.pm_name ?? "Unassigned"}
            </span>
            <span>Cycle: {card.cycle}</span>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md p-1.5 text-text-muted hover:bg-slate-100 transition-colors"
          aria-label="Close details"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Body */}
      <div className="px-5 py-5">
        {renderBody({
          isPending,
          isFetching,
          error,
          details,
          roleExp,
          projectRatingsVisible,
        })}
      </div>
    </div>
  );
}

// Pulled out into a function so the JSX render branch above stays as a
// single call instead of a nested ternary.
function renderBody({
  isPending,
  isFetching,
  error,
  details,
  roleExp,
  projectRatingsVisible,
}: {
  isPending: boolean;
  isFetching: boolean;
  error: string;
  details: ReturnType<typeof useReviewDetails>["details"];
  roleExp: RoleExpectation | undefined;
  projectRatingsVisible: boolean;
}) {
  if (isPending) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <Clock className="h-8 w-8 text-amber-500 mb-3" />
        <p className="font-medium text-text-main">Evaluation Pending</p>
        <p className="mt-1 text-sm text-text-muted">
          Your PM hasn't submitted the evaluation for this cycle yet.
        </p>
      </div>
    );
  }
  if (isFetching) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-text-muted gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-brand" />
        <span className="text-[13px] font-medium">
          Fetching evaluation details...
        </span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-center py-6 text-[13px] text-red-600 bg-red-50 rounded-xl">
        {error}
      </div>
    );
  }
  if (!details) return null;

  return (
    <div className="flex flex-col gap-6">
      {projectRatingsVisible && (
        <div className="flex items-center justify-between gap-4 flex-wrap rounded-lg border border-emerald-100 bg-emerald-50/50 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Star className="h-4 w-4 text-emerald-600" />
            <span className="text-[13.5px] text-text-main">
              Project Evaluation Score:{" "}
              <span className="font-bold text-emerald-700">
                {details.performance_group ?? "—"}
              </span>
            </span>
          </div>
          {details.reviewer_name && (
            <div className="flex items-center gap-1.5 text-[12px] text-emerald-800/80 font-medium bg-emerald-100/50 px-2.5 py-1 rounded-md">
              <UserCircle className="h-3.5 w-3.5" />
              Evaluated by {details.reviewer_name}
            </div>
          )}
        </div>
      )}
      <CompetencyBlock review={details} roleExp={roleExp} />
      <ImpactBlock review={details} />
    </div>
  );
}
