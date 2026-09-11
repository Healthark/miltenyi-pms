import { useMemo, useState } from "react";
import { Check, Eye, PenLine, Search } from "lucide-react";
import { quarterDisplay, type TeamRow } from "@/services/project-goals.service";
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

const GRID =
  "grid-cols-[minmax(190px,1.5fr)_minmax(170px,1.2fr)_minmax(140px,1fr)_minmax(150px,1fr)_minmax(140px,1fr)_minmax(140px,1fr)_minmax(150px,1fr)]";

type ReviewFilter = "all" | "self_pending" | "review_pending" | "reviewed" | "acknowledged";

/** Where one row stands in the selected quarter. */
function quarterBucket(r: TeamRow): ReviewFilter | null {
  if (!r.has_framework || r.goals_status !== "approved") return null;
  if (r.self_status !== "submitted" && r.review_status !== "submitted") return "self_pending";
  if (r.review_status !== "submitted") return "review_pending";
  return r.acknowledged_at ? "acknowledged" : "reviewed";
}

/** Mentor's mentees (or every staff member, for the Admin) with goal-set
 *  progress and the selected quarter's review progress. */
export function TeamQueue({ rows, cycleLabel, onOpen, viewerIsHr }: TeamQueueProps) {
  const [search, setSearch] = useState("");
  const [fn, setFn] = useState("all");
  const [st, setSt] = useState("all");
  const [rv, setRv] = useState<ReviewFilter>("all");
  const quarter = cycleLabel ? quarterDisplay(cycleLabel) : null;

  const functions = useMemo(
    () => Array.from(new Set(rows.map((r) => r.function_name).filter((x): x is string => !!x))).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (fn !== "all" && r.function_name !== fn) return false;
      if (st === "no_framework" && r.has_framework) return false;
      if (st !== "all" && st !== "no_framework" && r.goals_status !== st) return false;
      if (rv !== "all" && quarterBucket(r) !== rv) return false;
      if (q && !`${r.full_name} ${r.email} ${r.designation_name ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, fn, st, rv]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) {
      const key = r.has_framework ? r.goals_status : "no_framework";
      c[key] = (c[key] ?? 0) + 1;
      const b = quarterBucket(r);
      if (b) c[b] = (c[b] ?? 0) + 1;
    }
    return c;
  }, [rows]);

  const chip = (label: string, key: string, dot: string) => (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-2.5 py-1 text-xs text-text-main">
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
      {label} <span className="font-semibold">{counts[key] ?? 0}</span>
    </span>
  );

  const action = (r: TeamRow) => {
    if (!r.has_framework) return <span className="text-xs text-red-700">No framework for this level</span>;
    if (!r.set_id) return <span className="text-xs italic text-text-muted">Not started</span>;
    if (r.goals_status === "submitted")
      return (
        <button type="button" onClick={() => onOpen(r)} className="flex items-center gap-1.5 rounded-md bg-brand-light px-2.5 py-1.5 text-xs font-medium text-brand-accent hover:bg-brand hover:text-white transition-colors">
          <Check className="h-3.5 w-3.5" aria-hidden="true" /> Mark approved
        </button>
      );
    const reviewOpen = r.goals_status === "approved" && !!cycleLabel && r.review_status !== "submitted";
    if (reviewOpen && (r.self_status === "submitted" || viewerIsHr))
      return (
        <button type="button" onClick={() => onOpen(r)} className="flex items-center gap-1.5 rounded-md bg-brand px-2.5 py-1.5 text-xs font-medium text-white hover:opacity-90">
          <PenLine className="h-3.5 w-3.5" aria-hidden="true" /> Enter {quarter ? `Q${quarter.slice(1, 2)} ` : ""}review
        </button>
      );
    return (
      <button type="button" onClick={() => onOpen(r)} className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-text-main hover:bg-slate-50">
        <Eye className="h-3.5 w-3.5" aria-hidden="true" /> Open
      </button>
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative max-w-xs flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" aria-hidden="true" />
          <input
            type="text"
            placeholder="Search staff..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-white py-1.5 pl-9 pr-3 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand"
          />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label htmlFor="pg-fn" className={TH_CLS}>Function</label>
            <select id="pg-fn" value={fn} onChange={(e) => setFn(e.target.value)} className={`${SELECT_CLS} min-w-[170px]`}>
              <option value="all">All functions</option>
              {functions.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="pg-st" className={TH_CLS}>Goals</label>
            <select id="pg-st" value={st} onChange={(e) => setSt(e.target.value)} className={`${SELECT_CLS} min-w-[150px]`}>
              <option value="all">All</option>
              <option value="not_started">Not started</option>
              <option value="draft">Draft</option>
              <option value="submitted">Submitted</option>
              <option value="approved">Approved</option>
              <option value="no_framework">No framework</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="pg-rv" className={TH_CLS}>{quarter ?? "Quarter"}</label>
            <select id="pg-rv" value={rv} onChange={(e) => setRv(e.target.value as ReviewFilter)} className={`${SELECT_CLS} min-w-[170px]`} disabled={!cycleLabel}>
              <option value="all">All</option>
              <option value="self_pending">Self-review pending</option>
              <option value="review_pending">Review pending</option>
              <option value="reviewed">Reviewed</option>
              <option value="acknowledged">Acknowledged</option>
            </select>
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {chip("Not started", "not_started", "bg-slate-300")}
        {chip("Draft", "draft", "bg-slate-400")}
        {chip("Submitted", "submitted", "bg-blue-500")}
        {chip("Approved", "approved", "bg-emerald-500")}
        {chip("No framework", "no_framework", "bg-red-500")}
        {cycleLabel && (
          <>
            <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
            {chip(`${quarter} · self-review pending`, "self_pending", "bg-amber-400")}
            {chip("review pending", "review_pending", "bg-teal-500")}
            {chip("reviewed", "reviewed", "bg-violet-500")}
            {chip("acknowledged", "acknowledged", "bg-emerald-600")}
          </>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <div className="min-w-[1100px]">
          <div className={`grid ${GRID} gap-3 border-b border-border bg-slate-50 px-4 py-2.5`}>
            <span className={TH_CLS}>Staff member</span>
            <span className={TH_CLS}>Function · level</span>
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
              <div className={`text-sm ${r.miltenyi_reviewer_name ? "text-text-main" : "italic text-text-muted"}`}>{r.miltenyi_reviewer_name ?? "Not set"}</div>
              <div>{r.has_framework ? <SetStatusBadge status={r.goals_status} /> : <span className="inline-flex items-center rounded-full bg-red-50 px-2.5 py-0.5 text-xs font-medium text-red-700">No framework</span>}</div>
              <div className="flex flex-col items-start gap-0.5">
                {r.has_framework && r.set_id && r.goals_status === "approved" && cycleLabel ? (
                  <>
                    <StepBadge status={r.self_status} />
                    {r.self_submitted_at && <span className="text-[11px] text-text-muted">{fmtDate(r.self_submitted_at)}{r.self_rating != null ? ` · rated ${r.self_rating}` : ""}</span>}
                  </>
                ) : (
                  <span className="text-xs text-text-muted">—</span>
                )}
              </div>
              <div className="flex flex-col items-start gap-0.5">
                {r.has_framework && r.set_id && r.goals_status === "approved" && cycleLabel ? (
                  <>
                    <StepBadge status={r.review_status} />
                    {r.review_submitted_at && (
                      <span className="text-[11px] text-text-muted">
                        {fmtDate(r.review_submitted_at)}{r.final_rating != null ? ` · rated ${r.final_rating}` : ""}{r.acknowledged_at ? " · acknowledged" : ""}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-xs text-text-muted">—</span>
                )}
              </div>
              <div>{action(r)}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
