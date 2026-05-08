/**
 * ProfileInfoCard.tsx — Read-Only HR Identity Card.
 *
 * Displays the user's name, avatar initials, employee code, org,
 * function, designation, mentor, and join date.
 *
 * All fields are HR-controlled and read-only — the user cannot edit
 * them here. Edits go through the Admin Panel (Epic 1.3).
 *
 * Placement: src/components/profile/ProfileInfoCard.tsx
 */

import {
  Building2,
  Briefcase,
  BadgeCheck,
  Users,
  Calendar,
  Mail,
  Phone,
} from "lucide-react";
import type { UserProfile } from "@/services/profile.service";

interface ProfileInfoCardProps {
  readonly profile: UserProfile | null;
  readonly isLoading: boolean;
}

/** Skeleton placeholder shown while the profile is loading. */
function Skeleton() {
  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm animate-pulse">
      <div className="flex items-center gap-4 pb-4 mb-4 border-b border-border">
        <div className="h-14 w-14 rounded-full bg-slate-100" />
        <div className="flex flex-col gap-2">
          <div className="h-4 w-40 rounded bg-slate-100" />
          <div className="h-3 w-20 rounded bg-slate-100" />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3.5">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <div className="h-4 w-4 rounded bg-slate-100" />
            <div className="h-3 flex-1 rounded bg-slate-100" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A single row in the info list. */
function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  readonly icon: typeof Mail;
  readonly label: string;
  readonly value: string | null;
}) {
  return (
    <div className="flex items-start gap-3">
      <Icon
        className="mt-0.5 h-4 w-4 shrink-0 text-text-muted"
        aria-hidden="true"
      />
      <div className="min-w-0">
        <p className="text-xs text-text-muted">{label}</p>
        <p className="text-sm font-medium text-text-main truncate">
          {value ?? "—"}
        </p>
      </div>
    </div>
  );
}

export function ProfileInfoCard({ profile, isLoading }: ProfileInfoCardProps) {
  if (isLoading || !profile) return <Skeleton />;

  const initials = profile.full_name
    .split(" ")
    .map((n) => n[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const joinDate = new Date(profile.created_at).toLocaleDateString("en-IN", {
    year: "numeric",
    month: "long",
  });

  return (
    <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      {/* Avatar + Name + Role — horizontal layout to keep the card short
          and let the info grid breathe sideways instead of vertically. */}
      <div className="flex items-center gap-4 pb-4 mb-4 border-b border-border">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand text-white text-lg font-bold"
          aria-label={`Avatar for ${profile.full_name}`}
        >
          {initials}
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-base font-semibold text-text-main truncate">
            {profile.full_name}
          </h2>
          <span className="inline-block mt-1 rounded-full bg-brand-light px-2.5 py-0.5 text-xs font-medium text-brand">
            {profile.role}
          </span>
        </div>
      </div>

      {/* HR-Controlled Info Rows — two-column grid on wider screens
          so the card height roughly matches the password form on the
          right. Single column on small screens. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-5 gap-y-3.5">
        <InfoRow
          icon={BadgeCheck}
          label="Employee Code"
          value={profile.employee_code}
        />
        <InfoRow icon={Mail} label="Email" value={profile.email} />
        <InfoRow icon={Phone} label="Phone" value={profile.phone} />
        <InfoRow
          icon={Building2}
          label="Organization"
          value={profile.org_name}
        />
        <InfoRow
          icon={Briefcase}
          label="Function"
          value={profile.function}
        />
        <InfoRow
          icon={Briefcase}
          label="Designation"
          value={profile.designation}
        />
        <InfoRow icon={Users} label="Mentor" value={profile.mentor_name} />
        <InfoRow icon={Calendar} label="Joined" value={joinDate} />
      </div>

      {/* Footer note */}
      <p className="mt-4 text-xs text-text-muted text-center">
        Contact your HR administrator to update these details.
      </p>
    </div>
  );
}
