/**
 * QuarterRolloutCard — the Admin's control of the Project Goals review
 * cycle, modelled on the Healthark PMS cycle roll-out:
 *
 *   · the current quarter IS the review window (staff can write the current
 *     quarter and backfill earlier quarters of the year; later quarters are
 *     locked);
 *   · "Roll out Qn" advances one quarter — Q4 → Q1 of the next goal year
 *     starts a new year and needs a typed confirmation;
 *   · a new year starts ALL CLOSED (goal entry off until the Admin opens it
 *     in the year's configuration); the year being left stays open for
 *     backfill until the Admin closes it there;
 *   · "Set manually" jumps to any quarter of the year, or to Q1 of the next
 *     year (first live quarter, corrections, starting the year early);
 *   · "Roll back" moves one quarter back;
 *   · every move is logged and announced in-app to every active user.
 *
 * The per-year switches (goal entry, weightages, backfill, per-quarter
 * ratings) live in the year card next to this one.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, ChevronRight, History, Loader2, Lock, RotateCcw, X } from "lucide-react";
import { goalFrameworkService, type CycleStatus, type PeriodPreflight } from "@/services/goal-framework.service";
import { quarterDisplay, quarterLabel } from "@/services/project-goals.service";
import { queryKeys } from "@/lib/queryKeys";
import { useToast } from "@/hooks/useToast";
import { getErrorMessage } from "@/utils/errors";

const BTN_PRIMARY = "flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity";
const BTN_SECONDARY = "flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-main hover:bg-slate-50 disabled:opacity-50 transition-colors";
const BTN_GHOST = "rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors";
const INPUT_CLS = "w-full rounded-lg border border-border bg-white px-3 py-2 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand";

type Move = { kind: "rollout" } | { kind: "set"; target: string } | { kind: "rollback"; target: string };

function fmt(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtDay(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** "What will / won't change" confirmation, with the typed year label when
 *  the move starts a new goal year, and the pending counts of the quarter
 *  being left behind. */
function MoveModal({ status, move, preflight, onClose, onConfirm, isSaving, error }: Readonly<{
  status: CycleStatus;
  move: Move;
  preflight: PeriodPreflight | null;
  onClose: () => void;
  onConfirm: (confirmation?: string) => void;
  isSaving: boolean;
  error: string;
}>) {
  const target = move.kind === "rollout" ? status.next_label : move.target;
  const targetPeriod = target.replace(/^Q[1-4] /, "");
  const newYear = targetPeriod !== status.period_label;
  const needsTyped = newYear;
  const [typed, setTyped] = useState("");
  const from = status.current_label ? quarterDisplay(status.current_label) : "no quarter";
  const to = quarterDisplay(target);
  const backwards = move.kind === "rollback" || (move.kind === "set" && !newYear && (status.current_seq ?? 0) > Number(target[1]));
  const currentQ = preflight?.quarters.find((q) => q.seq === status.current_seq) ?? null;
  const pendingLine = currentQ && (currentQ.self_pending > 0 || currentQ.review_pending > 0)
    ? `${quarterDisplay(currentQ.cycle_label)} still has ${currentQ.self_pending} self-review${currentQ.self_pending === 1 ? "" : "s"} and ${currentQ.review_pending} review${currentQ.review_pending === 1 ? "" : "s"} pending`
    : currentQ ? `${quarterDisplay(currentQ.cycle_label)} is fully submitted` : null;

  const will: string[] = [];
  const wont: string[] = [];
  if (newYear) {
    will.push(`${targetPeriod} begins a new goal year: ${to} becomes the current quarter and the framework rows are carried over.`);
    will.push(`${targetPeriod} starts with every switch closed — open goal entry in its configuration below once the framework is ready; staff cannot start goals before that.`);
    will.push(`The topbar shows ${targetPeriod}; new goal sets and reviews are stamped ${targetPeriod}.`);
    wont.push(`${status.period_label} stays fully readable and its started quarters stay open for backfill${pendingLine ? ` (${pendingLine})` : ""} until you close the year in its configuration below.`);
    wont.push("Approved goals, submitted reviews and released ratings are preserved.");
    wont.push("Annual goals, annual reviews and the fiscal-year cycle (H1/H2) are separate and unaffected.");
  } else if (backwards) {
    will.push(`${to} becomes the current quarter again; quarters after it are closed.`);
    will.push("Every active user gets an in-app announcement. The move is logged.");
    wont.push("Nothing already submitted is deleted; the closed quarters just become read-only.");
    wont.push("Approved goals and released ratings are untouched.");
  } else {
    will.push(`${to} becomes the current quarter: staff can write and submit their ${to} self-review; mentors can enter the Miltenyi review for it.`);
    will.push(`Earlier quarters of ${status.period_label} stay open for backfill${pendingLine ? ` (${pendingLine})` : ""}; later quarters remain locked.`);
    will.push("Every active user gets an in-app announcement. The move is logged.");
    wont.push("Approved goals are untouched; goals are set once a year.");
    wont.push("Submitted self-reviews and reviews of other quarters are untouched.");
    wont.push("Ratings stay hidden from staff until you release them per quarter in the year's configuration below.");
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg rounded-xl bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <div>
            <h2 className="font-display text-base font-semibold text-text-main">
              {move.kind === "rollback" ? "Roll back" : move.kind === "set" ? "Set the current quarter" : newYear ? "Start the next goal year" : "Roll out the next quarter"}
            </h2>
            <p className="mt-0.5 text-xs text-text-muted">{from} → {to}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-4 px-6 py-5 text-sm text-text-main">
          {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-text-muted">What will change</p>
            <ul className="list-disc space-y-1 pl-5 text-[13px]">{will.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
          <div>
            <p className="mb-1 text-xs font-bold uppercase tracking-wider text-text-muted">What won't change</p>
            <ul className="list-disc space-y-1 pl-5 text-[13px]">{wont.map((w) => <li key={w}>{w}</li>)}</ul>
          </div>
          {needsTyped && (
            <label className="block rounded-lg border border-amber-200 bg-amber-50 p-3">
              <span className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" /> This starts a new goal year. Type <span className="font-mono">{targetPeriod}</span> to confirm.
              </span>
              <input className={INPUT_CLS} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={targetPeriod} autoFocus />
            </label>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button type="button" onClick={onClose} className={BTN_GHOST}>Cancel</button>
          <button
            type="button"
            disabled={isSaving || (needsTyped && typed.trim() !== targetPeriod)}
            onClick={() => onConfirm(needsTyped ? typed.trim() : undefined)}
            className={newYear || backwards ? "flex items-center gap-2 rounded-lg bg-amber-500 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50" : BTN_PRIMARY}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <ChevronRight className="h-4 w-4" />}
            {move.kind === "rollback" ? `Roll back to ${to}` : newYear ? `Start ${targetPeriod} · ${to}` : `Move to ${to}`}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function QuarterRolloutCard() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [move, setMove] = useState<Move | null>(null);
  const [manualTarget, setManualTarget] = useState("");
  const [showLog, setShowLog] = useState(false);

  const q = useQuery({ queryKey: queryKeys.admin.goalCycle(), queryFn: goalFrameworkService.getCycle });
  const logQ = useQuery({ queryKey: queryKeys.admin.goalCycleLog(), queryFn: () => goalFrameworkService.getCycleLog(10), enabled: showLog });
  const st = q.data;
  const preflightQ = useQuery({
    queryKey: queryKeys.admin.goalPreflight(st?.period_label),
    queryFn: () => goalFrameworkService.getPreflight(st?.period_label),
    enabled: !!move && !!st,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.admin.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.projectGoals.all });
  };
  const moveMut = useMutation({
    mutationFn: async ({ m, confirmation }: { m: Move; confirmation?: string }) => {
      if (m.kind === "rollout") return goalFrameworkService.rollout(confirmation);
      if (m.kind === "rollback") return goalFrameworkService.rollback();
      return goalFrameworkService.setCycle(m.target);
    },
    onSuccess: (next) => { setMove(null); refresh(); toast.success(`Current quarter: ${quarterDisplay(next.current_label)}`); },
  });

  /** Any quarter of the review year, plus Q1 of the next year (start it early). */
  const manualOptions = (s: CycleStatus): string[] => {
    const opts = [1, 2, 3, 4].map((n) => quarterLabel(s.period_label, n));
    opts.push(quarterLabel(s.next_period_label === s.period_label ? nextYearLabel(s.period_label) : s.next_period_label, 1));
    return opts.filter((o) => o !== s.current_label);
  };

  return (
    <div className="space-y-4">
      {q.isError && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{getErrorMessage(q.error)}</p>}
      {st && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-light text-brand-accent"><CalendarClock className="h-5 w-5" aria-hidden="true" /></span>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-text-muted">Review year · current quarter</p>
                <p className="font-display text-lg font-semibold text-text-main">{st.current_label ? quarterDisplay(st.current_label) : `${st.period_label} · not started`}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {st.previous_label && (
                <button type="button" className={BTN_SECONDARY} onClick={() => setMove({ kind: "rollback", target: st.previous_label! })} disabled={moveMut.isPending}>
                  <RotateCcw className="h-4 w-4" aria-hidden="true" /> Roll back to {quarterDisplay(st.previous_label)}
                </button>
              )}
              <button type="button" className={BTN_PRIMARY} onClick={() => setMove({ kind: "rollout" })} disabled={moveMut.isPending}>
                <ChevronRight className="h-4 w-4" aria-hidden="true" /> {st.crosses_year ? `Start ${st.next_period_label}` : `Roll out ${quarterDisplay(st.next_label)}`}
                {st.crosses_year && <span className="rounded bg-white/20 px-1.5 py-0.5 text-[10px] font-bold uppercase">new year</span>}
              </button>
            </div>
          </div>

          {/* Quarter strip */}
          <ol className="grid gap-2 sm:grid-cols-4" aria-label="Quarters">
            {[1, 2, 3, 4].map((n) => {
              const label = quarterLabel(st.period_label, n);
              const qr = st.quarters.find((x) => x.seq === n);
              const started = !!qr;
              const isCurrent = st.current_seq === n;
              return (
                <li key={n} className={`rounded-lg border px-3 py-2 ${isCurrent ? "border-brand bg-brand-light/60" : started ? "border-border bg-white" : "border-dashed border-border bg-slate-50"}`}>
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-semibold ${started ? "text-text-main" : "text-text-muted"}`}>Q{n}</span>
                    {isCurrent ? (
                      <span className="rounded-full bg-brand px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white">current</span>
                    ) : started && qr?.backfill_open ? (
                      <span className="text-[10px] font-medium uppercase tracking-wider text-emerald-700">open · backfill</span>
                    ) : started ? (
                      <span className="text-[10px] font-medium uppercase tracking-wider text-text-muted">closed</span>
                    ) : (
                      <Lock className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
                    )}
                  </div>
                  <p className="mt-0.5 text-[11px] text-text-muted">{started ? `${quarterDisplay(label)}${qr?.opened_at ? ` · opened ${fmtDay(qr.opened_at)}` : ""}` : "Not started"}</p>
                </li>
              );
            })}
          </ol>
          <p className="text-xs text-text-muted">
            After Q4, the next roll-out starts <b>{st.crosses_year ? st.next_period_label : nextYearLabel(st.period_label)}</b>: the new year begins all closed and {st.period_label} stays open for backfill until you close it.
          </p>

          {/* Manual set */}
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5">
            <span className="text-xs text-text-muted">Set manually (first live quarter, corrections, or start the next year early):</span>
            <select value={manualTarget} onChange={(e) => setManualTarget(e.target.value)} className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand">
              <option value="">Choose a quarter…</option>
              {manualOptions(st).map((o) => <option key={o} value={o}>{quarterDisplay(o)}{!o.endsWith(st.period_label) ? " (new year)" : ""}</option>)}
            </select>
            <button type="button" className={BTN_SECONDARY} disabled={!manualTarget || moveMut.isPending} onClick={() => manualTarget && setMove({ kind: "set", target: manualTarget })}>Set</button>
            <button type="button" onClick={() => setShowLog((v) => !v)} className="ml-auto flex items-center gap-1.5 text-xs font-medium text-text-muted hover:text-text-main">
              <History className="h-3.5 w-3.5" aria-hidden="true" /> {showLog ? "Hide" : "Show"} roll-out log
            </button>
          </div>
          {showLog && (
            <div className="rounded-lg border border-border">
              {logQ.isPending && <div className="px-4 py-3 text-sm text-text-muted">Loading…</div>}
              {logQ.data?.length === 0 && <div className="px-4 py-3 text-sm text-text-muted">No roll-outs yet.</div>}
              {logQ.data?.map((l) => (
                <div key={l.id} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border px-4 py-2 text-sm last:border-b-0">
                  <div>
                    <span className="font-medium text-text-main">{l.kind}</span>{" "}
                    <span className="text-text-muted">{l.from_label ? quarterDisplay(l.from_label) : "—"} → {quarterDisplay(l.to_label)} · by {l.actor_name ?? "system"}</span>
                  </div>
                  <span className="text-xs text-text-muted">{fmt(l.created_at)}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
      {move && st && (
        <MoveModal
          status={st}
          move={move}
          preflight={preflightQ.data ?? null}
          onClose={() => { setMove(null); moveMut.reset(); }}
          onConfirm={(confirmation) => moveMut.mutate({ m: move, confirmation })}
          isSaving={moveMut.isPending}
          error={moveMut.isError ? getErrorMessage(moveMut.error) : ""}
        />
      )}
    </div>
  );
}

/** "CY 26-27" → "CY 27-28" (mirrors the backend helper for the manual list). */
export function nextYearLabel(periodLabel: string): string {
  const m = /^([A-Za-z]+) (\d{2})-(\d{2})$/.exec(periodLabel.trim());
  if (m) {
    const y = 2000 + Number(m[2]) + 1;
    return `${m[1]} ${String(y % 100).padStart(2, "0")}-${String((y + 1) % 100).padStart(2, "0")}`;
  }
  const y4 = /^([A-Za-z]+) (\d{4})$/.exec(periodLabel.trim());
  if (y4) return `${y4[1]} ${Number(y4[2]) + 1}`;
  return periodLabel;
}
