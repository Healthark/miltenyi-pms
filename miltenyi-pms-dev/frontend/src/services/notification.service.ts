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
};
