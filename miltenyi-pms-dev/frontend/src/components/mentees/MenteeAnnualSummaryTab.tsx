/**
 * MenteeAnnualSummaryTab — Mentor's at-a-glance view of everything they
 * need to write a mentee's annual review for the selected FY.
 *
 * Surfaces:
 *   - Year picker + review status pill + "Fill Annual Review" CTA
 *   - Mentee's self review (rating + paragraph) when filed
 *   - Annual goals for the FY, each with H1 + H2 self/mentor review text
 *     side by side and criteria progress at the top
 *   - Project assignments grouped by half within the FY, each with
 *     performance group + PM eval excerpt
 *
 * The CTA calls `onOpenEval(selectedFy)` — the actual EvalDrawer is
 * mounted at the MenteeDetail page level so tab switches don't unmount
 * it (and don't trigger EvalForm's auto-save-on-unmount). Auto-save
 * only fires when the user leaves the mentee page entirely.
 */

import { useEffect, useMemo, useState } from "react";
import {
  Briefcase,
  ChevronDown,
  ChevronUp,
  ClipboardCheck,
  Save,
  Target,
} from "lucide-react";
import {
  type AnnualReview,
  type ReviewStatus,
} from "../../services/annual-review.service";
import type { MenteeDetail } from "../../services/mentee.service";
import type {
  TeamGoal,
  GoalSelfReview,
  GoalMentorReview,
  SelfReviewCycleHalf,
} from "../../services/goal.service";
import type { MenteeProjectAssignment } from "../../services/mentee.service";
import { PerformanceRatingBadge } from "../reviews/PerformanceRatingBadge";
import { useSystemSettings } from "../../hooks/useSystemSettings";
import {
  extractFyToken,
  formatFyLabel,
  fyTokenToStartYear,
} from "../../utils/fy";

interface MenteeAnnualSummaryTabProps {
  readonly mentee: MenteeDetail;
  /** Open the page-level eval drawer for the given FY token. Drawer
   *  state lives in MenteeDetail so tab switches don't unmount it. */
  readonly onOpenEval: (fy: string) => void;
}

// ── Status helpers ──────────────────────────────────────────────────

const STATUS_PILL: Record<
  ReviewStatus | "none",
  { label: string; cls: string }
> = {
  none: {
    label: "Not started",
    cls: "bg-slate-100 text-slate-600",
  },
  draft: {
    label: "Mentee drafting",
    cls: "bg-slate-100 text-slate-600",
  },
  pending_mentor: {
    label: "Awaiting your evaluation",
    cls: "bg-amber-50 text-amber-700",
  },
  // Both post-mentor states read as "Reviewed" from the mentor's POV —
  // they've done their part; management calibration is a downstream step.
  pending_management: {
    label: "Reviewed",
    cls: "bg-green-50 text-green-700",
  },
  completed: {
    label: "Reviewed",
    cls: "bg-green-50 text-green-700",
  },
};

function StatusPill({ status }: { readonly status: ReviewStatus | null }) {
  const cfg = STATUS_PILL[status ?? "none"];
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${cfg.cls}`}
    >
      {cfg.label}
    </span>
  );
}

// ── Review paragraph card ───────────────────────────────────────────
//
// Shared shape for the mentee's self-review AND the mentor's review.
// Layout: large rating badge top-left, label + author next to it, body
// paragraph spans the full width below. Putting the badge on the left
// makes the rating the first thing the eye lands on — much more visible
// than the original right-edge placement.

function ReviewParagraphCard({
  label,
  ratingLabel,
  rating,
  text,
  emptyText,
}: {
  readonly label: string;
  readonly ratingLabel: string;
  readonly rating: number | null;
  readonly text: string | null;
  readonly emptyText: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const body = text ?? "";
  const isLong = body.length > 280;
  const display = expanded || !isLong ? body : `${body.slice(0, 280)}…`;

  return (
    <section className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <div className="flex items-start gap-3">
        {/* Prominent rating column on the left. Reserves a fixed width so
            cards stack visually even when one of them has no rating. */}
        <div className="flex w-16 shrink-0 flex-col items-center gap-1">
          {rating !== null ? (
            <>
              <PerformanceRatingBadge value={rating} size="md" />
              <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted text-center">
                {ratingLabel}
              </span>
            </>
          ) : (
            <span className="text-[10px] italic text-text-muted text-center">
              {ratingLabel}
              <br />—
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            {label}
          </p>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-text-main">
            {display || (
              <span className="italic text-text-muted">{emptyText}</span>
            )}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-brand hover:underline"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3.5 w-3.5" /> Show less
                </>
              ) : (
                <>
                  <ChevronDown className="h-3.5 w-3.5" /> Read full
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Goal card with H1/H2 columns ────────────────────────────────────

function HalfPanel({
  half,
  self,
  mentor,
}: {
  readonly half: SelfReviewCycleHalf;
  readonly self: GoalSelfReview | undefined;
  readonly mentor: GoalMentorReview | undefined;
}) {
  return (
    <div className="rounded-md border border-border bg-slate-50/50 p-3">
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wider text-text-muted">
        {half}
      </p>
      <div className="space-y-2">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            Self-review
          </p>
          {self ? (
            <p className="mt-0.5 whitespace-pre-wrap text-xs text-text-main">
              {self.self_overall_review}
            </p>
          ) : (
            <p className="mt-0.5 text-xs italic text-text-muted">
              Not submitted
            </p>
          )}
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            Your review
          </p>
          {mentor ? (
            <p className="mt-0.5 whitespace-pre-wrap text-xs text-text-main">
              {mentor.mentor_overall_review}
            </p>
          ) : (
            <p className="mt-0.5 text-xs italic text-text-muted">—</p>
          )}
        </div>
      </div>
    </div>
  );
}

function GoalSummaryCard({ goal }: { readonly goal: TeamGoal }) {
  const [isExpanded, setIsExpanded] = useState(false);

  const h1Self = goal.self_reviews.find((sr) => sr.cycle_half === "H1");
  const h2Self = goal.self_reviews.find((sr) => sr.cycle_half === "H2");
  const h1Mentor = goal.mentor_reviews.find((mr) => mr.cycle_half === "H1");
  const h2Mentor = goal.mentor_reviews.find((mr) => mr.cycle_half === "H2");

  const completedCount = goal.criteria.filter((c) => c.is_completed).length;
  const totalCriteria = goal.criteria.length;

  return (
    <article className="rounded-lg border border-border bg-surface shadow-sm">
      <button
        type="button"
        onClick={() => setIsExpanded((v) => !v)}
        className="w-full text-left p-4 flex items-start justify-between gap-3 hover:bg-slate-50/60 transition-colors rounded-lg"
        aria-expanded={isExpanded}
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium text-text-main">{goal.title}</p>
          {goal.description && (
            <p className="mt-1 text-xs text-text-muted line-clamp-2">
              {goal.description}
            </p>
          )}
        </div>
        <ChevronDown
          className={`h-4 w-4 text-text-muted shrink-0 mt-0.5 transition-transform duration-200 ${
            isExpanded ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {isExpanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          {totalCriteria > 0 && (
            <div className="flex items-center gap-2">
              <div className="h-1.5 w-32 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    goal.progress_percent === 100
                      ? "bg-green-500"
                      : goal.progress_percent >= 50
                        ? "bg-blue-500"
                        : "bg-amber-500"
                  }`}
                  style={{ width: `${goal.progress_percent}%` }}
                />
              </div>
              <span className="text-xs font-medium text-text-muted">
                {completedCount}/{totalCriteria} key results · {goal.progress_percent}%
              </span>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <HalfPanel half="H1" self={h1Self} mentor={h1Mentor} />
            <HalfPanel half="H2" self={h2Self} mentor={h2Mentor} />
          </div>
        </div>
      )}
    </article>
  );
}

// ── Project card ────────────────────────────────────────────────────

const COMPETENCY_LABELS: ReadonlyArray<{
  key:
    | "comment_task_execution"
    | "comment_ownership"
    | "comment_project_management"
    | "comment_client_deliverables"
    | "comment_communication"
    | "comment_mentoring"
    | "comment_competency_skills";
  label: string;
}> = [
  { key: "comment_task_execution", label: "Task Execution" },
  { key: "comment_ownership", label: "Ownership" },
  { key: "comment_project_management", label: "Project Management" },
  { key: "comment_client_deliverables", label: "Client Deliverables" },
  { key: "comment_communication", label: "Communication" },
  { key: "comment_mentoring", label: "Mentoring" },
  { key: "comment_competency_skills", label: "Competency & Skills" },
];

function ProjectSummaryCard({
  assignment,
}: {
  readonly assignment: MenteeProjectAssignment;
}) {
  const [expanded, setExpanded] = useState(false);
  const detail = assignment.review_detail;
  const filledComments = detail
    ? COMPETENCY_LABELS.filter(({ key }) => Boolean(detail[key]))
    : [];
  const secondaryEvals = detail?.secondary_evaluations ?? [];
  const hasNarrative = filledComments.length > 0 || secondaryEvals.length > 0;

  const headerContent = (
    <div className="flex items-start gap-3 w-full">
      {/* Rating column — mirrors ReviewParagraphCard */}
      <div className="flex w-16 shrink-0 flex-col items-center gap-1">
        {assignment.performance_group != null ? (
          <>
            <PerformanceRatingBadge
              value={Number(assignment.performance_group)}
              size="md"
            />
            <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted text-center">
              PM Rating
            </span>
          </>
        ) : (
          <span className="text-[10px] italic text-text-muted text-center leading-tight">
            PM Rating
            <br />—
          </span>
        )}
      </div>

      {/* Project info */}
      <div className="min-w-0 flex-1">
        <p className="font-medium text-text-main">
          {assignment.project_name}
          <span className="ml-1.5 text-[11px] font-mono text-text-muted">
            ({assignment.project_code})
          </span>
        </p>
        <p className="mt-0.5 text-xs text-text-muted">
          {assignment.assignment_role ?? "—"}
          {assignment.cycle && ` · ${assignment.cycle}`}
          {assignment.pm_name && ` · PM: ${assignment.pm_name}`}
        </p>
        {!hasNarrative && (
          <p className="mt-1 text-xs italic text-text-muted">
            {assignment.review_status === "reviewed"
              ? "PM evaluation has no narrative comments."
              : "Not yet evaluated by PM."}
          </p>
        )}
      </div>

      {hasNarrative && (
        <ChevronDown
          className={`h-4 w-4 text-text-muted shrink-0 mt-0.5 transition-transform duration-200 ${
            expanded ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      )}
    </div>
  );

  return (
    <article className="rounded-lg border border-border bg-surface shadow-sm">
      {hasNarrative ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="w-full text-left p-4 hover:bg-slate-50/60 transition-colors rounded-lg"
          aria-expanded={expanded}
        >
          {headerContent}
        </button>
      ) : (
        <div className="p-4">{headerContent}</div>
      )}

      {expanded && hasNarrative && (
        <div className="px-4 pb-4 space-y-2 border-t border-border pt-3">
          {filledComments.map(({ key, label }) => (
            <div key={key}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                {label}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-text-main">
                {detail![key]}
              </p>
            </div>
          ))}
          {secondaryEvals.map((s, idx) => (
            <div key={`sec-${idx}`}>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
                Impact statement
                {s.evaluator_name ? ` — ${s.evaluator_name}` : ""}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-xs text-text-main">
                {s.impact_statement || "—"}
              </p>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

// ── Main ────────────────────────────────────────────────────────────

export function MenteeAnnualSummaryTab({
  mentee,
  onOpenEval,
}: MenteeAnnualSummaryTabProps) {
  const { settings } = useSystemSettings();
  const activeFyToken = settings?.active_cycle_name
    ? extractFyToken(settings.active_cycle_name)
    : "";

  // Map cycle_name → AnnualReview for fast lookup.
  const reviewByCycle = useMemo(() => {
    const m = new Map<string, AnnualReview>();
    for (const r of mentee.reviews_list) {
      m.set(extractFyToken(r.cycle_name), r);
    }
    return m;
  }, [mentee.reviews_list]);

  // FYs the picker exposes: every FY with a review row + the active FY (so
  // the mentor can land here even before the mentee files self-review).
  const availableFys = useMemo(() => {
    const s = new Set<string>();
    if (activeFyToken) s.add(activeFyToken);
    for (const r of mentee.reviews_list) s.add(extractFyToken(r.cycle_name));
    return Array.from(s).sort((a, b) => b.localeCompare(a));
  }, [mentee.reviews_list, activeFyToken]);

  const [selectedFy, setSelectedFy] = useState(
    activeFyToken || availableFys[0] || "",
  );

  // Settings load is async — once active FY arrives, default to it.
  useEffect(() => {
    if (activeFyToken && !selectedFy) setSelectedFy(activeFyToken);
  }, [activeFyToken, selectedFy]);

  const selectedReview = selectedFy
    ? reviewByCycle.get(selectedFy) ?? null
    : null;
  const selectedYear = selectedFy ? fyTokenToStartYear(selectedFy) : null;
  const isActiveFy = !!activeFyToken && selectedFy === activeFyToken;

  const goalsInFy = useMemo(
    () =>
      selectedYear !== null
        ? mentee.goals_list.filter((g) => g.fy_year === selectedYear)
        : [],
    [mentee.goals_list, selectedYear],
  );

  // Group projects by half within the FY. `cycle` may be "H1 FY26-27",
  // "H2 FY26-27", "FY26-27" (annual cadence), etc. Anything tagged to the
  // selected FY belongs in this section; the half prefix decides grouping.
  const projectsInFy = useMemo(() => {
    if (!selectedFy) return { h1: [], h2: [], unknown: [] };
    const buckets: {
      h1: MenteeProjectAssignment[];
      h2: MenteeProjectAssignment[];
      unknown: MenteeProjectAssignment[];
    } = { h1: [], h2: [], unknown: [] };
    for (const p of mentee.project_assignments) {
      if (!p.cycle) continue;
      if (extractFyToken(p.cycle) !== selectedFy) continue;
      const upper = p.cycle.toUpperCase();
      if (upper.startsWith("H1")) buckets.h1.push(p);
      else if (upper.startsWith("H2")) buckets.h2.push(p);
      else buckets.unknown.push(p);
    }
    return buckets;
  }, [mentee.project_assignments, selectedFy]);

  const status = selectedReview?.status ?? null;
  const canFill = isActiveFy && status === "pending_mentor";
  // Either column being non-null on the active-FY review means the mentor
  // has parked their work mid-eval — drives the "Continue" CTA label and
  // the "Draft saved" reminder pill.
  const hasMentorDraft =
    canFill &&
    (selectedReview?.mentor_overall_review_draft != null ||
      selectedReview?.mentor_performance_rating_draft != null);

  // CTA / status note copy. Only states where the mentor *can't* act yet
  // get a hint here (pre-mentor stages). Post-mentor states are conveyed
  // entirely by the green "Reviewed" pill — no extra note.
  const ctaNote: string | null = (() => {
    if (!isActiveFy) return null;
    if (status === null) return "Awaiting mentee's self-review";
    if (status === "draft") return "Mentee is drafting their self-review";
    return null;
  })();

  if (availableFys.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-md border border-dashed border-border bg-surface px-6 py-10 text-center">
        <ClipboardCheck className="h-6 w-6 text-text-muted" />
        <p className="mt-2 text-sm font-medium text-text-main">
          No annual review cycles yet
        </p>
        <p className="text-xs text-text-muted">
          Once the active fiscal year is configured, the summary will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header strip — year picker, status, CTA */}
      <div className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <label
            htmlFor="annual-summary-fy"
            className="text-[11px] font-bold uppercase tracking-wider text-text-muted"
          >
            FY
          </label>
          <select
            id="annual-summary-fy"
            value={selectedFy}
            onChange={(e) => setSelectedFy(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer"
          >
            {availableFys.map((fy) => (
              <option key={fy} value={fy}>
                {formatFyLabel(fy)}
                {fy === activeFyToken ? " (current)" : ""}
              </option>
            ))}
          </select>
          <StatusPill status={status} />
        </div>
        <div className="flex items-center gap-2">
          {canFill ? (
            <>
              {hasMentorDraft && (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700"
                  title="An unsubmitted draft is saved for this review"
                >
                  <Save className="h-3 w-3" />
                  Draft saved
                </span>
              )}
              <button
                type="button"
                onClick={() => onOpenEval(selectedFy)}
                className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
              >
                <ClipboardCheck className="h-4 w-4" />
                {hasMentorDraft ? "Continue" : "Fill"} Annual Review for{" "}
                {formatFyLabel(selectedFy)}
              </button>
            </>
          ) : ctaNote ? (
            <p className="text-xs italic text-text-muted">{ctaNote}</p>
          ) : null}
        </div>
      </div>

      {/* Reviews — mentee self + mentor evaluation. Mentor card only
          renders once the mentor has actually submitted (the field is null
          for active-FY rows still in `pending_mentor`, so it stays hidden
          there but appears on past completed/calibration rows). */}
      {selectedReview &&
        (selectedReview.self_overall_review ||
          selectedReview.self_performance_rating !== null) && (
          <ReviewParagraphCard
            label="Mentee's self review"
            ratingLabel="Self rating"
            rating={selectedReview.self_performance_rating}
            text={selectedReview.self_overall_review}
            emptyText="No self-review text"
          />
        )}
      {selectedReview &&
        (selectedReview.mentor_overall_review ||
          selectedReview.mentor_performance_rating !== null) && (
          <ReviewParagraphCard
            label="Mentor review"
            ratingLabel="Final rating"
            rating={selectedReview.mentor_performance_rating}
            text={selectedReview.mentor_overall_review}
            emptyText="No mentor review text"
          />
        )}

      {/* Goals section */}
      <section className="space-y-3">
        <header className="flex items-center gap-2">
          <Target className="h-4 w-4 text-text-muted" />
          <h2 className="text-sm font-semibold text-text-main">
            Annual Goals
            <span className="ml-1 font-normal text-text-muted">
              ({goalsInFy.length} in {formatFyLabel(selectedFy)})
            </span>
          </h2>
        </header>
        {goalsInFy.length === 0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface px-4 py-6 text-center text-xs text-text-muted">
            No annual goals in {formatFyLabel(selectedFy)} yet.
          </div>
        ) : (
          <div className="space-y-3">
            {goalsInFy.map((g) => (
              <GoalSummaryCard key={g.id} goal={g} />
            ))}
          </div>
        )}
      </section>

      {/* Projects section */}
      <section className="space-y-3">
        <header className="flex items-center gap-2">
          <Briefcase className="h-4 w-4 text-text-muted" />
          <h2 className="text-sm font-semibold text-text-main">
            Project Reviews
            <span className="ml-1 font-normal text-text-muted">
              (
              {projectsInFy.h1.length +
                projectsInFy.h2.length +
                projectsInFy.unknown.length}{" "}
              in {formatFyLabel(selectedFy)})
            </span>
          </h2>
        </header>
        {projectsInFy.h1.length +
          projectsInFy.h2.length +
          projectsInFy.unknown.length ===
        0 ? (
          <div className="rounded-md border border-dashed border-border bg-surface px-4 py-6 text-center text-xs text-text-muted">
            No project reviews recorded for {formatFyLabel(selectedFy)}.
          </div>
        ) : (
          <div className="space-y-4">
            {projectsInFy.h1.length > 0 && (
              <div className="space-y-2">
                {/* <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  H1
                </p> */}
                {projectsInFy.h1.map((p) => (
                  <ProjectSummaryCard
                    key={`h1-${p.project_id}`}
                    assignment={p}
                  />
                ))}
              </div>
            )}
            {projectsInFy.h2.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  H2
                </p>
                {projectsInFy.h2.map((p) => (
                  <ProjectSummaryCard
                    key={`h2-${p.project_id}`}
                    assignment={p}
                  />
                ))}
              </div>
            )}
            {projectsInFy.unknown.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
                  Annual / Other
                </p>
                {projectsInFy.unknown.map((p) => (
                  <ProjectSummaryCard
                    key={`u-${p.project_id}`}
                    assignment={p}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </section>

    </div>
  );
}
