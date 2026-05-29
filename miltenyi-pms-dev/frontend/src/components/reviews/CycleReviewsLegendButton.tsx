/**
 * CycleReviewsLegendButton — the (?) icon next to the "Cycle Reviews"
 * column header, plus a popover panel that shows the chip-state
 * legend with real chip swatches.
 *
 * Native `title` tooltips couldn't render the chip colors / shapes
 * (HR had to mentally map "Green (solid)" to a real chip), had a
 * laggy delay, and didn't work on touch devices. This component is
 * a small purpose-built popover with:
 *
 *   - Hover → opens after 200ms (no flash on accidental hover)
 *   - Mouse-out from BOTH the trigger and the panel → closes after 150ms
 *   - Click on the icon → toggles pinned-open (stays open until next
 *     click, outside click, or Escape) — gives touch + keyboard
 *     users an equivalent path that doesn't depend on hover
 *   - Escape / outside click → closes
 *   - Window scroll / resize → closes (we don't reposition; closing
 *     is simpler than computing new coords and avoids stale offsets)
 *
 * Positioning uses `createPortal` so the panel lives at document.body
 * — escapes the table's `overflow-x-auto` wrapper that would
 * otherwise clip it. Coords are computed from the trigger's bounding
 * rect on each open.
 */

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { HelpCircle } from "lucide-react";

/** Hover-in delay before showing — guards against unintentional
 *  hovers when HR is just moving the mouse through the toolbar area. */
const OPEN_DELAY_MS = 200;
/** Hover-out delay before hiding — short window so HR can transit
 *  from the trigger to the panel without the panel disappearing
 *  mid-cross. 150ms is the standard floating-ui-style grace. */
const CLOSE_DELAY_MS = 150;

/** Tailwind class bundle for the swatches inside the legend. Built
 *  to visually match `CycleReviewChip` exactly (same min-width,
 *  padding, font, colours) so the mapping is unambiguous. Slightly
 *  smaller text — these are reference chips, not interactive ones. */
const SWATCH_BASE =
  "inline-flex items-center justify-center min-w-[32px] px-2 py-0.5 rounded-md text-[11px] font-semibold tabular-nums";

interface LegendRow {
  readonly label: string;
  readonly description: string;
  readonly chipClasses: string;
}

// 3-state model: review rows often pre-exist in the DB without the
// PM having engaged, so the prior "row exists vs doesn't" split
// (pending vs awaiting) was invisible to HR. Both collapsed into a
// single Pending state. Three legend rows is now the full picture.
//
// All three swatches use the same period label ("Q1") to keep the
// legend's focus on COLOUR semantics — using Q1/Q2/Q3 made it look
// like the legend was tied to specific quarters rather than
// illustrating the four chip states in the abstract.
const LEGEND_ROWS: readonly LegendRow[] = [
  {
    label: "Q1",
    description: "Submitted",
    chipClasses: "bg-green-100 text-green-800 border border-green-200",
  },
  {
    label: "Q1",
    description: "Pending PM evaluation",
    chipClasses: "bg-amber-100 text-amber-800 border border-amber-200",
  },
  {
    label: "Q1",
    description: "Future cycle",
    chipClasses:
      "bg-slate-50 text-slate-400 border border-dashed border-slate-200",
  },
];

export function CycleReviewsLegendButton() {
  const [open, setOpen] = useState(false);
  /** Click-driven persistence: true means hover-out should NOT auto-
   *  close. Resets on outside click / Escape / another trigger click. */
  const [pinned, setPinned] = useState(false);
  /** Coords for the portal-rendered panel. Computed from the trigger's
   *  getBoundingClientRect when `open` flips true. */
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  /** Timer IDs for the open + close delays so we can cancel a pending
   *  open if the user moves out before OPEN_DELAY_MS, and cancel a
   *  pending close if they move back in before CLOSE_DELAY_MS. */
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const cancelOpenTimer = () => {
    if (openTimerRef.current !== null) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
  };
  const cancelCloseTimer = () => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleOpen = () => {
    cancelCloseTimer();
    if (open) return;
    openTimerRef.current = window.setTimeout(() => {
      setOpen(true);
    }, OPEN_DELAY_MS);
  };
  const scheduleClose = () => {
    cancelOpenTimer();
    if (pinned) return;
    closeTimerRef.current = window.setTimeout(() => {
      setOpen(false);
    }, CLOSE_DELAY_MS);
  };

  /** Click toggles the pinned state. If we pin, ensure it opens; if
   *  we unpin, close immediately (otherwise the panel would linger
   *  until the user hovers away). */
  const handleTriggerClick = () => {
    setPinned((prev) => {
      const next = !prev;
      cancelOpenTimer();
      cancelCloseTimer();
      setOpen(next);
      return next;
    });
  };

  // Compute / refresh portal coords whenever the panel opens.
  useEffect(() => {
    if (!open) {
      setCoords(null);
      return;
    }
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCoords({ top: rect.bottom + 8, left: rect.left });
  }, [open]);

  // Outside click + Escape — closes AND unpins so the next hover
  // re-opens fresh.
  useEffect(() => {
    if (!open) return;
    const handleOutsideClick = (e: MouseEvent) => {
      if (
        triggerRef.current?.contains(e.target as Node) ||
        panelRef.current?.contains(e.target as Node)
      ) {
        return;
      }
      setOpen(false);
      setPinned(false);
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setPinned(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEsc);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEsc);
    };
  }, [open]);

  // Close on scroll / resize. Reposition would be nice but it'd need
  // to track the table's own scroll container too — simpler to just
  // close and let the user re-open if they want it again.
  useEffect(() => {
    if (!open) return;
    const close = () => {
      setOpen(false);
      setPinned(false);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  // Cancel pending timers on unmount so we don't setState on a
  // stale instance after navigation.
  useEffect(() => {
    return () => {
      cancelOpenTimer();
      cancelCloseTimer();
    };
  }, []);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onMouseEnter={scheduleOpen}
        onMouseLeave={scheduleClose}
        onFocus={() => {
          cancelCloseTimer();
          setOpen(true);
        }}
        onBlur={() => {
          if (!pinned) scheduleClose();
        }}
        onClick={handleTriggerClick}
        aria-label="Cycle chip legend"
        aria-expanded={open}
        // Subtle visual cue that this is interactive — slightly more
        // emphasis when active (open / pinned).
        className={`inline-flex items-center rounded p-0.5 transition-colors ${
          open
            ? "text-brand bg-brand/10"
            : "text-text-muted/70 hover:text-text-main hover:bg-slate-100"
        }`}
      >
        <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      {open &&
        coords &&
        createPortal(
          <div
            ref={panelRef}
            role="dialog"
            aria-label="Cycle chip legend"
            onMouseEnter={cancelCloseTimer}
            onMouseLeave={scheduleClose}
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
            }}
            className="z-50 w-72 rounded-lg border border-border bg-surface shadow-lg p-3 text-[12px]"
          >
            <p className="font-display text-[13px] font-semibold text-text-main mb-2">
              Cycle chip legend
            </p>
            <ul className="space-y-1.5">
              {LEGEND_ROWS.map((row) => (
                <li
                  // Description is unique across the rows; row.label
                  // is "Q1" for all three after the consolidation, so
                  // we can't key by it.
                  key={row.description}
                  className="flex items-center gap-2.5"
                >
                  <span className={`${SWATCH_BASE} ${row.chipClasses}`}>
                    {row.label}
                  </span>
                  <span className="text-text-muted leading-tight">
                    {row.description}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-2.5 pt-2.5 border-t border-border/60 text-[11px] text-text-muted leading-tight">
              Click any solid (green or amber) chip to open that
              cycle's review.
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}
