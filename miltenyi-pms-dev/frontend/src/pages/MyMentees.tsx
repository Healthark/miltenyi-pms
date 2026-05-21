import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Users, AlertTriangle } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { queryKeys } from "@/lib/queryKeys";
import { MenteeCard } from "@/components/mentees/MenteeCard";
import {
  MenteeTable,
  type MenteeTableSortKey,
} from "@/components/mentees/MenteeTable";
import {
  MenteeToolbar,
  type MenteeSortKey,
  type MenteeViewMode,
} from "@/components/mentees/MenteeToolbar";
import {
  menteeService,
  type MenteeSummary,
  type MentorPairingGroup,
} from "@/services/mentee.service";
import { compareValues, type SortKind, type SortState, type SortValue } from "@/utils/sort";

const MENTEE_TABLE_SORT_CONFIG: Record<
  MenteeTableSortKey,
  { kind: SortKind; get: (m: MenteeSummary) => SortValue }
> = {
  full_name:             { kind: "alpha",   get: (m) => m.full_name },
  employee_code:         { kind: "natural", get: (m) => m.employee_code },
  email:                 { kind: "alpha",   get: (m) => m.email },
  function_name:       { kind: "alpha",   get: (m) => m.function_name },
  designation_name:      { kind: "alpha",   get: (m) => m.designation_name },
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
  const { user } = useAuth();
  const isHRMyOrg = user?.role === "HR_MyOrg";

  // HR_MyOrg branch — render the org-wide grouped pairings view.
  if (isHRMyOrg) {
    return <AllMentorPairings />;
  }

  return <MyMenteesView />;
}

function MyMenteesView() {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<MenteeSortKey>("name");
  const [viewMode, setViewMode] = useState<MenteeViewMode>("grid");
  const [tableSort, setTableSort] = useState<SortState<MenteeTableSortKey> | null>(null);

  // Cross-page cache sharing: this is the SAME key MentorDashboard uses
  // (queryKeys.mentees.summaries — see PR #19). A mentor who lands on
  // /dashboard first and then navigates here gets instant data from
  // cache. Conversely, if they hit /my-mentees first, the dashboard's
  // version is pre-warmed.
  const menteesQuery = useQuery({
    queryKey: queryKeys.mentees.summaries(),
    queryFn: menteeService.getSummaries,
  });
  const mentees = menteesQuery.data ?? [];
  const isLoading = menteesQuery.isPending;
  // useQuery's `error` is unknown by default; coerce to a user-facing
  // string. We don't display the actual error.message because backend
  // errors here aren't actionable for end users — the friendly copy
  // matches the pre-migration UX.
  const error: string | null = menteesQuery.isError
    ? "Could not load mentees. Please try again."
    : null;

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

    // Table mode with an active column sort takes precedence over the
    // toolbar dropdown — column headers are the sort UI in that mode.
    if (viewMode === "table" && tableSort) {
      const { kind, get } = MENTEE_TABLE_SORT_CONFIG[tableSort.key];
      return [...out].sort((a, b) =>
        compareValues(get(a), get(b), kind, tableSort.direction),
      );
    }

    return [...out].sort((a, b) => {
      if (sortKey === "designation") {
        const av = a.designation_name ?? "";
        const bv = b.designation_name ?? "";
        return av.localeCompare(bv) || a.full_name.localeCompare(b.full_name);
      }
      return a.full_name.localeCompare(b.full_name);
    });
  }, [mentees, search, sortKey, viewMode, tableSort]);

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

      {/* Main Content Container */}
      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        <div className="p-5 space-y-5">
          {/* Toolbar */}
          {!isLoading && mentees.length > 0 && (
            <MenteeToolbar
              search={search}
              onSearchChange={setSearch}
              sortKey={sortKey}
              onSortChange={setSortKey}
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
      </div>
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

// ── HR_MyOrg "All Mentor Pairings" view ────────────────────────────

function AllMentorPairings() {
  const [search, setSearch] = useState("");

  const pairingsQuery = useQuery({
    queryKey: queryKeys.mentees.pairings(),
    queryFn: menteeService.getAllPairings,
  });
  const groups = pairingsQuery.data ?? [];
  const isLoading = pairingsQuery.isPending;
  const error: string | null = pairingsQuery.isError
    ? "Could not load pairings. Please try again."
    : null;

  const totalMentees = useMemo(
    () => groups.reduce((sum, g) => sum + g.mentees.length, 0),
    [groups],
  );

  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => {
        const mentorMatches =
          g.mentor_name.toLowerCase().includes(q) ||
          g.mentor_email.toLowerCase().includes(q) ||
          g.mentor_employee_code.toLowerCase().includes(q);
        const matchingMentees = g.mentees.filter(
          (m) =>
            m.full_name.toLowerCase().includes(q) ||
            m.email.toLowerCase().includes(q) ||
            m.employee_code.toLowerCase().includes(q),
        );
        // Keep the mentor card if either the mentor matches or any of
        // their mentees do; in mentor-only matches, show the full list.
        if (mentorMatches) return g;
        if (matchingMentees.length > 0)
          return { ...g, mentees: matchingMentees };
        return null;
      })
      .filter((g): g is MentorPairingGroup => g !== null);
  }, [groups, search]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-main">
            All Mentor Pairings
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">
            {isLoading
              ? "Loading pairings…"
              : `${groups.length} ${groups.length === 1 ? "mentor" : "mentors"} · ${totalMentees} ${totalMentees === 1 ? "mentee" : "mentees"} across the org.`}
          </p>
        </div>
      </div>

      {/* Search */}
      {!isLoading && groups.length > 0 && (
        <div className="rounded-xl border border-border bg-surface px-5 py-4 shadow-sm">
          <input
            type="search"
            placeholder="Search by mentor or mentee…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full max-w-md rounded-lg border border-border bg-white py-2 px-3 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
            aria-label="Search pairings"
          />
        </div>
      )}

      {/* States */}
      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
          {error}
        </div>
      )}

      {isLoading && (
        <div className="space-y-4">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-40 rounded-xl border border-border bg-surface animate-pulse"
            />
          ))}
        </div>
      )}

      {!isLoading && groups.length === 0 && !error && (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-border bg-surface px-6 py-12 text-center">
          <Users className="h-10 w-10 text-text-muted" aria-hidden="true" />
          <p className="font-medium text-text-main">No mentors set up yet</p>
          <p className="text-sm text-text-muted">
            Once Mentor users are created and Employees are paired to them via
            the Users tab, the org-wide map will appear here.
          </p>
        </div>
      )}

      {!isLoading && groups.length > 0 && visibleGroups.length === 0 && (
        <div className="rounded-md border border-border bg-surface px-4 py-6 text-center text-sm text-text-muted">
          No pairings match your search.
        </div>
      )}

      {/* Grouped list — one card per Mentor */}
      {!isLoading && visibleGroups.length > 0 && (
        <div className="space-y-4">
          {visibleGroups.map((g) => (
            <div
              key={g.mentor_id}
              className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden"
            >
              {/* Mentor row */}
              <div className="flex items-center justify-between gap-4 border-b border-border bg-emerald-50/40 px-5 py-3">
                <div>
                  <p className="font-display text-sm font-semibold text-text-main">
                    {g.mentor_name}
                  </p>
                  <p className="text-xs text-text-muted">
                    {g.mentor_email} · {g.mentor_employee_code}
                  </p>
                </div>
                <span className="rounded-full bg-emerald-100 text-emerald-700 px-2.5 py-0.5 text-xs font-medium">
                  {g.mentees.length} {g.mentees.length === 1 ? "mentee" : "mentees"}
                </span>
              </div>

              {/* Mentees */}
              {g.mentees.length === 0 ? (
                <div className="px-5 py-4 text-xs italic text-text-muted">
                  No mentees assigned to this mentor yet.
                </div>
              ) : (
                <table className="w-full min-w-max text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-slate-50/60">
                      <th className="text-left px-5 py-2 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                        Mentee
                      </th>
                      <th className="text-left px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                        Email
                      </th>
                      <th className="text-left px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                        Function
                      </th>
                      <th className="text-left px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-text-muted">
                        Designation
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {g.mentees.map((m) => (
                      <tr key={m.user_id} className="hover:bg-slate-50/60 transition-colors">
                        <td className="px-5 py-2.5 font-medium text-text-main">
                          {m.full_name}
                          <div className="text-[11px] text-text-muted">
                            {m.employee_code}
                          </div>
                        </td>
                        <td className="px-4 py-2.5 text-text-muted">
                          {m.email}
                        </td>
                        <td className="px-4 py-2.5 text-text-muted">
                          {m.function_name ?? "—"}
                        </td>
                        <td className="px-4 py-2.5 text-text-muted">
                          {m.designation_name ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
