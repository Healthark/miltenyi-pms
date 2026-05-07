/**
 * Compact numeric badge showing a 1–5 performance rating.
 * Color-codes by rating tier: 1 green → 2 brand → 3 slate → 4 amber → 5 red.
 *
 * Accepts both numeric (annual review fields) and string (project review
 * `performance_group`) inputs — coerces internally so call sites don't
 * have to. Empty / null / unparseable values render as a muted dash so
 * the layout column width stays consistent.
 */
interface PerformanceRatingBadgeProps {
  readonly value: number | string | null | undefined;
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
  const n =
    value == null || value === ""
      ? null
      : typeof value === "number"
        ? value
        : Number(value);

  if (n == null || Number.isNaN(n)) {
    return <span className="text-[12px] text-text-muted">—</span>;
  }

  const cls = TIER[n] ?? TIER[3];
  const dim =
    size === "md"
      ? "h-7 w-7 text-sm"
      : "h-6 w-6 text-[12px]";

  return (
    <span
      className={`inline-flex items-center justify-center rounded-md border font-bold ${dim} ${cls}`}
      title={`Performance rating: ${n}`}
    >
      {n}
    </span>
  );
}
