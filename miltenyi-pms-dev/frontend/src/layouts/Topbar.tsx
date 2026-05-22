import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, CalendarDays, Moon, Sun } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { useTheme } from "@/hooks/useTheme";
import {
  notificationService,
  type TopbarSummary,
} from "@/services/notification.service";
import { NotificationDropdown } from "@/components/layout/NotificationDropdown";
import { hasActiveAnnouncements } from "@/components/layout/announcements";

export function Topbar() {
  const { user, refreshSession } = useAuth();
  const { isDark, toggleTheme } = useTheme();

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
  // Bell dot now reflects three sources: system-computed notifications,
  // unread user notifications, AND active announcements (org-wide gate
  // flags + cycle-rolled-over message). Announcements behave as a
  // live status indicator — the dot stays lit until the underlying
  // flag is re-enabled / the cycle banner is dismissed.
  const announcementsActive = hasActiveAnnouncements(user, settings ?? null);
  const hasNotifications =
    (summary?.notifications.length ?? 0) > 0 ||
    unreadUserCount > 0 ||
    announcementsActive;

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
      {/* Left — project cycle badge */}
      <CycleBadges
        settingsLoading={settingsLoading}
        activeCycleName={settings?.active_cycle_name ?? null}
      />

      {/* Right — theme toggle + bell + avatar */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={toggleTheme}
          className="p-2 text-text-main hover:text-brand-accent transition-colors rounded-full hover:bg-brand-light"
          aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          title={isDark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {isDark ? (
            <Sun className="w-5 h-5 text-amber-400" aria-hidden="true" />
          ) : (
            <Moon className="w-5 h-5" aria-hidden="true" />
          )}
        </button>

        <button
          ref={bellRef}
          type="button"
          onClick={handleBellClick}
          className="relative p-2 text-text-muted hover:text-brand-accent transition-colors rounded-full hover:bg-brand-light"
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

      {/* Notification dropdown — Portal so it escapes the header's
          layout. We render even when `summary` hasn't loaded yet so
          the Announcements tab is still reachable — notifications
          fall back to empty arrays in that case. */}
      {anchorRect && (
        <NotificationDropdown
          notifications={summary?.notifications ?? []}
          userNotifications={summary?.user_notifications ?? []}
          anchorRect={anchorRect}
          onClose={handleClose}
          onMarkAllRead={handleMarkAllRead}
          user={user}
          settings={settings ?? null}
          onRefreshSession={refreshSession}
        />
      )}
    </header>
  );
}

// ── Cycle Badge ─────────────────────────────────────────────────────

/**
 * Cycle badges — single source of truth is
 * `SystemSettings.active_cycle_name` (set by HR).
 *
 * Two pills:
 *   1. Project review cycle ("Project · Q2 FY26-27") — the raw cycle.
 *   2. Financial year ("FY26-27") — derived by scraping the FYxx-yy
 *      substring out of the cycle name. We keep the parsing local
 *      because every active cycle string carries the FY in this format
 *      ("Q2 FY26-27", "H1 FY26-27", or just "FY26-27" for annual-only
 *      orgs), so no extra fetch or context wiring is needed.
 */
const FY_LABEL_PATTERN = /FY\d{2}-\d{2}/;

function extractFyLabel(cycleName: string | null): string | null {
  if (!cycleName) return null;
  const match = cycleName.match(FY_LABEL_PATTERN);
  return match ? match[0] : null;
}

function CycleBadges({
  settingsLoading,
  activeCycleName,
}: {
  readonly settingsLoading: boolean;
  readonly activeCycleName: string | null;
}) {
  if (settingsLoading) {
    return (
      <div className="flex items-center gap-2">
        <span className="hidden sm:inline-flex items-center rounded-full border border-border bg-gray-50 px-2.5 py-0.5 text-xs text-text-muted animate-pulse">
          Loading...
        </span>
      </div>
    );
  }

  const fyLabel = extractFyLabel(activeCycleName);

  return (
    <div className="flex items-center gap-2">
      {fyLabel && (
        <span
          className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800"
          title="Current financial year"
        >
          <CalendarDays className="h-3 w-3 text-amber-700" aria-hidden="true" />
          {fyLabel}
        </span>
      )}
      {activeCycleName && (
        <span
          className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-brand-light px-2.5 py-0.5 text-xs font-medium text-brand-accent"
          title="Project review cycle"
        >
          <CalendarDays className="h-3 w-3 text-accent" aria-hidden="true" />
          Project · {activeCycleName}
        </span>
      )}
    </div>
  );
}
