import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { queryKeys } from "@/lib/queryKeys";
import {
  ArrowLeft,
  Briefcase,
  ClipboardCheck,
  FileText,
  Target,
  AlertTriangle,
  BadgeCheck,
  Mail,
  Building2,
  Phone,
} from "lucide-react";
import { menteeService } from "@/services/mentee.service";
import {
  annualReviewService,
  type AnnualReview,
  type MenteeAnnualReview,
  type MentorEvalPayload,
  type MentorEvalDraftPayload,
} from "@/services/annual-review.service";
import { MenteeGoalsTab } from "@/components/mentees/MenteeGoalsTab";
import { MenteeReviewTab } from "@/components/mentees/MenteeReviewTab";
import { MenteeProjectsTab } from "@/components/mentees/MenteeProjectsTab";
import { MenteeAnnualSummaryTab } from "@/components/mentees/MenteeAnnualSummaryTab";
import { EvalDrawer } from "@/components/reviews/EvalDrawer";
import { usePageTitleOverride } from "@/hooks/usePageTitleOverride";
import { useConfirm } from "@/hooks/useConfirm";
import { useToast } from "@/hooks/useToast";
import { getErrorMessage } from "@/utils/errors";
import { extractFyToken, formatFyLabel } from "@/utils/fy";

type TabKey = "summary" | "projects" | "goals" | "review";

const TABS: ReadonlyArray<{ key: TabKey; label: string; icon: typeof Target }> = [
  { key: "summary", label: "Annual Summary", icon: ClipboardCheck },
  { key: "projects", label: "Projects", icon: Briefcase },
  { key: "goals", label: "Annual Goals", icon: Target },
  { key: "review", label: "Annual Review", icon: FileText },
];

function initialsFor(name: string): string {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function isTabKey(value: string | null): value is TabKey {
  return (
    value === "goals" ||
    value === "summary" ||
    value === "review" ||
    value === "projects"
  );
}

export function MenteeDetail() {
  const { id } = useParams<{ id: string }>();
  const menteeId = Number(id);

  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get("tab");
  const activeTab: TabKey = isTabKey(tabFromUrl) ? tabFromUrl : "summary";

  const queryClient = useQueryClient();

  // Dynamic key per mentee — switching between two mentees keeps each
  // one's cache entry independently. The old `silent: true` reload
  // machinery is gone: useQuery's data stays visible during background
  // refetches by default (this is stale-while-revalidate). Only the
  // first-ever fetch flips `isPending` true; subsequent refetches use
  // `isFetching` which we don't gate the UI on.
  //
  // `enabled` gates on a valid menteeId so we don't fire a request
  // with NaN (the URL param parses to NaN if the user hand-types
  // /my-mentees/abc).
  const detailQuery = useQuery({
    queryKey: queryKeys.mentees.detail(menteeId),
    queryFn: () => menteeService.getDetail(menteeId),
    enabled: Boolean(menteeId) && !Number.isNaN(menteeId),
  });

  const data = detailQuery.data ?? null;
  const isLoading = detailQuery.isPending && !Number.isNaN(menteeId);

  // Two error sources, same UI treatment: an invalid URL param OR the
  // query failing. The query's failureReason carries the axios error;
  // a 404 (mentee not assigned to us / doesn't exist) gets a different
  // message than transient failures.
  const error: string | null = useMemo(() => {
    if (!menteeId || Number.isNaN(menteeId)) return "Invalid mentee id.";
    if (!detailQuery.isError) return null;
    const err = detailQuery.error as { response?: { status?: number } } | null;
    if (err?.response?.status === 404) {
      return "This mentee is not assigned to you or doesn't exist.";
    }
    return "Could not load mentee details. Please try again.";
  }, [menteeId, detailQuery.isError, detailQuery.error]);

  // Replace the "/3" segment in the Topbar breadcrumb with the mentee's name.
  usePageTitleOverride(data?.full_name ?? null);

  // Bridge for unmigrated child tabs (MenteeGoalsTab, MenteeProjectsTab)
  // that still do imperative mutations and need to refresh the
  // mentee-detail view. Once those tabs migrate to useMutation, they'll
  // invalidate keys directly and we can drop this prop. Until then,
  // expose a stable callback that hits the same invalidation a useQuery
  // mutation would.
  const reloadDetail = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.mentees.detail(menteeId),
    });
  }, [queryClient, menteeId]);

  const setActiveTab = (key: TabKey) => {
    // Preserve any other query params by copying from current search.
    const next = new URLSearchParams(searchParams);
    next.set("tab", key);
    setSearchParams(next, { replace: true });
  };

  // ── Annual eval drawer ────────────────────────────────────────────
  // The drawer lives at the page level (NOT inside the Annual Summary
  // tab) so the mentor can browse other tabs while evaluating. The
  // form's auto-save-on-unmount only fires when this whole page
  // unmounts (route change), not on tab switches.
  //
  // Mutation isPending flags replace the old evalSaving /
  // evalDraftSaving useStates.
  const [evalFy, setEvalFy] = useState<string | null>(null);
  const [evalError, setEvalError] = useState("");
  const confirm = useConfirm();
  const toast = useToast();

  // ── Mentor-eval mutations ──────────────────────────────────────────
  // These were deliberately deferred from PR #21 (AnnualReviews
  // migration) because EvalDrawer / mentor-eval logic lives at the
  // MenteeDetail page level, not the AnnualReviews page level.
  //
  // Broadcast invalidation footprint:
  //   - mentees.all        → this mentee's detail + the mentor's
  //                          summaries (badge counts, pending actions)
  //   - annualReviews.all  → TeamReviewTab, HR's All Reviews, the
  //                          mentee's own history
  //   - dashboard.all      → mentor's mentor_annual_reviews_pending
  //                          count in the dashboard widget
  const invalidateMentorEvalScope = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.mentees.all });
    void queryClient.invalidateQueries({
      queryKey: queryKeys.annualReviews.all,
    });
    void queryClient.invalidateQueries({ queryKey: queryKeys.dashboard.all });
  }, [queryClient]);

  const submitMentorEvalMutation = useMutation({
    mutationFn: (vars: { reviewId: number; payload: MentorEvalPayload }) =>
      annualReviewService.submitMentorEval(vars.reviewId, vars.payload),
    onSuccess: () => {
      invalidateMentorEvalScope();
      setEvalFy(null);
    },
    onError: (err) => setEvalError(getErrorMessage(err)),
  });

  const saveMentorDraftMutation = useMutation({
    mutationFn: (vars: {
      reviewId: number;
      payload: MentorEvalDraftPayload;
    }) => annualReviewService.saveMentorDraft(vars.reviewId, vars.payload),
    onSuccess: () => {
      invalidateMentorEvalScope();
      // Fires for both the explicit "Save Draft" click and the implicit
      // auto-save when this page unmounts (route change). The toast
      // provider lives at the app root, so it survives this component
      // unmounting mid-save.
      toast.success("Draft saved.");
    },
    onError: (err) => setEvalError(getErrorMessage(err)),
  });

  const reviewByCycle = useMemo(() => {
    const m = new Map<string, AnnualReview>();
    if (data) {
      for (const r of data.reviews_list) {
        m.set(extractFyToken(r.cycle_name), r);
      }
    }
    return m;
  }, [data]);

  const evalReview = evalFy ? reviewByCycle.get(evalFy) ?? null : null;
  const enrichedReview: MenteeAnnualReview | null =
    evalReview && data
      ? {
          ...evalReview,
          employee_name: data.full_name,
          employee_email: data.email,
          function: data.function_name,
          designation: data.designation_name,
        }
      : null;

  const openEval = useCallback((fy: string) => {
    setEvalError("");
    setEvalFy(fy);
  }, []);

  const closeEval = useCallback(() => {
    setEvalFy(null);
    setEvalError("");
  }, []);

  // EvalDrawer awaits onSubmit / onSaveDraft to drive its internal
  // "Saving..." state — use mutateAsync + try/catch to preserve the
  // legacy contract (onError sets evalError; the await never sees an
  // exception). Same pattern as PR #20's UserModal and PR #22's
  // GoalFormModal.
  const handleEvalSubmit = async (
    reviewId: number,
    payload: MentorEvalPayload,
  ) => {
    if (!data) return;
    const ok = await confirm({
      title: `Submit annual review for ${data.full_name}?`,
      message: `Submit your evaluation for ${data.full_name} (${formatFyLabel(
        evalFy ?? "",
      )}). Once submitted you can't edit it, and the review is forwarded to management for final calibration.`,
      variant: "warning",
      confirmText: "Submit Evaluation",
    });
    if (!ok) return;
    setEvalError("");
    try {
      await submitMentorEvalMutation.mutateAsync({ reviewId, payload });
    } catch {
      /* handled by onError */
    }
  };

  const handleEvalSaveDraft = async (
    reviewId: number,
    payload: MentorEvalDraftPayload,
  ) => {
    setEvalError("");
    try {
      await saveMentorDraftMutation.mutateAsync({ reviewId, payload });
    } catch {
      /* handled by onError */
    }
  };

  return (
    <div className="space-y-5">
      <Link
        to="/my-mentees"
        className="inline-flex items-center gap-1 text-xs font-medium text-text-muted hover:text-brand"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back to mentees
      </Link>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {isLoading && !data && (
        <div className="h-28 animate-pulse rounded-xl border border-border bg-surface" />
      )}

      {data && (
        <>
          {/* Header — identity + key personal details (folded in from the
              former Profile tab so the mentor can see everything without an
              extra click). */}
          <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div
                className="flex h-14 w-14 items-center justify-center rounded-full bg-brand text-base font-bold text-white shrink-0"
                aria-hidden="true"
              >
                {initialsFor(data.full_name)}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-lg font-semibold text-text-main">
                    {data.full_name}
                  </h1>
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      data.is_active
                        ? "bg-green-100 text-green-700"
                        : "bg-slate-100 text-slate-600"
                    }`}
                  >
                    {data.is_active ? "Active" : "Inactive"}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-text-muted">{data.role}</p>
              </div>
              {data.pending_actions_count > 0 && (
                <div className="flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                  {data.pending_actions_count} pending
                </div>
              )}
            </div>

            {/* Personal details — single inline strip; wraps on narrow screens. */}
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t border-border pt-3 text-xs text-text-main">
              <DetailItem icon={BadgeCheck} value={data.employee_code} title="Employee Code" />
              <DetailItem icon={Mail} value={data.email} title="Email" />
              <DetailItem icon={Building2} value={data.function_name} title="Function" />
              <DetailItem icon={Briefcase} value={data.designation_name} title="Designation" />
              {data.phone && (
                <DetailItem icon={Phone} value={data.phone} title="Phone" />
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="rounded-xl border border-border bg-surface shadow-sm">
            <div className="flex overflow-x-auto border-b border-border px-2">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const isActive = tab.key === activeTab;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex items-center gap-1.5 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
                      isActive
                        ? "border-brand text-brand"
                        : "border-transparent text-text-muted hover:text-text-main"
                    }`}
                  >
                    <Icon className="h-4 w-4" aria-hidden="true" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="p-5">
              {activeTab === "goals" && (
                <MenteeGoalsTab
                  goals={data.goals_list}
                  menteeName={data.full_name}
                  onReload={reloadDetail}
                />
              )}
              {activeTab === "summary" && (
                <MenteeAnnualSummaryTab
                  mentee={data}
                  onOpenEval={openEval}
                />
              )}
              {activeTab === "review" && (
                <MenteeReviewTab
                  reviews={data.reviews_list}
                  menteeName={data.full_name}
                />
              )}
              {activeTab === "projects" && (
                <MenteeProjectsTab
                  assignments={data.project_assignments}
                  menteeName={data.full_name}
                  menteeUserId={data.user_id}
                  onReload={reloadDetail}
                />
              )}
            </div>
          </div>

          {/* Eval drawer — lives at the page level so tab switches
              within MenteeDetail don't unmount it (which would trigger
              EvalForm's auto-save-on-unmount). It only unmounts when
              the user navigates away from this page entirely. */}
          {enrichedReview && (
            <EvalDrawer
              review={enrichedReview}
              onSubmit={handleEvalSubmit}
              onSaveDraft={handleEvalSaveDraft}
              onClose={closeEval}
              isSaving={submitMentorEvalMutation.isPending}
              isDraftSaving={saveMentorDraftMutation.isPending}
              error={evalError}
            />
          )}
        </>
      )}
    </div>
  );
}

function DetailItem({
  icon: Icon,
  value,
  title,
}: {
  readonly icon: typeof Mail;
  readonly value: string | null;
  readonly title: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 min-w-0"
      title={title}
    >
      <Icon className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
      <span className="truncate">{value ?? "—"}</span>
    </span>
  );
}
