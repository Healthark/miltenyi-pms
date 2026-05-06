import { useCallback, useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useSystemSettings } from "../hooks/useSystemSettings";
import { useToast } from "../hooks/useToast";
import { useConfirm } from "../hooks/useConfirm";
import { SelfReviewTab } from "../components/reviews/SelfReviewTab";
import { TeamReviewTab } from "../components/reviews/TeamReviewTab";
import { SelfReviewFormModal } from "../components/reviews/SelfReviewFormModal";
import {
  annualReviewService,
  type AnnualReview,
  type SelfReviewPayload,
  type SelfReviewDraftPayload,
} from "../services/annual-review.service";
import { getErrorMessage } from "../utils/errors";
import { formatFyLabel } from "../utils/fy";

type ActiveTab = "my" | "team" | "all";

export function AnnualReviews() {
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const toast = useToast();
  const confirm = useConfirm();

  // Role-based detection. Replaces the previous `has_mentees` shortcut so
  // HR_MyOrg gets their view-only "All Reviews" tab instead of falling
  // through to the Staff layout.
  const isStaff = user?.role === "Staff";
  const isMentor = user?.role === "Mentor";
  const isHRMyOrg = user?.role === "HR_MyOrg";

  const activeCycle = settings?.active_cycle_name ?? "";
  const submissionsOpen = settings?.reviews_submission_open ?? false;

  const fyLabel = settings?.active_cycle_name
    ? formatFyLabel(settings.active_cycle_name)
    : null;

  const [activeTab, setActiveTab] = useState<ActiveTab>("my");

  // Switch to the role's primary tab once auth resolves.
  useEffect(() => {
    if (isMentor) setActiveTab("team");
    else if (isHRMyOrg) setActiveTab("all");
    else setActiveTab("my");
  }, [isMentor, isHRMyOrg]);

  const [reviews, setReviews] = useState<AnnualReview[]>([]);
  const [allReviews, setAllReviews] = useState<AnnualReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      if (isHRMyOrg) {
        setAllReviews(await annualReviewService.getAllReviews());
      } else if (isStaff) {
        setReviews(await annualReviewService.getMyReviewHistory());
      } else {
        // Mentor: TeamReviewTab loads its own data
      }
    } catch {
      /* stays empty */
    } finally {
      setIsLoading(false);
    }
  }, [isHRMyOrg, isStaff]);

  useEffect(() => {
    void load();
  }, [load]);

  // Lookup the active-cycle row (if any). May be a draft (still editable),
  // or one of the post-draft statuses (locked).
  const currentReview =
    reviews.find((r) => r.cycle_name === activeCycle) ?? null;
  const isCurrentDraft = currentReview?.status === "draft";
  // Can open the form when there's no row yet, OR when the existing row
  // is still a draft. Past-draft statuses lock the modal closed.
  const canStart =
    !!activeCycle &&
    submissionsOpen &&
    (!currentReview || isCurrentDraft) &&
    !isLoading;

  const handleSubmit = async (payload: SelfReviewPayload) => {
    const ok = await confirm({
      title: "Submit annual self-review?",
      message: `Submit your self-review for ${
        fyLabel ?? "this cycle"
      }. Once submitted you can't edit your responses, and your mentor will receive it for evaluation.`,
      variant: "warning",
      confirmText: "Submit",
    });
    if (!ok) return;
    setIsSaving(true);
    setFormError("");
    try {
      const saved = await annualReviewService.submitSelfReview(payload);
      // submitSelfReview can either create a new row or promote a draft;
      // upsert into local state by id.
      setReviews((prev) => {
        const idx = prev.findIndex((r) => r.id === saved.id);
        if (idx === -1) return [saved, ...prev];
        const next = prev.slice();
        next[idx] = saved;
        return next;
      });
      setShowForm(false);
      toast.success("Self-review submitted.");
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDraft = async (payload: SelfReviewDraftPayload) => {
    setIsDraftSaving(true);
    setFormError("");
    try {
      // First save calls POST /self/draft to create the row; subsequent
      // saves use PATCH /draft on the existing row.
      const saved = currentReview
        ? await annualReviewService.saveDraft(currentReview.id, payload)
        : await annualReviewService.createSelfDraft(payload);
      setReviews((prev) => {
        const idx = prev.findIndex((r) => r.id === saved.id);
        if (idx === -1) return [saved, ...prev];
        const next = prev.slice();
        next[idx] = saved;
        return next;
      });
      toast.success("Draft saved.");
    } catch (err) {
      setFormError(getErrorMessage(err));
    } finally {
      setIsDraftSaving(false);
    }
  };

  const tabCls = (tab: ActiveTab) =>
    `px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
      activeTab === tab
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  // Header text per role. Staff/Mentor keep the existing "Team Reviews"
  // label (per the audit answer); HR_MyOrg gets a distinct "All Reviews"
  // header signalling org-wide view-only scope.
  const headerTitle = isHRMyOrg ? "All Reviews" : "Team Reviews";
  const headerSubtitle = isHRMyOrg
    ? "View-only access to every annual review across the org."
    : "Complete your team review and provide feedback for your team members.";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-main">
            {headerTitle}
            {fyLabel && (
              <span className="ml-2 text-sm font-normal text-text-muted">
                · {fyLabel}
              </span>
            )}
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">{headerSubtitle}</p>
        </div>
        {/* Self-Review button is Staff-only — never shown for Mentor or HR. */}
        {isStaff && activeTab === "my" && canStart && (
          <button
            type="button"
            onClick={() => {
              setFormError("");
              setShowForm(true);
            }}
            className="shrink-0 flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            {isCurrentDraft ? "Continue Draft" : "Self-Review"}
          </button>
        )}
      </div>

      {/* Tab container */}
      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        <div className="flex border-b border-border px-2">
          {isStaff && (
            <button
              type="button"
              className={tabCls("my")}
              onClick={() => setActiveTab("my")}
            >
              My Reviews
            </button>
          )}
          {isMentor && (
            <button
              type="button"
              className={tabCls("team")}
              onClick={() => setActiveTab("team")}
            >
              Team Review
            </button>
          )}
          {isHRMyOrg && (
            <button
              type="button"
              className={tabCls("all")}
              onClick={() => setActiveTab("all")}
            >
              All Reviews
            </button>
          )}
        </div>

        <div className="p-5">
          {isStaff && activeTab === "my" && (
            <SelfReviewTab reviews={reviews} isLoading={isLoading} />
          )}
          {isMentor && activeTab === "team" && <TeamReviewTab />}
          {isHRMyOrg && activeTab === "all" && (
            <AllReviewsTab reviews={allReviews} isLoading={isLoading} />
          )}
        </div>
      </div>

      {/* Form modal lives at page scope so the header button can open it */}
      {showForm && activeCycle && (
        <SelfReviewFormModal
          cycleName={activeCycle}
          draft={isCurrentDraft ? currentReview : null}
          onSubmit={handleSubmit}
          onSaveDraft={handleSaveDraft}
          onClose={() => {
            setShowForm(false);
            setFormError("");
          }}
          isSaving={isSaving}
          isDraftSaving={isDraftSaving}
          error={formError}
        />
      )}
    </div>
  );
}

// ── HR_MyOrg "All Reviews" view-only table ──────────────────────────

function AllReviewsTab({
  reviews,
  isLoading,
}: {
  readonly reviews: AnnualReview[];
  readonly isLoading: boolean;
}) {
  const [cycleFilter, setCycleFilter] = useState<string>("all");

  const cycles = Array.from(
    new Set(reviews.map((r) => r.cycle_name).filter(Boolean)),
  ).sort((a, b) => b.localeCompare(a));

  const filtered =
    cycleFilter === "all"
      ? reviews
      : reviews.filter((r) => r.cycle_name === cycleFilter);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-text-muted">
        Loading reviews…
      </div>
    );
  }
  if (reviews.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
        <p className="font-display text-base font-medium text-text-main">
          No annual reviews recorded
        </p>
        <p className="mt-1 text-sm text-text-muted">
          Reviews will appear here once Staff submit self-reviews and mentors
          start evaluating.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <label
          htmlFor="all-rev-cycle"
          className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
        >
          Cycle
        </label>
        <select
          id="all-rev-cycle"
          value={cycleFilter}
          onChange={(e) => setCycleFilter(e.target.value)}
          className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer"
        >
          <option value="all">All Cycles</option>
          {cycles.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <span className="text-xs text-text-muted">
          {filtered.length} of {reviews.length}
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="bg-slate-50/80 border-b border-border">
              <th className="text-left px-5 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Employee
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Cycle
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Status
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Self
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Mentor
              </th>
              <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                Final
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50/60 transition-colors">
                <td className="px-5 py-3 font-medium text-text-main">
                  {r.employee_name ?? `User #${r.user_id}`}
                </td>
                <td className="px-4 py-3">
                  <span className="text-[12px] font-semibold text-text-muted bg-slate-100 px-1.5 py-0.5 rounded">
                    {r.cycle_name}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-muted capitalize">
                  {r.status.replace("_", " ")}
                </td>
                <td className="px-4 py-3 text-text-muted">
                  {r.self_performance_rating ?? "—"}
                </td>
                <td className="px-4 py-3 text-text-muted">
                  {r.mentor_performance_rating ?? "—"}
                </td>
                <td className="px-4 py-3 text-text-muted">
                  {r.final_performance_rating ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
