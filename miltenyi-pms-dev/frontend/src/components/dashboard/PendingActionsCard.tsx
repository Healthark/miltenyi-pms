/**
 * PendingActionsCard — combined "needs attention" surface for HR.
 *
 * Two subsections share the HR mental model "what needs my
 * attention?":
 *   1. Outstanding Annual Reviews — not-started + draft chase lists.
 *   2. Paused Settings — org-wide gate flags currently OFF. Self-
 *      reminder to re-enable. Replaces the retired ActiveOverridesCard.
 *
 * Each section keeps the same shape:
 *   - badge in the subheader (count or "All clear"),
 *   - top INLINE_LIMIT rows inline,
 *   - per-section CTA at the bottom.
 */

import {
  CheckCircle2,
  ClipboardX,
  FileEdit,
  Pause,
  PauseCircle,
  UserX,
} from "lucide-react";
import { Link } from "react-router-dom";
import type { MissingAnnualReviewsSummary } from "@/services/dashboard.service";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import type { SystemSettingsResponse } from "@/services/system-settings.service";

const INLINE_LIMIT = 3;
const SETTINGS_HREF = "/admin?tab=settings";

interface PendingActionsCardProps {
  readonly missingReviews: MissingAnnualReviewsSummary | null;
  readonly missingReviewsHref?: string;
}

export function PendingActionsCard({
  missingReviews,
  missingReviewsHref = "/annual-reviews",
}: PendingActionsCardProps) {
  return (
    <article className="flex h-full flex-col gap-5 rounded-xl border border-border bg-surface p-5 shadow-sm">
      <MissingReviewsSection
        data={missingReviews}
        viewAllHref={missingReviewsHref}
      />
      <PausedSettingsSection />
    </article>
  );
}

/** Shared wrapper class for each subsection. The tinted slate background
 *  + rounded corners give the two halves of the merged card their own
 *  visual frame so they read as distinct subcards rather than two lists
 *  stacked together. No divider line — the panel boundary does the
 *  separation. */
const SECTION_PANEL =
  "flex flex-col gap-3 rounded-lg border border-border/60 bg-slate-50/50 p-4";

// ── Section: Outstanding Annual Reviews (Not Started + In Draft) ──────

function MissingReviewsSection({
  data,
  viewAllHref,
}: {
  readonly data: MissingAnnualReviewsSummary | null;
  readonly viewAllHref: string;
}) {
  const isLoading = data === null;
  const notStartedCount = data?.count ?? 0;
  const draftCount = data?.draft_count ?? 0;
  const isAllClear = !isLoading && notStartedCount === 0 && draftCount === 0;

  return (
    <section className={SECTION_PANEL}>
      {/* Header: section name + per-bucket count chips. Draft and
          not-started carry different urgency, so each gets its own
          count chip rather than one combined number. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <ClipboardX
              className="h-4 w-4 text-brand"
              aria-hidden="true"
            />
          </div>
          <h4 className="font-display text-sm font-semibold text-text-main">
            Outstanding Annual Reviews
          </h4>
        </div>
        {isAllClear ? (
          <CountBadge count={0} isAllClear label="" />
        ) : (
          <div className="flex items-center gap-1.5">
            {notStartedCount > 0 && (
              <span className="inline-flex items-center rounded-md bg-red px-2 py-1 text-[11px] font-semibold text-white tabular-nums">
                {notStartedCount} Not Started
              </span>
            )}
            {draftCount > 0 && (
              <span className="inline-flex items-center rounded-md bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800 tabular-nums">
                {draftCount} Draft{draftCount === 1 ? "" : "s"}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Body: loading → skeleton; both empty → all-clear; otherwise
          two stacked sub-blocks, each with its own list. Sub-block
          for an empty bucket is hidden so the card stays compact. */}
      {isLoading ? (
        <SkeletonList />
      ) : isAllClear ? (
        <AllClearBlock
          icon={<CheckCircle2 className="h-5 w-5 text-green" />}
          title="Every Employee has submitted their review."
          subtitle="No drafts pending, no employees missing — full coverage."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {notStartedCount > 0 && (
            <ChaseList
              sublabel="Not Started"
              iconBgClass="bg-rose-50"
              iconColorClass="text-red"
              icon={UserX}
              users={data.users.slice(0, INLINE_LIMIT).map((u) => ({
                key: u.user_id,
                full_name: u.full_name,
                function_name: u.function_name,
                designation_name: u.designation_name,
                mentor_name: u.mentor_name,
              }))}
            />
          )}
          {draftCount > 0 && (
            <ChaseList
              sublabel="In Draft"
              iconBgClass="bg-amber-50"
              iconColorClass="text-amber"
              icon={FileEdit}
              users={data.drafts.slice(0, INLINE_LIMIT).map((u) => ({
                key: u.user_id,
                full_name: u.full_name,
                function_name: u.function_name,
                designation_name: u.designation_name,
                mentor_name: u.mentor_name,
                // Draft rows deep-link to the All Reviews page so HR
                // can read what the employee has saved and decide
                // whether to nudge them. We pass a `status_filter`
                // query param the AnnualReviews page can pick up to
                // pre-filter the All Reviews tab.
                href: `${viewAllHref}?status_filter=draft`,
              }))}
            />
          )}
        </div>
      )}

      <Link
        to={viewAllHref}
        className="block w-full rounded-lg bg-brand-light py-2 text-center text-[12px] font-semibold text-brand transition-colors hover:bg-brand hover:text-white"
      >
        View All Reviews
      </Link>
    </section>
  );
}

/** Subsection within MissingReviewsSection. Renders one bucket's chase
 *  list with a small heading + accented icon. When a row carries an
 *  `href`, the row becomes clickable (used by drafts so HR can deep-
 *  link to the existing review). Plain (not-started) rows have no
 *  target — there's no review row to open yet. */
function ChaseList({
  sublabel,
  icon: Icon,
  iconBgClass,
  iconColorClass,
  users,
}: {
  readonly sublabel: string;
  readonly icon: typeof UserX;
  readonly iconBgClass: string;
  readonly iconColorClass: string;
  readonly users: Array<{
    key: number;
    full_name: string;
    function_name: string | null;
    designation_name: string | null;
    mentor_name: string | null;
    href?: string;
  }>;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted mb-1">
        {sublabel}
      </p>
      <ul className="flex flex-col gap-1">
        {users.map((u) => {
          const rowContent = (
            <>
              <div
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${iconBgClass}`}
              >
                <Icon className={`h-4 w-4 ${iconColorClass}`} aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold text-text-main">
                  {u.full_name}
                </p>
                <p className="mt-0.5 truncate text-[11px] text-text-muted">
                  {[u.function_name, u.designation_name]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </div>
              <p
                className="max-w-[110px] shrink-0 truncate text-right text-[12px] text-text-muted"
                title={u.mentor_name ?? "no mentor"}
              >
                {u.mentor_name ?? <span className="italic">no mentor</span>}
              </p>
            </>
          );
          return (
            <li key={u.key}>
              {u.href ? (
                <Link
                  to={u.href}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-100 transition-colors"
                >
                  {rowContent}
                </Link>
              ) : (
                <div className="flex items-center gap-3 rounded-lg px-2 py-2">
                  {rowContent}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ── Section: Paused Settings ──────────────────────────────────────────

/** Display list of the four org-wide gate flags, in the order they
 *  appear in System Settings. Each entry pairs a settings field name
 *  with the short label shown when that gate is OFF (i.e. the
 *  override is active). Kept inside this section so the section is
 *  self-contained — no prop drilling from HrDashboard. */
const PAUSED_SETTINGS: ReadonlyArray<{
  readonly settingKey: keyof Pick<
    SystemSettingsResponse,
    | "annual_reviews_enabled"
    | "annual_goals_edit_enabled"
    | "project_ratings_visible"
    | "annual_review_final_rating_visible"
  >;
  readonly label: string;
}> = [
  {
    settingKey: "annual_reviews_enabled",
    label: "Annual reviews paused",
  },
  {
    settingKey: "annual_goals_edit_enabled",
    label: "Goal editing disabled",
  },
  {
    settingKey: "project_ratings_visible",
    label: "Project ratings hidden",
  },
  {
    settingKey: "annual_review_final_rating_visible",
    label: "Final ratings hidden",
  },
];

function PausedSettingsSection() {
  const { settings } = useSystemSettings();
  const isLoading = !settings;
  // Setting OFF (false) → override is active → row is shown.
  const activeRows = !isLoading
    ? PAUSED_SETTINGS.filter((s) => settings[s.settingKey] === false)
    : [];
  const count = activeRows.length;
  const isAllClear = !isLoading && count === 0;

  return (
    <section className={SECTION_PANEL}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-light">
            <Pause className="h-4 w-4 text-brand" aria-hidden="true" />
          </div>
          <h4 className="font-display text-sm font-semibold text-text-main">
            Paused Settings
          </h4>
        </div>
        <CountBadge count={count} isAllClear={isAllClear} label="Paused" />
      </div>

      {isLoading ? (
        <SkeletonList />
      ) : isAllClear ? (
        <AllClearBlock
          icon={<CheckCircle2 className="h-5 w-5 text-green" />}
          title="No settings paused."
          subtitle="All org-wide gates are at default."
        />
      ) : (
        <ul className="flex flex-col gap-1">
          {activeRows.map((row) => (
            <li key={row.settingKey}>
              <Link
                to={SETTINGS_HREF}
                className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-100 transition-colors"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-50">
                  <PauseCircle
                    className="h-4 w-4 text-amber"
                    aria-hidden="true"
                  />
                </div>
                <p className="flex-1 truncate text-[13px] font-semibold text-text-main">
                  {row.label}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Link
        to={SETTINGS_HREF}
        className="block w-full rounded-lg bg-brand-light py-2 text-center text-[12px] font-semibold text-brand transition-colors hover:bg-brand hover:text-white"
      >
        Open System Settings
      </Link>
    </section>
  );
}

// ── Shared building blocks ────────────────────────────────────────────

function CountBadge({
  count,
  isAllClear,
  label,
}: {
  readonly count: number;
  readonly isAllClear: boolean;
  readonly label: string;
}) {
  if (isAllClear) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-green">
        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
        All clear
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md bg-red px-2.5 py-1 text-[11px] font-semibold text-white tabular-nums">
      {count} {label}
    </span>
  );
}

function SkeletonList() {
  return (
    <ul className="flex animate-pulse flex-col gap-1">
      {[0, 1, 2].map((i) => (
        <li key={i} className="flex items-center gap-3 px-2 py-2">
          <div className="h-9 w-9 shrink-0 rounded-full bg-slate-100" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3 w-32 rounded bg-slate-100" />
            <div className="h-2 w-24 rounded bg-slate-100" />
          </div>
          <div className="h-3 w-16 rounded bg-slate-100" />
        </li>
      ))}
    </ul>
  );
}

function AllClearBlock({
  icon,
  title,
  subtitle,
}: {
  readonly icon: React.ReactNode;
  readonly title: string;
  readonly subtitle: string;
}) {
  return (
    <div className="rounded-lg border border-dashed border-emerald-200 dark:border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-900/20 px-4 py-4 text-center">
      <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-full bg-emerald-50 dark:bg-emerald-900/50">
        {icon}
      </div>
      <p className="mt-2 text-[13px] font-medium text-text-main">{title}</p>
      <p className="mt-0.5 text-[11px] text-text-muted">{subtitle}</p>
    </div>
  );
}
