import { Search, ArrowUpDown, LayoutGrid, Table2 } from "lucide-react";

/** "pending" was removed — the underlying "Needs attention" signal is
 *  being rebuilt; the dropdown / filter / sort surfaces tied to it
 *  came out with it. */
export type MenteeSortKey = "name" | "designation";
export type MenteeViewMode = "grid" | "table";

interface MenteeToolbarProps {
  readonly search: string;
  readonly onSearchChange: (value: string) => void;
  readonly sortKey: MenteeSortKey;
  readonly onSortChange: (value: MenteeSortKey) => void;
  readonly viewMode: MenteeViewMode;
  readonly onViewModeChange: (value: MenteeViewMode) => void;
}

export function MenteeToolbar({
  search,
  onSearchChange,
  sortKey,
  onSortChange,
  viewMode,
  onViewModeChange,
}: MenteeToolbarProps) {
  const viewBtnCls = (mode: MenteeViewMode) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
      viewMode === mode
        ? "bg-brand/10 text-brand"
        : "text-text-muted hover:bg-slate-100"
    }`;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {/* Left: search */}
      <div className="relative w-full sm:max-w-xs">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
          aria-hidden="true"
        />
        <input
          type="search"
          placeholder="Search by name or employee code"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="h-9 w-full rounded-md border border-border bg-surface pl-9 pr-3 text-sm text-text-main placeholder:text-text-muted focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
        />
      </div>

      {/* Right: sort + view toggle. The 'Needs attention' filter button
          used to sit here; removed pending a rebuild of the signal. */}
      <div className="flex items-center gap-2">
        {viewMode === "grid" && (
          <div className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-2 text-xs">
            <ArrowUpDown className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />
            <label htmlFor="mentee-sort" className="text-text-muted">
              Sort:
            </label>
            <select
              id="mentee-sort"
              value={sortKey}
              onChange={(e) => onSortChange(e.target.value as MenteeSortKey)}
              className="bg-transparent font-medium text-text-main focus:outline-none"
            >
              <option value="name">Name</option>
              <option value="designation">Designation</option>
            </select>
          </div>
        )}

        <div className="flex h-9 items-center gap-1 rounded-md border border-border bg-surface p-0.5">
          <button
            type="button"
            className={viewBtnCls("grid")}
            onClick={() => onViewModeChange("grid")}
          >
            <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" /> Cards
          </button>
          <button
            type="button"
            className={viewBtnCls("table")}
            onClick={() => onViewModeChange("table")}
          >
            <Table2 className="h-3.5 w-3.5" aria-hidden="true" /> Table
          </button>
        </div>
      </div>
    </div>
  );
}
