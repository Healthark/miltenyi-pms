import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Info,
  CheckCircle,
  BellDot,
  Megaphone,
  Target,
  ClipboardCheck,
  Briefcase,
  FolderKanban,
  UserCog,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { NotificationItem, UserNotificationItem } from "@/services/notification.service";
import type { SessionClaims } from "@/services/auth.service";
import type { SystemSettingsResponse } from "@/services/system-settings.service";
import {
  buildAnnouncements,
  type AnnouncementRow,
} from "@/components/layout/announcements";

interface NotificationDropdownProps {
  readonly notifications: NotificationItem[];
  readonly userNotifications: UserNotificationItem[];
  /** DOMRect of the bell button — used to position the dropdown below it. */
  readonly anchorRect: DOMRect;
  readonly onClose: () => void;
  readonly onMarkAllRead: () => Promise<void>;
  /** Mark a single direct user-notification as read. Wrapped by the
   *  parent so the call optimistically removes the row from the local
   *  list and the bell badge tick decreases without waiting for the
   *  next `/summary` poll. Receives the notification id. */
  readonly onMarkRead: (id: number) => Promise<void>;
  /** Current authenticated user — needed to compute the per-role
   *  Announcement copy and the cycle-rolled-over message. Null while
   *  auth resolves; the Announcements tab simply renders empty. */
  readonly user: SessionClaims | null;
  /** Current system settings — drives the gate-state announcements.
   *  Null while settings resolve. */
  readonly settings: SystemSettingsResponse | null;
  /** Refresh the session so user.last_seen_cycle updates after the
   *  cycle-rolled-over dismiss button is clicked. */
  readonly onRefreshSession: () => Promise<void>;
}

const SEVERITY_STYLES: Record<
  NotificationItem["severity"],
  { icon: typeof Info; iconClass: string; bgClass: string }
> = {
  info: { icon: Info, iconClass: "text-blue-500", bgClass: "bg-blue-50" },
  warning: {
    icon: AlertTriangle,
    iconClass: "text-amber-500",
    bgClass: "bg-amber-50",
  },
  blocking: {
    icon: AlertTriangle,
    iconClass: "text-red-500",
    bgClass: "bg-red-50",
  },
};

// Per-module icon for direct user notifications.
const MODULE_ICONS: Record<string, LucideIcon> = {
  goal: Target,
  annual_review: ClipboardCheck,
  project_review: Briefcase,
  project: FolderKanban,
  admin: UserCog,
};

// Announcement copy lives in ./announcements.ts so this file exports only
// React components (keeps react-refresh / HMR happy).

// ── Component ─────────────────────────────────────────────────────────

type ActiveTab = "notifications" | "announcements";

export function NotificationDropdown({
  notifications,
  userNotifications,
  anchorRect,
  onClose,
  onMarkAllRead,
  onMarkRead,
  user,
  settings,
  onRefreshSession,
}: NotificationDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

  const announcements = useMemo(
    () => buildAnnouncements(user, settings, onRefreshSession),
    [user, settings, onRefreshSession],
  );

  // Default to the tab with content — if there are announcements but
  // no notifications, open Announcements. Otherwise open Notifications.
  const hasNotifs =
    notifications.length > 0 || userNotifications.length > 0;
  const [tab, setTab] = useState<ActiveTab>(
    hasNotifs ? "notifications" : announcements.length > 0 ? "announcements" : "notifications",
  );

  // Close on click outside
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label="Notifications and announcements"
      className="w-80 rounded-xl border border-border bg-surface shadow-lg overflow-hidden"
      style={{
        position: "fixed",
        top: anchorRect.bottom + 8,
        right: window.innerWidth - anchorRect.right,
        zIndex: 50,
      }}
    >
      {/* Tab bar */}
      <div className="flex border-b border-border bg-slate-50/40">
        <TabButton
          label="Notifications"
          active={tab === "notifications"}
          onClick={() => setTab("notifications")}
          showDot={hasNotifs}
        />
        <TabButton
          label="Announcements"
          active={tab === "announcements"}
          onClick={() => setTab("announcements")}
          showDot={announcements.length > 0}
        />
      </div>

      {/* Action bar — only on Notifications tab, and only when there's
          something to mark read. Keeps the Announcements tab clean. */}
      {tab === "notifications" && userNotifications.some((n) => !n.is_read) && (
        <div className="flex items-center justify-end px-4 py-2 border-b border-border">
          <button
            type="button"
            onClick={onMarkAllRead}
            className="text-[11px] text-brand hover:underline"
          >
            Mark all read
          </button>
        </div>
      )}

      {/* Body */}
      {tab === "notifications" ? (
        <NotificationsBody
          notifications={notifications}
          userNotifications={userNotifications}
          onClose={onClose}
          onMarkRead={onMarkRead}
        />
      ) : (
        <AnnouncementsBody announcements={announcements} />
      )}
    </div>,
    document.body,
  );
}

// ── Sub-components ────────────────────────────────────────────────────

function TabButton({
  label,
  active,
  onClick,
  showDot,
}: {
  readonly label: string;
  readonly active: boolean;
  readonly onClick: () => void;
  readonly showDot: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative flex-1 px-4 py-2.5 text-[12px] font-semibold transition-colors ${
        active
          ? "text-text-main bg-surface"
          : "text-text-muted hover:text-text-main"
      }`}
    >
      {label}
      {showDot && (
        <span
          aria-hidden="true"
          className="absolute top-2 right-3 h-1.5 w-1.5 rounded-full bg-accent"
        />
      )}
      {active && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-2 right-2 h-0.5 bg-brand rounded-full"
        />
      )}
    </button>
  );
}

function NotificationsBody({
  notifications,
  userNotifications,
  onClose,
  onMarkRead,
}: {
  readonly notifications: NotificationItem[];
  readonly userNotifications: UserNotificationItem[];
  readonly onClose: () => void;
  readonly onMarkRead: (id: number) => Promise<void>;
}) {
  if (notifications.length === 0 && userNotifications.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 px-4 text-center">
        <CheckCircle className="h-8 w-8 text-green-400" aria-hidden="true" />
        <p className="text-sm font-medium text-text-main">You're all caught up!</p>
        <p className="text-xs text-text-muted">No pending actions right now.</p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border max-h-80 overflow-y-auto">
      {notifications.map((n) => {
        // Computed alerts (live counts off the goals table). Intentionally
        // not dismissible — they vanish on their own when goal state
        // changes. Rendered as plain rows with no × affordance.
        const { icon: Icon, iconClass, bgClass } = SEVERITY_STYLES[n.severity];
        return (
          <li
            key={n.type}
            className={`flex items-start gap-3 px-4 py-3 ${bgClass}`}
          >
            <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${iconClass}`} aria-hidden="true" />
            <p className="text-sm text-text-main">{n.message}</p>
          </li>
        );
      })}
      {userNotifications.map((n) => {
        // Direct user notifications (rows from the notifications table).
        // Two affordances per row:
        //   1. Click the message itself → mark-read + navigate + close
        //   2. Click the × button on the right → mark-read only, stay open
        //
        // The × is rendered as a sibling of the <a>, NOT inside it, so
        // clicking it doesn't fall through to the navigation link. We
        // still stopPropagation on the × handler to belt-and-braces guard
        // against any future wrapping change.
        const Icon = (n.module && MODULE_ICONS[n.module]) || BellDot;
        const handleNavigate = () => {
          void onMarkRead(n.id);
          onClose();
        };
        const handleDismiss = (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          void onMarkRead(n.id);
        };
        const messageContent = (
          <>
            <Icon
              className="h-4 w-4 mt-0.5 shrink-0 text-blue-500"
              aria-hidden="true"
            />
            <p className="text-sm text-text-main">{n.message}</p>
          </>
        );
        return (
          <li
            key={n.id}
            className="flex items-start gap-2 px-4 py-3 bg-blue-50 hover:bg-blue-100/60 transition-colors"
          >
            {n.entity_url ? (
              <a
                href={n.entity_url}
                onClick={handleNavigate}
                className="flex-1 flex items-start gap-3 min-w-0 no-underline"
              >
                {messageContent}
              </a>
            ) : (
              <div className="flex-1 flex items-start gap-3 min-w-0">
                {messageContent}
              </div>
            )}
            <button
              type="button"
              onClick={handleDismiss}
              aria-label="Dismiss notification"
              title="Mark as read"
              className="rounded-md p-1 text-text-muted hover:bg-slate-200 hover:text-text-main shrink-0 self-start"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function AnnouncementsBody({
  announcements,
}: {
  readonly announcements: AnnouncementRow[];
}) {
  if (announcements.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-8 px-4 text-center">
        <Megaphone className="h-8 w-8 text-text-muted" aria-hidden="true" />
        <p className="text-sm font-medium text-text-main">
          No announcements right now.
        </p>
        <p className="text-xs text-text-muted">
          Everything is running at default settings.
        </p>
      </div>
    );
  }
  return (
    <ul className="divide-y divide-border max-h-80 overflow-y-auto">
      {announcements.map((a) => (
        <li key={a.key} className="flex items-start gap-3 px-4 py-3 bg-amber-50/40">
          <AlertTriangle
            className="h-4 w-4 mt-0.5 shrink-0 text-amber-600"
            aria-hidden="true"
          />
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-text-main">{a.title}</p>
            <p className="mt-0.5 text-[12px] text-text-muted">{a.body}</p>
          </div>
          {a.onDismiss && (
            <button
              type="button"
              onClick={() => void a.onDismiss?.()}
              className="rounded-md p-1 text-amber-700 hover:bg-amber-100 shrink-0"
              aria-label="Dismiss"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
