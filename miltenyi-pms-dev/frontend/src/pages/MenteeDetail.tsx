import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
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
import {
  menteeService,
  type MenteeDetail as MenteeDetailData,
} from "../services/mentee.service";
import {
  annualReviewService,
  type AnnualReview,
  type MenteeAnnualReview,
  type MentorEvalPayload,
  type MentorEvalDraftPayload,
} from "../services/annual-review.service";
import { MenteeGoalsTab } from "../components/mentees/MenteeGoalsTab";
import { MenteeReviewTab } from "../components/mentees/MenteeReviewTab";
import { MenteeProjectsTab } from "../components/mentees/MenteeProjectsTab";
import { MenteeAnnualSummaryTab } from "../components/mentees/MenteeAnnualSummaryTab";
import { EvalDrawer } from "../components/reviews/EvalDrawer";
import { usePageTitleOverride } from "../hooks/usePageTitleOverride";
import { useConfirm } from "../hooks/useConfirm";
import { useToast } from "../hooks/useToast";
import { getErrorMessage } from "../utils/errors";
import { extractFyToken, formatFyLabel } from "../utils/fy";

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

  const [data, setData] = useState<MenteeDetailData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Replace the "/3" segment in the Topbar breadcrumb with the mentee's name.
  usePageTitleOverride(data?.full_name ?? null);

  const loadDetail = useCallback(
    (options?: { silent?: boolean }) => {
      if (!menteeId || Number.isNaN(menteeId)) {
        setError("Invalid mentee id.");
        setIsLoading(false);
        return () => {};
      }
      let cancelled = false;
      // silent reload (e.g. after an action) keeps the existing tab content
      // visible instead of flashing the skeleton.
      if (!options?.silent) setIsLoading(true);
      setError(null);
      menteeService
        .getDetail(menteeId)
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .catch((err) => {
          if (cancelled) return;
          const msg =
            err?.response?.status === 404
              ? "This mentee is not assigned to you or doesn't exist."
              : "Could not load mentee details. Please try again.";
          setError(msg);
        })
        .finally(() => {
          if (!cancelled && !options?.silent) setIsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    },
    [menteeId],
  );

  useEffect(() => loadDetail(), [loadDetail]);

  const reloadDetail = useCallback(() => {
    loadDetail({ silent: true });
  }, [loadDetail]);

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
  const [evalFy, setEvalFy] = useState<string | null>(null);
  const [evalSaving, setEvalSaving] = useState(false);
  const [evalDraftSaving, setEvalDraftSaving] = useState(false);
  const [evalError, setEvalError] = useState("");
  const confirm = useConfirm();
  const toast = useToast();

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
          department: data.department_name,
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
    setEvalSaving(true);
    setEvalError("");
    try {
      await annualReviewService.submitMentorEval(reviewId, payload);
      setEvalFy(null);
      reloadDetail();
    } catch (err) {
      setEvalError(getErrorMessage(err));
    } finally {
      setEvalSaving(false);
    }
  };

  const handleEvalSaveDraft = async (
    reviewId: number,
    payload: MentorEvalDraftPayload,
  ) => {
    setEvalDraftSaving(true);
    setEvalError("");
    try {
      await annualReviewService.saveMentorDraft(reviewId, payload);
      reloadDetail();
      // Fires for both the explicit "Save Draft" click and the implicit
      // auto-save when this page unmounts (route change). The toast
      // provider lives at the app root, so it survives this component
      // unmounting mid-save.
      toast.success("Draft saved.");
    } catch (err) {
      setEvalError(getErrorMessage(err));
    } finally {
      setEvalDraftSaving(false);
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
              <DetailItem icon={Building2} value={data.department_name} title="Department" />
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
              isSaving={evalSaving}
              isDraftSaving={evalDraftSaving}
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
