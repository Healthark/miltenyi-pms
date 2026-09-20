/**
 * ProjectGoals — one goal set per staff member per year against the Miltenyi
 * goal-themes framework, reviewed every quarter. Three surfaces share the
 * same table component:
 *
 *   Staff             /project-goals            own set; Goal column (once) or the selected quarter's Self review column editable
 *   Mentor / Admin    /project-goals            team queue for one quarter
 *   Mentor / Admin    /project-goals/:setId     one set; the selected quarter's Miltenyi review column editable, approve / unlock actions
 *
 * The quarter selector picks which quarter's review the two right-hand
 * columns show. The current quarter (rolled out by the Admin in System
 * Settings) is the writable window; earlier quarters of the year stay open
 * for backfill, later ones are locked.
 *
 * `?set_id=` deep links from notifications resolve to the detail route for
 * mentors and Admins; staff always land on their own set. `?cycle=` pre-
 * selects a quarter; `?period=` a goal year (past years stay readable, and
 * writable while the Admin keeps them open for backfill).
 */
import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  FileCheck2,
  Loader2,
  Lock,
  Pencil,
  PenLine,
  Save,
  Send,
  Unlock,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/hooks/useConfirm";
import { queryKeys } from "@/lib/queryKeys";
import { getErrorMessage } from "@/utils/errors";
import {
  isQuarterWritable,
  projectGoalsService,
  quarterDisplay,
  quarterLabel,
  reviewFor,
  type ApprovePayload,
  type FinalRatingBy,
  type GoalReview,
  type GoalSet,
  type PeriodSettings,
  type TeamRow,
  type UnlockPayload,
} from "@/services/project-goals.service";
import { GoalsTable, type ReviewDraft, type Viewer } from "@/components/project-goals/GoalsTable";
import { FrameworkBand } from "@/components/project-goals/FrameworkBand";
import { QuarterProgress, QuarterSelector, YearSelector } from "@/components/project-goals/QuarterSelector";
import { ApproveModal } from "@/components/project-goals/ApproveModal";
import { UnlockModal } from "@/components/project-goals/UnlockModal";
import { ReviewProvenance, type ProvenanceDraft } from "@/components/project-goals/ReviewProvenance";
import { TeamQueue } from "@/components/project-goals/TeamQueue";
import {
  BTN_GHOST,
  BTN_PRIMARY,
  BTN_SECONDARY,
  BTN_WARN,
  Notice,
  SetStatusBadge,
  TH_CLS,
  fmtDate,
} from "@/components/project-goals/ui";

// ── Page shell ──────────────────────────────────────────────────────

function PageHeader({
  title,
  subtitle,
  right,
}: Readonly<{ title: React.ReactNode; subtitle: React.ReactNode; right?: React.ReactNode }>) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">{title}</h1>
        <p className="mt-0.5 text-sm text-text-muted">{subtitle}</p>
      </div>
      {right}
    </div>
  );
}

function Card({ tabs, children }: Readonly<{ tabs: React.ReactNode; children: React.ReactNode }>) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
      <div className="flex border-b border-border px-2">{tabs}</div>
      <div className="space-y-5 p-5">{children}</div>
    </div>
  );
}

const TAB_ACTIVE = "px-4 py-2.5 text-sm font-semibold border-b-2 border-brand text-brand";

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-6 w-64 rounded bg-slate-100" />
      <div className="h-32 rounded-xl bg-slate-100" />
      <div className="h-80 rounded-lg bg-slate-100" />
    </div>
  );
}

/** Which quarter to show first: the `?cycle=` deep link when it is a started
 *  quarter of the period, else the current quarter, else null. */
function useSelectedQuarter(period: PeriodSettings | null | undefined): [string | null, (label: string) => void] {
  const [params, setParams] = useSearchParams();
  const requested = params.get("cycle");
  const started = useMemo(() => new Set((period?.quarters ?? []).map((q) => q.cycle_label)), [period]);
  const fallback = period?.current_quarter_label ?? null;
  const [picked, setPicked] = useState<string | null>(null);

  const value = picked && started.has(picked) ? picked : requested && started.has(requested) ? requested : fallback;
  const onChange = (label: string) => {
    setPicked(label);
    const next = new URLSearchParams(params);
    next.set("cycle", label);
    setParams(next, { replace: true });
  };
  return [value, onChange];
}

/** Which goal year to show: the `?period=` deep link, else the active year. */
function useSelectedPeriod(): [string | null, (label: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get("period");
  const onChange = (label: string) => {
    const next = new URLSearchParams(params);
    next.set("period", label);
    next.delete("cycle");
    setParams(next, { replace: true });
  };
  return [value, onChange];
}

export function ProjectGoals() {
  const { user } = useAuth();
  const { setId } = useParams();
  const [params] = useSearchParams();
  const role = user?.role;

  if (role === "Staff") return <EmployeeGoals />;
  const deepLink = params.get("set_id");
  if (!setId && deepLink) {
    const cycle = params.get("cycle");
    return <Navigate to={`/project-goals/${deepLink}${cycle ? `?cycle=${encodeURIComponent(cycle)}` : ""}`} replace />;
  }
  const viewer: Viewer = role === "Admin" ? "hr" : "mentor";
  if (setId) return <SetDetail setId={Number(setId)} viewer={viewer} />;
  return <TeamGoals viewerIsHr={viewer === "hr"} />;
}

/** Per-quarter hints under the quarter pills: what state that quarter's review is in. */
function quarterHints(set: GoalSet | null, forStaff: boolean): Record<string, string> {
  const out: Record<string, string> = {};
  if (!set) return out;
  for (const r of set.reviews) {
    if (!r.review_is_draft) out[r.cycle_label] = r.acknowledged_at ? "Reviewed · acknowledged" : "Reviewed";
    else if (!r.self_is_draft) out[r.cycle_label] = forStaff ? "Self-review in · awaiting comments" : "Self-review in";
    else if (r.self_status === "draft" || r.review_status === "draft") out[r.cycle_label] = "In progress";
  }
  return out;
}

// ── Staff ───────────────────────────────────────────────────────────

function EmployeeGoals() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [error, setError] = useState("");

  const [periodParam, setPeriodParam] = useSelectedPeriod();
  const q = useQuery({ queryKey: queryKeys.projectGoals.mine(periodParam), queryFn: () => projectGoalsService.getMine(periodParam) });
  const data = q.data;
  const set = data?.goal_set ?? null;
  const period = data?.period ?? null;
  const framework = set?.framework ?? data?.framework ?? null;

  const [cycle, setCycle] = useSelectedQuarter(period);
  const review: GoalReview | null = reviewFor(set, cycle);
  const quarterWritable = isQuarterWritable(period, cycle);
  const quarterShown = quarterDisplay(cycle);

  const [goalDrafts, setGoalDrafts] = useState<Record<number, string>>({});
  const [selfDrafts, setSelfDrafts] = useState<Record<number, string>>({});
  const [selfRating, setSelfRating] = useState<number | "">("");

  useEffect(() => {
    if (!set) return;
    const g: Record<number, string> = {};
    for (const it of set.items) g[it.id] = it.goal_text ?? "";
    setGoalDrafts(g);
  }, [set?.id, set?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!set) return;
    const s: Record<number, string> = {};
    const rItems = new Map((review?.items ?? []).map((ri) => [ri.item_id, ri]));
    for (const it of set.items) s[it.id] = rItems.get(it.id)?.self_text ?? "";
    setSelfDrafts(s);
    setSelfRating(review?.self_rating ?? "");
  }, [set?.id, cycle, review?.id, review?.self_submitted_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.projectGoals.all });
  const onErr = (e: unknown) => setError(getErrorMessage(e));
  const selfPayload = () => ({
    cycle_label: cycle ?? "",
    items: (set?.items ?? []).map((it) => ({ item_id: it.id, self_text: selfDrafts[it.id] ?? "" })),
    self_rating: selfRating === "" ? null : selfRating,
  });

  const yearLabel = period?.period_label ?? periodParam;
  const create = useMutation({ mutationFn: () => projectGoalsService.createMine(yearLabel), onSuccess: () => { setError(""); invalidate(); }, onError: onErr });
  const saveGoals = useMutation({
    mutationFn: () => projectGoalsService.saveMyGoals({ items: (set?.items ?? []).map((it) => ({ item_id: it.id, goal_text: goalDrafts[it.id] ?? "" })) }, yearLabel),
    onSuccess: () => { setError(""); invalidate(); toast.success("Draft saved"); },
    onError: onErr,
  });
  const submitGoals = useMutation({
    mutationFn: async () => {
      await projectGoalsService.saveMyGoals({ items: (set?.items ?? []).map((it) => ({ item_id: it.id, goal_text: goalDrafts[it.id] ?? "" })) }, yearLabel);
      return projectGoalsService.submitMyGoals(yearLabel);
    },
    onSuccess: () => { setError(""); invalidate(); toast.success("Goals submitted"); },
    onError: onErr,
  });
  const saveSelf = useMutation({
    mutationFn: () => projectGoalsService.saveMySelfReview(selfPayload()),
    onSuccess: () => { setError(""); invalidate(); toast.success(`${quarterShown} self-review draft saved`); },
    onError: onErr,
  });
  const submitSelf = useMutation({
    mutationFn: async () => {
      await projectGoalsService.saveMySelfReview(selfPayload());
      return projectGoalsService.submitMySelfReview(cycle ?? "");
    },
    onSuccess: () => { setError(""); invalidate(); toast.success(`${quarterShown} self-review submitted`); },
    onError: onErr,
  });
  const acknowledge = useMutation({
    mutationFn: () => projectGoalsService.acknowledge(cycle ?? ""),
    onSuccess: () => { invalidate(); toast.success("Review acknowledged"); },
    onError: onErr,
  });

  const busy = create.isPending || saveGoals.isPending || submitGoals.isPending || saveSelf.isPending || submitSelf.isPending;
  const editGoal = !!set && set.status === "draft" && !!period?.entry_open;
  const editSelf = !!set && set.status === "approved" && quarterWritable && (!review || review.self_is_draft);
  const allGoalsFilled = !!set && set.items.every((it) => it.is_extra || (goalDrafts[it.id] ?? "").trim().length > 0);
  const allSelfFilled = !!set && set.items.every((it) => it.is_extra || (selfDrafts[it.id] ?? "").trim().length > 0) && selfRating !== "";
  const reviewPublished = !!review && !review.review_is_draft;

  const handleSubmitGoals = async () => {
    const ok = await confirm({
      title: `Submit your ${period?.period_label ?? ""} goals?`,
      message: "This records the goals you agreed offline with your Miltenyi reviewer. They stay fixed for the whole year and every quarter's review is written against them. Your mentor then marks the set approved.",
      confirmText: "Submit goals",
    });
    if (ok) submitGoals.mutate();
  };
  const handleSubmitSelf = async () => {
    const ok = await confirm({
      title: `Submit your ${quarterShown} self-review?`,
      message: "One submission per quarter, locked afterwards. Your mentor reads it before entering the Miltenyi reviewer's comments.",
      confirmText: "Submit self-review",
    });
    if (ok) submitSelf.mutate();
  };

  const periodLabel = period?.period_label ?? framework?.period_label ?? "";
  const header = (
    <PageHeader
      title={<>Project Goals {periodLabel && <span className="ml-2 text-sm font-normal text-text-muted">· {periodLabel}</span>}</>}
      subtitle="Your goals for the year under each KPI, set once and reviewed every quarter: your self-review and your Miltenyi reviewer's comments, side by side."
      right={<YearSelector periods={data?.periods ?? []} value={period?.period_label ?? null} onChange={setPeriodParam} />}
    />
  );

  if (q.isPending) return <div className="space-y-6">{header}<Skeleton /></div>;
  if (q.isError) return <div className="space-y-6">{header}<Notice tone="red" icon={Lock}>{getErrorMessage(q.error)}</Notice></div>;

  const goalsNotice = (() => {
    if (!set) return null;
    const rev = set.miltenyi_reviewer_name ?? "your Miltenyi reviewer";
    const mentor = set.mentor_name ?? "your mentor";
    switch (set.status) {
      case "draft":
        return <Notice tone="info" icon={BookOpen}>Write one goal in each row. Agree the wording with {rev} first; submitting records what was agreed, it does not start an approval round. Goals are set once for {set.period_label} and reviewed every quarter.</Notice>;
      case "submitted":
        return <Notice tone="blue" icon={Clock}><b>Submitted on {fmtDate(set.submitted_at)}.</b> Read-only while {mentor} records the approval agreed with {rev}.</Notice>;
      case "approved":
        return <Notice tone="green" icon={Lock}><b>Approved (agreed offline)</b>, recorded by {set.approved_by_name ?? mentor} on {fmtDate(set.approved_at)}. Goals are locked for {set.period_label}; each quarter you review against them.</Notice>;
      default:
        return null;
    }
  })();

  const quarterNotice = (() => {
    if (!set || set.status !== "approved" || !period) return null;
    const rev = set.miltenyi_reviewer_name ?? "your Miltenyi reviewer";
    const mentor = set.mentor_name ?? "your mentor";
    if (!cycle) return <Notice tone="amber" icon={CalendarClock}>Quarterly reviews have not started yet. The Admin opens Q1 when the first quarter's reviews are due.</Notice>;
    if (reviewPublished) return <Notice tone="violet" icon={FileCheck2}><b>{quarterShown} reviewed on {fmtDate(review?.review_submitted_at)}</b> by {rev}, entered by {review?.entered_by_name ?? mentor}.</Notice>;
    if (review && !review.self_is_draft) return <Notice tone="teal" icon={CheckCircle2}><b>{quarterShown} self-review submitted on {fmtDate(review.self_submitted_at)}.</b> {rev}'s comments will fill the last column once {mentor} has entered them.</Notice>;
    if (quarterWritable) return <Notice tone="info" icon={PenLine}><b>{quarterShown} self-review is open.</b> Write what you delivered against each goal this quarter and give one overall rating. {!period.is_active ? `${period.period_label} has ended; the Admin keeps it open so you can finish this quarter.` : cycle !== period.current_quarter_label ? "This is an earlier quarter of the year; it stays open for backfill." : ""}</Notice>;
    return <Notice tone="amber" icon={Lock}>{quarterShown} is closed{!period.is_active ? ` — ${period.period_label} is a past year and read-only` : ""}.</Notice>;
  })();

  let body: React.ReactNode;
  if (!period) {
    body = <Notice tone="amber" icon={Clock}>{data?.framework_missing_reason ?? "No Project Goals period is open yet."}</Notice>;
  } else if (!framework) {
    body = <Notice tone="amber" icon={Lock}>{data?.framework_missing_reason ?? "No framework applies to you yet."} Ask the Admin to check your function and designation mapping.</Notice>;
  } else if (!set) {
    body = (
      <>
        <FrameworkBand framework={framework} kpiCountNote={`${framework.kpis.length} KPIs follow${period.weightages_visible ? "; weightages are fixed by Miltenyi and total 100%" : ""}${period.extra_goal_enabled ? `, plus one optional "Additional goals" row${period.weightages_visible ? ` at ${period.extra_goal_weightage}%` : ""}.` : "."}`} />
        {period.entry_open ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-6 py-10 text-center">
            <PenLine className="h-8 w-8 text-text-muted" aria-hidden="true" />
            <p className="mt-3 font-medium text-text-main">Start your {period.period_label} goals</p>
            <p className="mt-1 max-w-md text-sm text-text-muted">One row per KPI above, set once for the year. Agree the wording with {data?.miltenyi_reviewer_name ?? "your Miltenyi reviewer"} first, then record it here.</p>
            <button type="button" disabled={busy} onClick={() => create.mutate()} className={`${BTN_PRIMARY} mt-4`}>
              {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}
              Start goal set
            </button>
          </div>
        ) : (
          <Notice tone="amber" icon={Lock}>Goal entry is closed for {period.period_label}.</Notice>
        )}
      </>
    );
  } else {
    body = (
      <>
        <div className="flex flex-wrap items-center gap-2">
          <span className={TH_CLS}>Goals · {set.period_label}</span>
          <SetStatusBadge status={set.status} />
        </div>
        {goalsNotice}
        {set.status === "approved" && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-slate-50 px-4 py-3">
            <QuarterSelector period={period} value={cycle} onChange={setCycle} hints={quarterHints(set, true)} />
            {cycle && <QuarterProgress review={review} quarterOpen={quarterWritable} />}
          </div>
        )}
        {quarterNotice}
        {framework && <FrameworkBand framework={framework} />}
        <GoalsTable
          items={set.items}
          status={set.status}
          viewer="employee"
          review={review}
          cycleLabel={set.status === "approved" ? cycle : null}
          quarterWritable={quarterWritable}
          miltenyiReviewerName={set.miltenyi_reviewer_name}
          mentorName={set.mentor_name}
          editGoal={editGoal}
          goalDrafts={goalDrafts}
          onGoalChange={(id, v) => setGoalDrafts((p) => ({ ...p, [id]: v }))}
          editSelf={editSelf}
          selfDrafts={selfDrafts}
          onSelfChange={(id, v) => setSelfDrafts((p) => ({ ...p, [id]: v }))}
          selfRating={selfRating}
          onSelfRatingChange={setSelfRating}
        />
        {editGoal && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-text-muted">Drafts can be saved and edited. Submit once the goals are agreed with your reviewer.</p>
            <div className="flex items-center gap-3">
              <button type="button" disabled={busy} onClick={() => saveGoals.mutate()} className={BTN_SECONDARY}>
                {saveGoals.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Draft
              </button>
              <button type="button" disabled={busy || !allGoalsFilled} title={allGoalsFilled ? undefined : "Every KPI row needs a goal"} onClick={handleSubmitGoals} className={BTN_PRIMARY}>
                {submitGoals.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit Goals
              </button>
            </div>
          </div>
        )}
        {editSelf && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-text-muted">Self-reviews are one-shot per quarter: locked once submitted.</p>
            <div className="flex items-center gap-3">
              <button type="button" disabled={busy} onClick={() => saveSelf.mutate()} className={BTN_SECONDARY}>
                {saveSelf.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Draft
              </button>
              <button type="button" disabled={busy || !allSelfFilled} title={allSelfFilled ? undefined : "Every row needs a self-review and you need an overall rating"} onClick={handleSubmitSelf} className={BTN_PRIMARY}>
                {submitSelf.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit {quarterShown} Self-Review
              </button>
            </div>
          </div>
        )}
        {reviewPublished && review && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-text-muted">
              {review.acknowledged_at ? `Acknowledged on ${fmtDate(review.acknowledged_at)}.` : "Acknowledging confirms you have read this quarter's review; it does not signal agreement."}
            </p>
            {!review.acknowledged_at && (
              <button type="button" disabled={acknowledge.isPending} onClick={() => acknowledge.mutate()} className={BTN_PRIMARY}>
                {acknowledge.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Acknowledge {quarterShown} review
              </button>
            )}
          </div>
        )}
      </>
    );
  }

  return (
    <div className="space-y-6">
      {header}
      <Card tabs={<button type="button" className={TAB_ACTIVE}>My Goals{periodLabel ? ` · ${periodLabel}` : ""}</button>}>
        {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
        {body}
      </Card>
    </div>
  );
}

// ── Mentor / Admin: team queue ──────────────────────────────────────

function TeamGoals({ viewerIsHr }: Readonly<{ viewerIsHr: boolean }>) {
  const navigate = useNavigate();
  const [periodParam, setPeriodParam] = useSelectedPeriod();
  const periodsQ = useQuery({ queryKey: queryKeys.projectGoals.periods(), queryFn: projectGoalsService.getPeriods });
  const periodQ = useQuery({ queryKey: queryKeys.projectGoals.period(periodParam), queryFn: () => projectGoalsService.getPeriod(periodParam) });
  const period = periodQ.data ?? null;
  const [cycle, setCycle] = useSelectedQuarter(period);
  const yearLabel = period?.period_label ?? periodParam;
  const q = useQuery({
    queryKey: queryKeys.projectGoals.team(yearLabel, cycle),
    queryFn: () => projectGoalsService.getTeam(yearLabel, cycle),
    enabled: periodQ.isSuccess,
  });
  const rows = q.data ?? [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>Project Goals {period && <span className="ml-2 text-sm font-normal text-text-muted">· {period.period_label}{!period.is_active ? (period.backfill_open ? " · open for backfill" : " · closed") : ""}</span>}</>}
        subtitle={viewerIsHr
          ? "Every staff member's goals for the year and the selected quarter's reviews. Mentors enter the Miltenyi reviewers' inputs; the Admin can unlock."
          : "Your mentees' goals for the year and the selected quarter's reviews. You record the offline approval once and enter the Miltenyi reviewer's comments each quarter."}
        right={<YearSelector periods={periodsQ.data ?? []} value={period?.period_label ?? null} onChange={setPeriodParam} />}
      />
      <Card tabs={<button type="button" className={TAB_ACTIVE}>{viewerIsHr ? "All Goals" : "Team Goals"}</button>}>
        {(periodQ.isPending || q.isPending) && <Skeleton />}
        {periodQ.isError && <Notice tone="red" icon={Lock}>{getErrorMessage(periodQ.error)}</Notice>}
        {q.isError && <Notice tone="red" icon={Lock}>{getErrorMessage(q.error)}</Notice>}
        {periodQ.isSuccess && !period && <Notice tone="amber" icon={Clock}>No Project Goals period is active. The Admin sets it up in System Settings.</Notice>}
        {period && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-slate-50 px-4 py-3">
            <QuarterSelector period={period} value={cycle} onChange={setCycle} />
            {!cycle && <span className="text-xs text-text-muted">Quarterly reviews start when the Admin rolls out Q1 in System Settings.</span>}
          </div>
        )}
        {q.isSuccess && (
          <TeamQueue
            rows={rows}
            cycleLabel={cycle}
            viewerIsHr={viewerIsHr}
            onOpen={(r: TeamRow) => { if (r.set_id) navigate(`/project-goals/${r.set_id}${cycle ? `?cycle=${encodeURIComponent(cycle)}` : ""}`); }}
          />
        )}
        {q.isSuccess && (
          <p className="text-xs text-text-muted">Staff whose function has no framework row for their level cannot enter goals until the Admin adds it in Admin Panel → Framework.</p>
        )}
      </Card>
    </div>
  );
}

// ── Mentor / Admin: one set ─────────────────────────────────────────

function SetDetail({ setId, viewer }: Readonly<{ setId: number; viewer: Viewer }>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { user } = useAuth();
  const [error, setError] = useState("");
  const [approveOpen, setApproveOpen] = useState(false);
  const [unlockTarget, setUnlockTarget] = useState<UnlockPayload["target"] | null>(null);

  const q = useQuery({ queryKey: queryKeys.projectGoals.set(setId), queryFn: () => projectGoalsService.getSet(setId) });
  const set = q.data ?? null;
  const period = set?.period ?? null;

  const [cycle, setCycle] = useSelectedQuarter(period);
  const review: GoalReview | null = reviewFor(set, cycle);
  const quarterWritable = isQuarterWritable(period, cycle);
  const quarterShown = quarterDisplay(cycle);

  const [reviewDrafts, setReviewDrafts] = useState<Record<number, ReviewDraft>>({});
  const [finalRating, setFinalRating] = useState<number | "">("");
  const [finalBy, setFinalBy] = useState<FinalRatingBy>("miltenyi");
  const [prov, setProv] = useState<ProvenanceDraft>({ miltenyi_reviewer_name: "", source_received_on: "" });

  useEffect(() => {
    if (!set) return;
    const d: Record<number, ReviewDraft> = {};
    const rItems = new Map((review?.items ?? []).map((ri) => [ri.item_id, ri]));
    for (const it of set.items) d[it.id] = { primary: rItems.get(it.id)?.primary_comment ?? "", note: rItems.get(it.id)?.healthark_note ?? "" };
    setReviewDrafts(d);
    setFinalRating(review?.final_rating ?? "");
    setFinalBy(review?.final_rating_by ?? "miltenyi");
    setProv({
      miltenyi_reviewer_name: review?.miltenyi_reviewer_name ?? set.miltenyi_reviewer_name ?? "",
      source_received_on: review?.source_received_on ?? "",
    });
  }, [set?.id, set?.status, cycle, review?.id, review?.review_submitted_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalidate = () => queryClient.invalidateQueries({ queryKey: queryKeys.projectGoals.all });
  const onErr = (e: unknown) => setError(getErrorMessage(e));

  const buildReviewPayload = (s: GoalSet) => ({
    cycle_label: cycle ?? "",
    items: s.items.map((it) => ({ item_id: it.id, primary_comment: reviewDrafts[it.id]?.primary ?? "", healthark_note: reviewDrafts[it.id]?.note ?? "" })),
    miltenyi_reviewer_name: prov.miltenyi_reviewer_name || null,
    source_received_on: prov.source_received_on || null,
    final_rating: finalRating === "" ? null : finalRating,
    final_rating_by: finalBy,
  });

  const approve = useMutation({
    mutationFn: (payload: ApprovePayload) => projectGoalsService.approve(setId, payload),
    onSuccess: () => { setError(""); setApproveOpen(false); invalidate(); toast.success("Marked approved"); },
    onError: onErr,
  });
  const saveReview = useMutation({
    mutationFn: () => projectGoalsService.saveReview(setId, buildReviewPayload(set!)),
    onSuccess: () => { setError(""); invalidate(); toast.success("Review draft saved"); },
    onError: onErr,
  });
  const submitReview = useMutation({
    mutationFn: async (force: boolean) => {
      await projectGoalsService.saveReview(setId, buildReviewPayload(set!));
      return projectGoalsService.submitReview(setId, cycle ?? "", force);
    },
    onSuccess: () => { setError(""); invalidate(); toast.success(`${quarterShown} review submitted`); },
    onError: onErr,
  });
  const unlock = useMutation({
    mutationFn: (payload: UnlockPayload) => projectGoalsService.unlock(setId, payload),
    onSuccess: () => { setError(""); setUnlockTarget(null); invalidate(); toast.success("Unlocked"); },
    onError: onErr,
  });

  const header = (
    <PageHeader
      title={set ? <>{set.owner_name} <span className="ml-2 text-sm font-normal text-text-muted">· {set.framework?.title ?? ""} · {set.framework?.function_name ?? ""} · {set.period_label}</span></> : "Project Goals"}
      subtitle={set ? <>Mentor: {set.mentor_name ?? "—"} · Miltenyi reviewer: {set.miltenyi_reviewer_name ?? "not set"}</> : ""}
      right={<button type="button" onClick={() => navigate("/project-goals")} className={`${BTN_GHOST} flex items-center gap-2`}><ArrowLeft className="h-4 w-4" /> Back to team</button>}
    />
  );

  if (q.isPending) return <div className="space-y-6">{header}<Skeleton /></div>;
  if (q.isError || !set) return <div className="space-y-6">{header}<Notice tone="red" icon={Lock}>{q.error ? getErrorMessage(q.error) : "Goal set not found."}</Notice></div>;

  const canWrite = viewer === "hr" || set.mentor_id === user?.user_id;
  const approved = set.status === "approved";
  const reviewPublished = !!review && !review.review_is_draft;
  const editReview = canWrite && approved && quarterWritable && !reviewPublished;
  const selfDone = !!review && !review.self_is_draft;
  const allPrimaryFilled = set.items.every((it) => it.is_extra || (reviewDrafts[it.id]?.primary ?? "").trim().length > 0) && finalRating !== "";
  const busy = approve.isPending || saveReview.isPending || submitReview.isPending || unlock.isPending;
  const rev = set.miltenyi_reviewer_name ?? "the Miltenyi reviewer";

  const goalsNotice = (() => {
    switch (set.status) {
      case "draft": return <Notice tone="info" icon={Pencil}>{set.owner_name} is still drafting their {set.period_label} goals. Nothing to do yet.</Notice>;
      case "submitted": return <Notice tone="blue" icon={Check}><b>Goals submitted on {fmtDate(set.submitted_at)}.</b> Confirm the offline agreement with {rev}, then mark the set approved. This locks the Goal column for the year.</Notice>;
      default: return null;
    }
  })();

  const quarterNotice = (() => {
    if (!approved || !period) return null;
    if (!cycle) return <Notice tone="amber" icon={CalendarClock}>Quarterly reviews have not started yet. The Admin rolls out Q1 in System Settings → Project Goals.</Notice>;
    if (reviewPublished) return null;   // the quarter progress row already says it: review submitted, acknowledged or not
    if (selfDone) return <Notice tone="teal" icon={CheckCircle2}><b>{quarterShown} self-review in</b> ({fmtDate(review?.self_submitted_at)}). Enter {rev}'s comments in the last column and the final rating in the footer.</Notice>;
    if (!quarterWritable) return <Notice tone="amber" icon={Lock}>{quarterShown} is closed. Nothing was submitted for it.</Notice>;
    return <Notice tone="amber" icon={Clock}>{set.owner_name} has not submitted a {quarterShown} self-review. You can draft {rev}'s comments now{viewer === "hr" ? " and submit anyway as Admin" : "; submission waits for the self-review"}.</Notice>;
  })();

  const handleSubmitReview = async (force: boolean) => {
    const ok = await confirm({
      title: force ? `Submit the ${quarterShown} review without the self-review?` : `Submit the ${quarterShown} review?`,
      message: force
        ? `${set.owner_name} has not submitted a ${quarterShown} self-review. Submitting now records the Miltenyi comments anyway and is logged as an Admin override.`
        : `This publishes ${rev}'s ${quarterShown} comments and the final rating to ${set.owner_name}. The review is final once submitted; only the Admin can unlock it.`,
      confirmText: "Submit review",
      variant: force ? "warning" : "default",
    });
    if (ok) submitReview.mutate(force);
  };

  return (
    <div className="space-y-6">
      {header}
      <Card tabs={<button type="button" className={TAB_ACTIVE}>Goals &amp; reviews · {set.period_label}</button>}>
        {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <span className={TH_CLS}>Goals · {set.period_label}</span>
          <SetStatusBadge status={set.status} />
        </div>
        {goalsNotice}
        {approved && period && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-slate-50 px-4 py-3">
            <QuarterSelector period={period} value={cycle} onChange={setCycle} hints={quarterHints(set, false)} />
            {cycle && <QuarterProgress review={review} quarterOpen={quarterWritable} />}
          </div>
        )}
        {quarterNotice}
        {set.framework && <FrameworkBand framework={set.framework} />}
        {approved && set.approved_agreed_with && (
          <p className="text-xs text-text-muted">
            Approval recorded by {set.approved_by_name ?? "the mentor"} on {fmtDate(set.approved_at)} · agreed with {set.approved_agreed_with} on {fmtDate(set.approved_agreed_on)}{set.approval_note ? ` · note: ${set.approval_note}` : ""}.
          </p>
        )}
        {canWrite && approved && cycle && (
          <ReviewProvenance
            review={review}
            fallbackReviewerName={set.miltenyi_reviewer_name}
            enteredByName={user?.full_name ?? ""}
            editable={editReview}
            draft={prov}
            onChange={setProv}
          />
        )}
        <GoalsTable
          items={set.items}
          status={set.status}
          viewer={viewer}
          review={review}
          cycleLabel={approved ? cycle : null}
          quarterWritable={quarterWritable}
          miltenyiReviewerName={prov.miltenyi_reviewer_name || set.miltenyi_reviewer_name}
          mentorName={set.mentor_name}
          editReview={editReview}
          reviewDrafts={reviewDrafts}
          onReviewChange={(id, field, v) => setReviewDrafts((p) => ({ ...p, [id]: { ...(p[id] ?? { primary: "", note: "" }), [field]: v } }))}
          finalRating={finalRating}
          onFinalRatingChange={setFinalRating}
          finalBy={finalBy}
          onFinalByChange={setFinalBy}
        />

        {/* Footer actions */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="flex items-center gap-3">
            {viewer === "hr" && (set.status === "submitted" || approved) && (
              <button type="button" disabled={busy} onClick={() => setUnlockTarget("goals")} className={BTN_SECONDARY} title="Refused once any quarter's self-review or review has been submitted"><Unlock className="h-4 w-4" /> Unlock goals</button>
            )}
            {viewer === "hr" && reviewPublished && (
              <button type="button" disabled={busy} onClick={() => setUnlockTarget("review")} className={BTN_SECONDARY}><Unlock className="h-4 w-4" /> Unlock {quarterShown} review</button>
            )}
          </div>
          <div className="flex items-center gap-3">
            {canWrite && set.status === "submitted" && (
              <button type="button" disabled={busy} onClick={() => setApproveOpen(true)} className={BTN_PRIMARY}><Check className="h-4 w-4" /> Mark approved (agreed offline)</button>
            )}
            {editReview && (
              <>
                <button type="button" disabled={busy} onClick={() => saveReview.mutate()} className={BTN_SECONDARY}>
                  {saveReview.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save Draft
                </button>
                {selfDone ? (
                  <button type="button" disabled={busy || !allPrimaryFilled} title={allPrimaryFilled ? undefined : "Every KPI needs the Miltenyi comment and a final rating"} onClick={() => handleSubmitReview(false)} className={BTN_PRIMARY}>
                    {submitReview.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit {quarterShown} Review
                  </button>
                ) : viewer === "hr" ? (
                  <button type="button" disabled={busy || !allPrimaryFilled} onClick={() => handleSubmitReview(true)} className={BTN_WARN}>
                    <Send className="h-4 w-4" /> Submit anyway (Admin)
                  </button>
                ) : (
                  <button type="button" disabled title="Waiting for the staff member's self-review" className={BTN_PRIMARY}><Send className="h-4 w-4" /> Submit {quarterShown} Review</button>
                )}
              </>
            )}
          </div>
        </div>

      </Card>

      {approveOpen && <ApproveModal set={set} onClose={() => setApproveOpen(false)} onConfirm={async (p) => { await approve.mutateAsync(p).catch(() => undefined); }} isSaving={approve.isPending} error={approve.isError ? getErrorMessage(approve.error) : ""} />}
      {unlockTarget && <UnlockModal target={unlockTarget} cycleLabel={cycle} ownerName={set.owner_name} onClose={() => setUnlockTarget(null)} onConfirm={async (p) => { await unlock.mutateAsync(p).catch(() => undefined); }} isSaving={unlock.isPending} error={unlock.isError ? getErrorMessage(unlock.error) : ""} />}
    </div>
  );
}

// Keep the label helper referenced for deep links built elsewhere.
export { quarterLabel };
