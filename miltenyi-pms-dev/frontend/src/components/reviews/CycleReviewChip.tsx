/**
 * CycleReviewChip — single-cycle pill inside the All Reviews tab's
 * "Cycle Reviews" cell.
 *
 * The All Reviews tab groups reviews by (employee, project, FY) so a
 * single row carries a strip of chips — one per cycle in the FY. Each
 * chip encodes the cycle's state at a glance:
 *
 *   • Reviewed   — green pill, ✓ icon, rating number on the right.
 *                  Click opens the review's detail modal.
 *   • Pending    — amber pill, ⏳ icon. Row exists but PM hasn't
 *                  submitted yet. Click opens the detail modal
 *                  (showing the row's metadata even without a
 *                  narrative).
 *   • Awaiting   — amber dashed outline, no icon. The org's active
 *                  cycle but PM hasn't started — no DB row to open,
 *                  so the chip is non-clickable. HR's primary chase
 *                  target.
 *   • Upcoming   — slate dashed outline, faded. Cycle hasn't begun
 *                  yet (future) or is past with no row (data gap).
 *                  Non-clickable.
 *
 * The chip can optionally be dimmed — used by the Period filter to
 * de-emphasise cycles that don't match the active period while
 * keeping them visible for context.
 */

import type {
  CycleSlot,
  CycleChipState,
} from "@/utils/groupProjectReviews";

interface CycleReviewChipProps {
  readonly slot: CycleSlot;
  /** When true, render at reduced opacity. Used by the toolbar's
   *  Period filter so non-matching cycles stay visible (for
   *  progression context) but visually de-emphasised. */
  readonly dimmed?: boolean;
  /** Click handler. Called only for clickable states (reviewed +
   *  pending). Awaiting / upcoming slots ignore clicks. */
  readonly onClick?: (slot: CycleSlot) => void;
}

/** Tailwind class bundles per chip state. Color alone signals the
 *  state — no icons, no rating dots. 3-state model:
 *
 *    reviewed → solid green (clickable: opens detail modal)
 *    pending  → solid amber (clickable when a DB row backs it;
 *                non-interactive otherwise — see render code below)
 *    upcoming → dashed slate (never clickable)
 *
 *  Rectangular rounded-md corners read calmer at the density we
 *  render them — 2-4 chips per cell. Hover affordances are applied
 *  conditionally in the render path so non-clickable pending chips
 *  don't get a misleading hover bg. */
const CHIP_BASE =
  "inline-flex items-center justify-center min-w-[34px] px-2 py-0.5 rounded-md text-[11px] font-semibold tabular-nums whitespace-nowrap select-none transition-opacity";

const STATE_CLASSES: Record<CycleChipState, string> = {
  reviewed: "bg-green-100 text-green-800 border border-green-200",
  pending: "bg-amber-100 text-amber-800 border border-amber-200",
  upcoming:
    "bg-slate-50 text-slate-400 border border-dashed border-slate-200 cursor-not-allowed",
};

/** Hover background applied only when the chip is actually clickable.
 *  Keyed off the same state so the colour shift matches the base. */
const HOVER_CLASSES: Record<CycleChipState, string> = {
  reviewed: "hover:bg-green-200 cursor-pointer",
  pending: "hover:bg-amber-200 cursor-pointer",
  upcoming: "",
};

/** Human-readable tooltip per state. Composed per-slot so we can
 *  inject the period / cycle name / reviewer name where relevant.
 *  Wording mirrors the legend popover labels so users see the same
 *  phrasing whether they hover the chip directly or open the (?)
 *  legend in the column header. */
function tooltipFor(slot: CycleSlot): string {
  switch (slot.state) {
    case "reviewed": {
      const rating = slot.review?.performance_group ?? null;
      const reviewer = slot.review?.reviewer_name ?? null;
      const parts = [`${slot.cycleName} — submitted`];
      if (rating) parts.push(`rating ${rating}`);
      if (reviewer) parts.push(`by ${reviewer}`);
      return parts.join(" · ");
    }
    case "pending":
      return `${slot.cycleName} — pending PM evaluation`;
    case "upcoming":
      return `${slot.cycleName} — future cycle`;
  }
}

export function CycleReviewChip({
  slot,
  dimmed = false,
  onClick,
}: CycleReviewChipProps) {
  // Clickable iff a real DB row backs the slot AND the state has a
  // meaningful detail view (reviewed = full review; pending with row
  // = saved/in-progress content). Pending chips without a row (PM
  // hasn't engaged yet) look identical but don't fire onClick.
  const clickable =
    (slot.state === "reviewed" || slot.state === "pending") &&
    slot.review !== null;
  const interactiveClasses = clickable ? HOVER_CLASSES[slot.state] : "";
  const classes = `${CHIP_BASE} ${STATE_CLASSES[slot.state]} ${interactiveClasses} ${
    dimmed ? "opacity-40" : ""
  }`;
  const label = slot.period || "FY";

  if (clickable && onClick) {
    return (
      <button
        type="button"
        onClick={() => onClick(slot)}
        title={tooltipFor(slot)}
        className={classes}
      >
        {label}
      </button>
    );
  }
  return (
    <span title={tooltipFor(slot)} className={classes}>
      {label}
    </span>
  );
}
