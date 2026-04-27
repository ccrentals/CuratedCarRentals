import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminEmailResendButton } from "@/components/admin/AdminEmailResendButton";
import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { fetchAdminEmailDetail } from "@/lib/notifications/adminEmails";

function statusBadgeClass(status: string) {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "SENT") return "border border-emerald-400/40 bg-emerald-500/10 text-emerald-200";
  if (normalized === "BOUNCED" || normalized === "DELIVERY_ISSUE") return "border border-amber-400/40 bg-amber-500/10 text-amber-200";
  if (normalized === "FAILED") return "border border-red-400/40 bg-red-500/10 text-red-200";
  if (normalized === "SKIPPED") return "border border-slate-400/40 bg-slate-500/10 text-slate-200";
  return "border border-[var(--ccr-border)] bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]";
}

function formatAdminEmailLabel(value: string | null | undefined) {
  if (!value) return "—";

  const normalized = value.replace(/[_.]+/g, " ").trim().toLowerCase();
  if (!normalized) return "—";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function safeBackHref(value: string | undefined) {
  if (!value) return "/admin/emails";
  if (!value.startsWith("/admin/emails")) return "/admin/emails";
  return value;
}

export default async function AdminEmailDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const backHref = safeBackHref(typeof query.back === "string" ? query.back : undefined);
  const item = await fetchAdminEmailDetail(id);

  if (!item) notFound();

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Monitoring</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Email Detail</h1>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            Delivery record, correlation metadata, and resend controls.
          </p>
        </div>
        <Link
          href={backHref}
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
        >
          Back to emails
        </Link>
      </div>

      <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xl font-bold text-[var(--ccr-text)]">
              {item.subject || formatAdminEmailLabel(item.emailType)}
            </p>
            <p className="text-sm text-[var(--ccr-muted)]">{item.recipientEmail || "Legacy / unavailable recipient"}</p>
            <p className="mt-1 text-xs text-[var(--ccr-muted)]">
              Created <DateTimeInline value={item.createdAt} className="inline-flex text-[var(--ccr-text)]" />
            </p>
          </div>
          <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(item.status)}`}>
            {item.status}
          </span>
        </div>

        <dl className="mt-5 grid gap-3 text-sm text-[var(--ccr-muted)] sm:grid-cols-2 xl:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide">Email Type</dt>
            <dd className="mt-1 text-[var(--ccr-text)]">{formatAdminEmailLabel(item.emailType)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide">Trigger Source</dt>
            <dd className="mt-1 text-[var(--ccr-text)]">{formatAdminEmailLabel(item.triggerSource)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide">Triggered By</dt>
            <dd className="mt-1 text-[var(--ccr-text)]">{item.triggeredByName || item.triggeredByUserId || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide">Entity</dt>
            <dd className="mt-1 text-[var(--ccr-text)]">{formatAdminEmailLabel(item.entityType)}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide">Reference</dt>
            <dd className="mt-1 text-[var(--ccr-text)]">{item.entityPublicId || item.entityId || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide">Transaction</dt>
            <dd className="mt-1 text-[var(--ccr-text)]">
              {item.relatedTransactionType
                ? `${formatAdminEmailLabel(item.relatedTransactionType)}${item.relatedTransactionId ? ` • ${item.relatedTransactionId}` : ""}`
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide">Provider Message ID</dt>
            <dd className="mt-1 break-all text-[var(--ccr-text)]">{item.providerMessageId || "—"}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide">Sent At</dt>
            <dd className="mt-1 text-[var(--ccr-text)]"><DateTimeInline value={item.sentAt} /></dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide">Last Event</dt>
            <dd className="mt-1 text-[var(--ccr-text)]"><DateTimeInline value={item.lastEventAt} /></dd>
          </div>
        </dl>

        <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
          <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Event History</p>
            {item.events.length === 0 ? (
              <p className="text-sm text-[var(--ccr-muted)]">No event history recorded for this row.</p>
            ) : (
              <div className="space-y-3">
                {item.events.map((event) => (
                  <div key={event.id} className="rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-semibold text-[var(--ccr-text)]">{formatAdminEmailLabel(event.eventType)}</p>
                      <span className="text-xs text-[var(--ccr-muted)]">
                        <DateTimeInline value={event.occurredAt} />
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                      {formatAdminEmailLabel(event.source)}
                      {event.status ? ` • ${formatAdminEmailLabel(event.status)}` : ""}
                    </p>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--ccr-bg)] p-3 text-xs text-[var(--ccr-text)]">
                      {JSON.stringify(event.details, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-5">
            <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Actions</p>
              {item.manualResendAllowed ? (
                <AdminEmailResendButton recordId={item.id} />
              ) : (
                <p className="text-sm text-[var(--ccr-muted)]">Manual resend is disabled for this email type.</p>
              )}
            </div>

            <div className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Metadata</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words text-xs text-[var(--ccr-text)]">
                {JSON.stringify(item.metadata, null, 2)}
              </pre>
            </div>

            {item.lastError ? (
              <div className="rounded-xl border border-red-400/40 bg-red-500/10 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-red-200">Last Error</p>
                <p className="text-sm text-red-100">{item.lastError}</p>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
