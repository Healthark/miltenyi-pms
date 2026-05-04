import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, CalendarDays } from "lucide-react";
import { useAuth } from "../hooks/useAuth";
import { useSystemSettings } from "../hooks/useSystemSettings";
import {
  notificationService,
  type TopbarSummary,
} from "../services/notification.service";
import { NotificationDropdown } from "../components/layout/NotificationDropdown";

export function Topbar() {
  const { user } = useAuth();

  // ── Active Cycle — from the dedicated SystemSettings context ──────
  // This is the single source of truth for the cycle badge. When an Admin
  // updates the cycle in the Settings page, refreshSettings() fires and
  // the Topbar updates instantly without a full page reload.
  const { settings, isLoading: settingsLoading } = useSystemSettings();

  // ── Notifications — from the lightweight summary endpoint ─────────
  const [summary, setSummary] = useState<TopbarSummary | null>(null);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);
  const bellRef = useRef<HTMLButtonElement>(null);

  // Fetch notification summary once on mount — single round-trip
  useEffect(() => {
    notificationService
      .getSummary()
      .then(setSummary)
      .catch(() => {
        // Silently fail — Topbar stays functional without notification data
      });
  }, []);

  const handleBellClick = useCallback(() => {
    if (anchorRect) {
      setAnchorRect(null);
      return;
    }
    if (bellRef.current) {
      setAnchorRect(bellRef.current.getBoundingClientRect());
    }
  }, [anchorRect]);

  const handleClose = useCallback(() => setAnchorRect(null), []);

  const handleMarkAllRead = useCallback(async () => {
    await notificationService.markAllRead();
    // Optimistically clear unread badge; update local state
    setSummary((prev) =>
      prev
        ? {
            ...prev,
            user_notifications: prev.user_notifications.map((n) => ({
              ...n,
              is_read: true,
            })),
          }
        : prev,
    );
  }, []);

  const unreadUserCount =
    summary?.user_notifications.filter((n) => !n.is_read).length ?? 0;
  const hasNotifications =
    (summary?.notifications.length ?? 0) > 0 || unreadUserCount > 0;

  const initials = user?.full_name
    ? user.full_name
        .split(" ")
        .map((n) => n[0])
        .slice(0, 2)
        .join("")
        .toUpperCase()
    : "?";

  return (
    <header className="h-16 bg-surface border-b border-border flex items-center justify-between px-8 shrink-0">
      {/* Left — active cycle badge */}
      <div className="flex items-center gap-3">
        {/* Active Cycle Badge — driven by SystemSettings context */}
        {settingsLoading ? (
          <span className="hidden sm:inline-flex items-center rounded-full border border-border bg-gray-50 px-2.5 py-0.5 text-xs text-text-muted animate-pulse">
            Loading...
          </span>
        ) : settings?.active_cycle_name ? (
          <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-brand-light px-2.5 py-0.5 text-xs font-medium text-brand">
            <CalendarDays className="h-3 w-3 text-accent" aria-hidden="true" />
            {settings.active_cycle_name}
          </span>
        ) : null}
      </div>

      {/* Right — bell + avatar */}
      <div className="flex items-center gap-4">
        <button
          ref={bellRef}
          type="button"
          onClick={handleBellClick}
          className="relative p-2 text-text-muted hover:text-brand transition-colors rounded-full hover:bg-slate-50"
          aria-label={
            hasNotifications
              ? `Notifications (${summary?.notifications.length} new)`
              : "Notifications"
          }
          aria-expanded={anchorRect !== null}
          aria-haspopup="dialog"
        >
          <Bell className="w-5 h-5" />
          {/* Red dot — only shown when there are real notifications */}
          {hasNotifications && (
            <span className="absolute top-1.5 right-2 w-2 h-2 bg-accent rounded-full border-2 border-surface" aria-hidden="true" />
          )}
        </button>

        <div
          className="h-8 w-8 rounded-full bg-brand text-white flex items-center justify-center font-semibold text-sm"
          aria-label={user?.full_name ?? "User avatar"}
          title={user?.full_name ?? ""}
        >
          {initials}
        </div>
      </div>

      {/* Notification dropdown — Portal so it escapes the header's layout */}
      {anchorRect && summary && (
        <NotificationDropdown
          notifications={summary.notifications}
          userNotifications={summary.user_notifications}
          anchorRect={anchorRect}
          onClose={handleClose}
          onMarkAllRead={handleMarkAllRead}
        />
      )}
    </header>
  );
}
