import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import type {
  UserResponse,
  UserCreatePayload,
  UserUpdatePayload,
  DepartmentBrief,
  DesignationBrief,
} from "../../services/admin.service";
import { UserCombobox } from "../common/UserCombobox";

// UPDATE 1: Restrict available roles to only Admin and Staff
const ROLES = ["Admin", "Staff"] as const;

interface UserModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSave: (
    payload: UserCreatePayload | UserUpdatePayload,
  ) => Promise<void>;
  readonly editingUser: UserResponse | null;
  readonly departments: DepartmentBrief[];
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
  departments,
  designations,
  managers,
  isSaving,
  error,
}: UserModalProps) {
  const isEditing = editingUser !== null;

  const [form, setForm] = useState({
    employee_code: "",
    full_name: "",
    email: "",
    phone: "",
    role: "Staff",
    department_id: "",
    designation_id: "",
    mentor_id: "",
    password: "",
  });

  useEffect(() => {
    if (editingUser) {
      setForm({
        employee_code: editingUser.employee_code,
        full_name: editingUser.full_name,
        email: editingUser.email,
        phone: editingUser.phone ?? "",
        // Ensure legacy roles default back to Staff when editing
        role: ["Admin", "Staff"].includes(editingUser.role) ? editingUser.role : "Staff",
        department_id: editingUser.department_id?.toString() ?? "",
        designation_id: editingUser.designation_id?.toString() ?? "",
        mentor_id: editingUser.mentor_id?.toString() ?? "",
        password: "",
      });
    } else {
      setForm({
        employee_code: "",
        full_name: "",
        email: "",
        phone: "",
        role: "Staff",
        department_id: "",
        designation_id: "",
        mentor_id: "",
        password: "",
      });
    }
  }, [editingUser]);

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
        department_id: form.department_id ? Number(form.department_id) : null,
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
        department_id: form.department_id ? Number(form.department_id) : null,
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

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="emp-code" className={LABEL_CLS}>
                Employee Code *
              </label>
              <input
                id="emp-code"
                className={INPUT_CLS}
                value={form.employee_code}
                onChange={(e) => set("employee_code", e.target.value)}
                placeholder="EMP-003"
              />
            </div>
            <div>
              <label htmlFor="full-name" className={LABEL_CLS}>
                Full Name *
              </label>
              <input
                id="full-name"
                className={INPUT_CLS}
                value={form.full_name}
                onChange={(e) => set("full_name", e.target.value)}
                placeholder="Jane Smith"
              />
            </div>
          </div>

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
              placeholder="jane@healthark.com"
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
                onChange={(e) => set("role", e.target.value)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="dept" className={LABEL_CLS}>
                Department
              </label>
              <select
                id="dept"
                className={INPUT_CLS}
                value={form.department_id}
                onChange={(e) => set("department_id", e.target.value)}
              >
                <option value="">— None —</option>
                {departments.map((d) => (
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

          <UserCombobox
            users={managers}
            value={form.mentor_id ? Number(form.mentor_id) : null}
            onChange={(id) => set("mentor_id", id !== null ? String(id) : "")}
            label="Assigned Mentor / Line Manager"
            placeholder="Search by name, email, or role…"
            excludeIds={editingUser ? [editingUser.id] : undefined}
          />

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