import { QuoteDetailClient } from "@/components/admin/quotes/QuoteDetailClient";
import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { canAccessAdmin } from "@/lib/auth/roles";

type QuoteEventRow = {
  id: string;
  created_at: string;
  event_type: string;
  actor_email: string | null;
  meta: Record<string, unknown> | null;
};

function isQuoteEventsMissingTable(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code ?? "").toUpperCase();
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  return code === "42P01" && message.includes("quote_events");
}

export default async function AdminQuoteDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionFromRequest();
  const canManage = canAccessAdmin(session?.role);

  if (!canManage) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Quote</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">You do not have permission to view this page.</p>
      </div>
    );
  }

  const { id } = await params;
  const query = await searchParams;
  const createdFlag = query.created === "1";

  const events = await (async () => {
    try {
      const result = await dbQuery<QuoteEventRow>(
        "select qe.id, qe.created_at, qe.event_type, u.email as actor_email, qe.meta from quote_events qe left join users u on u.id = qe.actor_admin_user_id where qe.quote_id = $1::uuid order by qe.created_at desc limit 50",
        [id],
      );
      return result.rows.map((row: QuoteEventRow) => ({
        id: row.id,
        createdAt: row.created_at,
        eventType: row.event_type,
        actorEmail: row.actor_email,
        meta: row.meta ?? {},
      }));
    } catch (error) {
      if (isQuoteEventsMissingTable(error)) {
        return [];
      }
      throw error;
    }
  })();

  return (
    <QuoteDetailClient
      quoteId={id}
      canManage={canManage}
      createdFlag={createdFlag}
      initialEvents={events}
    />
  );
}
