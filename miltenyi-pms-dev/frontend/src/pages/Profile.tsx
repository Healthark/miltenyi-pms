import { useState, useEffect } from "react";
import { profileService, type UserProfile } from "../services/profile.service";
import { ProfileInfoCard } from "../components/profile/ProfileInfoCard";
import { PasswordChangeCard } from "../components/profile/PasswordChangeCard";

export function Profile() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    profileService
      .getProfile()
      .then(setProfile)
      .catch(() => {
        // Profile still renders with null — InfoCard shows skeleton fallback
      })
      .finally(() => setIsLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div>
        <h1 className="font-display text-xl font-semibold text-text-main">
          My Profile
        </h1>
        <p className="mt-0.5 text-sm text-text-muted">
          View your details and manage your account settings.
        </p>
      </div>

      {/* Two-column layout: info left, settings right */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left — read-only HR data (1/3 width on desktop) */}
        <ProfileInfoCard profile={profile} isLoading={isLoading} />

        {/* Right — account settings (2/3 width on desktop) */}
        <div className="lg:col-span-2 space-y-6">
          <PasswordChangeCard />
        </div>
      </div>
    </div>
  );
}
