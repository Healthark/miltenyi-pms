import { useState, useEffect, useRef, useCallback } from "react";
import { Bell, CalendarDays, Moon, Sun } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { useTheme } from "@/hooks/useTheme";
import { queryKeys } from "@/lib/queryKeys";
import { projectGoalsService, quarterDisplay } from "@/services/project-goals.service";
import {
  notificationService,
  type TopbarSummary,
} from "@/services/notification.service";
import { NotificationDropdown } from "@/components/layout/NotificationDropdown";
import { hasActiveAnnouncements } from "@/components/layout/announcements";

export function Topbar() {
  const { user, refreshSession, hasFeature } = useAuth();
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
    // Optimistically empty the list — the next /summary fetch would
    // already return [] since the backend now filters out is_read=True
    // rows, so we just match that contract immediately for instant
    // feedback. Bell badge ticks down with it.
    setSummary((prev) =>
      prev ? { ...prev, user_notifications: [] } : prev,
    );
  }, []);

  const handleMarkRead = useCallback(async (id: number) => {
    // Optimistic remove FIRST so the row disappears with no flicker,
    // then fire the server call. If the call fails the row would need
    // to be re-added — but the only realistic failure is a 404 (row
    // already gone), which is fine to ignore since the optimistic
    // result matches the resolved state anyway.
    setSummary((prev) =>
      prev
        ? {
            ...prev,
            user_notifications: prev.user_notifications.filter(
              (n) => n.id !== id,
            ),
          }
        : prev,
    );
    try {
      await notificationService.markRead(id);
    } catch {
      // Idempotent endpoint — a failure here doesn't justify revert
      // because the row is most likely just already-read or
      // already-gone. Leaving the optimistic remove in place keeps
      // the bell aligned with the user's intent.
    }
  }, []);

  // Every row in `user_notifications` is unread by contract — the
  // backend's /summary endpoint filters out is_read=True rows server-
  // side. So a plain .length is the unread count.
  const unreadUserCount = summary?.user_notifications.length ?? 0;
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
      {/* Left — cycle badges */}
      <CycleBadges
        settingsLoading={settingsLoading}
        activeCycleName={settings?.active_cycle_name ?? null}
        showProjectCycle={hasFeature("project_reviews")}
        showProjectGoals={hasFeature("project_goals")}
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
              ? `Notifications (${
                  (summary?.notifications.length ?? 0) + unreadUserCount
                } new)`
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
          onMarkRead={handleMarkRead}
          user={user}
          settings={settings ?? null}
          onRefreshSession={refreshSession}
        />
      )}
    </header>
  );
}

// ── Cycle Badges ─────────────────────────────────────────────────────

/**
 * Cycle badges.
 *
 * Orgs running Project Goals (the Miltenyi instance) see the goal year and
 * the current review quarter — both come from the Project Goals period the
 * Admin rolls out in System Settings ("CY 2026", "Q3 · current quarter").
 *
 * Other orgs keep the fiscal-year pill scraped out of
 * `SystemSettings.active_cycle_name` ("H1 FY26-27" → "FY26-27"), plus the
 * project review cycle pill when that feature is on.
 */
const FY_LABEL_PATTERN = /FY\d{2}-\d{2}/;

function extractFyLabel(cycleName: string | null): string | null {
  if (!cycleName) return null;
  const match = cycleName.match(FY_LABEL_PATTERN);
  return match ? match[0] : null;
}

const PILL_AMBER =
  "hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-amber-50 px-2.5 py-0.5 text-xs font-medium text-amber-800";
const PILL_BRAND =
  "hidden sm:inline-flex items-center gap-1.5 rounded-full border border-border bg-brand-light px-2.5 py-0.5 text-xs font-medium text-brand-accent";
const PILL_MUTED =
  "hidden sm:inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-gray-50 px-2.5 py-0.5 text-xs text-text-muted";

function CycleBadges({
  settingsLoading,
  activeCycleName,
  showProjectCycle,
  showProjectGoals,
}: {
  readonly settingsLoading: boolean;
  readonly activeCycleName: string | null;
  /** Retired project reviews: their cycle pill only when the feature is on. */
  readonly showProjectCycle: boolean;
  /** Project Goals orgs: goal year + current quarter replace the FY pill. */
  readonly showProjectGoals: boolean;
}) {
  const periodQ = useQuery({
    queryKey: queryKeys.projectGoals.period(),
    queryFn: () => projectGoalsService.getPeriod(),
    enabled: showProjectGoals,
    staleTime: 60_000,
  });

  if (settingsLoading || (showProjectGoals && periodQ.isPending)) {
    return (
      <div className="flex items-center gap-2">
        <span className={`${PILL_MUTED} animate-pulse`}>Loading...</span>
      </div>
    );
  }

  if (showProjectGoals) {
    const period = periodQ.data ?? null;
    const currentQuarter = period?.current_quarter_label ?? null;
    return (
      <div className="flex items-center gap-2">
        {period ? (
          <span className={PILL_AMBER} title="Project Goals year — goals are set once for this year">
            <CalendarDays className="h-3 w-3 text-amber-700" aria-hidden="true" />
            {period.period_label}
          </span>
        ) : (
          <span className={PILL_MUTED} title="No Project Goals period is active yet">
            <CalendarDays className="h-3 w-3" aria-hidden="true" />
            No goal year set
          </span>
        )}
        {period && (
          currentQuarter ? (
            <span className={PILL_BRAND} title="Current review quarter — rolled out by the Admin in System Settings">
              <CalendarDays className="h-3 w-3 text-accent" aria-hidden="true" />
              {quarterDisplay(currentQuarter).split(" · ")[0]} · current quarter
            </span>
          ) : (
            <span className={PILL_MUTED} title="The Admin has not rolled out the first quarter yet">
              <CalendarDays className="h-3 w-3" aria-hidden="true" />
              No quarter rolled out
            </span>
          )
        )}
      </div>
    );
  }

  const fyLabel = extractFyLabel(activeCycleName);
  return (
    <div className="flex items-center gap-2">
      {fyLabel && (
        <span className={PILL_AMBER} title="Current financial year">
          <CalendarDays className="h-3 w-3 text-amber-700" aria-hidden="true" />
          {fyLabel}
        </span>
      )}
      {showProjectCycle && activeCycleName && (
        <span className={PILL_BRAND} title="Project review cycle">
          <CalendarDays className="h-3 w-3 text-accent" aria-hidden="true" />
          Project · {activeCycleName}
        </span>
      )}
    </div>
  );
}
