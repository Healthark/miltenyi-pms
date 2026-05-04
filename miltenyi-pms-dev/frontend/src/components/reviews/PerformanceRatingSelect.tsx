import { Info } from "lucide-react";

/**
 * 1–5 performance rating select with a hover tooltip showing the rating guide.
 * Kept identical to the Project Review EvalModal so both surfaces read alike.
 *
 * Rating guide:
 *   1 — Performed beyond expectations
 *   2 — Exceeded goals at expected level
 *   3 — Achieved goals at expected level
 *   4 — Partially achieved goals
 *   5 — Did not achieve goals
 */
interface PerformanceRatingSelectProps {
  readonly id?: string;
  readonly label?: string;
  readonly value: number | "";
  readonly onChange: (next: number | "") => void;
  readonly disabled?: boolean;
  readonly showTooltip?: boolean;
}

export function PerformanceRatingSelect({
  id = "performance-rating",
  label = "Overall Performance Rating",
  value,
  onChange,
  disabled = false,
  showTooltip = true,
}: PerformanceRatingSelectProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <label htmlFor={id} className="text-[13px] font-bold text-text-main">
          {label}
        </label>
        {showTooltip && !disabled && (
          <div className="group relative inline-flex items-center">
            <Info className="h-3.5 w-3.5 text-text-muted cursor-default" />
            <div className="invisible group-hover:visible pointer-events-none absolute top-full left-0 z-50 mt-2 w-72 rounded-lg border border-border bg-white px-3 py-2.5 text-xs text-text-main shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-150">
              <div className="absolute left-3 bottom-full border-4 border-transparent border-b-border" />
              <p className="font-semibold mb-1.5">Rating Guide</p>
              <ul className="space-y-1.5 text-text-muted">
                <li>
                  <span className="font-semibold text-text-main">1 —</span>{" "}
                  Performed beyond expectations
                </li>
                <li>
                  <span className="font-semibold text-text-main">2 —</span>{" "}
                  Exceeded goals at expected level
                </li>
                <li>
                  <span className="font-semibold text-text-main">3 —</span>{" "}
                  Achieved goals at expected level
                </li>
                <li>
                  <span className="font-semibold text-text-main">4 —</span>{" "}
                  Partially achieved goals
                </li>
                <li>
                  <span className="font-semibold text-text-main">5 —</span> Did
                  not achieve goals
                </li>
              </ul>
            </div>
          </div>
        )}
      </div>
      <select
        id={id}
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          onChange(v === "" ? "" : Number(v));
        }}
        disabled={disabled}
        className="w-24 rounded-lg border border-border bg-white px-3 py-2 text-[13px] outline-none focus:border-brand disabled:bg-slate-50 disabled:text-text-muted disabled:cursor-not-allowed"
      >
        <option value="" disabled>
          Select
        </option>
        <option value={1}>1</option>
        <option value={2}>2</option>
        <option value={3}>3</option>
        <option value={4}>4</option>
        <option value={5}>5</option>
      </select>
    </div>
  );
}
