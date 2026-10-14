import { useMemo, useState } from "react";
import { Eye, PenLine, Search } from "lucide-react";
import type { AnnualRosterRow } from "@/services/goal.service";
import { ApprovalStatusBadge } from "@/components/goals/ApprovalStatusBadge";
import { ClearFiltersButton } from "@/components/common/ClearFiltersButton";
import { StepBadge, TH_CLS } from "@/components/project-goals/ui";
import { isPostApproved } from "@/utils/goalStatus";
import {
  HALF_REVIEW_LABELS,
  HALVES,
  ROSTER_STATUS_OPTIONS,
  halfBucket,
  rowStep,
  stepStatus,
  type Half,
  type RosterReviewFilter,
  type RosterStatusFilter,
} from "@/components/annual-goals/helpers";

type RowAction = "approve" | "review" | "view" | null;

/** Halves whose reviews can still be written: up to the active one (H1 stays
 *  open for backfill during H2). Empty for a year that is not the active one. */
function openHalves(activeHalf: Half | null): Half[] {
  if (activeHalf === "H1") return ["H1"];
  if (activeHalf === "H2") return ["H1", "H2"];
  return [];
}

/** The self-review for an open half is in and the mentor's review can be
 *  submitted now (the server allows it only from `{half}_self_reviewed`). */
function awaitsReview(r: AnnualRosterRow, open: readonly Half[]): boolean {
  return open.some((h) => r.approval_status === (h === "H1" ? "h1_self_reviewed" : "h2_self_reviewed"));
}

/** What the reader does next on a row. A past year is read only. */
function nextAction(r: AnnualRosterRow, open: readonly Half[], viewerIsHr: boolean): RowAction {
  if (!r.goal_id || !r.approval_status || r.approval_status === "draft") return null;
  if (viewerIsHr) return "view";
  if (r.approval_status === "pending_approval") return "approve";
  if (awaitsReview(r, open)) return "review";
  return "view";
}

function matchesGoals(r: AnnualRosterRow, f: RosterStatusFilter): boolean {
  switch (f) {
    case "all":
      return true;
    case "not_started":
      return !r.goal_id;
    case "approved":
      return !!r.approval_status && isPostApproved(r.approval_status);
    default:
      return r.approval_status === f;
  }
}

function matchesReviews(r: AnnualRosterRow, f: RosterReviewFilter): boolean {
  if (f === "all") return true;
  const [half, bucket] = f.split(":") as [Half, string];
  return halfBucket(r, half) === bucket;
}

const SELECT_CLS =
  "rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";

interface AnnualRosterTableProps {
  readonly rows: AnnualRosterRow[];
  /** The active half when the roster shows the active year; null for other years. */
  readonly activeHalf: Half | null;
  /** Label of the year shown, e.g. "CY 26-27" (heads the Reviews filter groups). */
  readonly yearLabel: string;
  readonly viewerIsHr: boolean;
  readonly initialStatus?: RosterStatusFilter;
  readonly onOpen: (row: AnnualRosterRow) => void;
}

/**
 * The mentor's mentees (or every staff member, for the Admin) for one year:
 * one row per person with the goal's status and both halves' review steps.
 * Filters mirror the Project Goals team list. A row with a goal past draft
 * opens that person's goal table (the whole row, or its button).
 */
export function AnnualRosterTable({ rows, activeHalf, yearLabel, viewerIsHr, initialStatus = "all", onOpen }: AnnualRosterTableProps) {
  const [search, setSearch] = useState("");
  const [fn, setFn] = useState("all");
  const [lvl, setLvl] = useState("all");
  const [mentor, setMentor] = useState("all");
  const [status, setStatus] = useState<RosterStatusFilter>(initialStatus);
  const [reviews, setReviews] = useState<RosterReviewFilter>("all");
  const open = openHalves(activeHalf);
  // Halves that can be filtered on: those started in the active year, both in a past year.
  const filterHalves: Half[] = activeHalf ? open : [...HALVES];

  const functions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.function_name).filter((x): x is string => !!x))).sort(),
    [rows],
  );
  const levels = useMemo(
    () => Array.from(new Set(rows.map((r) => r.level).filter((x): x is number => x != null))).sort((a, b) => a - b),
    [rows],
  );
  const mentors = useMemo(
    () => Array.from(new Set(rows.map((r) => r.mentor_name).filter((x): x is string => !!x))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      const haystack = `${r.full_name} ${r.employee_code ?? ""} ${r.designation_name ?? ""} ${r.mentor_name ?? ""}`;
      if (q && !haystack.toLowerCase().includes(q)) return false;
      if (fn !== "all" && r.function_name !== fn) return false;
      if (lvl !== "all" && String(r.level ?? "") !== lvl) return false;
      if (mentor !== "all" && (mentor === "__none__" ? !!r.mentor_name : r.mentor_name !== mentor)) return false;
      return matchesGoals(r, status) && matchesReviews(r, reviews);
    });
  }, [rows, search, fn, lvl, mentor, status, reviews]);

  const pending = filtered.filter((r) => r.approval_status === "pending_approval").length;
  const toReview = filtered.filter((r) => awaitsReview(r, open)).length;
  const notStarted = filtered.filter((r) => !r.goal_id).length;
  const hasFilter =
    search.trim() !== "" || fn !== "all" || lvl !== "all" || mentor !== "all" || status !== "all" || reviews !== "all";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[220px] max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" aria-hidden="true" />
          <input
            type="text"
            aria-label="Search staff"
            placeholder={viewerIsHr ? "Search staff, code, designation, mentor…" : "Search staff, code, designation…"}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-white py-1.5 pl-9 pr-3 text-[13px] text-text-main outline-none placeholder:text-text-muted focus:border-brand"
          />
        </div>
        <label className="flex flex-col gap-1">
          <span className={TH_CLS}>Function</span>
          <select value={fn} onChange={(e) => setFn(e.target.value)} className={`${SELECT_CLS} min-w-[170px]`}>
            <option value="all">All functions</option>
            {functions.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={TH_CLS}>Level</span>
          <select value={lvl} onChange={(e) => setLvl(e.target.value)} className={`${SELECT_CLS} min-w-[110px]`}>
            <option value="all">All</option>
            {levels.map((l) => <option key={l} value={String(l)}>Level {l}</option>)}
          </select>
        </label>
        {viewerIsHr && (
          <label className="flex flex-col gap-1">
            <span className={TH_CLS}>Mentor</span>
            <select value={mentor} onChange={(e) => setMentor(e.target.value)} className={`${SELECT_CLS} min-w-[160px]`}>
              <option value="all">All mentors</option>
              {mentors.map((m) => <option key={m} value={m}>{m}</option>)}
              <option value="__none__">No mentor</option>
            </select>
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className={TH_CLS}>Goals</span>
          <select value={status} onChange={(e) => setStatus(e.target.value as RosterStatusFilter)} className={`${SELECT_CLS} min-w-[170px]`}>
            {ROSTER_STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={TH_CLS}>Reviews</span>
          <select value={reviews} onChange={(e) => setReviews(e.target.value as RosterReviewFilter)} className={`${SELECT_CLS} min-w-[200px]`}>
            <option value="all">All</option>
            {filterHalves.map((h) => (
              <optgroup key={h} label={`${h} · ${yearLabel}`}>
                {HALF_REVIEW_LABELS.map(({ bucket, label }) => (
                  <option key={bucket} value={`${h}:${bucket}`}>{h} · {label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <ClearFiltersButton
          active={hasFilter}
          onClear={() => { setSearch(""); setFn("all"); setLvl("all"); setMentor("all"); setStatus("all"); setReviews("all"); }}
        />
      </div>

      <p className="text-xs text-text-muted">
        Showing <b>{filtered.length}</b> of {rows.length} staff{hasFilter ? " (filtered)" : ""}
        {pending > 0 && <> · <b>{pending}</b> awaiting approval</>}
        {toReview > 0 && <> · <b>{toReview}</b> review{toReview === 1 ? "" : "s"} to write</>}
        {notStarted > 0 && <> · <b>{notStarted}</b> not started</>}
      </p>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[1000px] border-collapse text-[13px]">
          <thead className="bg-slate-50">
            <tr className="border-b border-border text-left">
              <th scope="col" className="px-4 py-2.5"><span className={TH_CLS}>Staff member</span></th>
              <th scope="col" className="px-4 py-2.5"><span className={TH_CLS}>Function · designation</span></th>
              {viewerIsHr && <th scope="col" className="px-4 py-2.5"><span className={TH_CLS}>Mentor</span></th>}
              <th scope="col" className="px-4 py-2.5"><span className={TH_CLS}>Goal</span></th>
              <th scope="col" className="px-4 py-2.5"><span className={TH_CLS}>Status</span></th>
              {HALVES.map((h) => (
                <th key={h} scope="col" className="px-4 py-2.5"><span className={TH_CLS}>{h} · self / mentor</span></th>
              ))}
              <th scope="col" className="px-4 py-2.5"><span className={TH_CLS}>Action</span></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={viewerIsHr ? 8 : 7} className="px-4 py-10 text-center text-sm text-text-muted">
                  {rows.length === 0
                    ? viewerIsHr ? "No staff members yet." : "You have no mentees yet."
                    : "Nobody matches these filters."}
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const action = nextAction(r, open, viewerIsHr);
              const clickable = action !== null;
              return (
                <tr
                  key={r.user_id}
                  onClick={() => clickable && onOpen(r)}
                  className={`border-b border-border/60 align-top ${clickable ? "cursor-pointer hover:bg-slate-50/70" : ""}`}
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-text-main">{r.full_name}</p>
                    {r.employee_code && <p className="text-[11px] text-text-muted">{r.employee_code}</p>}
                  </td>
                  <td className="px-4 py-3 text-text-muted">
                    <p>{r.function_name ?? "—"}</p>
                    {r.designation_name && <p className="text-[11px]">{r.designation_name}</p>}
                  </td>
                  {viewerIsHr && <td className="px-4 py-3 text-text-muted">{r.mentor_name ?? "No mentor"}</td>}
                  <td className="max-w-[260px] px-4 py-3">
                    {!r.goal_id ? (
                      <span className="text-xs italic text-text-muted">Not started</span>
                    ) : r.goal_title ? (
                      <span className="line-clamp-2 text-text-main">{r.goal_title}</span>
                    ) : (
                      <span className="text-xs italic text-text-muted">Drafting</span>
                    )}
                    {r.extra_goals > 0 && (
                      <p className="mt-0.5 text-[11px] text-amber-700">
                        +{r.extra_goals} older goal{r.extra_goals === 1 ? "" : "s"} this year
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {r.approval_status ? (
                      <ApprovalStatusBadge status={r.approval_status} />
                    ) : (
                      <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600">Not started</span>
                    )}
                  </td>
                  {HALVES.map((h) => (
                    <td key={h} className="px-4 py-3">
                      {r.approval_status && isPostApproved(r.approval_status) ? (
                        <div className="flex flex-col items-start gap-1">
                          <StepBadge status={stepStatus(rowStep(r, h, "self"))} label={`Self · ${labelOf(rowStep(r, h, "self"))}`} />
                          <StepBadge status={stepStatus(rowStep(r, h, "mentor"))} label={`Mentor · ${labelOf(rowStep(r, h, "mentor"))}`} />
                        </div>
                      ) : (
                        <span className="text-xs text-text-muted">—</span>
                      )}
                    </td>
                  ))}
                  <td className="px-4 py-3">
                    {action && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onOpen(r); }}
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-colors ${
                          action === "view"
                            ? "text-text-muted hover:bg-slate-100 hover:text-text-main"
                            : "bg-brand/10 text-brand hover:bg-brand hover:text-white"
                        }`}
                      >
                        {action === "review" ? (
                          <><PenLine className="h-3 w-3" aria-hidden="true" /> Write review</>
                        ) : (
                          <><Eye className="h-3 w-3" aria-hidden="true" /> View</>
                        )}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function labelOf(step: AnnualRosterRow["h1_self"]): string {
  if (step === "submitted") return "submitted";
  if (step === "draft") return "draft";
  return "not started";
}
