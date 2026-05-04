/**
 * Loading-state placeholders for the My Reviews tab. The grid version
 * mimics the project-summary card grid, the table version mimics the
 * sortable table — both keep the page layout from jumping when data
 * arrives.
 */

export function GridSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="rounded-xl border border-border bg-surface p-4">
          <div className="flex justify-between mb-3">
            <div className="h-4 w-16 rounded bg-slate-100" />
            <div className="h-4 w-20 rounded-full bg-slate-100" />
          </div>
          <div className="h-4 w-3/4 rounded bg-slate-100 mb-2" />
          <div className="h-3 w-1/2 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

export function TableSkeleton() {
  return (
    <div className="animate-pulse">
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex gap-6 px-5 py-3 border-b border-border"
        >
          <div className="h-4 w-1/4 rounded bg-slate-100" />
          <div className="h-4 w-16 rounded bg-slate-100" />
          <div className="h-4 w-1/5 rounded bg-slate-100" />
          <div className="h-4 w-20 rounded-full bg-slate-100" />
          <div className="h-4 w-12 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}
