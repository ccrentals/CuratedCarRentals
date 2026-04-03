import Link from "next/link";
import { notFound } from "next/navigation";

import { ClerkIdentitySyncPanel } from "@/components/admin/ClerkIdentitySyncPanel";
import { resolveAdminActor } from "@/lib/auth/adminGuards";
import { generateClerkIdentitySyncReport } from "@/lib/auth/clerkIdentitySync";

export default async function AdminDeveloperAuthSyncPage() {
  const access = await resolveAdminActor({ requirement: "developer" });
  if (!access.ok) {
    notFound();
  }

  const report = await generateClerkIdentitySyncReport();

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Developer</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Auth sync</h1>
          <p className="mt-2 text-sm text-[var(--ccr-muted)]">
            Clerk is the identity source of truth for usernames and primary email. Use this page to audit and repair local drift.
          </p>
        </div>
        <Link
          href="/admin/developer"
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
        >
          Back to developer
        </Link>
      </div>

      <ClerkIdentitySyncPanel initialReport={report} />
    </div>
  );
}
