import { useState } from "react";
import { createPortal } from "react-dom";
import type {
  UserResponse,
  UserCreatePayload,
  UserUpdatePayload,
  FunctionBrief,
  DesignationBrief,
} from "@/services/admin.service";
import { UserCombobox } from "@/components/common/UserCombobox";
import { useAuth } from "@/hooks/useAuth";

// Role choices in the dropdown — must match the backend Role enum exactly.
// Labels are display-only; the value is what gets persisted.
const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "Staff", label: "Staff" },
  { value: "PM", label: "PM (Miltenyi)" },
  { value: "Mentor", label: "Mentor (Healthark)" },
  { value: "HR_Miltenyi", label: "HR · Miltenyi" },
  { value: "HR_MyOrg", label: "HR · Healthark" },
];

const ALL_ROLE_VALUES = ROLE_OPTIONS.map((r) => r.value);

// HR_Miltenyi cannot create/edit Mentor or HR_MyOrg users (security boundary).
// Backend enforces this; the UI hides the options too so the constraint is
// visible up-front instead of as a 403 after submit.
const PROTECTED_ROLES = new Set(["Mentor", "HR_MyOrg"]);

interface UserModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSave: (
    payload: UserCreatePayload | UserUpdatePayload,
  ) => Promise<void>;
  readonly editingUser: UserResponse | null;
  readonly functions: FunctionBrief[];
  readonly designations: DesignationBrief[];
  readonly managers: UserResponse[]; // Consider renaming this prop to 'potentialMentors' in the future
  readonly isSaving: boolean;
  readonly error: string;
}

const INPUT_CLS =
  "w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-text-main placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand";
const LABEL_CLS = "block text-xs font-medium text-text-muted mb-1";

export function UserModal({
  isOpen,
  onClose,
  onSave,
  editingUser,
  functions,
  designations,
  managers,
  isSaving,
  error,
}: UserModalProps) {
  const isEditing = editingUser !== null;
  const { user: currentUser } = useAuth();

  // HR_Miltenyi can only see/select non-protected roles. HR_MyOrg sees all.
  const isViewerMiltenyiHR = currentUser?.role === "HR_Miltenyi";
  const visibleRoleOptions = isViewerMiltenyiHR
    ? ROLE_OPTIONS.filter((r) => !PROTECTED_ROLES.has(r.value))
    : ROLE_OPTIONS;

  // Initialize form state once on mount. AdminPanel passes
  // `key={editingUser?.id ?? "new"}`, so React remounts this modal
  // whenever HR switches between Add / Edit / a different user, and
  // this initializer re-runs with the fresh `editingUser`.
  const [form, setForm] = useState(() =>
    editingUser
      ? {
          employee_code: editingUser.employee_code,
          full_name: editingUser.full_name,
          email: editingUser.email,
          phone: editingUser.phone ?? "",
          // Map any legacy/unknown role value back to Staff so the dropdown
          // doesn't render a value that isn't in ROLE_OPTIONS.
          role: ALL_ROLE_VALUES.includes(editingUser.role) ? editingUser.role : "Staff",
          function_id: editingUser.function_id?.toString() ?? "",
          designation_id: editingUser.designation_id?.toString() ?? "",
          mentor_id: editingUser.mentor_id?.toString() ?? "",
          password: "",
        }
      : {
          employee_code: "",
          full_name: "",
          email: "",
          phone: "",
          role: "Staff",
          function_id: "",
          designation_id: "",
          mentor_id: "",
          password: "",
        },
  );

  if (!isOpen) return null;

  const set = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSubmit = async () => {
    if (isEditing) {
      await onSave({
        full_name: form.full_name || undefined,
        phone: form.phone || undefined,
        role: form.role || undefined,
        employee_code: form.employee_code || undefined,
        function_id: form.function_id ? Number(form.function_id) : null,
        designation_id: form.designation_id
          ? Number(form.designation_id)
          : null,
        mentor_id: form.mentor_id ? Number(form.mentor_id) : null,
      } satisfies UserUpdatePayload);
    } else {
      await onSave({
        employee_code: form.employee_code,
        full_name: form.full_name,
        email: form.email,
        phone: form.phone || undefined,
        role: form.role,
        function_id: form.function_id ? Number(form.function_id) : null,
        designation_id: form.designation_id
          ? Number(form.designation_id)
          : null,
        mentor_id: form.mentor_id ? Number(form.mentor_id) : null,
        password: form.password,
      } satisfies UserCreatePayload);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="user-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl bg-surface shadow-xl">
        <div className="border-b border-border px-6 py-4">
          <h2
            id="user-modal-title"
            className="font-display text-base font-semibold text-text-main"
          >
            {isEditing ? "Edit User" : "Add New User"}
          </h2>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <p className="rounded-lg bg-red-50 px-4 py-2.5 text-sm text-red-600">
              {error}
            </p>
          )}

          {/* Identity fields (employee_code + full_name) are locked
              when HR_Miltenyi is editing an existing Staff row. Healthark
              HR owns those columns for Staff users; mirrors the backend's
              403 guard in admin_routes.update_user. The lock checks the
              ORIGINAL role (editingUser.role) so it stays consistent
              even if the user changes the role dropdown mid-edit. */}
          {(() => {
            const isStaffIdentityLocked =
              isViewerMiltenyiHR &&
              isEditing &&
              editingUser?.role === "Staff";
            const lockedInputCls = `${INPUT_CLS} ${isStaffIdentityLocked ? "cursor-not-allowed opacity-50" : ""}`;
            return (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="emp-code" className={LABEL_CLS}>
                    Employee Code *
                  </label>
                  <input
                    id="emp-code"
                    className={lockedInputCls}
                    value={form.employee_code}
                    onChange={(e) => set("employee_code", e.target.value)}
                    placeholder="EMP-003"
                    readOnly={isStaffIdentityLocked}
                  />
                </div>
                <div>
                  <label htmlFor="full-name" className={LABEL_CLS}>
                    Full Name *
                  </label>
                  <input
                    id="full-name"
                    className={lockedInputCls}
                    value={form.full_name}
                    onChange={(e) => set("full_name", e.target.value)}
                    placeholder="Jane Smith"
                    readOnly={isStaffIdentityLocked}
                  />
                </div>
              </div>
            );
          })()}

          <div>
            <label htmlFor="email" className={LABEL_CLS}>
              Email Address *
            </label>
            <input
              id="email"
              type="email"
              className={`${INPUT_CLS} ${isEditing ? "cursor-not-allowed opacity-50" : ""}`}
              value={form.email}
              onChange={(e) => set("email", e.target.value)}
              placeholder="jane@miltenyi.com"
              readOnly={isEditing}
            />
            {isEditing && (
              <p className="mt-1 text-xs text-text-muted">
                Email cannot be changed after creation.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="phone" className={LABEL_CLS}>
                Phone
              </label>
              <input
                id="phone"
                className={INPUT_CLS}
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+91 98765 43210"
              />
            </div>
            <div>
              <label htmlFor="role" className={LABEL_CLS}>
                System Role *
              </label>
              <select
                id="role"
                className={INPUT_CLS}
                value={form.role}
                onChange={(e) => {
                  const nextRole = e.target.value;
                  // Only Staff have a mentor — flipping to any other role
                  // clears the previous selection so it can't be saved
                  // against a role that shouldn't carry one.
                  setForm((prev) => ({
                    ...prev,
                    role: nextRole,
                    mentor_id: nextRole === "Staff" ? prev.mentor_id : "",
                  }));
                }}
              >
                {visibleRoleOptions.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="func" className={LABEL_CLS}>
                Function
              </label>
              <select
                id="func"
                className={INPUT_CLS}
                value={form.function_id}
                onChange={(e) => set("function_id", e.target.value)}
              >
                <option value="">— None —</option>
                {functions.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="desig" className={LABEL_CLS}>
                Designation
              </label>
              <select
                id="desig"
                className={INPUT_CLS}
                value={form.designation_id}
                onChange={(e) => set("designation_id", e.target.value)}
              >
                <option value="">— None —</option>
                {designations.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Mentor assignment is hidden from HR_Miltenyi viewers — that
              workflow belongs to HR_MyOrg (Healthark). For HR_Miltenyi
              the form just leaves `mentor_id` untouched, so the existing
              mentor_id on edited rows is preserved through the save. */}
          {!isViewerMiltenyiHR && (
            <UserCombobox
              users={managers}
              value={form.mentor_id ? Number(form.mentor_id) : null}
              onChange={(id) => set("mentor_id", id !== null ? String(id) : "")}
              label="Assigned Mentor"
              placeholder={
                form.role === "Staff"
                  ? "Search by name, email, or role…"
                  : "Only Staff can be assigned a mentor"
              }
              disabled={form.role !== "Staff"}
              excludeIds={editingUser ? [editingUser.id] : undefined}
            />
          )}

          {!isEditing && (
            <div>
              <label htmlFor="password" className={LABEL_CLS}>
                Temporary Password *
              </label>
              <input
                id="password"
                type="password"
                className={INPUT_CLS}
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                placeholder="Min. 8 characters"
              />
              <p className="mt-1 text-xs text-text-muted">
                The user should change this after first login.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-text-muted hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSaving}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            {isSaving ? "Saving…" : isEditing ? "Save Changes" : "Add User"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}