import { AdminQuotesListClient } from "@/components/admin/quotes/AdminQuotesListClient";
import { getSessionFromRequest } from "@/lib/auth/session";

function isStaffRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER" || normalized === "USER";
}

export default async function AdminQuotesPage() {
  const session = await getSessionFromRequest();

  if (!isStaffRole(session?.role)) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Quotes</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">You do not have permission to view this page.</p>
      </div>
    );
  }

  return <AdminQuotesListClient />;
}
