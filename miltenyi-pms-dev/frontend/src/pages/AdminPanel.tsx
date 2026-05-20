import { useState, useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import {
  UserPlus, Users, Settings, FolderOpen, Plus, Download,
} from "lucide-react";

import {
  adminService,
  type UserResponse,
  type UserCreatePayload,
  type UserUpdatePayload,
  type AdminSettingsUpdatePayload,
} from "@/services/admin.service";
import type { CycleType } from "@/services/system-settings.service";
import { getErrorMessage } from "@/utils/errors";
import { UsersTab } from "@/components/admin/UsersTab";
import { SystemSettingsTab } from "@/components/admin/SystemSettingsTab";
import { ProjectsTab, type ProjectsTabHandle } from "@/components/admin/ProjectsTab";
import { UserModal } from "@/components/admin/UserModal";
import { ExportsTab } from "@/components/admin/ExportsTab";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { useToast } from "@/hooks/useToast";
import { useSnackbar } from "@/hooks/useSnackbar";
import { useConfirm } from "@/hooks/useConfirm";
import { useAuth } from "@/hooks/useAuth";


type ActiveTab =
  | "users"
  | "projects"
  | "exports"
  | "settings";

export default function AdminPanel() {
  const { refreshSettings } = useSystemSettings();
  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();
  const queryClient = useQueryClient();

  const projectsTabRef = useRef<ProjectsTabHandle>(null);

  const { user } = useAuth();
  // Exports tab is open to both HR roles. The tab body branches on role
  // internally: HR_MyOrg gets the full Exports surface (combined workbook
  // + per-employee + per-sheet quick downloads); HR_Miltenyi gets a
  // stripped-down view with just the Miltenyi-scoped workbook (users +
  // projects + project reviews — annual goals/reviews are out of scope).
  //
  // Role — not Function/Department — is the access check because Miltenyi
  // org has no "HR" function row to key off.
  const canSeeExports =
    user?.role === "HR_MyOrg" || user?.role === "HR_Miltenyi";

  // System Settings tab is HR_MyOrg-only. HR_Miltenyi has no controls
  // they can flip there (cycle cadence, fiscal anchor, timezone,
  // per-FY toggles, date simulation are all Healthark-owned), so the
  // tab is hidden entirely rather than shown read-only. Same role-gate
  // pattern as canSeeExports above.
  const canSeeSystemSettings = user?.role === "HR_MyOrg";

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
  const [activeTab, setActiveTab] = useState<ActiveTab>("users");
  const [searchQuery, setSearchQuery] = useState("");
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserResponse | null>(null);
  const [modalError, setModalError] = useState("");

  // Settings form state — only the org-wide knobs live here now
  // (cadence, fiscal month, simulated_today). The four per-FY access
  // toggles are owned by SystemSettingsTab via the year-scoped
  // /admin/settings/year endpoints. Cadence + fiscal month are
  // currently read-only in the UI but their values still flow to the
  // tab so it can render the read-only display.
  const [cycleType, setCycleType] = useState<CycleType>("half_yearly");
  const [fiscalStartMonth, setFiscalStartMonth] = useState(4);
  // IANA timezone string. Anchors every backend calendar-day decision
  // (cycle rollover, FY-end gates, assignment end dates). Defaults to
  // "UTC" until HR picks the org's actual zone.
  const [timezone, setTimezone] = useState<string>("UTC");
  // Dev/QA date simulation. simulatedToday is an ISO date string (or
  // empty when unset). simulationAllowed mirrors the backend's env
  // flag so the field hides itself outside dev/staging.
  const [simulatedToday, setSimulatedToday] = useState<string>("");
  const [simulationAllowed, setSimulationAllowed] = useState(false);
  // Tracks whether the next save should send `clear_simulated_today`
  // — set when HR clicks Clear so the PATCH explicitly drops the
  // stored value (PATCH semantics treat omission as "leave unchanged").
  const [clearSimulatedTodayPending, setClearSimulatedTodayPending] = useState(false);

  // Sync the local settings form ONCE when the query first resolves.
  // Re-syncs on the *server's* terms also need to land here (e.g. the
  // settings mutation's onSuccess uses queryClient.setQueryData to
  // freshen the cache, which triggers this effect). The
  // `hasInitializedForm` flag prevents background refetches from
  // overwriting an in-progress edit.
  const [hasInitializedForm, setHasInitializedForm] = useState(false);
  useEffect(() => {
    if (settings && !hasInitializedForm) {
      setCycleType((settings.cycle_type as CycleType) ?? "half_yearly");
      setFiscalStartMonth(settings.fiscal_start_month ?? 4);
      setTimezone(settings.timezone ?? "UTC");
      setSimulatedToday(settings.simulated_today ?? "");
      setSimulationAllowed(settings.simulation_allowed ?? false);
      setClearSimulatedTodayPending(false);
      setHasInitializedForm(true);
    }
  }, [settings, hasInitializedForm]);

  // ── Derived ───────────────────────────────────────────────────────────────
  // Any active user can mentor — Manager/Principal/Admin gating is a UX
  // choice that fights real-world team structures (a senior IC can mentor a
  // junior IC without being a "Manager"). Filter here is just the active set.
  //
  // HR_Miltenyi viewers don't get any Mentor or HR_MyOrg candidates in
  // the picker. UserModal also hides the mentor field entirely for
  // them (it derives the same flag from useAuth internally). This
  // filter mirrors that scope so the option list stays clean even if
  // the field were ever re-enabled for HR_Miltenyi.
  const isViewerMiltenyiHR = user?.role === "HR_Miltenyi";
  const mentorOptions = users.filter((u) => {
    if (u.is_deleted) return false;
    if (isViewerMiltenyiHR && (u.role === "Mentor" || u.role === "HR_MyOrg")) {
      return false;
    }
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
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.admin.users() });
      closeUserModal();
      toast.success(`${created.full_name} created.`);
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

  // ── Settings mutation ──────────────────────────────────────────────────
  // The previous handler did: PATCH → GET → setSettings → re-sync form
  // state. With useMutation, the response of PATCH is already the fresh
  // server view (the backend returns the updated row), so we:
  //   1. Push the response straight into the ['admin', 'settings'] cache
  //      via setQueryData. This skips an extra GET round-trip.
  //   2. Re-sync the local form state from the response (the server may
  //      have computed `active_cycle` from cycle_type + fiscal_start_month,
  //      or normalized `simulation_allowed`).
  //   3. Tell the global SystemSettingsProvider to refresh — it has its
  //      own context-cached copy that drives banners and gates elsewhere.
  //
  // We deliberately use setQueryData here instead of invalidateQueries:
  // setQueryData is synchronous and avoids a refetch round-trip when we
  // already have the canonical response. For a save flow that's the
  // right trade. invalidateQueries would also work but would add a
  // wasted GET.
  const updateSettingsMutation = useMutation({
    mutationFn: (payload: AdminSettingsUpdatePayload) =>
      adminService.updateSettings(payload),
    onSuccess: (fresh) => {
      queryClient.setQueryData(queryKeys.admin.settings(), fresh);
      setCycleType((fresh.cycle_type as CycleType) ?? "half_yearly");
      setFiscalStartMonth(fresh.fiscal_start_month ?? 4);
      setTimezone(fresh.timezone ?? "UTC");
      setSimulatedToday(fresh.simulated_today ?? "");
      setSimulationAllowed(fresh.simulation_allowed ?? false);
      setClearSimulatedTodayPending(false);
      void refreshSettings();
      toast.success("Configuration saved.");
    },
    onError: (err) => snackbar.error(getErrorMessage(err)),
  });

  const handleSaveOrgWide = () => {
    // Org-wide PATCH: only the cadence/fiscal/simulation fields. The
    // four access toggles save through their own per-FY mutation in
    // SystemSettingsTab.
    const payload: AdminSettingsUpdatePayload = {
      cycle_type: cycleType,
      fiscal_start_month: fiscalStartMonth,
      timezone: timezone,
    };
    if (clearSimulatedTodayPending) {
      payload.clear_simulated_today = true;
    } else if (simulatedToday) {
      payload.simulated_today = simulatedToday;
    }
    updateSettingsMutation.mutate(payload);
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
            Manage users, projects, and system configuration for your organization.
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
        {activeTab === "projects" && (
          <button
            type="button"
            onClick={() => projectsTabRef.current?.openCreate()}
            className="flex items-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Add Project
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
          <button
            type="button"
            className={tabCls("projects")}
            onClick={() => setActiveTab("projects")}
          >
            <FolderOpen className="h-4 w-4" aria-hidden="true" />
            Projects
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

        {activeTab === "projects" && <ProjectsTab ref={projectsTabRef} />}

        {activeTab === "exports" && canSeeExports && <ExportsTab />}

        {activeTab === "settings" && canSeeSystemSettings && (
          <SystemSettingsTab
            activeCycleName={settings?.active_cycle ?? ""}
            cycleType={cycleType}
            fiscalStartMonth={fiscalStartMonth}
            timezone={timezone}
            onTimezoneChange={setTimezone}
            simulatedToday={simulatedToday || null}
            simulationAllowed={simulationAllowed}
            onSimulatedTodayChange={(date) => {
              setSimulatedToday(date);
              setClearSimulatedTodayPending(false);
            }}
            onClearSimulatedToday={() => {
              setSimulatedToday("");
              setClearSimulatedTodayPending(true);
            }}
            onSaveOrgWide={handleSaveOrgWide}
            isSavingOrgWide={updateSettingsMutation.isPending}
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