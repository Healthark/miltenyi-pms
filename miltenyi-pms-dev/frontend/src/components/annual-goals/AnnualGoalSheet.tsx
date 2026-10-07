/**
 * AnnualGoalSheet — one annual goal as the mentor or the Admin sees it
 * (7 Oct 2026): status, the H1 / H2 selector, the one-row table and the
 * mentor's actions (approve, request changes, write the half's review).
 * The Admin reads only. Used by /annual-goals/:goalId and by the mentee
 * page's Annual Goals tab.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  MessageSquare,
  Pencil,
  RotateCcw,
  Save,
  Send,
} from "lucide-react";
import { queryKeys } from "@/lib/queryKeys";
import { goalService } from "@/services/goal.service";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/hooks/useConfirm";
import { getErrorMessage } from "@/utils/errors";
import { cyLabel } from "@/utils/fy";
import { activeHalfAndFy, isPostApproved } from "@/utils/goalStatus";
import { ApprovalStatusBadge } from "@/components/goals/ApprovalStatusBadge";
import { RoleExpectationsModal } from "@/components/goals/RoleExpectationsModal";
import { BTN_PRIMARY, BTN_SECONDARY, Notice, TH_CLS, fmtDate } from "@/components/project-goals/ui";
import { AnnualGoalTable } from "@/components/annual-goals/AnnualGoalTable";
import { HalfProgress, HalfSelector } from "@/components/annual-goals/HalfSelector";
import { RequestChangesModal } from "@/components/annual-goals/RequestChangesModal";
import {
  defaultHalf,
  halfHints,
  halfOpen,
  halfStarted,
  mentorDraftAllowed,
  mentorStep,
  mentorSubmitAllowed,
  selfStep,
  useResettableState,
  type Half,
} from "@/components/annual-goals/helpers";

export function AnnualGoalSheet({ goalId }: Readonly<{ goalId: number }>) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const { settings } = useSystemSettings();
  const activeCycle = settings?.active_cycle_name ?? null;
  const [error, setError] = useState("");
  const [changesOpen, setChangesOpen] = useState(false);
  const [expectationsOpen, setExpectationsOpen] = useState(false);

  const q = useQuery({
    queryKey: queryKeys.goals.annualSheet(goalId),
    queryFn: () => goalService.getAnnualSheet(goalId),
  });
  const goal = q.data ?? null;
  const fyYear = goal?.fy_year ?? null;

  // Open on the half waiting for the mentor's review (H1 can be waiting
  // during H2), else on the current half.
  const [pickedHalf, setPickedHalf] = useState<Half | null>(null);
  const awaiting: Half | null =
    goal?.approval_status === "h1_self_reviewed" ? "H1" : goal?.approval_status === "h2_self_reviewed" ? "H2" : null;
  const fallbackHalf: Half =
    awaiting && halfStarted(awaiting, fyYear, activeCycle) ? awaiting : defaultHalf(fyYear, activeCycle);
  const half: Half = pickedHalf && halfStarted(pickedHalf, fyYear, activeCycle) ? pickedHalf : fallbackHalf;
  const started = halfStarted(half, fyYear, activeCycle);
  const open = halfOpen(half, fyYear, activeCycle);

  const mentorRow = goal?.mentor_reviews.find((r) => r.cycle_half === half) ?? null;
  const [mentorDraft, setMentorDraft] = useResettableState(
    `${goal?.id ?? 0}|${half}|${mentorRow?.id ?? 0}|${mentorRow?.is_draft ?? ""}`,
    () => mentorRow?.mentor_overall_review ?? "",
  );

  const expectationsQ = useQuery({
    queryKey: queryKeys.goals.annualOwnerExpectations(goalId),
    queryFn: () => goalService.getAnnualOwnerExpectations(goalId),
    enabled: expectationsOpen,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.goals.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
    void queryClient.invalidateQueries({ queryKey: queryKeys.mentees.all });
  };
  const onErr = (e: unknown) => setError(getErrorMessage(e));

  const approve = useMutation({
    mutationFn: () => goalService.updateApproval(goalId, { approval_status: "approved" }),
    onSuccess: () => { setError(""); invalidate(); toast.success("Goal approved"); },
    onError: onErr,
  });
  const requestChanges = useMutation({
    mutationFn: (feedback: string) =>
      goalService.updateApproval(goalId, { approval_status: "changes_requested", feedback }),
    onSuccess: () => { setChangesOpen(false); setError(""); invalidate(); toast.success("Changes requested"); },
  });
  const saveReview = useMutation({
    mutationFn: () => goalService.saveMentorReviewDraft(goalId, half, { mentor_overall_review: mentorDraft }),
    onSuccess: () => { setError(""); invalidate(); toast.success(`${half} review draft saved`); },
    onError: onErr,
  });
  const submitReview = useMutation({
    mutationFn: () => goalService.submitMentorReview(goalId, half, { mentor_overall_review: mentorDraft.trim() }),
    // Stay on the half just reviewed instead of jumping to the next one.
    onSuccess: () => { setPickedHalf(half); setError(""); invalidate(); toast.success(`${half} review submitted`); },
    onError: onErr,
  });

  if (q.isPending) return <div className="h-48 animate-pulse rounded-lg bg-slate-100" />;
  if (q.isError || !goal) {
    return <Notice tone="red" icon={Lock}>{q.error ? getErrorMessage(q.error) : "Goal not found."}</Notice>;
  }

  const owner = goal.owner_name;
  const mentorName = goal.owner_mentor_name ?? goal.manager_name;
  const canReview = goal.can_review;
  const status = goal.approval_status;
  const approved = isPostApproved(status);
  const yearText = fyYear != null ? cyLabel(fyYear) : goal.cycle_name ?? "";
  const sStep = selfStep(goal, half);
  const mStep = mentorStep(goal, half);
  const editMentor = canReview && approved && started && open && mStep !== "submitted" && mentorDraftAllowed(goal, half);
  const canSubmitReview = editMentor && mentorSubmitAllowed(goal, half);
  const busy = approve.isPending || requestChanges.isPending || saveReview.isPending || submitReview.isPending;

  const active = activeHalfAndFy(activeCycle);
  const released =
    !active || fyYear !== active.fyYear
      ? true
      : half === "H1"
        ? settings?.goal_reviews_visible_h1 ?? true
        : settings?.goal_reviews_visible_h2 ?? true;

  const goalNotice = (() => {
    switch (status) {
      case "draft":
        return <Notice tone="info" icon={Pencil}>{owner} is still drafting their {yearText} goal. Nothing to do yet.</Notice>;
      case "pending_approval":
        return canReview ? (
          <Notice tone="blue" icon={Clock}>
            <b>Submitted for your approval.</b> Approve it, or request changes with a note for {owner}. Approving locks the goal for {yearText}.
          </Notice>
        ) : (
          <Notice tone="blue" icon={Clock}>Submitted. Waiting for {mentorName ?? "the mentor"} to approve it.</Notice>
        );
      case "changes_requested":
        return (
          <Notice tone="amber" icon={MessageSquare}>
            <b>Changes requested.</b>{" "}
            {goal.manager_feedback ? <>“{goal.manager_feedback}” </> : null}
            Waiting for {owner} to revise the goal and submit it again.
          </Notice>
        );
      default:
        return null;
    }
  })();

  const halfNotice = (() => {
    if (!approved || !started) return null;
    if (mStep === "submitted") {
      const mr = goal.mentor_reviews.find((r) => r.cycle_half === half && !r.is_draft);
      return (
        <Notice tone="green" icon={CheckCircle2}>
          <b>{half} review submitted{mr ? ` on ${fmtDate(mr.submitted_at)}` : ""}.</b>
          {!released ? ` It stays hidden from ${owner} until the Admin releases ${half} reviews in System Settings.` : ""}
        </Notice>
      );
    }
    if (sStep === "submitted") {
      const sr = goal.self_reviews.find((r) => r.cycle_half === half && !r.is_draft);
      return (
        <Notice tone="teal" icon={CheckCircle2}>
          <b>{half} self-review in</b>{sr ? ` (${fmtDate(sr.submitted_at)})` : ""}.{" "}
          {canReview ? "Write your review in the last column." : `Waiting for ${mentorName ?? "the mentor"}'s review.`}
        </Notice>
      );
    }
    if (!open) return <Notice tone="amber" icon={Lock}>{half} is closed. Nothing was submitted for it.</Notice>;
    if (canReview && !mentorDraftAllowed(goal, half)) {
      return <Notice tone="amber" icon={Lock}>{half} can no longer be reviewed: the goal has moved on to the next half.</Notice>;
    }
    return (
      <Notice tone="amber" icon={Clock}>
        {owner} has not submitted an {half} self-review yet.
        {canReview ? " You can draft your review now; submitting waits for the self-review." : ""}
      </Notice>
    );
  })();

  const handleApprove = async () => {
    const ok = await confirm({
      title: `Approve ${owner}'s ${yearText} goal?`,
      message: `This locks the goal for the year. ${owner} then writes a self-review every half and you review it.`,
      confirmText: "Approve",
    });
    if (ok) approve.mutate();
  };
  const handleSubmitReview = async () => {
    const ok = await confirm({
      title: `Submit your ${half} review?`,
      message: released
        ? `${owner} sees it straight away. A submitted review cannot be edited.`
        : `It stays hidden from ${owner} until the Admin releases ${half} reviews. A submitted review cannot be edited.`,
      confirmText: "Submit review",
    });
    if (ok) submitReview.mutate();
  };


  return (
    <div className="space-y-4">
      {error && <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={TH_CLS}>Goal · {yearText}</span>
          <ApprovalStatusBadge status={status} />
          {approved && goal.approved_at && (
            <span className="text-xs text-text-muted">Approved on {fmtDate(goal.approved_at)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {expectationsOpen && expectationsQ.isError && (
            <span className="text-xs text-red-600">{getErrorMessage(expectationsQ.error)}</span>
          )}
          <button
            type="button"
            onClick={() => setExpectationsOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-[12px] font-medium text-blue-700 transition-colors hover:bg-blue-50"
          >
            {expectationsOpen && expectationsQ.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            View role expectations
          </button>
        </div>
      </div>
      {goalNotice}
      {approved && fyYear != null && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-slate-50 px-4 py-3">
          <HalfSelector
            fyYear={fyYear}
            activeCycleName={activeCycle}
            value={half}
            onChange={setPickedHalf}
            hints={halfHints(goal, false)}
          />
          <HalfProgress selfStep={sStep} mentorStep={mStep} open={open} />
        </div>
      )}
      {halfNotice}
      <AnnualGoalTable
        goal={goal}
        viewer={canReview ? "mentor" : "hr"}
        half={half}
        halfStarted={started}
        halfOpen={open}
        mentorName={mentorName}
        editMentor={editMentor}
        mentorDraft={mentorDraft}
        onMentorChange={setMentorDraft}
      />

      {canReview && (status === "pending_approval" || editMentor) && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="text-xs text-text-muted">
            {status === "pending_approval"
              ? "Approve once the goal is agreed. Request changes to send it back with a note."
              : "Drafts can be saved and edited. A submitted review is final."}
          </p>
          <div className="flex items-center gap-3">
            {status === "pending_approval" && (
              <>
                <button type="button" disabled={busy} onClick={() => setChangesOpen(true)} className={BTN_SECONDARY}>
                  <RotateCcw className="h-4 w-4" /> Request changes
                </button>
                <button type="button" disabled={busy} onClick={handleApprove} className={BTN_PRIMARY}>
                  {approve.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} Approve
                </button>
              </>
            )}
            {editMentor && (
              <>
                <button type="button" disabled={busy} onClick={() => saveReview.mutate()} className={BTN_SECONDARY}>
                  {saveReview.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save draft
                </button>
                <button
                  type="button"
                  disabled={busy || !canSubmitReview || !mentorDraft.trim()}
                  title={
                    !canSubmitReview
                      ? `Waiting for ${owner}'s ${half} self-review`
                      : !mentorDraft.trim()
                        ? "Write the review first"
                        : undefined
                  }
                  onClick={handleSubmitReview}
                  className={BTN_PRIMARY}
                >
                  {submitReview.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Submit {half} review
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {changesOpen && (
        <RequestChangesModal
          ownerName={owner}
          onClose={() => setChangesOpen(false)}
          onSend={async (feedback) => {
            await requestChanges.mutateAsync(feedback).catch(() => undefined);
          }}
          isSaving={requestChanges.isPending}
          error={requestChanges.isError ? getErrorMessage(requestChanges.error) : ""}
        />
      )}
      {expectationsOpen && expectationsQ.data && (
        <RoleExpectationsModal
          expectation={expectationsQ.data}
          title={`${owner}'s role expectations`}
          onClose={() => setExpectationsOpen(false)}
        />
      )}
    </div>
  );
}
