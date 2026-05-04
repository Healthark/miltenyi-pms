/**
 * Compact numeric badge showing a 1–5 performance rating.
 * Color-codes by rating tier: 1 green → 2 brand → 3 slate → 4 amber → 5 red.
 */
interface PerformanceRatingBadgeProps {
  readonly value: number | null;
  readonly size?: "sm" | "md";
}

const TIER: Record<number, string> = {
  1: "bg-green-50 text-green-700 border-green-200",
  2: "bg-brand/10 text-brand border-brand/30",
  3: "bg-slate-100 text-slate-700 border-slate-200",
  4: "bg-amber-50 text-amber-700 border-amber-200",
  5: "bg-red-50 text-red-700 border-red-200",
};

export function PerformanceRatingBadge({
  value,
  size = "sm",
}: PerformanceRatingBadgeProps) {
  if (value == null) {
    return <span className="text-[12px] text-text-muted">—</span>;
  }

  const cls = TIER[value] ?? TIER[3];
  const dim =
    size === "md"
      ? "h-7 w-7 text-sm"
      : "h-6 w-6 text-[12px]";

  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border font-bold ${dim} ${cls}`}
      title={`Performance rating: ${value}`}
    >
      {value}
    </span>
  );
}
