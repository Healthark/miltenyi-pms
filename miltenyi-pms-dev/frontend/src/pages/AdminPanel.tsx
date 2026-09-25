import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  UserPlus, Users, Settings, Download, GitBranch, BookOpen,
} from "lucide-react";
import { FrameworkMappingTab } from "@/components/admin/FrameworkMappingTab";
import { FrameworkTab } from "@/components/admin/FrameworkTab";

import {
  adminService,
  type UserResponse,
  type UserCreatePayload,
  type UserUpdatePayload,
} from "@/services/admin.service";
import { getErrorMessage } from "@/utils/errors";
import { UsersTab } from "@/components/admin/UsersTab";
import { SystemSettingsTab } from "@/components/admin/SystemSettingsTab";
import { UserModal } from "@/components/admin/UserModal";
import { ExportsTab } from "@/components/admin/ExportsTab";
import { useToast } from "@/hooks/useToast";
import { useSnackbar } from "@/hooks/useSnackbar";
import { useConfirm } from "@/hooks/useConfirm";
import { useAuth } from "@/hooks/useAuth";

// Projects (trial rosters with a Miltenyi PM) were retired on 10 Sep 2026:
// nothing is tracked per trial or project any more. The components stay in
// src/components/admin/ProjectsTab.tsx behind the "projects" feature flag
// for an org that wants them back.

type ActiveTab =
  | "users"
  | "mapping"
  | "framework"
  | "exports"
  | "settings";

export default function AdminPanel() {
  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const { user } = useAuth();
  // Exports tab is open to both HR roles. The tab body branches on role
  // internally: HR_MyOrg gets the full Exports surface (combined workbook
  // + per-employee + per-sheet quick downloads); HR_Miltenyi gets a
  // stripped-down view with just the Miltenyi-scoped workbook (users +
  // projects + project reviews — annual goals/reviews are out of scope).
  //
  // Role — not Function/Department — is the access check because Miltenyi
  // org has no "HR" function row to key off.
  const canSeeExports = user?.role === "Admin";

  // System Settings tab is HR_MyOrg-only. HR_Miltenyi has no controls
  // they can flip there (cycle cadence, fiscal anchor, timezone,
  // per-FY toggles are all Healthark-owned), so the
  // tab is hidden entirely rather than shown read-only. Same role-gate
  // pattern as canSeeExports above.
  const canSeeSystemSettings = user?.role === "Admin";

  // ── Server state ──────────────────────────────────────────────────────────
  // Four independent queries that fire in parallel on mount. Each owns
  // its own cache entry under the ['admin', ...] namespace. Mutations
  // below invalidate by key so cross-component updates (e.g. another
  // mounted view of users) refresh automatically.
  //
  // The settings query opts OUT of refetch-on-window-focus because the
  // form state below initializes from it once on first arrival. Without
  // this guard, alt-tabbing while editing a half-typed FY would silently
  // clobber the form with the server's current values.
  const usersQuery = useQuery({
    queryKey: queryKeys.admin.users(),
    queryFn: adminService.getUsers,
  });
  const functionsQuery = useQuery({
    queryKey: queryKeys.admin.functions(),
    queryFn: adminService.getFunctions,
  });
  const designationsQuery = useQuery({
    queryKey: queryKeys.admin.designations(),
    queryFn: adminService.getDesignations,
  });
  const settingsQuery = useQuery({
    queryKey: queryKeys.admin.settings(),
    queryFn: adminService.getSettings,
    refetchOnWindowFocus: false,
  });

  // `data = []` defaults keep the rest of the component working with
  // arrays (avoids `users?.filter(...)` ceremony everywhere). The
  // queries above remain the source of truth.
  const users = usersQuery.data ?? [];
  const functions = functionsQuery.data ?? [];
  const designations = designationsQuery.data ?? [];
  const settings = settingsQuery.data ?? null;
  const isLoading = usersQuery.isPending;

  // ── UI state ──────────────────────────────────────────────────────────────
  // Honor a `?tab=<id>` query param on initial mount so deep-links
  // from elsewhere in the app (e.g. the "Re-enable →" link on the HR
  // dashboard's Active Overrides card) can open the right tab. Falls
  // back to "users" for any unknown / missing value. URL is read once
  // synchronously inside useState's initializer so the right tab
  // paints from the first render.
  const [activeTab, setActiveTab] = useState<ActiveTab>(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("tab");
    const valid: ActiveTab[] = ["users", "mapping", "framework", "exports", "settings"];
    return (valid as readonly string[]).includes(requested ?? "")
      ? (requested as ActiveTab)
      : "users";
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserResponse | null>(null);
  const [modalError, setModalError] = useState("");

  // Settings form state — only the org-wide knobs live here
  // (fiscal month, timezone). The per-FY access
  // toggles are owned by SystemSettingsTab via the year-scoped
  // /admin/settings/year endpoints; the Project Goals switches by the
  // goal-framework settings endpoint. Fiscal month and timezone are
  // read-only in the UI (set at onboarding) and only flow to the tab
  // for display; nothing org-wide is saved from this page any more.
  const [fiscalStartMonth, setFiscalStartMonth] = useState(4);
  // IANA timezone string. Anchors every backend calendar-day decision
  // (cycle rollover, FY-end gates, assignment end dates). Defaults to
  // "UTC" until HR picks the org's actual zone.
  const [timezone, setTimezone] = useState<string>("UTC");

  // Sync the local settings form ONCE when the query first resolves.
  // Done during render via the "previous prop snapshot" pattern (React 19
  // recommended path — see the `set-state-in-effect` rule docs) instead
  // of a useEffect that would otherwise be flagged. Background refetches
  // never re-sync because `hasInitializedForm` flips on the first run.
  const [hasInitializedForm, setHasInitializedForm] = useState(false);
  if (settings && !hasInitializedForm) {
    setFiscalStartMonth(settings.fiscal_start_month ?? 4);
    setTimezone(settings.timezone ?? "UTC");
    setHasInitializedForm(true);
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  // Mentor picker shows ONLY users with role="Mentor". Previously this
  // list was every active user with the rationale "any senior IC can
  // mentor a junior IC" — but in practice the picker became a noisy
  // mix of Employees, PMs, HR roles, and Mentors, and HR ended up
  // accidentally assigning the wrong role as a mentor. The backend
  // also enforces role=Mentor on the mentor_id assignment now (see
  // admin_routes._validate_mentor_role); this filter keeps the UI in
  // sync so non-Mentor candidates never appear in the dropdown.
  const mentorOptions = users.filter((u) => {
    if (u.is_deleted) return false;
    if (u.role !== "Mentor") return false;
    return true;
  });

  // ── User handlers ─────────────────────────────────────────────────────────
  const openAddModal = () => {
    setEditingUser(null);
    setModalError("");
    setShowUserModal(true);
  };
  const openEditModal = (u: UserResponse) => {
    setEditingUser(u);
    setModalError("");
    setShowUserModal(true);
  };
  const closeUserModal = () => {
    setShowUserModal(false);
    setEditingUser(null);
    setModalError("");
  };

  // ── User mutations ─────────────────────────────────────────────────────
  // The same invalidation key (['admin', 'users']) is used by every user
  // mutation. After any write, TanStack Query refetches the users list
  // and every observer of that key re-renders with the new data. This
  // replaces the manual setUsers((prev) => ...) shuffles below.
  //
  // Why we invalidate instead of writing the response into the cache
  // directly: the server may compute things we didn't send (timestamps,
  // related counts), so re-asking it is the safest single-source-of-
  // truth move. For a hot-path mutation we'd consider setQueryData with
  // the response, but user CRUD isn't hot enough to bother.

  const createUserMutation = useMutation({
    mutationFn: (payload: UserCreatePayload) =>
      adminService.createUser(payload),
    onSuccess: (created, payload) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      closeUserModal();
      // Drift signal: the modal previewed `payload.employee_code` from
      // GET /admin/users/next-employee-code, but the backend re-derives
      // at create time. If two HRs picked the same role in the same
      // window, one of them gets a code +1 — surface that as info so
      // the HR doesn't think the preview lied.
      if (
        payload.employee_code &&
        payload.employee_code !== created.employee_code
      ) {
        toast.info(
          `${created.full_name} created with code ${created.employee_code} ` +
            `(${payload.employee_code} was just taken by another user).`,
        );
      } else {
        toast.success(`${created.full_name} created.`);
      }
    },
    onError: (err) => setModalError(getErrorMessage(err)),
  });

  // useMutation's mutate() takes ONE argument. updateUser needs two
  // (id + payload), so we pack them into an object. This is the
  // canonical pattern for any multi-arg mutation.
  const updateUserMutation = useMutation({
    mutationFn: (vars: { id: number; payload: UserUpdatePayload }) =>
      adminService.updateUser(vars.id, vars.payload),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      closeUserModal();
      toast.success(`${updated.full_name} updated.`);
    },
    onError: (err) => setModalError(getErrorMessage(err)),
  });

  // Combined "is the modal in a saving state" flag. With two separate
  // mutations powering one modal we OR their pending flags so the
  // existing isSaving prop still tells the UI to show a spinner.
  const isSavingUser =
    createUserMutation.isPending || updateUserMutation.isPending;

  // Deactivate/Reactivate take a user object (we need full_name for
  // the toast). Returning the user from the mutationFn lets onSuccess
  // receive it as the first arg without us having to capture it via
  // a closure.
  const deactivateMutation = useMutation({
    mutationFn: async (target: UserResponse) => {
      await adminService.deactivateUser(target.id);
      return target;
    },
    onSuccess: (target) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      toast.success(`${target.full_name} deactivated.`);
    },
    onError: (err) => snackbar.error(getErrorMessage(err)),
  });

  const reactivateMutation = useMutation({
    mutationFn: (target: UserResponse) =>
      adminService.reactivateUser(target.id),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      toast.success(`${updated.full_name} reactivated.`);
    },
    onError: (err) => snackbar.error(getErrorMessage(err)),
  });

  // Uses mutateAsync (not mutate) because the UserModal awaits onSave
  // to drive its internal "Saving..." state and only un-disables the
  // submit button when the Promise resolves. We catch the rejection
  // here so the existing onError -> setModalError flow stays in
  // charge of UI error messaging (matching the contract the modal
  // was written against: onSave always resolves).
  //
  // mutate vs mutateAsync rule of thumb:
  //   - mutate:      fire-and-forget; success/failure handled by
  //                  onSuccess/onError callbacks. Use when you don't
  //                  need to coordinate the caller's flow with the
  //                  mutation lifecycle.
  //   - mutateAsync: returns a Promise that resolves with the data or
  //                  rejects with the error. Use when the caller needs
  //                  to await completion (e.g. a modal that's awaiting
  //                  before closing, or sequential mutations).
  const handleSaveUser = async (
    payload: UserCreatePayload | UserUpdatePayload,
  ): Promise<void> => {
    setModalError("");
    try {
      if (editingUser) {
        await updateUserMutation.mutateAsync({
          id: editingUser.id,
          payload: payload as UserUpdatePayload,
        });
      } else {
        await createUserMutation.mutateAsync(payload as UserCreatePayload);
      }
    } catch {
      // onError already set modalError. Swallow so the modal's await
      // never sees an exception (preserves the legacy contract).
    }
  };

  const handleDeactivate = async (target: UserResponse) => {
    const ok = await confirm({
      title: "Deactivate user?",
      message: `Deactivate ${target.full_name}? They will no longer be able to log in. This can be reversed by reactivating the user.`,
      variant: "danger",
      confirmText: "Deactivate",
    });
    if (!ok) return;
    deactivateMutation.mutate(target);
  };

  const handleReactivate = async (target: UserResponse) => {
    const ok = await confirm({
      title: "Reactivate user?",
      message: `Reactivate ${target.full_name}? They will regain access immediately using their previous password. Historical goals, reviews, and mentor assignment are preserved.`,
      variant: "default",
      confirmText: "Reactivate",
    });
    if (!ok) return;
    reactivateMutation.mutate(target);
  };

  // ── Tab style helper ──────────────────────────────────────────────────────
  const tabCls = (tab: ActiveTab) =>
    `flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors ${
      activeTab === tab
        ? "border-brand text-brand"
        : "border-transparent text-text-muted hover:text-text-main"
    }`;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold text-text-main">
            Admin Panel
          </h1>
          <p className="mt-0.5 text-sm text-text-muted">
            Manage users, the goals framework, exports and system configuration.
          </p>
        </div>
        {activeTab === "users" && (
          <button
            type="button"
            onClick={openAddModal}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Add User
          </button>
        )}
      </div>

      {/* Tab container */}
      <div className="rounded-xl border border-border bg-surface shadow-sm overflow-hidden">
        <div className="flex border-b border-border px-2">
          <button
            type="button"
            className={tabCls("users")}
            onClick={() => setActiveTab("users")}
          >
            <Users className="h-4 w-4" aria-hidden="true" />
            Users
          </button>
          {canSeeExports && (
            <button
              type="button"
              className={tabCls("exports")}
              onClick={() => setActiveTab("exports")}
            >
              <Download className="h-4 w-4" aria-hidden="true" />
              Exports
            </button>
          )}
          {canSeeSystemSettings && (
            <button
              type="button"
              className={tabCls("settings")}
              onClick={() => setActiveTab("settings")}
            >
              <Settings className="h-4 w-4" aria-hidden="true" />
              System Settings
            </button>
          )}
          {/* Project Goals administration — Healthark HR only. Mapping shows
              each employee's function, designation level, mentor (reviewer of
              record) and Miltenyi reviewer; Framework edits the goal-themes
              content per function × level. */}
          {canSeeSystemSettings && (
            <button
              type="button"
              className={tabCls("mapping")}
              onClick={() => setActiveTab("mapping")}
            >
              <GitBranch className="h-4 w-4" aria-hidden="true" />
              Framework Mapping
            </button>
          )}
          {canSeeSystemSettings && (
            <button
              type="button"
              className={tabCls("framework")}
              onClick={() => setActiveTab("framework")}
            >
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              Framework
            </button>
          )}
        </div>

        {activeTab === "users" && (
          <UsersTab
            users={users}
            isLoading={isLoading}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            onEdit={openEditModal}
            onDeactivate={handleDeactivate}
            onReactivate={handleReactivate}
          />
        )}

        {activeTab === "exports" && canSeeExports && <ExportsTab />}

        {activeTab === "mapping" && canSeeSystemSettings && (
          <FrameworkMappingTab users={users} />
        )}

        {activeTab === "framework" && canSeeSystemSettings && <FrameworkTab />}

        {activeTab === "settings" && canSeeSystemSettings && (
          <SystemSettingsTab
            activeCycleName={settings?.active_cycle ?? ""}
            fiscalStartMonth={fiscalStartMonth}
            timezone={timezone}
          />
        )}
      </div>

      {/* Modals — rendered outside the card so they overlay the full page */}
      {/* `key` on (editingUser?.id ?? "new") forces React to remount the
          modal whenever HR switches between Add / Edit / a different user.
          That makes the modal's `useState` initializer re-run with the
          fresh prop, so we don't need a useEffect to sync the form. */}
      <UserModal
        key={editingUser?.id ?? "new"}
        isOpen={showUserModal}
        onClose={closeUserModal}
        onSave={handleSaveUser}
        editingUser={editingUser}
        functions={functions}
        designations={designations}
        managers={mentorOptions}
        isSaving={isSavingUser}
        error={modalError}
      />

    </div>
  );
}