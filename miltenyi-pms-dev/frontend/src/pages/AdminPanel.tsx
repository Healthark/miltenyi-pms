import { useState, useEffect, useCallback, useRef } from "react";
import {
  UserPlus, Users, Settings, FolderOpen, BarChart2, ShieldCheck, Plus,
} from "lucide-react";

import {
  adminService,
  type UserResponse,
  type UserCreatePayload,
  type UserUpdatePayload,
  type DepartmentBrief,
  type DesignationBrief,
  type SystemSettings,
  type AdminSettingsUpdatePayload,
} from "../services/admin.service";
import type { CycleType } from "../services/system-settings.service";
import { getErrorMessage } from "../utils/errors";
import { UsersTab } from "../components/admin/UsersTab";
import { SystemSettingsTab } from "../components/admin/SystemSettingsTab";
import { ProjectsTab, type ProjectsTabHandle } from "../components/admin/ProjectsTab";
import { UserModal } from "../components/admin/UserModal";
import { ManagementTab } from "../components/project-reviews/ManagementTab";
import { ManagementReviewTab } from "../components/admin/ManagementReviewTab";
import { useSystemSettings } from "../hooks/useSystemSettings";
import { useToast } from "../hooks/useToast";
import { useSnackbar } from "../hooks/useSnackbar";
import { useConfirm } from "../hooks/useConfirm";
import { useAuth } from "../hooks/useAuth";


type ActiveTab =
  | "users"
  | "projects"
  | "reviews"
  | "management_review"
  | "settings";

export default function AdminPanel() {
  // ── Data ──────────────────────────────────────────────────────────────────
  const [users, setUsers] = useState<UserResponse[]>([]);
  const [departments, setDepartments] = useState<DepartmentBrief[]>([]);
  const [designations, setDesignations] = useState<DesignationBrief[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // ── UI state ──────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<ActiveTab>("users");
  const [searchQuery, setSearchQuery] = useState("");
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserResponse | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  // Settings form state
  const [cycleType, setCycleType] = useState<CycleType>("half_yearly");
  const [fiscalStartMonth, setFiscalStartMonth] = useState(4);
  const [annualReviewsEnabled, setAnnualReviewsEnabled] = useState(false);
  const [annualGoalsEditEnabled, setAnnualGoalsEditEnabled] = useState(false);
  const [finalRatingVisible, setFinalRatingVisible] = useState(false);
  const [projectRatingsVisible, setProjectRatingsVisible] = useState(false);
  const [annualReviewFinalRatingVisible, setAnnualReviewFinalRatingVisible] = useState(false);

  const { refreshSettings } = useSystemSettings();
  const toast = useToast();
  const snackbar = useSnackbar();
  const confirm = useConfirm();

  const projectsTabRef = useRef<ProjectsTabHandle>(null);

  const { user } = useAuth();
  // Sub-role gate. The backend also enforces this on every management
  // endpoint, so this is purely a UI affordance.
  const canSeeManagementReview =
    user?.role === "Admin" && user?.is_management === true;
  // ── Bootstrap ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [usersData, deptData, desigData, settingsData] = await Promise.all([
        adminService.getUsers(),
        adminService.getDepartments(),
        adminService.getDesignations(),
        adminService.getSettings(),
      ]);
      setUsers(usersData);
      setDepartments(deptData);
      setDesignations(desigData);
      setSettings(settingsData);
      setCycleType((settingsData.cycle_type as CycleType) ?? "half_yearly");
      setFiscalStartMonth(settingsData.fiscal_start_month ?? 4);
      setAnnualReviewsEnabled(settingsData.annual_reviews_enabled ?? false);
      setAnnualGoalsEditEnabled(settingsData.annual_goals_edit_enabled ?? false);
      setFinalRatingVisible(settingsData.annual_goals_final_rating_visible ?? false);
      setProjectRatingsVisible(settingsData.project_ratings_visible ?? false);
      setAnnualReviewFinalRatingVisible(settingsData.annual_review_final_rating_visible ?? false);
    } catch {
      // Errors handled per-operation below
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // ── Derived ───────────────────────────────────────────────────────────────
  // Any active user can mentor — Manager/Principal/Admin gating is a UX
  // choice that fights real-world team structures (a senior IC can mentor a
  // junior IC without being a "Manager"). Filter here is just the active set.
  const mentorOptions = users.filter((u) => !u.is_deleted);

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

  const handleSaveUser = async (
    payload: UserCreatePayload | UserUpdatePayload,
  ) => {
    setIsSaving(true);
    setModalError("");
    try {
      if (editingUser) {
        const updated = await adminService.updateUser(
          editingUser.id,
          payload as UserUpdatePayload,
        );
        setUsers((prev) =>
          prev.map((u) => (u.id === updated.id ? updated : u)),
        );
        closeUserModal();
        toast.success(`${updated.full_name} updated.`);
      } else {
        const created = await adminService.createUser(
          payload as UserCreatePayload,
        );
        setUsers((prev) => [created, ...prev]);
        closeUserModal();
        toast.success(`${created.full_name} created.`);
      }
    } catch (err) {
      setModalError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeactivate = async (user: UserResponse) => {
    const ok = await confirm({
      title: "Deactivate user?",
      message: `Deactivate ${user.full_name}? They will no longer be able to log in. This can be reversed by reactivating the user.`,
      variant: "danger",
      confirmText: "Deactivate",
    });
    if (!ok) return;

    try {
      await adminService.deactivateUser(user.id);
      setUsers((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, is_deleted: true } : u)),
      );
      toast.success(`${user.full_name} deactivated.`);
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
  };

  const handleReactivate = async (user: UserResponse) => {
    const ok = await confirm({
      title: "Reactivate user?",
      message: `Reactivate ${user.full_name}? They will regain access immediately using their previous password. Historical goals, reviews, and mentor assignment are preserved.`,
      variant: "default",
      confirmText: "Reactivate",
    });
    if (!ok) return;

    try {
      const updated = await adminService.reactivateUser(user.id);
      setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      toast.success(`${updated.full_name} reactivated.`);
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    }
  };

  // ── Settings handler ──────────────────────────────────────────────────────
  const handleSaveSettings = async () => {
    setIsSaving(true);
    try {
      const payload: AdminSettingsUpdatePayload = {
        cycle_type: cycleType,
        fiscal_start_month: fiscalStartMonth,
        annual_reviews_enabled: annualReviewsEnabled,
        annual_goals_edit_enabled: annualGoalsEditEnabled,
        annual_goals_final_rating_visible: finalRatingVisible,
        project_ratings_visible: projectRatingsVisible,
        annual_review_final_rating_visible: annualReviewFinalRatingVisible,
      };
      await adminService.updateSettings(payload);
      // Re-fetch from DB so local state always reflects what was actually persisted.
      const fresh = await adminService.getSettings();
      setSettings(fresh);
      setCycleType((fresh.cycle_type as CycleType) ?? "half_yearly");
      setFiscalStartMonth(fresh.fiscal_start_month ?? 4);
      setAnnualReviewsEnabled(fresh.annual_reviews_enabled ?? false);
      setAnnualGoalsEditEnabled(fresh.annual_goals_edit_enabled ?? false);
      setFinalRatingVisible(fresh.annual_goals_final_rating_visible ?? false);
      setProjectRatingsVisible(fresh.project_ratings_visible ?? false);
      setAnnualReviewFinalRatingVisible(fresh.annual_review_final_rating_visible ?? false);
      await refreshSettings();
      toast.success("Configuration saved.");
    } catch (err) {
      snackbar.error(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
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
          <button
            type="button"
            className={tabCls("reviews")}
            onClick={() => setActiveTab("reviews")}
          >
            <BarChart2 className="h-4 w-4" aria-hidden="true" />
            Reviews
          </button>
          {canSeeManagementReview && (
            <button
              type="button"
              className={tabCls("management_review")}
              onClick={() => setActiveTab("management_review")}
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Management Review
            </button>
          )}
          <button
            type="button"
            className={tabCls("settings")}
            onClick={() => setActiveTab("settings")}
          >
            <Settings className="h-4 w-4" aria-hidden="true" />
            System Settings
          </button>
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

        {activeTab === "reviews" && (
          <div className="p-5">
            <ManagementTab />
          </div>
        )}

        {activeTab === "management_review" && canSeeManagementReview && (
          <ManagementReviewTab />
        )}

        {activeTab === "settings" && (
          <SystemSettingsTab
            activeCycleName={settings?.active_cycle ?? ""}
            cycleType={cycleType}
            fiscalStartMonth={fiscalStartMonth}
            annualReviewsEnabled={annualReviewsEnabled}
            onAnnualReviewsEnabledChange={setAnnualReviewsEnabled}
            annualGoalsEditEnabled={annualGoalsEditEnabled}
            onAnnualGoalsEditEnabledChange={setAnnualGoalsEditEnabled}
            finalRatingVisible={finalRatingVisible}
            onFinalRatingVisibleChange={setFinalRatingVisible}
            projectRatingsVisible={projectRatingsVisible}
            onProjectRatingsVisibleChange={setProjectRatingsVisible}
            annualReviewFinalRatingVisible={annualReviewFinalRatingVisible}
            onAnnualReviewFinalRatingVisibleChange={setAnnualReviewFinalRatingVisible}
            onSave={handleSaveSettings}
            isSaving={isSaving}
          />
        )}
      </div>

      {/* Modals — rendered outside the card so they overlay the full page */}
      <UserModal
        isOpen={showUserModal}
        onClose={closeUserModal}
        onSave={handleSaveUser}
        editingUser={editingUser}
        departments={departments}
        designations={designations}
        managers={mentorOptions}
        isSaving={isSaving}
        error={modalError}
      />

    </div>
  );
}