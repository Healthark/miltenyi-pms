import { CheckCircle2, Clock, User } from "lucide-react";
import type { MyProjectCard } from "../../services/project-review.service";

/**
 * Compact card rendered in the My Reviews grid view. Selectable — the
 * parent toggles `isSelected` and renders the detail panel below the
 * grid for the active card.
 */
export function ProjectSummaryCard({
  card,
  isSelected,
  onClick,
}: {
  readonly card: MyProjectCard;
  readonly isSelected: boolean;
  readonly onClick: () => void;
}) {
  const isReviewed = card.review_status === "reviewed";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-4 transition-all duration-200 ${
        isSelected
          ? "border-brand bg-brand/5 ring-1 ring-brand/30 shadow-md"
          : "border-border bg-surface hover:border-brand/30 hover:shadow-sm"
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-mono text-text-muted bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
          {card.project_code}
        </span>
        {isReviewed ? (
          <span className="flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase text-green-700">
            <CheckCircle2 className="h-3 w-3" /> Reviewed
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">
            <Clock className="h-3 w-3" /> Pending
          </span>
        )}
      </div>

      <h3 className="text-[14px] font-semibold text-text-main leading-snug mb-1.5 line-clamp-2">
        {card.project_name}
      </h3>

      <div className="flex items-center gap-1.5 text-[12px] text-text-muted">
        <User className="h-3 w-3 shrink-0" />
        <span className="truncate">{card.pm_name ?? "Unassigned"}</span>
      </div>

      <div className="flex items-center justify-between mt-2 pt-2 border-t border-border/60">
        {isReviewed ? (
          <span className="text-[11px] text-text-muted">
            Click to view evaluation
          </span>
        ) : (
          <span className="text-[11px] text-text-muted italic">
            Awaiting PM evaluation
          </span>
        )}
        {card.cycle && (
          <span className="text-[10px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
            {card.cycle}
          </span>
        )}
      </div>
    </button>
  );
}
