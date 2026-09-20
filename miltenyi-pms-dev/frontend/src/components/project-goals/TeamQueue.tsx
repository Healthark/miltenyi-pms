import { useMemo, useState } from "react";
import { Check, Eye, PenLine, Search } from "lucide-react";
import { quarterDisplay, quarterSeq, type TeamRow } from "@/services/project-goals.service";
import { SetStatusBadge, StepBadge, TH_CLS, fmtDate } from "@/components/project-goals/ui";

interface TeamQueueProps {
  readonly rows: TeamRow[];
  /** The quarter the review columns describe (stored label); null when none has started. */
  readonly cycleLabel: string | null;
  readonly onOpen: (row: TeamRow) => void;
  readonly viewerIsHr: boolean;
}

const SELECT_CLS =
  "rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";

const GRID_HR =
  "grid-cols-[minmax(190px,1.5fr)_minmax(160px,1.1fr)_minmax(130px,0.9fr)_minmax(140px,1fr)_minmax(150px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(140px,0.9fr)]";
const GRID_MENTOR =
  "grid-cols-[minmax(190px,1.5fr)_minmax(170px,1.2fr)_minmax(140px,1fr)_minmax(150px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(140px,0.9fr)]";

type ReviewFilter = "all" | "self_pending" | "review_pending" | "reviewed" | "acknowledged";

/** Where one row stands in the selected quarter. */
function quarterBucket(r: TeamRow): ReviewFilter | null {
  if (!r.has_framework || r.goals_status !== "approved") return null;
  if (r.self_status !== "submitted" && r.review_status !== "submitted") return "self_pending";
  if (r.review_status !== "submitted") return "review_pending";
  return r.acknowledged_at ? "acknowledged" : "reviewed";
}

/** What the viewer can do on this row right now. */
function nextAction(r: TeamRow, cycleLabel: string | null, viewerIsHr: boolean): "approve" | "review" | "open" | "not_started" | "no_framework" {
  if (!r.has_framework) return "no_framework";
  if (!r.set_id) return "not_started";
  if (r.goals_status === "submitted") return "approve";
  const reviewOpen = r.goals_status === "approved" && !!cycleLabel && r.review_status !== "submitted";
  if (reviewOpen && (r.self_status === "submitted" || viewerIsHr)) return "review";
  return "open";
}

/**
 * Mentor's mentees (or every staff member, for the Admin): the year's goal
 * status and the selected quarter's review progress, with filters on
 * function, level, mentor (Admin), goal status and quarter status.
 */
export function TeamQueue({ rows, cycleLabel, onOpen, viewerIsHr }: TeamQueueProps) {
  const [search, setSearch] = useState("");
  const [fn, setFn] = useState("all");
  const [lvl, setLvl] = useState("all");
  const [mentor, setMentor] = useState("all");
  const [st, setSt] = useState("all");
  const [rv, setRv] = useState<ReviewFilter>("all");
  const quarter = cycleLabel ? quarterDisplay(cycleLabel) : null;
  const qShort = cycleLabel ? `Q${quarterSeq(cycleLabel)}` : null;
  const GRID = viewerIsHr ? GRID_HR : GRID_MENTOR;

  const functions = useMemo(() => Array.from(new Set(rows.map((r) => r.function_name).filter((x): x is string => !!x))).sort(), [rows]);
  const levels = useMemo(() => Array.from(new Set(rows.map((r) => r.level).filter((x): x is number => x != null))).sort((a, b) => a - b), [rows]);
  const mentors = useMemo(() => Array.from(new Set(rows.map((r) => r.mentor_name).filter((x): x is string => !!x))).sort(), [rows]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (fn !== "all" && r.function_name !== fn) return false;
      if (lvl !== "all" && String(r.level ?? "") !== lvl) return false;
      if (mentor !== "all" && (mentor === "__none__" ? !!r.mentor_name : r.mentor_name !== mentor)) return false;
      if (st === "no_framework" && r.has_framework) return false;
      if (st !== "all" && st !== "no_framework" && (!r.has_framework || r.goals_status !== st)) return false;
      if (rv !== "all" && quarterBucket(r) !== rv) return false;
      if (q && !`${r.full_name} ${r.email} ${r.designation_name ?? ""} ${r.mentor_name ?? ""} ${r.miltenyi_reviewer_name ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, fn, lvl, mentor, st, rv]);

  const toApprove = filtered.filter((r) => nextAction(r, cycleLabel, viewerIsHr) === "approve").length;
  const toReview = filtered.filter((r) => nextAction(r, cycleLabel, viewerIsHr) === "review").length;
  const anyFilter = fn !== "all" || lvl !== "all" || mentor !== "all" || st !== "all" || rv !== "all" || search.trim() !== "";

  const action = (r: TeamRow) => {
    switch (nextAction(r, cycleLabel, viewerIsHr)) {
      case "no_framework":
        return <span className="text-xs text-red-700">No framework for this level</span>;
      case "not_started":
        return <span className="text-xs italic text-text-muted">Not started</span>;
      case "approve":
        return (
          <button type="button" onClick={() => onOpen(r)} className="flex items-center gap-1.5 rounded-md bg-brand-light px-2.5 py-1.5 text-xs font-medium text-brand-accent hover:bg-brand hover:text-white transition-colors">
            <Check className="h-3.5 w-3.5" aria-hidden="true" /> Mark approved
          </button>
        );
      case "review":
        return (
          <button type="button" onClick={() => onOpen(r)} className="flex items-center gap-1.5 rounded-md bg-brand px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90">
            <PenLine className="h-3.5 w-3.5" aria-hidden="true" /> Enter {qShort ?? ""} review
          </button>
        );
      default:
        return (
          <button type="button" onClick={() => onOpen(r)} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text-main hover:bg-slate-50">
            <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Open
          </button>
        );
    }
  };

  const stepCell = (r: TeamRow, kind: "self" | "review") => {
    if (!(r.has_framework && r.set_id && r.goals_status === "approved" && cycleLabel)) return <span className="text-xs text-text-muted">—</span>;
    const status = kind === "self" ? r.self_status : r.review_status;
    const when = kind === "self" ? r.self_submitted_at : r.review_submitted_at;
    const rating = kind === "self" ? r.self_rating : r.final_rating;
    return (
      <div className="flex flex-col items-start gap-0.5">
        <StepBadge status={status} />
        {when && (
          <span className="text-[11px] text-text-muted">
            {fmtDate(when)}{rating != null ? ` · rated ${rating}` : ""}{kind === "review" && r.acknowledged_at ? " · acknowledged" : ""}
          </span>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="relative min-w-[220px] max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search staff, mentor, reviewer…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-white py-1.5 pl-9 pr-3 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand"
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
          <select value={st} onChange={(e) => setSt(e.target.value)} className={`${SELECT_CLS} min-w-[150px]`}>
            <option value="all">All</option>
            <option value="not_started">Not started</option>
            <option value="draft">Draft</option>
            <option value="submitted">Submitted</option>
            <option value="approved">Approved</option>
            <option value="no_framework">No framework</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={TH_CLS}>{quarter ?? "Quarter"}</span>
          <select value={rv} onChange={(e) => setRv(e.target.value as ReviewFilter)} className={`${SELECT_CLS} min-w-[170px]`} disabled={!cycleLabel}>
            <option value="all">All</option>
            <option value="self_pending">Self-review pending</option>
            <option value="review_pending">Review pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="acknowledged">Acknowledged</option>
          </select>
        </label>
      </div>

      <p className="text-xs text-text-muted">
        Showing <b>{filtered.length}</b> of {rows.length} staff{anyFilter ? " (filtered)" : ""}
        {toApprove > 0 && <> · <b>{toApprove}</b> awaiting approval</>}
        {toReview > 0 && cycleLabel && <> · <b>{toReview}</b> {quarter} review{toReview === 1 ? "" : "s"} to enter</>}
      </p>

      <div className="overflow-x-auto rounded-lg border border-border">
        <div className={viewerIsHr ? "min-w-[1240px]" : "min-w-[1100px]"}>
          <div className={`grid ${GRID} gap-3 border-b border-border bg-slate-50 px-4 py-2.5`}>
            <span className={TH_CLS}>Staff member</span>
            <span className={TH_CLS}>Function · level</span>
            {viewerIsHr && <span className={TH_CLS}>Mentor</span>}
            <span className={TH_CLS}>Miltenyi reviewer</span>
            <span className={TH_CLS}>Goals · year</span>
            <span className={TH_CLS}>{quarter ? `${quarter} self-review` : "Self-review"}</span>
            <span className={TH_CLS}>{quarter ? `${quarter} review` : "Review"}</span>
            <span className={TH_CLS}>Actions</span>
          </div>
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-text-muted">No staff match these filters.</div>
          )}
          {filtered.map((r) => (
            <div key={r.user_id} className={`grid ${GRID} items-center gap-3 border-b border-border px-4 py-3 last:border-b-0 hover:bg-slate-50`}>
              <div className="min-w-0">
                <div className="text-sm font-medium text-text-main">{r.full_name}</div>
                <div className="truncate text-xs text-text-muted">{r.designation_name ?? r.email}</div>
              </div>
              <div className="min-w-0">
                <div className="text-sm text-text-main">{r.function_name ?? "—"}</div>
                <div className="text-xs text-text-muted">
                  {r.has_framework ? `Level ${r.level} · ${r.framework_title ?? ""}` : r.level ? `Level ${r.level}` : "No level"}
                </div>
              </div>
              {viewerIsHr && (
                <div className={`text-sm ${r.mentor_name ? "text-text-main" : "italic text-text-muted"}`}>{r.mentor_name ?? "No mentor"}</div>
              )}
              <div className={`text-sm ${r.miltenyi_reviewer_name ? "text-text-main" : "italic text-text-muted"}`}>{r.miltenyi_reviewer_name ?? "Not set"}</div>
              <div>{r.has_framework ? <SetStatusBadge status={r.goals_status} /> : <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">No framework</span>}</div>
              <div>{stepCell(r, "self")}</div>
              <div>{stepCell(r, "review")}</div>
              <div>{action(r)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
