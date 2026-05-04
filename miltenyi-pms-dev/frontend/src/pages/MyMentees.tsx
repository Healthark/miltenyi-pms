import { useEffect, useMemo, useState } from "react";
import { Users } from "lucide-react";
import { MenteeCard } from "../components/mentees/MenteeCard";
import {
  MenteeTable,
  type MenteeTableSortKey,
} from "../components/mentees/MenteeTable";
import {
  MenteeToolbar,
  type MenteeSortKey,
  type MenteeViewMode,
} from "../components/mentees/MenteeToolbar";
import {
  menteeService,
  type MenteeSummary,
} from "../services/mentee.service";
import { compareValues, type SortKind, type SortState } from "../utils/sort";

const MENTEE_TABLE_SORT_CONFIG: Record<
  MenteeTableSortKey,
  { kind: SortKind; get: (m: MenteeSummary) => unknown }
> = {
  full_name:             { kind: "alpha",   get: (m) => m.full_name },
  employee_code:         { kind: "natural", get: (m) => m.employee_code },
  email:                 { kind: "alpha",   get: (m) => m.email },
  department_name:       { kind: "alpha",   get: (m) => m.department_name },
  designation_name:      { kind: "alpha",   get: (m) => m.designation_name },
  pending_actions_count: { kind: "numeric", get: (m) => m.pending_actions_count },
};

function CardSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-sm animate-pulse">
      <div className="flex items-center gap-3">
        <div className="h-11 w-11 rounded-full bg-slate-100" />
        <div className="flex-1 space-y-2">
          <div className="h-3 w-2/3 rounded bg-slate-100" />
          <div className="h-2.5 w-1/2 rounded bg-slate-100" />
        </div>
      </div>
      <div className="h-24 rounded-md bg-slate-100" />
      <div className="h-6 rounded-md bg-slate-100" />
    </div>
  );
}

export function MyMentees() {
  const [mentees, setMentees] = useState<MenteeSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [onlyPending, setOnlyPending] = useState(false);
  const [sortKey, setSortKey] = useState<MenteeSortKey>("name");
  const [viewMode, setViewMode] = useState<MenteeViewMode>("grid");
  const [tableSort, setTableSort] = useState<SortState<MenteeTableSortKey> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    menteeService
      .getSummaries()
      .then((data) => {
        if (!cancelled) setMentees(data);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load mentees. Please try again.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const totalPendingActions = useMemo(
    () => mentees.reduce((sum, m) => sum + m.pending_actions_count, 0),
    [mentees],
  );

  const visibleMentees = useMemo(() => {
    const q = search.trim().toLowerCase();
    let out = mentees;
    if (q) {
      out = out.filter(
        (m) =>
          m.full_name.toLowerCase().includes(q) ||
          m.employee_code.toLowerCase().includes(q),
      );
    }
    if (onlyPending) {
      out = out.filter((m) => m.pending_actions_count > 0);
    }

    // Table mode with an active column sort takes precedence over the
    // toolbar dropdown — column headers are the sort UI in that mode.
    if (viewMode === "table" && tableSort) {
      const { kind, get } = MENTEE_TABLE_SORT_CONFIG[tableSort.key];
      return [...out].sort((a, b) =>
        compareValues(get(a), get(b), kind, tableSort.direction),
      );
    }

    return [...out].sort((a, b) => {
      if (sortKey === "pending") {
        // Most pending first, then name tiebreak
        const delta = b.pending_actions_count - a.pending_actions_count;
        if (delta !== 0) return delta;
        return a.full_name.localeCompare(b.full_name);
      }
      if (sortKey === "designation") {
        const av = a.designation_name ?? "";
        const bv = b.designation_name ?? "";
        return av.localeCompare(bv) || a.full_name.localeCompare(b.full_name);
      }
      return a.full_name.localeCompare(b.full_name);
    });
  }, [mentees, search, onlyPending, sortKey, viewMode, tableSort]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-main">
            My Mentees
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">
            {isLoading
              ? "Loading your mentees…"
              : `${mentees.length} ${mentees.length === 1 ? "mentee" : "mentees"} reporting to you.`}
          </p>
        </div>
      </div>

      {/* Toolbar */}
      {!isLoading && mentees.length > 0 && (
        <MenteeToolbar
          search={search}
          onSearchChange={setSearch}
          onlyPending={onlyPending}
          onOnlyPendingChange={setOnlyPending}
          sortKey={sortKey}
          onSortChange={setSortKey}
          totalPendingActions={totalPendingActions}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
        />
      )}

      {/* States */}
      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {isLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      {!isLoading && mentees.length === 0 && !error && <EmptyState />}

      {!isLoading && mentees.length > 0 && visibleMentees.length === 0 && (
        <div className="rounded-md border border-border bg-surface px-4 py-6 text-center text-sm text-text-muted">
          No mentees match your filters.
        </div>
      )}

      {!isLoading && visibleMentees.length > 0 && (
        viewMode === "grid" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {visibleMentees.map((m) => (
              <MenteeCard key={m.user_id} mentee={m} />
            ))}
          </div>
        ) : (
          <MenteeTable
            mentees={visibleMentees}
            sort={tableSort}
            onSort={setTableSort}
          />
        )
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-light">
        <Users className="h-6 w-6 text-brand" aria-hidden="true" />
      </div>
      <div>
        <p className="font-medium text-text-main">No mentees assigned yet</p>
        <p className="mt-1 text-sm text-text-muted">
          When an HR administrator assigns mentees to you, they'll appear here.
        </p>
      </div>
    </div>
  );
}
