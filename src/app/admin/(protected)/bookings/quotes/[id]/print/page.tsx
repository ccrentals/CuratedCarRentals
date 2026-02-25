import { QuotePrintClient } from "@/components/admin/quotes/QuotePrintClient";
import { getSessionFromRequest } from "@/lib/auth/session";
import { isStaffRole } from "@/lib/auth/roles";

export default async function AdminQuotePrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSessionFromRequest();
  const { id } = await params;

  if (!isStaffRole(session?.role)) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Quote print</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">You do not have permission to view this page.</p>
      </div>
    );
  }

  return <QuotePrintClient quoteId={id} />;
}
