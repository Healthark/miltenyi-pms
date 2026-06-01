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
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  useMemo,
  type Ref,
} from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Search, Pencil, Trash2, Users, FolderOpen,
  CheckCircle2, RotateCcw,
} from "lucide-react";
import {
  projectService,
  type ProjectResponse,
  type ProjectsPaginatedSortBy,
} from "@/services/project.service";
import { adminService } from "@/services/admin.service";
import { queryKeys } from "@/lib/queryKeys";
import { getErrorMessage } from "@/utils/errors";
import { ProjectModal } from "@/components/admin/ProjectModal";
import { ExportExcelButton } from "@/components/admin/ExportExcelButton";
import { ClearFiltersButton } from "@/components/common/ClearFiltersButton";
import { StringCombobox } from "@/components/common/StringCombobox";
import { Pagination } from "@/components/common/Pagination";
import { setOrDeleteParam, searchParamsChanged } from "@/utils/searchParams";
import { useToast } from "@/hooks/useToast";
import { useSnackbar } from "@/hooks/useSnackbar";
import { useConfirm } from "@/hooks/useConfirm";
import { SortableHeader } from "@/components/SortableHeader";
import { type SortState } from "@/utils/sort";

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Sort keys the SERVER can ORDER BY (mirrors backend
// `_PROJECTS_SORT_COLUMNS`). expected_end_date, pm_name,
// secondary_evaluator_name + member_count are deferred — they'd
// require correlated subqueries or extra joins. Those headers stay
// rendered as plain (non-sortable) text in this PR.
type ProjectsSortKey =
  | "name"
  | "project_code"
  | "start_date"
  | "status";

// PROJECTS_SORT_CONFIG removed (PR #74). Sort flows to the server via
// sort_by / sort_dir query params; per-column comparators no longer
// needed on the client.

type StatusFilter = "active" | "completed" | "all";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [sort, setSort] = useState<SortState<ProjectsSortKey> | null>(null);
  const [yearFilter, setYearFilter] = useState<string>("all");
  const [pmFilter, setPmFilter] = useState<string>("all");
  // Status default "active" — HR almost always wants the live roster
  // first (mirrors UsersTab's default). Completed projects are an
  // audit subset accessed via the dropdown.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("active");

  // ── URL state ──────────────────────────────────────────────────────
  // Mirrors UsersTab's pattern (which lives in the same panel): read
  // deep-link params on first mount, then mirror filter changes to URL
  // so refresh + share-link preserve the view. Gated by a one-shot ref
  // so the writer doesn't clobber URL params before the reader has
  // seeded state from them. Preserves `?tab=` and any other Admin-
  // level params (we only touch the keys this tab owns).
  const [searchParams, setSearchParams] = useSearchParams();
  const projectsTabDefaultedRef = useRef(false);
  useEffect(() => {
    if (projectsTabDefaultedRef.current) return;
    const urlYear = searchParams.get("year");
    const urlPm = searchParams.get("pm");
    const urlStatus = searchParams.get("status");
    if (urlYear) setYearFilter(urlYear);
    if (urlPm) setPmFilter(urlPm);
    if (urlStatus) setStatusFilter(urlStatus as StatusFilter);
    projectsTabDefaultedRef.current = true;
  }, [searchParams]);

  useEffect(() => {
    if (!projectsTabDefaultedRef.current) return;
    const next = new URLSearchParams(searchParams);
    setOrDeleteParam(next, "year", yearFilter);
    setOrDeleteParam(next, "pm", pmFilter);
    // Status: "active" is the page default; "all"/"completed" are real
    // user choices we DO want in the URL. The shared helper would
    // delete on "all" (same sentinel UsersTab/etc. use), but here
    // "all" means "include completed" — a real broadening. Delete only
    // when status matches the default.
    if (statusFilter && statusFilter !== "active") {
      next.set("status", statusFilter);
    } else {
      next.delete("status");
    }
    if (searchParamsChanged(searchParams, next)) {
      setSearchParams(next, { replace: true });
    }
  }, [yearFilter, pmFilter, statusFilter, searchParams, setSearchParams]);

  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  // ── Queries ─────────────────────────────────────────────────────────
  // Both lists are cached under shared keys so mutations from anywhere
  // in the app (PM/filter dropdowns, ProjectModal save, UsersTab edits)
  // invalidate them via the namespace `.all` accessor.
  //
  // Projects: shared with `useOrgProjectNames` (used by All Reviews
  // tab Project filter dropdowns) — single fetch covers both surfaces.
  // include_completed=true is always passed so toggling the Status
  // filter is purely client-side, no re-fetch.
  const projectsQuery = useQuery({
    queryKey: queryKeys.projects.list(),
    queryFn: () => projectService.listProjects(true),
  });
  const projects = useMemo(
    () => projectsQuery.data ?? [],
    [projectsQuery.data],
  );

  // Users: shared with the AdminPanel parent + UsersTab. Filtering
  // out deleted users locally keeps the ProjectModal's PM/member
  // picker from offering deactivated accounts without losing the
  // cache-share — UsersTab still gets the full list including
  // deleted rows for its Status filter.
  const usersQuery = useQuery({
    queryKey: queryKeys.admin.users(),
    queryFn: () => adminService.getUsers(),
  });
  const users = useMemo(
    () => (usersQuery.data ?? []).filter((u) => !u.is_deleted),
    [usersQuery.data],
  );

  const isLoading = projectsQuery.isPending || usersQuery.isPending;

  // Single helper because all three project-side mutations share the
  // same invalidation scope (every consumer of the project list).
  const invalidateProjectsScope = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.projects.all });
  }, [queryClient]);

  // ── Mutations ───────────────────────────────────────────────────────
  // All three follow the same shape: server call → optimistic-friendly
  // cache patch in onSuccess → broadcast invalidation in onSettled.
  // We patch in onSuccess rather than onMutate because the server
  // response is the source of truth (markComplete / reopen return
  // updated rows with derived fields like member_count). Delete is the
  // exception — we splice out the row optimistically inside onSuccess
  // for the same instant-feedback effect.
  const deleteMutation = useMutation({
    mutationFn: (projectId: number) => projectService.deleteProject(projectId),
    onSuccess: (_, projectId) => {
      queryClient.setQueryData<ProjectResponse[]>(
        queryKeys.projects.list(),
        (prev) => prev?.filter((p) => p.id !== projectId),
      );
    },
    onError: (err) => snackbar.error(getErrorMessage(err)),
    onSettled: invalidateProjectsScope,
  });

  const markCompleteMutation = useMutation({
    mutationFn: (projectId: number) => projectService.markComplete(projectId),
    onSuccess: (updated) => {
      queryClient.setQueryData<ProjectResponse[]>(
        queryKeys.projects.list(),
        (prev) => prev?.map((p) => (p.id === updated.id ? updated : p)),
      );
    },
    onError: (err) => snackbar.error(getErrorMessage(err)),
    onSettled: invalidateProjectsScope,
  });

  const reopenMutation = useMutation({
    mutationFn: (projectId: number) => projectService.reopen(projectId),
    onSuccess: (updated) => {
      queryClient.setQueryData<ProjectResponse[]>(
        queryKeys.projects.list(),
        (prev) => prev?.map((p) => (p.id === updated.id ? updated : p)),
      );
    },
    onError: (err) => snackbar.error(getErrorMessage(err)),
    onSettled: invalidateProjectsScope,
  });

  // ── Action handlers (thin wrappers — confirm + mutate + toast) ──────
  const handleDelete = async (project: ProjectResponse) => {
    const ok = await confirm({
      title: "Delete project?",
      message: `Delete "${project.name}"? This is a soft delete — the project is hidden but can be restored later.`,
      variant: "danger",
      confirmText: "Delete",
    });
    if (!ok) return;
    deleteMutation.mutate(project.id, {
      onSuccess: () => toast.success(`"${project.name}" deleted.`),
    });
  };

  const handleMarkComplete = async (project: ProjectResponse) => {
    const ok = await confirm({
      title: "Mark project as completed?",
      message:
        `"${project.name}" will be archived. ` +
        (project.member_count > 0
          ? `Its ${project.member_count} active assignment${project.member_count === 1 ? "" : "s"} ` +
            "will be end-dated to today. The PM can still finish in-progress " +
            "reviews for the current cycle; future cycles won't generate " +
            "new pending reviews."
          : "No active assignments will be affected — they're already ended."),
      confirmText: "Mark Complete",
    });
    if (!ok) return;
    markCompleteMutation.mutate(project.id, {
      onSuccess: () =>
        toast.success(`"${project.name}" marked as completed.`),
    });
  };

  const handleReopen = async (project: ProjectResponse) => {
    const ok = await confirm({
      title: "Re-open project?",
      message:
        `Re-open "${project.name}". The previously end-dated team members ` +
        "will NOT be auto-restored — re-add anyone who should be on the " +
        "project from the project edit form.",
      confirmText: "Re-open",
    });
    if (!ok) return;
    reopenMutation.mutate(project.id, {
      onSuccess: () => toast.success(`"${project.name}" re-opened.`),
    });
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

  // Modal save invalidates the projects key — the modal itself owns
  // the create/edit PATCH, so we don't know the new/updated row shape
  // here. Broadcast invalidation refetches the full list.
  const handleModalSave = () => {
    handleModalClose();
    invalidateProjectsScope();
  };

  // Filter-option lists derive from the FULL `projects` list (the
  // existing `listProjects(true)` query) — NOT from the paginated
  // page slice — so a narrowed filter set never collapses the dropdown
  // options to "only what's on this page". Same pattern UsersTab uses
  // for Function/Designation/Mentor dropdowns.
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

  // ── Server-side paginated query (PR #74) ────────────────────────────
  // Push filters + sort + page state to GET /projects/paginated. The
  // `projects` full list (above) still drives dropdown options +
  // ProjectModal's PM/member pickers; this new query drives only what
  // the table body renders.
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const paginatedQueryFilterParams = useMemo(() => {
    const params: Record<string, string | number> = {};
    const q = searchQuery.trim();
    if (q) params.search = q;
    if (statusFilter !== "all") params.status = statusFilter;
    if (pmFilter !== "all") params.pm_name = pmFilter;
    if (yearFilter !== "all") {
      const yearNum = Number(yearFilter);
      if (!Number.isNaN(yearNum)) params.start_year = yearNum;
    }
    if (sort) {
      params.sort_by = sort.key;
      params.sort_dir = sort.direction;
    }
    return params;
  }, [searchQuery, statusFilter, pmFilter, yearFilter, sort]);

  // Reset to page 1 when filters or sort change.
  const paginatedQueryFilterParamsKey = JSON.stringify(
    paginatedQueryFilterParams,
  );
  useEffect(() => {
    setPage(1);
  }, [paginatedQueryFilterParamsKey]);

  const paginatedQuery = useQuery({
    queryKey: queryKeys.projects.listPaginated({
      ...paginatedQueryFilterParams,
      _page: page,
      _pageSize: pageSize,
    }),
    queryFn: () =>
      projectService.listProjectsPaginated({
        ...paginatedQueryFilterParams,
        sort_by: sort?.key as ProjectsPaginatedSortBy | undefined,
        sort_dir: sort?.direction,
        limit: pageSize,
        offset: (page - 1) * pageSize,
      }),
  });

  const visibleProjects = paginatedQuery.data?.items ?? [];
  const totalProjects = paginatedQuery.data?.total ?? 0;

  return (
    <div className="p-5 flex flex-col gap-4">
      {/* Toolbar — search + filters */}
      <div className="flex items-center gap-4 flex-wrap">
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
        {/* Toolbar follows the project-wide
            Identity → Category → Relation → Time → State order so
            the filter widgets sit in the same logical slots across
            all admin-accessible pages. PM (Relation) precedes Start
            Year (Time) and Status (State). */}
        <div className="flex items-center gap-2">
          <label htmlFor="project-pm-filter" className={FILTER_LABEL_CLS}>
            PM
          </label>
          <StringCombobox
            id="project-pm-filter"
            // "(No PM)" sentinel prepended so HR can find unassigned
            // projects via type-to-filter ("no " narrows to it).
            // Display label is the wire value — parens + leading space
            // guarantee no collision with a real full_name. Filter
            // logic above short-circuits to `p.pm_name == null` for
            // this sentinel. Mirrors the "(No mentor)" pattern in
            // UsersTab + ManagementReview.
            options={["(No PM)", ...availablePms]}
            // State uses "all" as the no-filter sentinel; combobox
            // uses "" — translate on both edges (matches the pattern
            // used by UsersTab's Mentor/PM filters).
            value={pmFilter === "all" ? "" : pmFilter}
            onChange={(v) => setPmFilter(v === "" ? "all" : v)}
            placeholder="All PMs"
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
          <label htmlFor="project-status-filter" className={FILTER_LABEL_CLS}>
            Status
          </label>
          <select
            id="project-status-filter"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className={`${FILTER_SELECT_CLS} min-w-[120px]`}
          >
            <option value="active">Active</option>
            <option value="completed">Completed</option>
            <option value="all">All</option>
          </select>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ClearFiltersButton
            // Status defaults to "active" (sticky); treat any other
            // value as a user choice. Everything else clears to "all"
            // / empty.
            active={
              searchQuery.trim().length > 0 ||
              yearFilter !== "all" ||
              pmFilter !== "all" ||
              statusFilter !== "active"
            }
            onClear={() => {
              setSearchQuery("");
              setYearFilter("all");
              setPmFilter("all");
              setStatusFilter("active");
            }}
          />
          <ExportExcelButton kind="projects" />
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-sm text-text-muted">
          Loading projects…
        </div>
      ) : visibleProjects.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-border py-16 text-center bg-background/50">
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
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-border bg-slate-50 text-left">
                {/* Running row number. Cumulative across pages (page 2
                    starts at 26 when pageSize=25), matching the
                    "Showing 51–75 of 247" counter at the bottom. */}
                <th className="px-3 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted w-10">
                  #
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Project" columnKey="name" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Code" columnKey="project_code" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Start Date" columnKey="start_date" sort={sort} onSort={setSort} />
                </th>
                {/* End Date / PM / Secondary / Members — non-sortable
                    in this PR (PR #74 plan: derived columns deferred;
                    they'd need extra joins or correlated subqueries to
                    sort server-side). Rendered as plain headers so the
                    visual style matches the others without the
                    chevron affordance. */}
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  End Date
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  PM
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Secondary
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Members
                </th>
                <th className="px-5 py-3">
                  <SortableHeader label="Status" columnKey="status" sort={sort} onSort={setSort} />
                </th>
                <th className="px-5 py-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleProjects.map((project, idx) => (
                <tr
                  key={project.id}
                  className="transition-colors hover:bg-slate-50"
                >
                  <td className="px-3 py-3.5 text-text-muted tabular-nums text-xs">
                    {((page - 1) * pageSize + idx + 1).toLocaleString()}
                  </td>
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
                    {project.secondary_evaluator_name ?? "—"}
                  </td>
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-1.5 text-text-muted">
                      <Users className="h-3.5 w-3.5" aria-hidden="true" />
                      {project.member_count}
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    {project.status === "completed" ? (
                      <span
                        title={
                          project.completed_at
                            ? `Completed ${formatDate(project.completed_at)}` +
                              (project.completed_by_name
                                ? ` by ${project.completed_by_name}`
                                : "")
                            : "Completed"
                        }
                        className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold uppercase text-slate-600"
                      >
                        <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                        Completed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-bold uppercase text-green-700">
                        Active
                      </span>
                    )}
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
                      {project.status === "active" ? (
                        <button
                          type="button"
                          onClick={() => handleMarkComplete(project)}
                          title="Mark as completed"
                          className="rounded-md p-1.5 text-text-muted hover:bg-green-50 hover:text-green-700 transition-colors"
                        >
                          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleReopen(project)}
                          title="Re-open project"
                          className="rounded-md p-1.5 text-text-muted hover:bg-amber-50 hover:text-amber-700 transition-colors"
                        >
                          <RotateCcw className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
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

      {/* Pagination toolbar — below the table. The component handles
          its own zero-total state; we hide during the very first load
          so we don't flash controls on a skeleton table. */}
      {!paginatedQuery.isPending && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={totalProjects}
          onPageChange={setPage}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setPage(1);
          }}
          entityLabel="projects"
        />
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