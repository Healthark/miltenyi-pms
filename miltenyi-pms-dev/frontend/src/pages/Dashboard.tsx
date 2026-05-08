import { useAuth } from "@/hooks/useAuth";
import { Construction } from "lucide-react";

/**
 * Dashboard — role-aware "coming soon" placeholder.
 *
 * Every authenticated user has a Dashboard tab in the sidebar. The actual
 * per-role surface (widgets, action items, KPIs) is not yet designed —
 * for now we just confirm the user landed somewhere sensible and
 * acknowledge which dashboard *will* be tailored for them.
 *
 * When real content arrives, this file is the single replacement target:
 * branch on `user?.role` and render the role-specific layout. The
 * sidebar already routes all 5 roles here.
 */

interface RolePlaceholder {
  readonly title: string;
  readonly subtitle: string;
}

const ROLE_PLACEHOLDERS: Record<string, RolePlaceholder> = {
  HR_MyOrg: {
    title: "Healthark HR Dashboard",
    subtitle:
      "Org-wide rollups across staffing, reviews, and mentor pairings will live here.",
  },
  HR_Miltenyi: {
    title: "Miltenyi HR Dashboard",
    subtitle:
      "Project rosters, evaluation completion rates, and system-settings shortcuts will live here.",
  },
  Mentor: {
    title: "Mentor Dashboard",
    subtitle:
      "Pending mentee goal approvals + annual reviews waiting on you will surface here.",
  },
  PM: {
    title: "PM Dashboard",
    subtitle:
      "Your evaluation queue across the current cycle will surface here.",
  },
  Staff: {
    title: "My Dashboard",
    subtitle:
      "Your goals, project reviews, and annual review status will surface here.",
  },
};

const FALLBACK: RolePlaceholder = {
  title: "Dashboard",
  subtitle: "Tailored content is coming soon.",
};

export function Dashboard() {
  const { user } = useAuth();
  const placeholder = (user && ROLE_PLACEHOLDERS[user.role]) ?? FALLBACK;
  const firstName = user?.full_name?.split(" ")[0] ?? "there";

  return (
    <div className="space-y-8">
      {/* Greeting */}
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">
          Welcome back, {firstName}
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">
          {placeholder.subtitle}
        </p>
      </div>

      {/* Placeholder card */}
      <div className="rounded-xl border border-dashed border-border bg-surface p-10 text-center shadow-sm">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-light">
          <Construction
            className="h-6 w-6 text-brand"
            aria-hidden="true"
          />
        </div>
        <h2 className="mt-5 font-display text-lg font-semibold text-text-main">
          {placeholder.title}
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-text-muted">
          {placeholder.subtitle}
        </p>
        <p className="mt-6 inline-flex items-center rounded-full bg-brand-light px-3 py-1 text-xs font-medium text-brand">
          Coming soon
        </p>
        {user && (
          <p className="mt-3 text-[11px] uppercase tracking-wider text-text-muted/70">
            Showing as: {user.role}
          </p>
        )}
      </div>
    </div>
  );
}
