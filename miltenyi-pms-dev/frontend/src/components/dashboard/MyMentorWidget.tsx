import { UserCheck, ArrowRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { UserProfile } from "@/services/profile.service";

interface MyMentorWidgetProps {
  /** Null while the parent's fetch is in flight. */
  readonly profile: UserProfile | null;
}

/**
 * MyMentorWidget — Staff-dashboard tile that surfaces who the user
 * reports to. Renders the mentor's name plus a "View profile" CTA
 * pointing at the user's own profile page (which shows the mentor row
 * in full).
 *
 * Gating: the parent should hide this card when `user.has_mentor` is
 * false (CEO / founders / soft-deleted-mentor edge cases). When the
 * fetch is in flight `profile` is null and a skeleton renders in
 * place so the grid is stable.
 */
export function MyMentorWidget({ profile }: MyMentorWidgetProps) {
  const isLoading = profile === null;
  const mentorName = profile?.mentor_name ?? null;

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-light">
          <UserCheck className="h-5 w-5 text-brand" aria-hidden="true" />
        </div>
        <p className="text-xs font-medium text-text-muted uppercase tracking-wide">
          My Mentor
        </p>
      </div>

      {isLoading ? (
        <div className="animate-pulse space-y-2">
          <div className="h-5 w-40 rounded bg-slate-100" />
          <div className="h-3 w-56 rounded bg-slate-100" />
        </div>
      ) : (
        <>
          <p className="font-display text-lg font-semibold text-text-main">
            {mentorName ?? "No mentor assigned"}
          </p>
          <p className="text-sm text-text-muted -mt-2">
            {mentorName
              ? "Your goals route through them for approval and review."
              : "Contact HR if this looks wrong."}
          </p>

          {mentorName && (
            <Link
              to="/profile"
              className="flex items-center gap-1 text-xs font-medium text-brand hover:underline mt-auto"
            >
              View profile <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}
        </>
      )}
    </div>
  );
}
