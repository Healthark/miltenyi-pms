/**
 * ProjectsTab.tsx — Admin Panel tab for managing projects (Revised).
 *
 * Changes:
 *   - Removed allocated hours column
 *   - Shows end date (column header label "End Date"; backend field stays expected_end_date)
 *   - Shows "PM" column (Primary evaluator on the project)
 *   - Shows "PM Reports To" column (PM's senior reviewer)
 *
 * Placement: src/components/admin/ProjectsTab.tsx
 */

import {
  useState,
  useEffect,
  useCallback,
  useImperativeHandle,
  useMemo,
  type Ref,
} from "react";
import { Search, Pencil, Trash2, Users, FolderOpen } from "lucide-react";
import {
  projectService,
  type ProjectResponse,
} from "../../services/project.service";
import { adminService, type UserResponse } from "../../services/admin.service";
import { getErrorMessage } from "../../utils/errors";
import { ProjectModal } from "./ProjectModal";
import { useToast } from "../../hooks/useToast";
import { useSnackbar } from "../../hooks/useSnackbar";
import { useConfirm } from "../../hooks/useConfirm";
import { SortableHeader } from "../SortableHeader";
import {
  compareValues,
  type SortKind,
  type SortState,
} from "../../utils/sort";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

type ProjectsSortKey =
  | "name"
  | "project_code"
  | "start_date"
  | "expected_end_date"
  | "pm_name"
  | "reports_to_name"
  | "member_count";

const PROJECTS_SORT_CONFIG: Record<
  ProjectsSortKey,
  { kind: SortKind; get: (p: ProjectResponse) => unknown }
> = {
  name:              { kind: "alpha",   get: (p) => p.name },
  project_code:      { kind: "natural", get: (p) => p.project_code },
  start_date:        { kind: "alpha",   get: (p) => p.start_date },
  expected_end_date: { kind: "alpha",   get: (p) => p.expected_end_date },
  pm_name:           { kind: "alpha",   get: (p) => p.pm_name },
  reports_to_name:   { kind: "alpha",   get: (p) => p.reports_to_name },
  member_count:      { kind: "numeric", get: (p) => p.member_count },
};

const FILTER_LABEL_CLS =
  "text-[11px] font-bold uppercase tracking-wider text-text-muted";
const FILTER_SELECT_CLS =
  "rounded-lg border border-border bg-white px-3 py-1.5 text-[13px] text-text-main outline-none focus:border-brand cursor-pointer";

export interface ProjectsTabHandle {
  openCreate: () => void;
}

interface ProjectsTabProps {
  readonly ref?: Ref<ProjectsTabHandle>;
}

export function ProjectsTab({ ref }: ProjectsTabProps = {}) {
  const [projects, setProjects] = useState<ProjectResponse[]>([]);
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [sort, setSort] = useState<SortState<ProjectsSortKey> | null>(null);
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [pmFilter, setPmFilter] = useState<string>("all");

  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [projectsData, usersData] = await Promise.all([
        projectService.listProjects(),
        adminService.getUsers(),
      ]);
      setProjects(projectsData);
      setUsers(usersData.filter((u) => !u.is_deleted));
    } catch {
      // stays empty
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleDelete = async (project: ProjectResponse) => {
    const ok = await confirm({
      title: "Delete project?",
      message: `Delete "${project.name}"? This is a soft delete — the project is hidden but can be restored later.`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;

    try {
      await projectService.deleteProject(project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
      toast.success(`"${project.name}" deleted.`);
    } catch (err: unknown) {
      snackbar.error(getErrorMessage(err));
    }
  };

  const openCreate = useCallback(() => {
    setEditingProjectId(null);
    setShowModal(true);
  }, []);

  useImperativeHandle(ref, () => ({ openCreate }), [openCreate]);

  const openEdit = (projectId: number) => {
    setEditingProjectId(projectId);
    setShowModal(true);
  };

  const handleModalClose = () => {
    setShowModal(false);
    setEditingProjectId(null);
  };

  const handleModalSave = () => {
    handleModalClose();
    void loadData();
  };

  const availableYears = useMemo(
    () =>
      Array.from(
        new Set(
          projects
            .map((p) =>
              p.start_date ? new Date(p.start_date).getFullYear() : null,
            )
            .filter((y): y is number => y !== null),
        ),
      ).sort((a, b) => b - a),
    [projects],
  );

  const availablePms = useMemo(
    () =>
      Array.from(
        new Set(
          projects
            .map((p) => p.pm_name)
            .filter((n): n is string => !!n),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [projects],
  );

  const visibleProjects = useMemo(() => {
    const q = searchQuery.toLowerCase();
    const filtered = projects.filter((p) => {
      if (q) {
        const matchesSearch =
          p.name.toLowerCase().includes(q) ||
          p.project_code.toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }
      if (yearFilter !== "all") {
        const year = p.start_date
          ? new Date(p.start_date).getFullYear().toString()
          : null;
        if (year !== yearFilter) return false;
      }
      if (pmFilter !== "all" && p.pm_name !== pmFilter) return false;
      return true;
    });
    if (!sort) return filtered;
    const { kind, get } = PROJECTS_SORT_CONFIG[sort.key];
    return filtered
      .slice()
      .sort((a, b) => compareValues(get(a), get(b), kind, sort.direction));
  }, [projects, searchQuery, yearFilter, pmFilter, sort]);

  return (
    <div>
      {/* Toolbar — search + filters */}
      <div className="border-b border-border px-5 py-4 flex items-center gap-4 flex-wrap">
        <div className="relative max-w-sm flex-1 min-w-[200px]">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted"
            aria-hidden="true"
          />
          <input
            type="search"
            placeholder="Search by name or code…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-4 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand"
            aria-label="Search projects"
          />
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="project-year-filter" className={FILTER_LABEL_CLS}>
            Start Year
          </label>
          <select
            id="project-year-filter"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
            className={`${FILTER_SELECT_CLS} min-w-[120px]`}
          >
            <option value="all">All Years</option>
            {availableYears.map((y) => (
              <option key={y} value={String(y)}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="project-pm-filter" className={FILTER_LABEL_CLS}>
            PM
          </label>
          <select
            id="project-pm-filter"
            value={pmFilter}
            onChange={(e) => setPmFilter(e.target.value)}
            className={`${FILTER_SELECT_CLS} min-w-[160px]`}
          >
            <option value="all">All PMs</option>
            {availablePms.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20 text-sm text-text-muted">
          Loading projects…
        </div>
      ) : visibleProjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <FolderOpen className="h-10 w-10 text-text-muted mb-3" aria-hidden="true" />
          <p className="font-display text-base font-medium text-text-main">
            {projects.length === 0
              ? "No projects yet"
              : "No projects match your filters"}
          </p>
          <p className="mt-1 text-sm text-text-muted">
            {projects.length === 0
              ? "Create your first project to start assigning team members."
              : "Try adjusting your search or filters."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-slate-50 text-left">
                <th className="px-5 py-3">
                  <SortableHeader label="Project" columnKey="name" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Code" columnKey="project_code" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Start Date" columnKey="start_date" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="End Date" columnKey="expected_end_date" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="PM" columnKey="pm_name" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="PM Reports To" columnKey="reports_to_name" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Members" columnKey="member_count" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleProjects.map((project) => (
                <tr
                  key={project.id}
                  className="transition-colors hover:bg-slate-50"
                >
                  <td className="px-5 py-3.5">
                    <div className="font-medium text-text-main">
                      {project.name}
                    </div>
                    {project.description && (
                      <div className="text-xs text-text-muted line-clamp-1 mt-0.5">
                        {project.description}
                      </div>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-mono text-text-muted">
                      {project.project_code}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-text-muted">
                    {formatDate(project.start_date)}
                  </td>
                  <td className="px-5 py-3.5 text-text-muted">
                    {formatDate(project.expected_end_date)}
                  </td>
                  <td className="px-5 py-3.5 text-text-muted">
                    {project.pm_name ?? "—"}
                  </td>
                  <td className="px-5 py-3.5 text-text-muted">
                    {project.reports_to_name ?? "—"}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1.5 text-text-muted">
                      <Users className="h-3.5 w-3.5" aria-hidden="true" />
                      {project.member_count}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => openEdit(project.id)}
                        title="Edit project"
                        className="rounded-md p-1.5 text-text-muted hover:bg-brand-light hover:text-brand transition-colors"
                      >
                        <Pencil className="h-4 w-4" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(project)}
                        title="Delete project"
                        className="rounded-md p-1.5 text-text-muted hover:bg-red-50 hover:text-red-600 transition-colors"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <ProjectModal
          projectId={editingProjectId}
          users={users}
          onClose={handleModalClose}
          onSave={handleModalSave}
        />
      )}
    </div>
  );
}