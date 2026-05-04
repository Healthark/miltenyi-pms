/**
 * SortableHeader.tsx — Clickable table column header with sort indicator.
 *
 * Renders inside a <th>. Click toggles sort direction on the column; clicking
 * a different column switches to that column in ascending order.
 *
 *   <th> <SortableHeader label="Project" columnKey="project_name"
 *          sort={sort} onSort={setSort} /> </th>
 *
 * The three indicator states:
 *   - inactive column  → faint ChevronsUpDown
 *   - active + asc     → ChevronUp in brand color
 *   - active + desc    → ChevronDown in brand color
 */

import { ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import type { SortState } from "../utils/sort";
import { toggleSort } from "../utils/sort";

interface SortableHeaderProps<K extends string> {
  readonly label: string;
  readonly columnKey: K;
  readonly sort: SortState<K> | null;
  readonly onSort: (next: SortState<K>) => void;
  /** Align text/icon horizontally. Defaults to "left". */
  readonly align?: "left" | "right";
}

export function SortableHeader<K extends string>({
  label,
  columnKey,
  sort,
  onSort,
  align = "left",
}: SortableHeaderProps<K>) {
  const isActive = sort?.key === columnKey;
  const direction = isActive ? sort!.direction : null;

  const handleClick = () => onSort(toggleSort(sort, columnKey));

  return (
    <button
      type="button"
      onClick={handleClick}
      className={`group inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider transition-colors ${
        isActive ? "text-brand" : "text-text-muted hover:text-text-main"
      } ${align === "right" ? "flex-row-reverse" : ""}`}
      aria-sort={
        !isActive
          ? "none"
          : direction === "asc"
          ? "ascending"
          : "descending"
      }
    >
      <span>{label}</span>
      {direction === "asc" ? (
        <ChevronUp className="h-3 w-3" aria-hidden="true" />
      ) : direction === "desc" ? (
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      ) : (
        <ChevronsUpDown
          className="h-3 w-3 opacity-40 group-hover:opacity-70 transition-opacity"
          aria-hidden="true"
        />
      )}
    </button>
  );
}
