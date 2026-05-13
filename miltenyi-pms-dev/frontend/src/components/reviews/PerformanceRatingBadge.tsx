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
  1: "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-700/40",
  2: "bg-brand/10 dark:bg-brand-light/60 text-brand dark:text-brand-accent border-brand/30 dark:border-brand-accent/40",
  3: "bg-slate-100 dark:bg-slate-700/50 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-600",
  4: "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700/40",
  5: "bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300 border-red-200 dark:border-red-700/40",
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
