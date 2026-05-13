/**
 * InsightStripe — left-bordered callout at the bottom of HR dashboard
 * cards. Surfaces the single most-actionable observation from the
 * card's data ("12 reviews ready for management", "Longest stall: 14
 * days", etc.) so HR can scan the page and know where to act.
 *
 * Tone changes both the border + tint and the leading icon — green
 * for all-clear, amber/red for warnings, brand purple for neutral
 * informational callouts.
 */

import {
  AlertOctagon,
  AlertTriangle,
  CheckCircle2,
  TrendingUp,
} from "lucide-react";

export type InsightTone = "brand" | "amber" | "red" | "green";

interface InsightStripeProps {
  readonly text: string;
  readonly tone?: InsightTone;
}

interface ToneStyle {
  readonly container: string;
  readonly icon: typeof TrendingUp;
  readonly iconClass: string;
}

const TONE_STYLES: Record<InsightTone, ToneStyle> = {
  brand: {
    container: "border-brand bg-brand-light/40",
    icon: TrendingUp,
    iconClass: "text-brand",
  },
  amber: {
    container: "border-amber bg-amber-50",
    icon: AlertTriangle,
    iconClass: "text-amber-600",
  },
  red: {
    container: "border-red bg-rose-50",
    icon: AlertOctagon,
    iconClass: "text-red",
  },
  green: {
    container: "border-green bg-emerald-50/60",
    icon: CheckCircle2,
    iconClass: "text-green",
  },
};

export function InsightStripe({
  text,
  tone = "brand",
}: InsightStripeProps) {
  const style = TONE_STYLES[tone];
  const Icon = style.icon;
  return (
    <div
      className={`flex items-center gap-2 rounded-lg border-l-2 px-3 py-2 ${style.container}`}
    >
      <Icon
        className={`h-3.5 w-3.5 shrink-0 ${style.iconClass}`}
        aria-hidden="true"
      />
      <p className="text-[12px] font-medium text-text-main">{text}</p>
    </div>
  );
}
