/**
 * Shared bits for the Project Goals surfaces: class strings copied from the
 * existing evaluation forms so the module reads like the rest of the app,
 * a date formatter, and small presentational atoms (Notice, KpiNumber,
 * WeightChip, SetStatusBadge, StepBadge).
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import type { GoalsStatus, StepStatus } from "@/services/project-goals.service";

export const TEXTAREA_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand resize-none disabled:bg-slate-50 disabled:text-text-muted disabled:cursor-not-allowed";
export const INPUT_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand disabled:bg-slate-50 disabled:text-text-muted";
export const READONLY_CLS =
  "rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm text-text-main whitespace-pre-wrap leading-relaxed";
export const BTN_PRIMARY =
  "flex items-center gap-2 rounded-lg bg-brand px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity";
export const BTN_SECONDARY =
  "flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-main hover:bg-slate-50 disabled:opacity-50 transition-colors";
export const BTN_GHOST =
  "rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors";
export const BTN_WARN =
  "flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity";
export const TH_CLS = "text-[11px] font-bold uppercase tracking-wider text-text-muted";

export const TEXT_MAX = 3000;
export const NOTE_MAX = 1000;

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Goals status badge (yearly lifecycle) ───────────────────────────

const STATUS_CONFIG: Record<GoalsStatus, { label: string; cls: string }> = {
  not_started: { label: "Not started", cls: "bg-slate-100 text-slate-600" },
  draft: { label: "Draft", cls: "bg-slate-100 text-slate-600" },
  submitted: { label: "Submitted", cls: "bg-blue-100 text-blue-700" },
  approved: { label: "Approved · agreed offline", cls: "bg-emerald-100 text-emerald-700" },
};

export function SetStatusBadge({ status }: Readonly<{ status: GoalsStatus }>) {
  const c = STATUS_CONFIG[status] ?? STATUS_CONFIG.not_started;
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${c.cls}`}>
      {c.label}
    </span>
  );
}

// ── Quarter step badge (self-review / review of one quarter) ────────

const STEP_CONFIG: Record<StepStatus, { label: string; cls: string; dot: string }> = {
  not_started: { label: "Not started", cls: "bg-slate-100 text-slate-600", dot: "bg-slate-300" },
  draft: { label: "Draft", cls: "bg-amber-50 text-amber-800 border border-amber-200", dot: "bg-amber-400" },
  submitted: { label: "Submitted", cls: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500" },
};

export function StepBadge({ status, label }: Readonly<{ status: StepStatus; label?: string }>) {
  const c = STEP_CONFIG[status] ?? STEP_CONFIG.not_started;
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ${c.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} aria-hidden="true" />
      {label ?? c.label}
    </span>
  );
}

// ── Atoms ───────────────────────────────────────────────────────────

export function KpiNumber({ n }: Readonly<{ n: number }>) {
  return (
    <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-brand-light text-[12px] font-bold text-brand-accent">
      {n}
    </span>
  );
}

export function WeightChip({ weight }: Readonly<{ weight: number | null }>) {
  if (weight == null) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800"
      title="Weightage fixed by Miltenyi · informational"
    >
      {weight}%
    </span>
  );
}

export type NoticeTone = "info" | "blue" | "green" | "teal" | "violet" | "amber" | "red";

const TONE_CLS: Record<NoticeTone, string> = {
  info: "border-blue-100 bg-blue-50/40 text-text-main",
  blue: "border-blue-100 bg-blue-50 text-blue-800",
  green: "border-emerald-200 bg-emerald-100 text-emerald-700",
  teal: "border-teal-200 bg-teal-100 text-teal-700",
  violet: "border-violet-200 bg-violet-100 text-violet-700",
  amber: "border-amber-200 bg-amber-50 text-amber-800",
  red: "border-red-200 bg-red-50 text-red-700",
};

export function Notice({
  tone,
  icon: Icon,
  children,
}: Readonly<{ tone: NoticeTone; icon: LucideIcon; children: ReactNode }>) {
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-4 py-2.5 text-[13px] ${TONE_CLS[tone]}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}

export function CharCounter({ value, max }: Readonly<{ value: string; max: number }>) {
  const n = value.length;
  return (
    <div className={`mt-1 text-right text-xs ${n >= max ? "text-red-600" : "text-text-muted"}`}>
      {n.toLocaleString()} / {max.toLocaleString()}
    </div>
  );
}
