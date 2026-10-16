/**
 * Saving a user whose function or level change would remove their personal
 * Project Goals framework (16 Oct 2026). The API refuses the first save with
 * a 409 whose detail code is "personal_framework" and whose message says
 * what will happen; we show that in the confirm dialog and, on "Change and
 * remove", save again with the confirmation. Used by the Users tab and the
 * Framework Mapping dialog. Resolves to null when the Admin cancels.
 */
import type { useConfirm } from "@/hooks/useConfirm";
import { adminService, type UserResponse, type UserUpdatePayload } from "@/services/admin.service";
import { getErrorCode, getErrorMessage } from "@/utils/errors";

export async function updateUserConfirmingPersonalFramework(
  confirm: ReturnType<typeof useConfirm>,
  userId: number,
  payload: UserUpdatePayload,
): Promise<UserResponse | null> {
  try {
    return await adminService.updateUser(userId, payload);
  } catch (err) {
    if (getErrorCode(err) !== "personal_framework") throw err;
    const ok = await confirm({
      title: "Remove the personal framework?",
      message: getErrorMessage(err),
      variant: "warning",
      confirmText: "Change and remove",
    });
    if (!ok) return null;
    return adminService.updateUser(userId, payload, { dropPersonalFramework: true });
  }
}
