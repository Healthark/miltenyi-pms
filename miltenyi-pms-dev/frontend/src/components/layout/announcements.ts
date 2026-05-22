/**
 * announcements.ts — Pure helpers for the Topbar bell's Announcements tab.
 *
 * Extracted from NotificationDropdown.tsx so the dropdown file exports
 * only React components — that lets `react-refresh` keep HMR working on
 * edits to either the component OR these helpers without a full reload.
 * The two consumers are NotificationDropdown (renders the rows) and
 * Topbar (decides whether to light the bell dot via hasActiveAnnouncements).
 */

import type { SessionClaims } from "@/services/auth.service";
import type { SystemSettingsResponse } from "@/services/system-settings.service";
import { authService } from "@/services/auth.service";

export type AnnouncementKey =
  | "annual_reviews_enabled"
  | "annual_goals_edit_enabled"
  | "project_ratings_visible"
  | "annual_review_final_rating_visible";

type RoleCopy = Partial<Record<string, string>>;

const GATE_COPY: Record<AnnouncementKey, RoleCopy> = {
  annual_reviews_enabled: {
    Employee:
      "Annual review submissions are paused. You can't submit your self-review right now.",
    Mentor:
      "Annual review submissions are paused. You can't submit team evaluations right now.",
    HR_MyOrg:
      "Annual review submissions are paused. Re-enable in System Settings when ready.",
  },
  annual_goals_edit_enabled: {
    Employee:
      "Annual goal editing is disabled. You can't create or edit goals right now.",
    Mentor:
      "Annual goal editing is disabled. New goals from your mentees are paused.",
    HR_MyOrg:
      "Annual goal editing is disabled. Re-enable in System Settings when ready.",
  },
  project_ratings_visible: {
    Employee:
      "Project performance ratings are hidden for the current cycle.",
    PM: "Project ratings are hidden from employees for the current cycle.",
    HR_MyOrg:
      "Project ratings are hidden from employees. Re-enable in System Settings.",
    HR_Miltenyi:
      "Project ratings are hidden from employees. Re-enable in System Settings.",
  },
  annual_review_final_rating_visible: {
    Employee:
      "Final annual review ratings are hidden for the current cycle.",
    HR_MyOrg:
      "Final ratings hidden. Re-enable when calibration is complete.",
  },
};

export interface AnnouncementRow {
  /** Stable key so React can reconcile and the cycle row gets its own
   *  dismiss handler. */
  readonly key: string;
  readonly title: string;
  readonly body: string;
  /** Click → call this. Currently only the cycle-rollover row sets it. */
  readonly onDismiss?: () => Promise<void>;
}

export function buildAnnouncements(
  user: SessionClaims | null,
  settings: SystemSettingsResponse | null,
  onRefreshSession: () => Promise<void>,
): AnnouncementRow[] {
  if (!user || !settings) return [];
  const role = user.role;
  const rows: AnnouncementRow[] = [];

  // Gate-flag announcements (an entry is included only when the flag
  // is OFF AND the current role has copy for it).
  const checks: Array<{
    key: AnnouncementKey;
    active: boolean;
    title: string;
  }> = [
    {
      key: "annual_reviews_enabled",
      active: settings.annual_reviews_enabled === false,
      title: "Annual review submissions paused",
    },
    {
      key: "annual_goals_edit_enabled",
      active: settings.annual_goals_edit_enabled === false,
      title: "Annual goal editing disabled",
    },
    {
      key: "project_ratings_visible",
      active: settings.project_ratings_visible === false,
      title: "Project ratings hidden",
    },
    {
      key: "annual_review_final_rating_visible",
      active: settings.annual_review_final_rating_visible === false,
      title: "Final annual review ratings hidden",
    },
  ];
  for (const c of checks) {
    if (!c.active) continue;
    const body = GATE_COPY[c.key][role];
    if (!body) continue;
    rows.push({ key: c.key, title: c.title, body });
  }

  // Cycle-rolled-over announcement — driven by user.last_seen_cycle
  // diverging from the live active_cycle_name. Dismiss persists across
  // sessions via the backend (stamps last_seen_cycle).
  const cycleMismatch =
    user.last_seen_cycle !== null &&
    user.last_seen_cycle !== settings.active_cycle_name;
  if (cycleMismatch) {
    rows.push({
      key: "cycle_rollover",
      title: `Rolled into ${settings.active_cycle_name}`,
      body:
        "The active cycle has changed. HR will re-open submission gates as needed.",
      onDismiss: async () => {
        try {
          await authService.dismissCycleBanner();
        } catch {
          /* best-effort — banner reappears on next visit if this fails */
        }
        await onRefreshSession();
      },
    });
  }

  return rows;
}

// Public helper so the Topbar can decide whether to light the bell dot
// without duplicating the gate logic. Returns true iff at least one
// announcement is currently active for this user.
export function hasActiveAnnouncements(
  user: SessionClaims | null,
  settings: SystemSettingsResponse | null,
): boolean {
  if (!user || !settings) return false;
  return buildAnnouncements(user, settings, async () => {}).length > 0;
}
