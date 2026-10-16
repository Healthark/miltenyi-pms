/**
 * PersonalFrameworkModal — the Admin customises one staff member's Project
 * Goals framework for the active goal year (16 Oct 2026): the title, the two
 * paragraphs, KPI texts and weightages and the Additional goals %.
 *
 * Saving applies it to the person's goal sheet at once: goal text and
 * quarter reviews stay on their rows; KPIs can be added or removed only
 * until the goals are approved. Revert goes back to the role column. The
 * staff member and their mentor are notified either way.
 *
 * Opened from the Framework Mapping tab ("Customise framework"), the
 * Framework tab's Personal frameworks list, and the Admin's goal sheet view.
 */
import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CopyPlus, Info, Loader2, Lock, Save, Undo2, X } from "lucide-react";

import { queryKeys } from "@/lib/queryKeys";
import { getErrorMessage } from "@/utils/errors";
import { useToast } from "@/hooks/useToast";
import { goalFrameworkService, type PersonalFramework, type PersonalKpi } from "@/services/goal-framework.service";
import { AutoTextarea, KpiListEditor } from "@/components/admin/frameworkEditor";
import { draftValid, type FrameworkDraft } from "@/components/admin/frameworkDraft";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, INPUT_CLS, Notice, PersonalisedChip, TH_CLS } from "@/components/project-goals/ui";

type Draft = FrameworkDraft<PersonalKpi>;
type Confirming = "save" | "revert" | null;

const BTN_DANGER =
  "flex items-center gap-2 rounded-lg bg-red-600 px-5 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity";

const STATUS_WORD: Record<string, string> = { draft: "a draft", submitted: "submitted", approved: "approved" };

const draftFrom = (p: PersonalFramework): Draft => ({
  title: p.title,
  business_outcomes: p.business_outcomes,
  functional_goals: p.functional_goals,
  kpis: p.kpis.map((k) => ({ ...k })),
  extra_goal_weightage: p.extra_goal_weightage,
});

const sameDraft = (a: Draft, b: Draft) =>
  a.title === b.title && a.business_outcomes === b.business_outcomes && a.functional_goals === b.functional_goals &&
  Number(a.extra_goal_weightage) === Number(b.extra_goal_weightage) && a.kpis.length === b.kpis.length &&
  a.kpis.every((k, i) => k.text === b.kpis[i].text && Number(k.weightage) === Number(b.kpis[i].weightage) && k.item_id === b.kpis[i].item_id);

const rowsPhrase = (from: number, to: number) => (from === to ? `Row ${from}` : `Rows ${from}–${to}`);

export function PersonalFrameworkModal({ userId, startWith, onClose }: Readonly<{ userId: number; startWith?: "revert"; onClose: () => void }>) {
  const q = useQuery({ queryKey: queryKeys.admin.goalPersonal(userId), queryFn: () => goalFrameworkService.getPersonal(userId), staleTime: 0 });
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 py-6" role="dialog" aria-modal="true" aria-label="Personal framework">
      <div className="flex max-h-full w-full max-w-3xl flex-col rounded-xl bg-surface shadow-xl">
        {q.data ? (
          <Editor key={`${q.data.user_id}-${q.data.updated_at ?? "std"}`} data={q.data} startWith={startWith} onClose={onClose} />
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-border px-6 py-4">
              <h2 className="font-display text-base font-semibold text-text-main">Personal framework</h2>
              <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors" aria-label="Close"><X className="h-5 w-5" /></button>
            </div>
            <div className="px-6 py-5">
              {q.isPending && <div className="h-48 animate-pulse rounded-lg bg-slate-100" />}
              {q.isError && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{getErrorMessage(q.error)}</p>}
            </div>
            <div className="flex justify-end border-t border-border px-6 py-4">
              <button type="button" onClick={onClose} className={BTN_GHOST}>Close</button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

function Editor({ data, startWith, onClose }: Readonly<{ data: PersonalFramework; startWith?: "revert"; onClose: () => void }>) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(data));
  const [confirming, setConfirming] = useState<Confirming>(startWith === "revert" && data.is_personal ? "revert" : null);
  const [error, setError] = useState("");
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  const name = data.full_name;
  const hasSheet = data.set_id != null;
  const canCount = data.can_change_kpi_count;
  const column = data.based_on;
  const lockedReason = `${name}'s goals are approved: KPI texts and weightages can change, KPIs cannot be added or removed.`;
  const notified = data.mentor_name ? `${name} and ${data.mentor_name} are notified.` : `${name} is notified.`;

  // Goal text that a save would delete: rows that held text and are gone from the list.
  const dropped = data.kpis.filter((k) => k.item_id != null && k.has_goal_text && !draft.kpis.some((d) => d.item_id === k.item_id));
  const valid = draftValid(draft);
  const changed = !sameDraft(draft, draftFrom(data));
  // Saving unchanged content still makes it personal (a sheet with custom weights becomes its own framework).
  const canSave = valid && (changed || !data.is_personal);

  // Revert takes the role column's KPIs by position.
  const sheetRows = data.kpis.length;
  const columnRows = column?.kpis.length ?? 0;
  const revertBlocked = !column
    ? `There is no role column for ${data.function_name} level ${data.level} to go back to. Add it on the Framework tab first.`
    : hasSheet && !canCount && columnRows !== sheetRows
      ? `${name}'s goals are approved with ${sheetRows} KPIs and the role column has ${columnRows}; KPIs cannot be added or removed after approval.`
      : "";
  const lostText = hasSheet ? data.kpis.slice(columnRows).filter((k) => k.has_goal_text).length : 0;
  const revertRows = !hasSheet || columnRows === sheetRows
    ? ""
    : columnRows < sheetRows
      ? ` ${rowsPhrase(columnRows + 1, sheetRows)} of the sheet ${sheetRows - columnRows === 1 ? "is" : "are"} removed${lostText ? ", with the goal text in them" : ""}.`
      : ` ${columnRows - sheetRows} new KPI ${columnRows - sheetRows === 1 ? "row is" : "rows are"} added.`;

  const last = data.last_year;
  const lastFits = !last || canCount || last.kpis.length === draft.kpis.length;
  const copyLast = () => {
    if (!last) return;
    patch({
      title: last.title,
      business_outcomes: last.business_outcomes,
      functional_goals: last.functional_goals,
      extra_goal_weightage: last.extra_goal_weightage ?? 0,
      kpis: last.kpis.map((k, i) => ({ text: k.text, weightage: k.weightage ?? 0, item_id: draft.kpis[i]?.item_id ?? null, has_goal_text: draft.kpis[i]?.has_goal_text })),
    });
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: queryKeys.admin.all });
    queryClient.invalidateQueries({ queryKey: queryKeys.projectGoals.all });
  };
  const save = useMutation({
    mutationFn: () =>
      goalFrameworkService.savePersonal(data.user_id, {
        title: draft.title.trim(),
        business_outcomes: draft.business_outcomes.trim(),
        functional_goals: draft.functional_goals.trim(),
        kpis: draft.kpis.map((k) => ({ text: k.text.trim(), weightage: Number(k.weightage) || 0, item_id: k.item_id })),
        extra_goal_weightage: Number(draft.extra_goal_weightage) || 0,
      }),
    onSuccess: () => {
      invalidate();
      toast.success(data.is_personal ? `Personal framework saved for ${name}` : `Framework personalised for ${name}`);
      onClose();
    },
    onError: (e) => { setConfirming(null); setError(getErrorMessage(e)); },
  });
  const revert = useMutation({
    mutationFn: () => goalFrameworkService.revertPersonal(data.user_id),
    onSuccess: () => {
      invalidate();
      toast.success(`${name} is back on the standard framework`);
      onClose();
    },
    onError: (e) => { setConfirming(null); setError(getErrorMessage(e)); },
  });
  const busy = save.isPending || revert.isPending;

  const sheetNote = !hasSheet
    ? `${name} has not started their ${data.period_label} goals yet; their sheet will be built from this framework.`
    : canCount
      ? `${name}'s goals are ${STATUS_WORD[data.set_status ?? ""] ?? "in progress"}. Saving updates their sheet at once; goal text stays on its row.`
      : "";

  return (
    <>
      <div className="flex items-start justify-between gap-3 border-b border-border px-6 py-4">
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-text-main">Personal framework · {name} · {data.period_label}</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {data.function_name} · Level {data.level}{data.level_label ? ` · ${data.level_label}` : ""}
            {column ? <> · {data.is_personal ? "based on" : "starts from"} “{column.title}”</> : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {data.is_personal && <PersonalisedChip />}
          <button type="button" onClick={onClose} className="rounded-md p-1.5 text-text-muted hover:bg-slate-50 transition-colors" aria-label="Close"><X className="h-5 w-5" /></button>
        </div>
      </div>

      <div className="space-y-4 overflow-y-auto px-6 py-5 text-sm">
        {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
        {sheetNote && <Notice tone="info" icon={Info}>{sheetNote}</Notice>}
        {!canCount && <Notice tone="amber" icon={Lock}>{lockedReason} Their quarter reviews stay on the rows.</Notice>}
        {dropped.length > 0 && (
          <Notice tone="red" icon={AlertTriangle}>
            Saving deletes the goal {name} wrote for {dropped.map((k) => `“${k.text.length > 60 ? `${k.text.slice(0, 60)}…` : k.text}”`).join(", ")}.
          </Notice>
        )}

        {last && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-border px-3 py-2">
            <span className="text-xs text-text-muted">{name} had a personal framework in {last.period_label}: “{last.title}”, {last.kpis.length} KPIs.</span>
            <button type="button" disabled={!lastFits} title={lastFits ? undefined : `Last year's has ${last.kpis.length} KPIs; ${name}'s approved goals have ${draft.kpis.length}.`} onClick={copyLast} className={BTN_SECONDARY}>
              <CopyPlus className="h-4 w-4" /> Copy last year's
            </button>
          </div>
        )}

        <label className="block">
          <span className={`${TH_CLS} mb-1 block`}>Role title</span>
          <input className={INPUT_CLS} value={draft.title} onChange={(e) => patch({ title: e.target.value })} maxLength={200} placeholder="Role title shown on the sheet" />
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className={`${TH_CLS} mb-1 block`}>Business &amp; strategic outcomes</span>
            <AutoTextarea value={draft.business_outcomes} onChange={(v) => patch({ business_outcomes: v })} placeholder="Business & strategic outcomes" />
          </label>
          <label className="block">
            <span className={`${TH_CLS} mb-1 block`}>Functional / operational excellence goals</span>
            <AutoTextarea value={draft.functional_goals} onChange={(v) => patch({ functional_goals: v })} placeholder="Functional / operational excellence goals" />
          </label>
        </div>
        <div>
          <p className={`${TH_CLS} mb-1.5`}>KPI / success measures · weightage</p>
          <KpiListEditor
            idPrefix={`pf-${data.user_id}`}
            kpis={draft.kpis}
            onKpisChange={(kpis) => patch({ kpis })}
            newKpi={() => ({ text: "", weightage: 0, item_id: null })}
            extra={draft.extra_goal_weightage}
            onExtraChange={(w) => patch({ extra_goal_weightage: w })}
            canAddRemove={canCount}
            lockedReason={lockedReason}
            extraNote={data.extra_goal_enabled
              ? `The free-text row at the end of ${name}'s sheet.`
              : `The year's Additional goals row is off in System Settings; this weightage applies when it is turned on.`}
            kpiBadge={(k) => (k.has_goal_text ? <span className="text-[11px] text-text-muted">· goal written</span> : null)}
          />
        </div>
      </div>

      <div className="border-t border-border px-6 py-4">
        {confirming === "save" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-main">
              {hasSheet ? `Applies to ${name}'s goals now. ` : `${name}'s goals will start from it. `}{notified}
            </p>
            <div className="flex gap-3">
              <button type="button" disabled={busy} onClick={() => setConfirming(null)} className={BTN_GHOST}>Back</button>
              <button type="button" disabled={busy} onClick={() => save.mutate()} className={BTN_PRIMARY}>
                {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Confirm save
              </button>
            </div>
          </div>
        )}
        {confirming === "revert" && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-main">
              {revertBlocked || <>{name}'s framework goes back to “{column?.title}”{hasSheet ? " and their sheet follows now" : ""}.{revertRows} {notified}</>}
            </p>
            <div className="flex gap-3">
              <button type="button" disabled={busy} onClick={() => setConfirming(null)} className={BTN_GHOST}>Back</button>
              <button type="button" disabled={busy || !!revertBlocked} onClick={() => revert.mutate()} className={BTN_DANGER}>
                {revert.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Revert to standard
              </button>
            </div>
          </div>
        )}
        {confirming === null && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {data.is_personal && (
                <button type="button" disabled={busy} onClick={() => setConfirming("revert")} title={revertBlocked || undefined} className="flex items-center gap-2 rounded-lg border border-red-200 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors">
                  <Undo2 className="h-4 w-4" /> Revert to standard
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className={BTN_GHOST}>Cancel</button>
              <button
                type="button"
                disabled={busy || !canSave}
                title={!valid ? "Needs a role title, both paragraphs, text in every KPI and weightages totalling 100" : !canSave ? "Nothing changed" : undefined}
                onClick={() => { setError(""); setConfirming("save"); }}
                className={BTN_PRIMARY}
              >
                <Save className="h-4 w-4" /> {data.is_personal ? "Save" : "Save as personal framework"}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
