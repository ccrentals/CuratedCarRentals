import { ProfileManager } from "@/components/admin/ProfileManager";

export default function AdminProfilePage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
      <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Profile</h1>
      <p className="mt-2 text-sm text-[var(--ccr-muted)]">
        Manage your account details and personal admin preferences.
      </p>
      <ProfileManager />
    </div>
  );
}
