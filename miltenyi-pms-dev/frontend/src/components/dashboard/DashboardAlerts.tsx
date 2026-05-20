/**
 * DashboardAlerts — stack of state-derived banners shown at the top of
 * every role's dashboard.
 *
 * Two flavours:
 *   1. Gate banners — derived from current system settings. Always-on
 *      while the condition holds; vanish when HR re-opens the gate.
 *      Each banner's audience and copy is role-specific.
 *   2. Cycle-rolled-over banner — driven by `user.last_seen_cycle`
 *      diverging from `settings.active_cycle_name`. Dismissible per
 *      user; click X stamps the user's `last_seen_cycle` so the banner
 *      disappears across sessions.
 *
 * No banner uses raw alert components; everything is themable so it
 * reads cleanly in both light and dark mode.
 */

import { useCallback, useState } from "react";
import { AlertTriangle, Info, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useSystemSettings } from "@/hooks/useSystemSettings";
import { authService } from "@/services/auth.service";

/**
 * Per-session dismiss storage. Gate banners stay hidden for the rest of
 * this browser session once dismissed; the next logout (or browser
 * close) clears the dismissals so the banner re-appears at next login.
 *
 * The cycle banner is NOT routed through this — it dismisses via the
 * backend (`users.last_seen_cycle`) for cross-session persistence.
 *
 * `AuthProvider.logout()` clears keys prefixed with DISMISS_PREFIX so
 * the user genuinely starts fresh after signing out.
 */
const DISMISS_PREFIX = "dashboard_alert_dismissed_";

export function clearDismissedDashboardBanners(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(DISMISS_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => sessionStorage.removeItem(k));
  } catch {
    /* sessionStorage unavailable — nothing to clear */
  }
}

function readInitialDismissed(): Set<string> {
  const keys = new Set<string>();
  try {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i);
      if (k?.startsWith(DISMISS_PREFIX)) {
        keys.add(k.slice(DISMISS_PREFIX.length));
      }
    }
  } catch {
    /* ignore */
  }
  return keys;
}

interface GateBannerCopy {
  /** Per-role text. `null` means this role doesn't see this banner. */
  readonly Employee?: string;
  readonly Mentor?: string;
  readonly PM?: string;
  readonly HR_MyOrg?: string;
  readonly HR_Miltenyi?: string;
}

interface GateBanner {
  readonly key: string;
  /** True iff the banner should show — derived from `settings`. */
  readonly active: boolean;
  readonly copy: GateBannerCopy;
}

export function DashboardAlerts() {
  const { user, refreshSession } = useAuth();
  const { settings } = useSystemSettings();

  // Local UI state — used to suppress the cycle banner instantly on
  // dismiss, before the backend round-trip completes. The auth context
  // refresh will then make this redundant, but the local flag avoids a
  // flicker.
  const [dismissing, setDismissing] = useState(false);
  // Per-session dismissals for the four gate banners. Seeded from
  // sessionStorage so dismissals survive page reloads inside one
  // browser session. Logout clears the storage (see AuthProvider).
  const [dismissedGates, setDismissedGates] = useState<Set<string>>(
    readInitialDismissed,
  );

  const dismissGate = useCallback((key: string) => {
    setDismissedGates((prev) => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });
    try {
      sessionStorage.setItem(DISMISS_PREFIX + key, "1");
    } catch {
      /* sessionStorage unavailable — dismissal stays in-memory only */
    }
  }, []);

  if (!user || !settings) return null;

  const role = user.role as keyof GateBannerCopy;

  // ── State-derived gate banners ─────────────────────────────────
  const gateBanners: readonly GateBanner[] = [
    {
      key: "annual_reviews_enabled",
      active: settings.annual_reviews_enabled === false,
      copy: {
        Employee:
          "Annual review submissions are paused. You can't submit your self-review right now.",
        Mentor:
          "Annual review submissions are paused. You can't submit team evaluations right now.",
        HR_MyOrg:
          "Annual review submissions are paused. Re-enable in System Settings when ready.",
      },
    },
    {
      key: "annual_goals_edit_enabled",
      active: settings.annual_goals_edit_enabled === false,
      copy: {
        Employee:
          "Annual goal editing is disabled. You can't create or edit goals right now.",
        Mentor:
          "Annual goal editing is disabled. New goals from your mentees are paused.",
        HR_MyOrg:
          "Annual goal editing is disabled. Re-enable in System Settings when ready.",
      },
    },
    {
      key: "project_ratings_visible",
      active: settings.project_ratings_visible === false,
      copy: {
        Employee:
          "Project performance ratings are hidden for the current cycle.",
        PM: "Project ratings are hidden from employees for the current cycle.",
        HR_MyOrg:
          "Project ratings are hidden from employees. Re-enable in System Settings.",
        HR_Miltenyi:
          "Project ratings are hidden from employees. Re-enable in System Settings.",
      },
    },
    {
      key: "annual_review_final_rating_visible",
      active: settings.annual_review_final_rating_visible === false,
      copy: {
        Employee:
          "Final annual review ratings are hidden for the current cycle.",
        HR_MyOrg:
          "Final ratings hidden. Re-enable when calibration is complete.",
      },
    },
  ];

  const visibleGates = gateBanners.filter(
    (b) =>
      b.active && b.copy[role] !== undefined && !dismissedGates.has(b.key),
  );

  // ── Cycle rollover banner ──────────────────────────────────────
  // First-time users (`last_seen_cycle === null`) see the banner once
  // — dismissing stamps them. Subsequent rollovers re-trigger when
  // the stamp diverges from the live cycle.
  const cycleMismatch =
    user.last_seen_cycle !== null &&
    user.last_seen_cycle !== settings.active_cycle_name;
  // Hide while a dismiss is in flight, even before refreshSession returns.
  const showCycleBanner = cycleMismatch && !dismissing;

  const dismissCycle = async () => {
    setDismissing(true);
    try {
      await authService.dismissCycleBanner();
      await refreshSession();
    } catch {
      // Best-effort — if the dismiss POST fails, the user will see
      // the banner again on next dashboard visit. Don't surface as
      // a snackbar error; it's a low-stakes click.
    }
    // Don't reset `dismissing` to false — once refreshSession lands,
    // user.last_seen_cycle === settings.active_cycle_name and the
    // cycleMismatch derivation returns false on its own.
  };

  if (visibleGates.length === 0 && !showCycleBanner) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2">
      {showCycleBanner && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5"
        >
          <Info
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
            aria-hidden="true"
          />
          <p className="flex-1 text-sm text-amber-900">
            <span className="font-semibold">
              We&apos;ve rolled into {settings.active_cycle_name}.
            </span>{" "}
            HR will re-open submission gates as needed.
          </p>
          <button
            type="button"
            onClick={dismissCycle}
            className="rounded-md p-1 text-amber-700 hover:bg-amber-100"
            aria-label="Dismiss cycle banner"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      )}

      {visibleGates.map((banner) => (
        <div
          key={banner.key}
          role="status"
          className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5"
        >
          <AlertTriangle
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-700"
            aria-hidden="true"
          />
          <p className="flex-1 text-sm text-amber-900">{banner.copy[role]}</p>
          <button
            type="button"
            onClick={() => dismissGate(banner.key)}
            className="rounded-md p-1 text-amber-700 hover:bg-amber-100"
            aria-label="Dismiss banner"
            title="Dismiss until next sign-in"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
