/**
 * SelfReviewCycleMenu.tsx — Compact 2-row dropdown listing H1 / H2
 * self-review entries for an approved goal.
 *
 * Each row shows: cycle label + submitted status.  Clicking a row fires
 * `onSelect(cycleHalf)` so the parent can open the form modal (either
 * in edit-or-view mode for the mentee, or view-only for the mentor).
 *
 * The dropdown is rendered via a portal into document.body and positioned
 * with `position: fixed` based on the trigger's getBoundingClientRect().
 * This avoids being clipped by ancestor overflow containers (the table's
 * `overflow-x-auto` wrapper, in particular, forces `overflow-y: auto`
 * and would otherwise hide the menu behind the scrollbar edge).
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ClipboardCheck,
  ChevronDown,
  Check,
  Circle,
  CheckCircle2,
  Eye,
} from "lucide-react";
import type { Goal, SelfReviewCycleHalf } from "../../services/goal.service";
import { formatFyYearSpan } from "../../utils/fy";
import {
  cycleKeysForType,
  halfDisplayLabel,
  isHalfWindowOpen,
} from "../../utils/goalStatus";
import { useSystemSettings } from "../../hooks/useSystemSettings";

interface SelfReviewCycleMenuProps {
  readonly goal: Goal;
  /** "mentee" shows Fill / Submitted; "mentor" shows View / Not submitted. */
  readonly mode: "mentee" | "mentor";
  readonly onSelect: (cycleHalf: SelfReviewCycleHalf) => void;
}

const MENU_WIDTH = 224; // Tailwind w-56
const MENU_GAP = 4;

function cycleLabel(
  goal: Goal,
  half: SelfReviewCycleHalf,
  cycleType: string | null,
): string {
  const display = halfDisplayLabel(half, cycleType);
  return goal.fy_year ? `${display} ${formatFyYearSpan(goal.fy_year)}` : display;
}

export function SelfReviewCycleMenu({
  goal,
  mode,
  onSelect,
}: SelfReviewCycleMenuProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const { settings } = useSystemSettings();
  const fiscalStartMonth = settings?.fiscal_start_month ?? 4;
  const cycleType = settings?.cycle_type ?? null;
  // For half-yearly orgs the menu shows 2 rows (H1/H2). For quarterly
  // orgs it shows 4 rows (Q1/Q2/Q3/Q4). The data column carries either
  // family — we read whichever is configured for the org.
  const cycles = cycleKeysForType(cycleType);
  const totalCycles = cycles.length;

  // Compute the menu position from the trigger's bounding rect.  Called on
  // open, on window resize, and on any scroll (capture: true catches
  // scrolls on ancestors like the table's overflow-x container).
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    // Anchor the menu's right edge to the trigger's right edge, clamped so
    // the menu never overflows the viewport horizontally.
    const left = Math.max(
      8,
      Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8),
    );
    // Prefer below; flip above when there isn't room.  Estimated menu
    // height: ~120px for two rows.
    const MENU_EST_HEIGHT = 120;
    const belowTop = rect.bottom + MENU_GAP;
    const top =
      belowTop + MENU_EST_HEIGHT <= window.innerHeight
        ? belowTop
        : Math.max(8, rect.top - MENU_GAP - MENU_EST_HEIGHT);
    setPos({ top, left });
  }, []);

  // Position once synchronously on open to avoid a one-frame flicker.
  useLayoutEffect(() => {
    if (open) updatePosition();
  }, [open, updatePosition]);

  // Reposition on viewport changes while the menu is open.
  useEffect(() => {
    if (!open) return;
    const handler = () => updatePosition();
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [open, updatePosition]);

  // Close on outside click (must allow clicks inside the portal menu itself).
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const submittedCount = goal.self_reviews.filter((sr) => !sr.is_draft).length;
  const mentorReviewedCount = goal.mentor_reviews.filter((mr) => !mr.is_draft).length;

  const triggerLabel =
    mode === "mentor"
      ? mentorReviewedCount > 0
        ? `Reviews (${mentorReviewedCount}/${submittedCount} reviewed)`
        : submittedCount > 0
        ? `Self Reviews (${submittedCount}/${totalCycles})`
        : "Self Reviews"
      : submittedCount === totalCycles
      ? "Self Reviews · Submitted"
      : submittedCount > 0
      ? `Self Reviews (${submittedCount}/${totalCycles})`
      : "Self Review";

  const menu =
    open && pos ? (
      <div
        ref={menuRef}
        style={{
          position: "fixed",
          top: pos.top,
          left: pos.left,
          width: MENU_WIDTH,
        }}
        className="z-50 rounded-lg border border-border bg-surface shadow-lg overflow-hidden"
        role="menu"
      >
        {cycles.map((half) => {
          // "Submitted" means a non-draft row exists for this half.
          // Drafts (is_draft=true) are still in-progress — the mentee can
          // resume them, the mentor can't see them yet.
          const selfRow = goal.self_reviews.find(
            (sr) => sr.cycle_half === half,
          );
          const submitted = selfRow !== undefined && !selfRow.is_draft;
          const hasSelfDraft =
            selfRow !== undefined && selfRow.is_draft;
          // Lock rules:
          //   Mentee mode  — locked when not yet submitted AND the time
          //                  window for the half isn't open. (Prevents
          //                  filing reviews outside the FY window.)
          //   Mentor mode  — locked when no self-review exists yet. The
          //                  mentor-review surface needs the mentee's
          //                  self-review on the left panel; no point
          //                  opening it before there's anything to react to.
          const windowOpen = isHalfWindowOpen(
            half,
            goal.fy_year,
            fiscalStartMonth,
          );
          const isMenteeLocked = mode === "mentee" && !submitted && !windowOpen;
          const isMentorLocked = mode === "mentor" && !submitted;
          const isLocked = isMenteeLocked || isMentorLocked;
          const isFirstCycle = cycles.indexOf(half) === 0;
          const lockReason = isMentorLocked
            ? "Awaiting mentee self-review for this cycle"
            : !isFirstCycle
              ? `${halfDisplayLabel(half, cycleType)} window has not opened yet`
              : "Review window for this fiscal year has closed";
          return (
            <button
              key={half}
              type="button"
              role="menuitem"
              disabled={isLocked}
              onClick={() => {
                if (isLocked) return;
                setOpen(false);
                onSelect(half);
              }}
              title={isLocked ? lockReason : undefined}
              className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left transition-colors border-b border-border last:border-b-0 ${
                isLocked
                  ? "cursor-not-allowed opacity-60"
                  : "hover:bg-brand/5"
              }`}
            >
              <div className="flex flex-col min-w-0">
                <span className="text-[12px] font-semibold text-text-main">
                  {cycleLabel(goal, half, cycleType)}
                </span>
                <span
                  className={`text-[10px] ${
                    submitted
                      ? "text-green-600"
                      : isLocked
                        ? "text-text-muted/70"
                        : "text-text-muted"
                  }`}
                >
                  {submitted ? (
                    <span className="flex items-center gap-1">
                      <Check className="h-2.5 w-2.5" /> Submitted
                    </span>
                  ) : isLocked ? (
                    <span className="flex items-center gap-1">
                      <Circle className="h-2.5 w-2.5" /> {lockReason}
                    </span>
                  ) : hasSelfDraft && mode === "mentee" ? (
                    <span className="flex items-center gap-1">
                      <Circle className="h-2.5 w-2.5" /> Draft saved
                    </span>
                  ) : (
                    <span className="flex items-center gap-1">
                      <Circle className="h-2.5 w-2.5" /> Not Submitted
                    </span>
                  )}
                </span>
              </div>
              {mode === "mentor" ? (
                // Status-indicator icons (the row click target opens the
                // mentor review modal):
                //   CheckCircle2 — mentor review already submitted.
                //   Eye          — self-review filed; mentor review pending.
                //   Circle       — no self-review yet (row is disabled).
                (() => {
                  const mentorRow = goal.mentor_reviews.find(
                    (mr) => mr.cycle_half === half,
                  );
                  const mentorReviewed =
                    mentorRow !== undefined && !mentorRow.is_draft;
                  if (mentorReviewed) {
                    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />;
                  }
                  if (submitted) {
                    return <Eye className="h-3.5 w-3.5 text-text-muted shrink-0" />;
                  }
                  return <Circle className="h-3.5 w-3.5 text-text-muted shrink-0" />;
                })()
              ) : submitted ? (
                <Check className="h-3.5 w-3.5 text-green-500 shrink-0" />
              ) : isLocked ? (
                <Circle className="h-3.5 w-3.5 text-text-muted shrink-0" />
              ) : (
                <ClipboardCheck className="h-3.5 w-3.5 text-brand shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    ) : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md bg-brand/10 px-2 py-1 text-[11px] font-medium text-brand hover:bg-brand hover:text-white transition-colors"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <ClipboardCheck className="h-3 w-3" />
        {triggerLabel}
        <ChevronDown
          className={`h-3 w-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {menu && createPortal(menu, document.body)}
    </>
  );
}
