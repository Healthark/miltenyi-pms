import apiClient from "@/services/api.client";

export interface NotificationItem {
  type: string;
  message: string;
  count: number;
  severity: "info" | "warning" | "blocking";
}

export interface UserNotificationItem {
  id: number;
  message: string;
  module?: string | null;
  entity_type?: string | null;
  entity_id?: number | null;
  entity_url?: string | null;
  created_at: string;
  is_read: boolean;
}

export interface TopbarSummary {
  active_cycle: string | null;
  notifications: NotificationItem[];
  user_notifications: UserNotificationItem[];
}

export const notificationService = {
  getSummary: async (): Promise<TopbarSummary> => {
    const res = await apiClient.get<TopbarSummary>("/notifications/summary");
    return res.data;
  },

  markAllRead: async (): Promise<void> => {
    await apiClient.post("/notifications/mark-all-read", {});
  },

  /** Mark one specific notification as read. Idempotent on the backend
   *  (already-read rows just return 204 without touching the DB). The
   *  bell's next /summary fetch will exclude this row since reads are
   *  filtered server-side now. */
  markRead: async (id: number): Promise<void> => {
    await apiClient.post(`/notifications/${id}/mark-read`, {});
  },
};
