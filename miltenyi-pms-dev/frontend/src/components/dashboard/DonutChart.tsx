/**
 * DonutChart — SVG donut for HR dashboard funnel cards.
 *
 * No charting library is used; the SVG is hand-drawn from the segment
 * values so the bundle stays slim. The center slot shows a primary
 * value (typically a percentage or count) plus an optional secondary
 * line below it.
 *
 * Segment colors are taken from the system theme tokens defined in
 * `index.css` (`--color-brand`, `--color-green`, `--color-amber`,
 * `--color-red`) so the chart palette stays in sync with the rest of
 * the app. The track ring uses `--color-border` for the same reason.
 *
 * When every segment is zero (an "empty" cycle), the chart renders the
 * neutral track ring so the card layout doesn't collapse — callers can
 * branch on their own empty state earlier if they want a different
 * affordance.
 */

interface DonutSegment {
  readonly label: string;
  readonly value: number;
  /** Any CSS color — pass a theme token via `var(--color-…)` so the
   *  chart stays consistent with the rest of the design system. */
  readonly color: string;
}

interface DonutChartProps {
  readonly segments: readonly DonutSegment[];
  /** Outer diameter in px. Defaults to 128 — fits a 3-up card row. */
  readonly size?: number;
  /** Ring thickness in px. Defaults to 12. */
  readonly thickness?: number;
  /** Big text inside the donut. */
  readonly centerPrimary: string;
  /** Small caption below the primary, e.g. "/1500" or "Total". */
  readonly centerSecondary?: string;
  /** Accessible label for screen readers. */
  readonly ariaLabel?: string;
}

export function DonutChart({
  segments,
  size = 128,
  thickness = 12,
  centerPrimary,
  centerSecondary,
  ariaLabel,
}: DonutChartProps) {
  const radius = (size - thickness) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  // Walk around the circle starting at 12 o'clock and proceeding
  // clockwise. We render each segment as a full-circumference circle
  // with a dash pattern that exposes only its slice — strokeDashoffset
  // rotates the dash window into position.
  let cursor = 0;
  const arcs = segments.map((seg) => {
    const fraction = total > 0 ? seg.value / total : 0;
    const length = fraction * circumference;
    const node = (
      <circle
        key={seg.label}
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={seg.color}
        strokeWidth={thickness}
        strokeLinecap="round"
        strokeDasharray={`${length} ${circumference - length}`}
        strokeDashoffset={-cursor}
        // Avoid drawing zero-length strokes — some browsers render a
        // hairline dot when the segment is 0.
        opacity={length > 0 ? 1 : 0}
      />
    );
    cursor += length;
    return node;
  });

  return (
    <div
      className="relative inline-flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={ariaLabel}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        // Rotate so 12 o'clock is the start of the first segment.
        style={{ transform: "rotate(-90deg)" }}
        aria-hidden="true"
      >
        {/* Track ring — visible behind data so empty/partial cycles
            still read as a chart, not an absence. */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={thickness}
        />
        {total > 0 && arcs}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-2xl font-semibold text-text-main leading-none">
          {centerPrimary}
        </span>
        {centerSecondary && (
          <span className="mt-1 text-[11px] font-medium text-text-muted">
            {centerSecondary}
          </span>
        )}
      </div>
    </div>
  );
}
