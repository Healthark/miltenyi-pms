/**
 * AnnualGoals — one annual goal per person per year, shown like Project
 * Goals (7 Oct 2026): a one-row table whose Goal column holds every goal
 * for the year, with an H1 / H2 selector for the self review and mentor
 * review columns. Ratings stay on the Annual Reviews page.
 *
 *   Staff            /annual-goals            own goal; Goal column or the half's self review editable
 *   Mentor / Admin   /annual-goals            roster for one year, one row per person
 *   Mentor / Admin   /annual-goals/:goalId    one goal; approve, request changes, mentor review (the Admin reads)
 *
 * Deep links: `?goal_id=` (notifications) opens that goal: the staff
 * member's own page on the goal's year, or the detail route for mentors
 * and the Admin. `?fy=2026` picks a year; `?status=` pre-filters the
 * roster (dashboard cards).
 */
import { useMemo, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BookOpen,
  CheckCheck,
  CheckCircle2,
  Clock,
  Info,
  Loader2,
  Lock,
  MessageSquare,
  PenLine,
  Save,
  Send,
} from "lucide-react";

import { useAuth } from "@/hooks/useAuth";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { useToast } from "@/hooks/useToast";
import { useSnackbar } from "@/hooks/useSnackbar";
import { useConfirm } from "@/hooks/useConfirm";
import { queryKeys } from "@/lib/queryKeys";
import { getErrorMessage } from "@/utils/errors";
import { cyLabel } from "@/utils/fy";
import { activeHalfAndFy, isPostApproved } from "@/utils/goalStatus";
import { goalService, type Goal, type TeamGoal } from "@/services/goal.service";
import { profileService } from "@/services/profile.service";
import { ApprovalStatusBadge } from "@/components/goals/ApprovalStatusBadge";
import { BulkApproveModal } from "@/components/goals/BulkApproveModal";
import { RoleExpectationsModal } from "@/components/goals/RoleExpectationsModal";
import { ExportExcelButton } from "@/components/admin/ExportExcelButton";
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, Notice, TH_CLS, fmtDate } from "@/components/project-goals/ui";
import { AnnualGoalTable } from "@/components/annual-goals/AnnualGoalTable";
import { AnnualGoalSheet } from "@/components/annual-goals/AnnualGoalSheet";
import { AnnualRosterTable } from "@/components/annual-goals/AnnualRosterTable";
import { AnnualYearSelector, HalfProgress, HalfSelector } from "@/components/annual-goals/HalfSelector";
import {
  defaultHalf,
  goalDraftOf,
  goalOfYear,
  halfHints,
  halfOpen,
  halfStarted,
  isRosterStatusFilter,
  linkProblem,
  mentorStep,
  selfReviewAllowed,
  selfStep,
  useResettableState,
  type Half,
} from "@/components/annual-goals/helpers";

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
      <div className="h-24 rounded-xl bg-slate-100" />
      <div className="h-72 rounded-lg bg-slate-100" />
    </div>
  );
}

/** `?fy=` as a 4-digit start year, and a setter that keeps the other params. */
function useYearParam(): [number | null, (year: number) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get("fy");
  const value = raw && /^\d{4}$/.test(raw) ? Number(raw) : null;
  const set = (year: number) => {
    const next = new URLSearchParams(params);
    next.set("fy", String(year));
    next.delete("goal_id");
    setParams(next, { replace: true });
  };
  return [value, set];
}

export function AnnualGoals() {
  const { user } = useAuth();
  const { goalId } = useParams();
  const [params] = useSearchParams();
  const role = user?.role;

  if (role === "Staff") {
    if (goalId) return <Navigate to={`/annual-goals?goal_id=${goalId}`} replace />;
    return <MyAnnualGoal />;
  }
  const deepLink = params.get("goal_id");
  if (!goalId && deepLink && /^\d+$/.test(deepLink)) return <Navigate to={`/annual-goals/${deepLink}`} replace />;
  const viewerIsHr = role === "Admin";
  if (goalId) return <AnnualGoalDetail goalId={Number(goalId)} viewerIsHr={viewerIsHr} />;
  return <AnnualGoalsRoster viewerIsHr={viewerIsHr} />;
}

// ── Staff ───────────────────────────────────────────────────────────

function MyAnnualGoal() {
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const [params] = useSearchParams();
  const [error, setError] = useState("");
  const [expectationsOpen, setExpectationsOpen] = useState(false);

  const activeCycle = settings?.active_cycle_name ?? null;
  const active = activeHalfAndFy(activeCycle);
  const goalsQ = useQuery({ queryKey: queryKeys.goals.mine("annual"), queryFn: () => goalService.getMyGoals("annual") });
  const expectationsQ = useQuery({ queryKey: queryKeys.profile.expectations(), queryFn: profileService.getMyExpectations });
  const goals = useMemo(() => goalsQ.data ?? [], [goalsQ.data]);

  // Year: `?fy=`, else the year of a `?goal_id=` deep link, else the active year.
  const [yearParam, setYearParam] = useYearParam();
  const linkedId = Number(params.get("goal_id"));
  const linkedYear = linkedId ? goals.find((g) => g.id === linkedId)?.fy_year ?? null : null;
  const activeYear = active?.fyYear ?? null;
  const years = useMemo(() => {
    const s = new Set<number>();
    if (activeYear != null) s.add(activeYear);
    for (const g of goals) if (g.fy_year != null) s.add(g.fy_year);
    return Array.from(s).sort((a, b) => b - a);
  }, [goals, activeYear]);
  const year: number | null =
    (yearParam != null && years.includes(yearParam) ? yearParam : null) ?? linkedYear ?? activeYear ?? years[0] ?? null;
  const yearText = year != null ? cyLabel(year) : "";

  const { goal, extra } = goalOfYear(goals, year);
  const isActiveYear = activeYear != null && year === activeYear;
  const hasMentor = user?.has_mentor !== false;
  const entryOpen = isActiveYear && !!settings?.annual_goals_edit_enabled;
  const status = goal?.approval_status ?? null;
  const approved = !!goal && isPostApproved(goal.approval_status);
  const editGoal = entryOpen && hasMentor && (goal === null || status === "draft" || status === "changes_requested");
  const mentor = goal?.manager_name ?? "your mentor";
  // The same name at the start of a sentence.
  const mentorStart = goal?.manager_name ?? "Your mentor";

  // Half: picked by the reader for this year, else the current one (or H2 for a past year).
  const [picked, setPicked] = useState<{ year: number | null; half: Half } | null>(null);
  const half: Half =
    picked && picked.year === year && halfStarted(picked.half, year, activeCycle) ? picked.half : defaultHalf(year, activeCycle);
  const started = halfStarted(half, year, activeCycle);
  const open = halfOpen(half, year, activeCycle);
  const sStep = selfStep(goal, half);
  const mStep = mentorStep(goal, half);
  const editSelf = !!goal && approved && started && open && sStep !== "submitted" && selfReviewAllowed(goal, half);

  const [goalDraft, setGoalDraft] = useResettableState(
    `${goal?.id ?? "new"}|${goal?.approval_status ?? ""}|${year ?? ""}`,
    () => goalDraftOf(goal),
  );

  const selfRow = goal?.self_reviews.find((r) => r.cycle_half === half) ?? null;
  const [selfDraft, setSelfDraft] = useResettableState(
    `${goal?.id ?? 0}|${half}|${selfRow?.id ?? 0}|${selfRow?.is_draft ?? ""}`,
    () => selfRow?.self_overall_review ?? "",
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  };
  const onErr = (e: unknown) => setError(getErrorMessage(e));
  const goalPayload = () => ({
    title: goalDraft.title.trim(),
    description: goalDraft.description.trim() || null,
    attachment_url: goalDraft.attachment_url.trim() || null,
  });
  const persistGoal = (): Promise<Goal> =>
    goal ? goalService.updateGoal(goal.id, goalPayload()) : goalService.createGoal({ ...goalPayload(), goal_type: "annual" });

  const saveGoal = useMutation({
    mutationFn: persistGoal,
    onSuccess: () => { setError(""); invalidate(); toast.success("Draft saved"); },
    onError: onErr,
  });
  const submitGoal = useMutation({
    mutationFn: async () => {
      const saved = await persistGoal();
      return goalService.submitGoal(saved.id);
    },
    onSuccess: () => { setError(""); invalidate(); toast.success("Goal submitted for approval"); },
    // A save that worked before a failed submit still shows as the draft.
    onError: (e) => { onErr(e); invalidate(); },
  });
  const saveSelf = useMutation({
    mutationFn: () => goalService.saveSelfReviewDraft(goal!.id, half, { self_overall_review: selfDraft }),
    onSuccess: () => { setError(""); invalidate(); toast.success(`${half} self-review draft saved`); },
    onError: onErr,
  });
  const submitSelf = useMutation({
    mutationFn: () => goalService.submitSelfReview(goal!.id, half, { self_overall_review: selfDraft.trim() }),
    onSuccess: () => { setError(""); invalidate(); toast.success(`${half} self-review submitted`); },
    onError: onErr,
  });

  const busy = saveGoal.isPending || submitGoal.isPending || saveSelf.isPending || submitSelf.isPending;
  const titleOk = goalDraft.title.trim().length > 0;
  const descOk = goalDraft.description.trim().length > 0;
  const linkBad = linkProblem(goalDraft.attachment_url) !== null;

  const handleSubmitGoal = async () => {
    const ok = await confirm({
      title: `Submit your ${yearText} goal for approval?`,
      message: `${mentorStart} approves it or asks for changes. You can't edit it while it waits, and once approved it stays fixed for the year.`,
      confirmText: "Submit goal",
    });
    if (ok) submitGoal.mutate();
  };
  const handleSubmitSelf = async () => {
    const ok = await confirm({
      title: `Submit your ${half} self-review?`,
      message: `One submission per half; it can't be edited afterwards. ${mentorStart} reads it before writing their review.`,
      confirmText: "Submit self-review",
    });
    if (ok) submitSelf.mutate();
  };

  const header = (
    <PageHeader
      title={<>Annual Goals {yearText && <span className="ml-2 text-sm font-normal text-text-muted">· {yearText}</span>}</>}
      subtitle="Your goal for the year: every goal in one row, set once and reviewed every half. Your self-review and your mentor's review sit side by side."
      right={<AnnualYearSelector years={years} value={year} activeYear={activeYear} onChange={setYearParam} />}
    />
  );

  if (goalsQ.isPending) return <div className="space-y-6">{header}<Skeleton /></div>;
  if (goalsQ.isError) {
    return <div className="space-y-6">{header}<Notice tone="red" icon={Lock}>{getErrorMessage(goalsQ.error)}</Notice></div>;
  }

  const goalNotice = (() => {
    if (!goal) {
      if (!hasMentor) {
        return <Notice tone="amber" icon={Lock}>No mentor is assigned to you yet, so you can't set your annual goal. Ask the Admin to assign one.</Notice>;
      }
      if (editGoal) {
        return (
          <Notice tone="info" icon={BookOpen}>
            Write <b>all</b> of your goals for {yearText} in this one row: a short title, then each goal on its own line. Save a draft any time, and submit it for {mentor} to approve when it is ready.
          </Notice>
        );
      }
      if (isActiveYear) return <Notice tone="amber" icon={Lock}>Annual goal entry for {yearText} is closed. The Admin opens it in System Settings.</Notice>;
      return <Notice tone="amber" icon={Clock}>You have no annual goal for {yearText}.</Notice>;
    }
    switch (goal.approval_status) {
      case "draft":
        return editGoal ? (
          <Notice tone="info" icon={BookOpen}>
            Write all of your goals for {yearText} in this one row. Save a draft any time, and submit it for {mentor} to approve when it is ready.
            {goal.manager_feedback ? <> {mentorStart}'s last feedback: “{goal.manager_feedback}”</> : null}
          </Notice>
        ) : (
          <Notice tone="amber" icon={Lock}>Your goal is still a draft, but goal entry for {yearText} is closed. The Admin opens it in System Settings.</Notice>
        );
      case "changes_requested":
        return (
          <Notice tone="amber" icon={MessageSquare}>
            <b>{mentorStart} asked for changes.</b>{" "}
            {goal.manager_feedback ? <>“{goal.manager_feedback}” </> : null}
            {editGoal ? "Edit your goal below and submit it again." : `Goal entry for ${yearText} is closed; the Admin can reopen it.`}
          </Notice>
        );
      case "pending_approval":
        return (
          <Notice tone="blue" icon={Clock}>
            <b>Submitted for approval.</b> {mentorStart} approves it or asks for changes. You can't edit it while it waits.
          </Notice>
        );
      default:
        return (
          <Notice tone="green" icon={CheckCircle2}>
            <b>Approved{goal.approved_at ? ` on ${fmtDate(goal.approved_at)}` : ""}.</b> Your goal is fixed for {yearText}; each half you review your progress against it.
          </Notice>
        );
    }
  })();

  const halfNotice = (() => {
    if (!goal || !approved || !started || mStep === "submitted") return null;
    if (sStep === "submitted") {
      const sr = goal.self_reviews.find((r) => r.cycle_half === half && !r.is_draft);
      return (
        <Notice tone="teal" icon={CheckCircle2}>
          <b>{half} self-review submitted{sr ? ` on ${fmtDate(sr.submitted_at)}` : ""}.</b> {mentorStart}'s review fills the last column once it is in.
        </Notice>
      );
    }
    if (editSelf) {
      return (
        <Notice tone="info" icon={PenLine}>
          <b>{half} self-review is open.</b> Write what you delivered against your goals this half.
          {active && isActiveYear && half !== active.half ? " This half stays open for backfill." : ""}
        </Notice>
      );
    }
    if (open && !selfReviewAllowed(goal, half)) {
      return <Notice tone="amber" icon={Lock}>{half} can no longer be filled: your goal has moved on to the next half.</Notice>;
    }
    return <Notice tone="amber" icon={Lock}>{half} is closed.{!isActiveYear ? ` ${yearText} is a past year and read-only.` : ""}</Notice>;
  })();

  const expectation = expectationsQ.data ?? null;

  return (
    <div className="space-y-6">
      {header}
      <Card tabs={<button type="button" className={TAB_ACTIVE}>My Goal{yearText ? ` · ${yearText}` : ""}</button>}>
        {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className={TH_CLS}>Goal · {yearText}</span>
            {goal ? (
              <ApprovalStatusBadge status={goal.approval_status} />
            ) : (
              <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">Not started</span>
            )}
          </div>
          {expectation && (
            <button
              type="button"
              onClick={() => setExpectationsOpen(true)}
              className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-[12px] font-medium text-blue-700 transition-colors hover:bg-blue-50"
            >
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
              View role expectations
            </button>
          )}
        </div>
        {goalNotice}
        {extra > 0 && (
          <Notice tone="amber" icon={Info}>
            You have {extra} more goal{extra === 1 ? "" : "s"} for {yearText} from before goals were limited to one per year. Only the oldest is shown and used here.
          </Notice>
        )}
        {approved && year != null && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-slate-50 px-4 py-3">
            <HalfSelector fyYear={year} activeCycleName={activeCycle} value={half} onChange={(h) => setPicked({ year, half: h })} hints={halfHints(goal, true)} />
            <HalfProgress selfStep={sStep} mentorStep={mStep} open={open} />
          </div>
        )}
        {halfNotice}
        {(goal || editGoal) && (
          <AnnualGoalTable
            goal={goal}
            viewer="employee"
            half={half}
            halfStarted={started}
            halfOpen={open}
            mentorName={goal?.manager_name ?? null}
            editGoal={editGoal}
            goalDraft={goalDraft}
            onGoalChange={(field, value) => setGoalDraft((d) => ({ ...d, [field]: value }))}
            editSelf={editSelf}
            selfDraft={selfDraft}
            onSelfChange={setSelfDraft}
          />
        )}
        {editGoal && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-text-muted">One goal per year: keep every goal in this row. Drafts can be saved and edited until you submit.</p>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={busy || !titleOk || linkBad}
                title={!titleOk ? "Give the goal a title first" : linkBad ? "Fix the link first" : undefined}
                onClick={() => saveGoal.mutate()}
                className={BTN_SECONDARY}
              >
                {saveGoal.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft
              </button>
              <button
                type="button"
                disabled={busy || !titleOk || !descOk || linkBad}
                title={!titleOk || !descOk ? "Write a title and your goals first" : linkBad ? "Fix the link first" : undefined}
                onClick={handleSubmitGoal}
                className={BTN_PRIMARY}
              >
                {submitGoal.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit for approval
              </button>
            </div>
          </div>
        )}
        {editSelf && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-xs text-text-muted">Self-reviews are one-shot per half: locked once submitted.</p>
            <div className="flex items-center gap-3">
              <button type="button" disabled={busy} onClick={() => saveSelf.mutate()} className={BTN_SECONDARY}>
                {saveSelf.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft
              </button>
              <button
                type="button"
                disabled={busy || !selfDraft.trim()}
                title={selfDraft.trim() ? undefined : "Write your self-review first"}
                onClick={handleSubmitSelf}
                className={BTN_PRIMARY}
              >
                {submitSelf.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit {half} self-review
              </button>
            </div>
          </div>
        )}
      </Card>
      {expectationsOpen && expectation && (
        <RoleExpectationsModal expectation={expectation} onClose={() => setExpectationsOpen(false)} />
      )}
    </div>
  );
}

// ── Mentor / Admin: roster ──────────────────────────────────────────

function AnnualGoalsRoster({ viewerIsHr }: Readonly<{ viewerIsHr: boolean }>) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();
  const snackbar = useSnackbar();
  const [params] = useSearchParams();
  const [yearParam, setYearParam] = useYearParam();
  const [bulkGoals, setBulkGoals] = useState<TeamGoal[] | null>(null);
  const [bulkError, setBulkError] = useState("");

  const q = useQuery({
    queryKey: queryKeys.goals.annualRoster(yearParam),
    queryFn: () => goalService.getAnnualRoster(yearParam),
  });
  const roster = q.data ?? null;
  const statusParam = params.get("status");
  const initialStatus = isRosterStatusFilter(statusParam) ? statusParam : "all";
  const activeHalf = roster && roster.fy_year === roster.active_fy_year ? roster.active_half : null;
  const yearText = roster ? cyLabel(roster.fy_year) : "";
  const pendingCount = roster?.rows.filter((r) => r.approval_status === "pending_approval").length ?? 0;

  const bulkApprove = useMutation({
    mutationFn: (ids: number[]) => goalService.bulkApprove(ids),
    onSuccess: (result, ids) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.mentees.all });
      setBulkGoals(null);
      const n = result.approved_ids.length;
      if (result.failures.length === 0) {
        toast.success(`Approved ${n} goal${n === 1 ? "" : "s"}`);
      } else {
        snackbar.error(`Approved ${n} of ${ids.length}. The rest could not be approved: ${result.failures[0].reason}`);
      }
    },
    onError: (e) => setBulkError(getErrorMessage(e)),
  });

  const openBulk = async () => {
    try {
      const team = await queryClient.fetchQuery({
        queryKey: queryKeys.goals.mentees(),
        queryFn: () => goalService.getTeamGoals("annual"),
      });
      setBulkError("");
      setBulkGoals(team.filter((g) => g.fy_year === roster?.fy_year));
    } catch (e) {
      snackbar.error(getErrorMessage(e));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={<>Annual Goals {yearText && <span className="ml-2 text-sm font-normal text-text-muted">· {yearText}</span>}</>}
        subtitle={
          viewerIsHr
            ? "Every staff member's goal for the year and both halves' reviews. Mentors approve the goals and write the reviews; you can read everything."
            : "Your mentees' goals for the year. Approve each goal, then review it every half once the self-review is in."
        }
        right={
          roster && (
            <AnnualYearSelector years={roster.years} value={roster.fy_year} activeYear={roster.active_fy_year} onChange={setYearParam} />
          )
        }
      />
      <Card tabs={<button type="button" className={TAB_ACTIVE}>{viewerIsHr ? "All Goals" : "Team Goals"}</button>}>
        {q.isPending && <Skeleton />}
        {q.isError && <Notice tone="red" icon={Lock}>{getErrorMessage(q.error)}</Notice>}
        {roster && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-text-muted">
                Goal entry for {yearText} is {roster.entry_open ? "open" : "closed"}.
                {activeHalf ? ` ${activeHalf} reviews are open.` : roster.active_fy_year !== roster.fy_year ? " This year's reviews are closed." : ""}
              </p>
              <div className="flex items-center gap-2">
                {!viewerIsHr && pendingCount > 0 && (
                  <button type="button" onClick={() => void openBulk()} className={BTN_SECONDARY}>
                    <CheckCheck className="h-4 w-4" aria-hidden="true" /> Bulk approve ({pendingCount})
                  </button>
                )}
                {viewerIsHr && <ExportExcelButton kind="goals" />}
              </div>
            </div>
            <AnnualRosterTable
              key={roster.fy_year}
              rows={roster.rows}
              activeHalf={activeHalf}
              viewerIsHr={viewerIsHr}
              initialStatus={initialStatus}
              onOpen={(r) => { if (r.goal_id) navigate(`/annual-goals/${r.goal_id}`); }}
            />
          </>
        )}
      </Card>
      {bulkGoals && (
        <BulkApproveModal
          goals={bulkGoals}
          onClose={() => setBulkGoals(null)}
          onSubmit={async (ids) => {
            await bulkApprove.mutateAsync(ids).catch(() => undefined);
          }}
          isSaving={bulkApprove.isPending}
          error={bulkError}
        />
      )}
    </div>
  );
}

// ── Mentor / Admin: one goal ────────────────────────────────────────

function AnnualGoalDetail({ goalId, viewerIsHr }: Readonly<{ goalId: number; viewerIsHr: boolean }>) {
  const navigate = useNavigate();
  const q = useQuery({
    queryKey: queryKeys.goals.annualSheet(goalId),
    queryFn: () => goalService.getAnnualSheet(goalId),
  });
  const g = q.data ?? null;
  const yearText = g?.fy_year != null ? cyLabel(g.fy_year) : null;
  const back = () => navigate(g?.fy_year != null ? `/annual-goals?fy=${g.fy_year}` : "/annual-goals");

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          g ? (
            <>
              {g.owner_name}{" "}
              <span className="ml-2 text-sm font-normal text-text-muted">
                · {[g.owner_designation_name, g.owner_function_name, yearText].filter(Boolean).join(" · ")}
              </span>
            </>
          ) : (
            "Annual Goals"
          )
        }
        subtitle={g ? <>Mentor: {g.owner_mentor_name ?? "—"}</> : ""}
        right={
          <button type="button" onClick={back} className={`${BTN_GHOST} flex items-center gap-2`}>
            <ArrowLeft className="h-4 w-4" /> {viewerIsHr ? "Back to all goals" : "Back to team"}
          </button>
        }
      />
      <Card tabs={<button type="button" className={TAB_ACTIVE}>Goal &amp; reviews{yearText ? ` · ${yearText}` : ""}</button>}>
        <AnnualGoalSheet goalId={goalId} />
      </Card>
    </div>
  );
}
