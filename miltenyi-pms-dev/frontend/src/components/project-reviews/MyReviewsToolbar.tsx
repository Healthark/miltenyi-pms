import { LayoutGrid, Search, Table2 } from "lucide-react";

type ViewMode = "grid" | "table";

/**
 * Toolbar for the My Reviews tab: text search, four filter selects
 * (cycle / project / pm / status), and a card↔table view toggle.
 *
 * State lives in the parent (ProjectReviews page); this component is a
 * pure controlled-input collection. Splitting it out shrinks the parent
 * by ~70 lines and makes the markup easier to scan.
 */
export function MyReviewsToolbar({
  searchQuery,
  onSearchChange,
  viewMode,
  onViewModeChange,
  selectedCycle,
  onSelectedCycleChange,
  availableCycles,
  projectFilter,
  onProjectFilterChange,
  availableProjects,
  pmFilter,
  onPmFilterChange,
  availablePMs,
  statusFilter,
  onStatusFilterChange,
}: {
  readonly searchQuery: string;
  readonly onSearchChange: (v: string) => void;
  readonly viewMode: ViewMode;
  readonly onViewModeChange: (v: ViewMode) => void;
  readonly selectedCycle: string;
  readonly onSelectedCycleChange: (v: string) => void;
  readonly availableCycles: readonly string[];
  readonly projectFilter: string;
  readonly onProjectFilterChange: (v: string) => void;
  readonly availableProjects: readonly string[];
  readonly pmFilter: string;
  readonly onPmFilterChange: (v: string) => void;
  readonly availablePMs: readonly string[];
  readonly statusFilter: string;
  readonly onStatusFilterChange: (v: string) => void;
}) {
  const viewBtnCls = (mode: ViewMode) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors ${
      viewMode === mode
        ? "bg-brand/10 text-brand"
        : "text-text-muted hover:bg-slate-100"
    }`;

  return (
    <div className="flex flex-col gap-3">
      {/* Row 1: Search + View Toggle */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Search projects..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full rounded-lg border border-border bg-white pl-9 pr-3 py-1.5 text-[13px] text-text-main placeholder:text-text-muted outline-none focus:border-brand"
          />
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-border bg-white p-0.5">
          <button
            type="button"
            className={viewBtnCls("grid")}
            onClick={() => onViewModeChange("grid")}
          >
            <LayoutGrid className="h-3.5 w-3.5" /> Cards
          </button>
          <button
            type="button"
            className={viewBtnCls("table")}
            onClick={() => onViewModeChange("table")}
          >
            <Table2 className="h-3.5 w-3.5" /> Table
          </button>
        </div>
      </div>

      {/* Row 2: Filters */}
      <div className="flex items-center gap-4 flex-wrap">
        <FilterSelect
          label="Cycle"
          value={selectedCycle}
          onChange={onSelectedCycleChange}
          allLabel="All Cycles"
          options={availableCycles}
          minWidth={120}
        />
        <FilterSelect
          label="Project"
          value={projectFilter}
          onChange={onProjectFilterChange}
          allLabel="All Projects"
          options={availableProjects}
          minWidth={160}
        />
        <FilterSelect
          label="PM"
          value={pmFilter}
          onChange={onPmFilterChange}
          allLabel="All PMs"
          options={availablePMs}
          minWidth={140}
        />
        <div className="flex items-center gap-2">
          <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
            Status
          </label>
          <select
            value={statusFilter}
            onChange={(e) => onStatusFilterChange(e.target.value)}
            className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand min-w-[120px] cursor-pointer"
          >
            <option value="all">All</option>
            <option value="reviewed">Reviewed</option>
            <option value="pending">Pending</option>
          </select>
        </div>
      </div>
    </div>
  );
}

// Small local helper — only used here, not worth its own file.
function FilterSelect({
  label,
  value,
  onChange,
  allLabel,
  options,
  minWidth,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly allLabel: string;
  readonly options: readonly string[];
  readonly minWidth: number;
}) {
  return (
    <div className="flex items-center gap-2">
      <label className="text-[11px] font-bold uppercase tracking-wider text-text-muted">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer"
        style={{ minWidth: `${minWidth}px` }}
      >
        <option value="all">{allLabel}</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
    </div>
  );
}
