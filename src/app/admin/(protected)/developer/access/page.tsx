import Link from "next/link";
import { notFound } from "next/navigation";

import { resolveAdminActor } from "@/lib/auth/adminGuards";

type CapabilityRow = {
  feature: string;
  developer: string;
  admin: string;
  user: string;
};

const CAPABILITIES: CapabilityRow[] = [
  {
    feature: "Access operations dashboards (bookings, customers, payments, vehicles, calendar)",
    developer: "Full",
    admin: "Full",
    user: "Limited",
  },
  {
    feature: "Create / edit bookings and customer records",
    developer: "Full",
    admin: "Full",
    user: "Limited",
  },
  {
    feature: "Payment actions (manual payment, manual refund adjustment, cancel/restore)",
    developer: "Full",
    admin: "Full",
    user: "Restricted",
  },
  {
    feature: "Run cron jobs and monitoring actions",
    developer: "Full",
    admin: "No",
    user: "No",
  },
  {
    feature: "Settings management",
    developer: "Full",
    admin: "Full",
    user: "No",
  },
  {
    feature: "Users page access",
    developer: "Full",
    admin: "Full",
    user: "No",
  },
  {
    feature: "Assign DEVELOPER role",
    developer: "Yes",
    admin: "No",
    user: "No",
  },
  {
    feature: "Administration docs + developer checklist",
    developer: "Full",
    admin: "No",
    user: "No",
  },
];

export default async function AdminDeveloperAccessPage() {
  const access = await resolveAdminActor({ requirement: "developer" });
  if (!access.ok) {
    notFound();
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Administration</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Role Capability Matrix</h1>
          <p className="mt-2 text-sm text-[var(--ccr-muted)]">
            Quick reference for what DEVELOPER, ADMIN, and OPERATIONS accounts are expected to handle.
          </p>
        </div>
        <Link
          href="/admin/developer"
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
        >
          Back to developer
        </Link>
      </div>

      <section className="mt-6 overflow-x-auto rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
        <table className="min-w-full text-left text-sm">
          <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
            <tr>
              <th className="px-3 py-3">Feature</th>
              <th className="px-3 py-3">Developer</th>
              <th className="px-3 py-3">Admin</th>
              <th className="px-3 py-3">Operations</th>
            </tr>
          </thead>
          <tbody>
            {CAPABILITIES.map((row) => (
              <tr key={row.feature} className="border-b border-[var(--ccr-border)] last:border-b-0">
                <td className="px-3 py-3 text-[var(--ccr-text)]">{row.feature}</td>
                <td className="px-3 py-3 font-semibold text-[var(--ccr-text)]">{row.developer}</td>
                <td className="px-3 py-3 font-semibold text-[var(--ccr-text)]">{row.admin}</td>
                <td className="px-3 py-3 font-semibold text-[var(--ccr-text)]">{row.user}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-4 text-xs text-[var(--ccr-muted)]">
          Note: server-side route guards remain the enforcement source of truth; this page is an operational reference.
        </p>
      </section>
    </div>
  );
}
