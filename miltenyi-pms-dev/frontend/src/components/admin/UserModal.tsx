import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  adminService,
  type UserResponse,
  type UserCreatePayload,
  type UserUpdatePayload,
  type FunctionBrief,
  type DesignationBrief,
} from "@/services/admin.service";
import { UserCombobox } from "@/components/common/UserCombobox";
import { IdCombobox } from "@/components/common/IdCombobox";
import { useAuth } from "@/hooks/useAuth";
import {
  normalizeFullName,
  isValidNameChars,
  isValidEmailForRole,
  emailDomainHintForRole,
} from "@/utils/text";

// Role choices in the dropdown — must match the backend Role enum exactly.
// Labels are display-only; the value is what gets persisted.
const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: "Employee", label: "Employee" },
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
          // Map any legacy/unknown role value back to Employee so the dropdown
          // doesn't render a value that isn't in ROLE_OPTIONS.
          role: ALL_ROLE_VALUES.includes(editingUser.role) ? editingUser.role : "Employee",
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
          role: "Employee",
          function_id: "",
          designation_id: "",
          mentor_id: "",
          password: "",
        },
  );

  // Tracks the in-flight preview request so a stale response from an
  // earlier role can't clobber the field after the HR has moved on.
  // Toggle to "loading" while the request is in flight so the input
  // shows a placeholder instead of stale text.
  const [codeLoading, setCodeLoading] = useState(false);

  // Auto-generate the employee code as the HR picks a role. Create
  // mode only — edit mode keeps the existing code (immutable identity
  // stamp; see backend `_compute_next_employee_code` for the
  // convention). Backend re-derives at POST time so this preview is
  // never authoritative; HR sees the actual saved code via the
  // mutation response if a race causes a drift.
  useEffect(() => {
    if (isEditing || !isOpen || !form.role) return;
    let cancelled = false;
    setCodeLoading(true);
    adminService
      .getNextEmployeeCode(form.role)
      .then((code) => {
        if (cancelled) return;
        setForm((prev) => ({ ...prev, employee_code: code }));
      })
      .catch(() => {
        // Network / 403 — fall back to blank, let user retry by
        // re-selecting the role. Backend will still derive at create
        // time so save isn't blocked.
        if (cancelled) return;
        setForm((prev) => ({ ...prev, employee_code: "" }));
      })
      .finally(() => {
        if (!cancelled) setCodeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [form.role, isEditing, isOpen]);

  if (!isOpen) return null;

  const set = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // Validity flags mirror the backend rules in admin_routes.py:
  // _validate_name_chars + _validate_email_for_role. Computed every
  // render so the inline error rows + the Save button's disabled
  // state stay in sync with what the user has typed.
  //
  // Name: empty is treated as "not yet entered" — we show no error
  // until they type something, but Save stays disabled (required *
  // already signals it). When chars are bad we surface the message.
  // Email: only validated on the create path, since the field is
  // read-only when editing — but role changes during edit DO need
  // the existing stored email to match the new role, which the
  // backend re-checks. The UI surfaces a hint inline so HR doesn't
  // get a surprise 400 when flipping a role across domains.
  const nameTrimmed = form.full_name.trim();
  const nameHasChars = nameTrimmed.length > 0;
  const nameCharsValid = nameHasChars ? isValidNameChars(nameTrimmed) : true;
  const showNameError = nameHasChars && !nameCharsValid;

  const emailToCheck = isEditing ? editingUser!.email : form.email;
  const emailDomainValid =
    emailToCheck.length === 0
      ? true
      : isValidEmailForRole(emailToCheck, form.role);
  const showEmailError = emailToCheck.length > 0 && !emailDomainValid;
  const emailHint = emailDomainHintForRole(form.role);

  // Snap the displayed name to canonical title-case once the user
  // tabs away — matches the backend's normalization so what they see
  // is what gets persisted. Skip when chars are invalid so we don't
  // mangle an in-flight typo (the inline error already nudges them
  // to fix it before blur-normalize would help).
  const handleFullNameBlur = () => {
    if (!nameHasChars || !nameCharsValid) return;
    const canonical = normalizeFullName(form.full_name);
    if (canonical !== form.full_name) {
      set("full_name", canonical);
    }
  };

  const canSave =
    nameHasChars && nameCharsValid && emailDomainValid && !isSaving;

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

          {/* For HR_Miltenyi editing an existing row, only Function and
              Designation are editable; every other field is locked.
              Healthark HR owns the identity columns (employee_code,
              full_name), the system role, the phone number, and the
              mentor assignment. The lock applies regardless of the
              target's role since HR_Miltenyi has the same authority
              over any row they're allowed to touch (Employee / PM /
              HR_Miltenyi — Mentor and HR_MyOrg rows are blocked
              entirely upstream). Mirrors the backend 403 guard in
              admin_routes.update_user. Add-user flow stays
              unrestricted: HR_Miltenyi can still provision new users
              with full field access. */}
          {(() => {
            const isMiltenyiLocked = isViewerMiltenyiHR && isEditing;
            const lockedInputCls = `${INPUT_CLS} ${isMiltenyiLocked ? "cursor-not-allowed opacity-50" : ""}`;
            // In create mode the employee code is auto-generated from
            // the role (server-derived; preview comes from
            // GET /admin/users/next-employee-code). The input is
            // always read-only in create mode — HR shouldn't be able
            // to type a custom code. In edit mode the existing rule
            // applies: Healthark HR can edit, Miltenyi HR cannot.
            const isCodeReadOnly = !isEditing || isMiltenyiLocked;
            const codePlaceholder = !isEditing
              ? codeLoading
                ? "Generating…"
                : form.role
                  ? ""
                  : "Pick a role to generate code"
              : "EMP-003";
            const codeInputCls = `${INPUT_CLS} ${
              !isEditing || isMiltenyiLocked
                ? "cursor-not-allowed opacity-70 bg-slate-50 dark:bg-slate-800/40"
                : ""
            }`;
            return (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="emp-code" className={LABEL_CLS}>
                    Employee Code *
                  </label>
                  <input
                    id="emp-code"
                    className={codeInputCls}
                    value={form.employee_code}
                    onChange={(e) => set("employee_code", e.target.value)}
                    placeholder={codePlaceholder}
                    readOnly={isCodeReadOnly}
                    aria-readonly={isCodeReadOnly}
                    title={
                      !isEditing
                        ? "Auto-generated from the selected role"
                        : undefined
                    }
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
                    onBlur={handleFullNameBlur}
                    placeholder="Jane Smith"
                    readOnly={isMiltenyiLocked}
                  />
                  {showNameError && (
                    <p className="mt-1 text-xs text-red-600">
                      Name can only contain letters, spaces, and full stops.
                    </p>
                  )}
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
            {showEmailError && emailHint && (
              <p className="mt-1 text-xs text-red-600">{emailHint}</p>
            )}
            {!showEmailError && !isEditing && emailHint && (
              <p className="mt-1 text-xs text-text-muted">{emailHint}</p>
            )}
          </div>

          {/* Phone and System Role share the same HR_Miltenyi edit lock
              as the identity fields above. `disabled` on the <select>
              produces the right native styling and blocks both keyboard
              and click input; we mirror the read-only opacity treatment
              from the text inputs for visual consistency. */}
          {(() => {
            const isMiltenyiLocked = isViewerMiltenyiHR && isEditing;
            const lockedInputCls = `${INPUT_CLS} ${isMiltenyiLocked ? "cursor-not-allowed opacity-50" : ""}`;
            return (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label htmlFor="phone" className={LABEL_CLS}>
                    Phone
                  </label>
                  <input
                    id="phone"
                    className={lockedInputCls}
                    value={form.phone}
                    onChange={(e) => set("phone", e.target.value)}
                    placeholder="+91 98765 43210"
                    readOnly={isMiltenyiLocked}
                  />
                </div>
                <div>
                  <label htmlFor="role" className={LABEL_CLS}>
                    System Role *
                  </label>
                  <select
                    id="role"
                    className={lockedInputCls}
                    value={form.role}
                    onChange={(e) => {
                      const nextRole = e.target.value;
                      // Only Employees have a mentor — flipping to any other role
                      // clears the previous selection so it can't be saved
                      // against a role that shouldn't carry one.
                      setForm((prev) => ({
                        ...prev,
                        role: nextRole,
                        mentor_id: nextRole === "Employee" ? prev.mentor_id : "",
                      }));
                    }}
                    disabled={isMiltenyiLocked}
                  >
                    {visibleRoleOptions.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            );
          })()}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="func" className={LABEL_CLS}>
                Function
              </label>
              {/* Searchable picker — 8 GCC functions today; type-to-filter
                  scales gracefully if HR_MyOrg ever adds more. */}
              <IdCombobox
                id="func"
                options={functions}
                value={form.function_id ? Number(form.function_id) : null}
                onChange={(next) =>
                  set("function_id", next == null ? "" : String(next))
                }
                placeholder="Search functions…"
              />
            </div>
            <div>
              <label htmlFor="desig" className={LABEL_CLS}>
                Designation
              </label>
              {/* Searchable picker — ~35 GCC designations across the
                  4 career levels; the native <select> is unusable
                  without type-to-filter at this size. */}
              <IdCombobox
                id="desig"
                options={designations}
                value={form.designation_id ? Number(form.designation_id) : null}
                onChange={(next) =>
                  set("designation_id", next == null ? "" : String(next))
                }
                placeholder="Search designations…"
              />
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
                form.role === "Employee"
                  ? "Search by name, email, or role…"
                  : "Only Employees can be assigned a mentor"
              }
              disabled={form.role !== "Employee"}
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
            disabled={!canSave}
            className="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
          >
            {isSaving ? "Saving…" : isEditing ? "Save Changes" : "Add User"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}