import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Info, CheckCircle, BellDot } from "lucide-react";
import type { NotificationItem, UserNotificationItem } from "../../services/notification.service";

interface NotificationDropdownProps {
  readonly notifications: NotificationItem[];
  readonly userNotifications: UserNotificationItem[];
  /** DOMRect of the bell button — used to position the dropdown below it. */
  readonly anchorRect: DOMRect;
  readonly onClose: () => void;
  readonly onMarkAllRead: () => Promise<void>;
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

export function NotificationDropdown({
  notifications,
  userNotifications,
  anchorRect,
  onClose,
  onMarkAllRead,
}: NotificationDropdownProps) {
  const ref = useRef<HTMLDivElement>(null);

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
      aria-label="Notifications"
      className="w-80 rounded-xl border border-border bg-surface shadow-lg overflow-hidden"
      style={{
        position: "fixed",
        top: anchorRect.bottom + 8,
        right: window.innerWidth - anchorRect.right,
        zIndex: 50,
      }}
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <p className="font-display text-sm font-semibold text-text-main">
          Notifications
        </p>
        {userNotifications.some((n) => !n.is_read) && (
          <button
            type="button"
            onClick={onMarkAllRead}
            className="text-[11px] text-brand hover:underline"
          >
            Mark all read
          </button>
        )}
      </div>

      {notifications.length === 0 && userNotifications.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 px-4 text-center">
          <CheckCircle className="h-8 w-8 text-green-400" aria-hidden="true" />
          <p className="text-sm font-medium text-text-main">
            You're all caught up!
          </p>
          <p className="text-xs text-text-muted">
            No pending actions right now.
          </p>
        </div>
      ) : (
        <ul className="divide-y divide-border max-h-80 overflow-y-auto">
          {/* System-computed notifications */}
          {notifications.map((n) => {
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
          {/* Direct user notifications from mentor Notify button */}
          {userNotifications.map((n) => (
            <li
              key={n.id}
              className={`flex items-start gap-3 px-4 py-3 ${n.is_read ? "bg-white" : "bg-blue-50"}`}
            >
              <BellDot
                className={`h-4 w-4 mt-0.5 shrink-0 ${n.is_read ? "text-text-muted" : "text-blue-500"}`}
                aria-hidden="true"
              />
              <p className="text-sm text-text-main">{n.message}</p>
            </li>
          ))}
        </ul>
      )}
    </div>,
    document.body,
  );
}
