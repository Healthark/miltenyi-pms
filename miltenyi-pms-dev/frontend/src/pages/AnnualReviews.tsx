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

type ActiveTab = "my" | "team";

export function AnnualReviews() {
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const toast = useToast();
  const confirm = useConfirm();

  const isMentor = user?.has_mentees ?? false;
  const activeCycle = settings?.active_cycle_name ?? "";
  const submissionsOpen = settings?.reviews_submission_open ?? false;

  const fyLabel = settings?.active_cycle_name
    ? formatFyLabel(settings.active_cycle_name)
    : null;

  const [activeTab, setActiveTab] = useState<ActiveTab>("my");

  const [reviews, setReviews] = useState<AnnualReview[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDraftSaving, setIsDraftSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setReviews(await annualReviewService.getMyReviewHistory());
    } catch {
      /* stays empty */
    } finally {
      setIsLoading(false);
    }
  }, []);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-main">
            Annual Reviews
            {fyLabel && (
              <span className="ml-2 text-sm font-normal text-text-muted">
                · {fyLabel}
              </span>
            )}
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">
            Complete your annual review, receive mentor feedback, and view your
            final rating.
          </p>
        </div>
        {activeTab === "my" && canStart && (
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
          <button
            type="button"
            className={tabCls("my")}
            onClick={() => setActiveTab("my")}
          >
            My Review
          </button>
          {isMentor && (
            <button
              type="button"
              className={tabCls("team")}
              onClick={() => setActiveTab("team")}
            >
              Team Review
            </button>
          )}
        </div>

        <div className="p-5">
          {activeTab === "my" && (
            <SelfReviewTab reviews={reviews} isLoading={isLoading} />
          )}
          {activeTab === "team" && isMentor && <TeamReviewTab />}
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
