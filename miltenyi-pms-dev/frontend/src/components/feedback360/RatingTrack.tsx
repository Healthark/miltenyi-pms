/**
 * RatingTrack — 1–5 dotted slider used for input + read-only modes
 * on the FeedbackGive page.
 *
 *   <RatingTrack value={4} onChange={setRating} />     // input
 *   <RatingTrack value={4} disabled />                  // read-only
 *   <RatingTrack value={undefined} onChange={...} />    // not-yet-rated (no thumb)
 *
 * Tick dots and thumb are both absolute-positioned at exact
 * percentages (0% / 25% / 50% / 75% / 100%), so a parent's gridlines
 * at the same percentages line up perfectly with the dot centers.
 */

interface RatingTrackProps {
  /** Integer rating 1–5. `undefined` = not rated (no thumb shown). */
  readonly value?: number;
  /** Click handler. Omit to render as read-only. */
  readonly onChange?: (v: number) => void;
  /** Disable interaction (read-only). */
  readonly disabled?: boolean;
}

const TICK_VALUES = [1, 2, 3, 4, 5] as const;

function pctFor(rating: number): number {
  // Map 1..5 → 0%..100% with the four equal segments.
  return ((rating - 1) / 4) * 100;
}

export function RatingTrack({ value, onChange, disabled }: RatingTrackProps) {
  const isInteractive = !disabled && !!onChange;
  const thumbPct = typeof value === "number" ? pctFor(value) : null;

  return (
    <div className="relative h-7 w-full select-none">
      {/* The track line — pinned to the dot centers (translateX(-50%)
          puts dot 1 at left=0 and dot 5 at left=width-1, so the track
          spans 0% → 100% horizontally to match). */}
      <div className="absolute left-0 right-0 top-1/2 -translate-y-1/2 h-px bg-border" />

      {/* Tick dots — absolute at exact percentages */}
      {TICK_VALUES.map((v) => {
        const pct = pctFor(v);
        const selected = value === v;
        const tickBase =
          "absolute top-1/2 h-2 w-2 rounded-full transition-all";
        const tickColor = selected ? "bg-brand" : "bg-slate-300";
        const positionStyle = {
          left: `${pct}%`,
          transform: "translate(-50%, -50%)",
        } as const;

        if (isInteractive) {
          return (
            <button
              key={v}
              type="button"
              onClick={() => onChange?.(v)}
              style={positionStyle}
              className={`${tickBase} ${tickColor} hover:scale-150 hover:bg-brand cursor-pointer z-10`}
              aria-label={`Rate ${v}`}
              aria-pressed={selected}
            />
          );
        }
        return (
          <span
            key={v}
            style={positionStyle}
            className={`${tickBase} ${tickColor} ${
              disabled ? "opacity-70" : ""
            }`}
            aria-hidden="true"
          />
        );
      })}

      {/* Thumb at the selected integer position */}
      {thumbPct !== null && (
        <div
          className="absolute top-1/2 h-3.5 w-3.5 rounded-full bg-brand ring-2 ring-surface shadow-sm pointer-events-none transition-all z-20"
          style={{
            left: `${thumbPct}%`,
            transform: "translate(-50%, -50%)",
            opacity: disabled ? 0.7 : 1,
          }}
          aria-hidden="true"
        />
      )}
    </div>
  );
}
