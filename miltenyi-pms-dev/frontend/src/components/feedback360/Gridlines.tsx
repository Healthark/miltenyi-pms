/**
 * Five vertical "graph paper" gridlines at 0% / 25% / 50% / 75% / 100%
 * of the parent's content area. Use to back the plot column of
 * AggregateView + FeedbackGive so dots/whiskers visually trace up
 * to the scale labels.
 *
 * Positioning is left to the caller via `className` (e.g.
 * `inset-x-6 inset-y-0` for cells with px-6 padding). The component
 * sets `absolute` itself so the caller doesn't have to.
 */
interface GridlinesProps {
  /** Additional inset classes for the absolute container. */
  readonly className?: string;
}

const POSITIONS = [1, 2, 3, 4, 5] as const;
const ANCHOR_VALUES = new Set([1, 3, 5]); // labelled scale points

export function Gridlines({ className = "inset-x-6 inset-y-0" }: GridlinesProps) {
  return (
    <div className={`absolute pointer-events-none ${className}`}>
      {POSITIONS.map((v) => {
        const pct = ((v - 1) / 4) * 100;
        const isAnchor = ANCHOR_VALUES.has(v);
        return (
          <div
            key={v}
            className={`absolute top-0 bottom-0 w-px ${
              isAnchor ? "bg-border/60" : "bg-border/30"
            }`}
            style={{ left: `${pct}%`, transform: "translateX(-50%)" }}
          />
        );
      })}
    </div>
  );
}
