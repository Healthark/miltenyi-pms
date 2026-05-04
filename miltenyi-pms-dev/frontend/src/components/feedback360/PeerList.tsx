import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  Loader2,
  Search,
  Send,
  UserCircle,
} from "lucide-react";
import {
  feedback360Service,
  type FeedbackPeer,
} from "../../services/feedback360.service";
import { getErrorMessage } from "../../utils/errors";

/**
 * Give Feedback tab — every active org user (excluding self), with a
 * search + filter toolbar. Each row links to /feedback/give/:user_id.
 * The destination page auto-detects whether the user has already
 * submitted on that peer:
 *   - Not yet submitted → submit mode (sliders enabled)
 *   - Already submitted → read-only mode (sliders disabled, no submit)
 *
 * The worked-with chip is purely a disclosure: it does not change what
 * the reviewer can do, but the colour matches the bar colour the
 * rating will eventually populate on the aggregate view.
 */
export function PeerList() {
  const [peers, setPeers] = useState<FeedbackPeer[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "worked" | "not_worked">(
    "worked",
  );

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError("");
    feedback360Service
      .getPeers()
      .then((rows) => {
        if (!cancelled) setPeers(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return peers.filter((p) => {
      if (q && !p.full_name.toLowerCase().includes(q)) return false;
      if (filter === "worked" && !p.worked_with) return false;
      if (filter === "not_worked" && p.worked_with) return false;
      return true;
    });
  }, [peers, search, filter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-sm text-text-muted">
        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Loading peers…
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
        <AlertCircle className="h-4 w-4 shrink-0 text-red-600 mt-0.5" />
        <p className="text-sm text-red-700">{error}</p>
      </div>
    );
  }
  if (peers.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-border py-12 text-center text-sm text-text-muted">
        No employees to review.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search employees…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-1.5 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand"
          />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
            All ({peers.length})
          </FilterChip>
          <FilterChip
            active={filter === "worked"}
            onClick={() => setFilter("worked")}
          >
            Worked with
          </FilterChip>
          <FilterChip
            active={filter === "not_worked"}
            onClick={() => setFilter("not_worked")}
          >
            Not worked with
          </FilterChip>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-border py-12 text-center text-sm text-text-muted">
          No employees match the current filter.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {filtered.map((p) => (
            <PeerRow key={p.user_id} peer={p} />
          ))}
        </div>
      )}
    </div>
  );
}

function PeerRow({ peer }: { readonly peer: FeedbackPeer }) {
  return (
    <Link
      to={`/feedback/give/${peer.user_id}`}
      className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 shadow-sm hover:border-brand/40 hover:bg-slate-50/40 transition-colors"
    >
      <UserCircle className="h-7 w-7 text-text-muted shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-text-main truncate">{peer.full_name}</p>
        <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
          {peer.designation_name && (
            <span className="text-[11px] text-text-muted truncate">
              {peer.designation_name}
              {peer.department_name && ` · ${peer.department_name}`}
            </span>
          )}
          <span
            className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
              peer.worked_with
                ? "bg-brand/10 text-brand"
                : "bg-amber-50 text-amber-700"
            }`}
          >
            {peer.worked_with ? "Worked with" : "Not worked with"}
          </span>
        </div>
      </div>
      {peer.has_submitted ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-[11px] font-medium text-green-700 shrink-0">
          <Eye className="h-3 w-3" /> View
          <CheckCircle2 className="h-3 w-3 ml-0.5" />
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-md bg-brand/10 px-2.5 py-1 text-[11px] font-medium text-brand shrink-0">
          <Send className="h-3 w-3" /> Give Feedback
        </span>
      )}
    </Link>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  readonly active: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? "bg-brand text-white"
          : "bg-white border border-border text-text-muted hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}
