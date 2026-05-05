import { Clock, Loader2, Star } from "lucide-react";
import type {
  MyProjectCard,
  RoleExpectation,
} from "../../services/project-review.service";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import { useReviewDetails } from "../../hooks/useReviewDetails";
import { CompetencyBlock } from "./CompetencyBlock";
import { ImpactBlock } from "./ImpactBlock";

const TABLE_COLSPAN = 7;

/**
 * Inline expansion shown beneath a clicked My Reviews table row.
 * Uses the shared `useReviewDetails` hook so cascading-render
 * setStates inside `useEffect` are avoided.
 */
export function TableExpandedRow({
  card,
  expectations,
}: {
  readonly card: MyProjectCard;
  readonly expectations: RoleExpectation[];
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

  if (isPending) {
    return (
      <tr>
        <td
          colSpan={TABLE_COLSPAN}
          className="px-5 py-6 text-center text-sm text-text-muted bg-slate-50/50"
        >
          <Clock className="h-5 w-5 text-amber-500 mx-auto mb-2" />
          Evaluation pending — awaiting PM review.
        </td>
      </tr>
    );
  }

  if (isFetching) {
    return (
      <tr>
        <td colSpan={TABLE_COLSPAN} className="px-5 py-6 text-center bg-slate-50/50">
          <Loader2 className="h-5 w-5 animate-spin text-brand mx-auto" />
        </td>
      </tr>
    );
  }

  if (error || !details) {
    return (
      <tr>
        <td
          colSpan={TABLE_COLSPAN}
          className="px-5 py-4 text-center text-sm text-red-600 bg-red-50/30"
        >
          {error || "No data available"}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={TABLE_COLSPAN} className="p-0">
        <div className="border-t border-brand/10 bg-slate-50/40 px-5 py-5 animate-in slide-in-from-top-1 fade-in duration-200">
          <div className="flex flex-col gap-4">
            {projectRatingsVisible && (
              <div className="flex items-center gap-2.5 rounded-lg border border-emerald-100 bg-emerald-50/50 px-3 py-2">
                <Star className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-[13px] text-text-main">
                  Rating:{" "}
                  <span className="font-bold text-emerald-700">
                    {details.performance_group ?? "—"}
                  </span>
                </span>
                {details.reviewer_name && (
                  <span className="ml-auto text-[11px] text-emerald-700">
                    by {details.reviewer_name}
                  </span>
                )}
              </div>
            )}

            <CompetencyBlock review={details} roleExp={roleExp} compact />
            <ImpactBlock review={details} compact />
          </div>
        </div>
      </td>
    </tr>
  );
}
