import Link from "next/link";
import { notFound } from "next/navigation";
import { canAccessAdmin } from "@/lib/auth/roles";

import { DateTimeInline } from "@/components/shared/DateTimeInline";
import { MessageStatusActions } from "@/components/admin/MessageStatusActions";
import { getSessionFromRequest } from "@/lib/auth/session";
import { writeAuditLog } from "@/lib/audit";
import {
  fetchAdminMessageByIdWithOptionalMarkRead,
  isContactMessagesMissingTableError,
} from "@/lib/messages/adminMessages";

function statusBadgeClass(status: string) {
  const normalized = String(status ?? "")
    .trim()
    .toUpperCase();

  if (normalized === "ARCHIVED") {
    return "border border-[var(--ccr-status-neutral-border)] bg-[var(--ccr-status-neutral-bg)] text-[var(--ccr-status-neutral-text)]";
  }
  if (normalized === "READ") {
    return "border border-[var(--ccr-status-info-border)] bg-[var(--ccr-status-info-bg)] text-[var(--ccr-status-info-text)]";
  }
  return "border border-[var(--ccr-status-warning-border)] bg-[var(--ccr-status-warning-bg)] text-[var(--ccr-status-warning-text)]";
}

function safeBackHref(value: string | undefined) {
  if (!value) return "/admin/messages";
  if (!value.startsWith("/admin/messages")) return "/admin/messages";
  return value;
}

export default async function AdminMessageDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionFromRequest();
  const canView = canAccessAdmin(session?.role);
  const canDeletePermanent = canView;

  if (!canView || !session) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Message</h1>
        <p className="mt-2 text-sm text-[var(--ccr-muted)]">
          You do not have permission to view this page.
        </p>
      </div>
    );
  }

  const { id } = await params;
  const query = await searchParams;
  const markRead = query.markRead === "1";
  const backHref = safeBackHref(typeof query.back === "string" ? query.back : undefined);

  let result: Awaited<ReturnType<typeof fetchAdminMessageByIdWithOptionalMarkRead>> | null = null;
  try {
    result = await fetchAdminMessageByIdWithOptionalMarkRead({
      id,
      markRead,
      actorUserId: session.userId,
    });
  } catch (error) {
    if (isContactMessagesMissingTableError(error)) {
      return (
        <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
          <div className="rounded-2xl border border-[var(--ccr-status-warning-border)] bg-[var(--ccr-status-warning-bg)] p-4 text-sm text-[var(--ccr-status-warning-text)]">
            <p className="font-semibold">Messages table is not installed.</p>
            <p className="mt-1 text-xs opacity-90">
              Apply migrations to enable message details.
            </p>
          </div>
        </div>
      );
    }

    throw error;
  }

  if (!result?.item) {
    notFound();
  }

  if (markRead && result.statusChanged && result.previousStatus === "NEW") {
    await writeAuditLog({
      userId: session.userId,
      action: "CONTACT_MESSAGE_MARKED_READ",
      entityType: "contact_message",
      entityId: id,
      details: {
        trigger: "DETAIL_PAGE_VIEW",
        previousStatus: "NEW",
        nextStatus: result.item.status,
      },
    });
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Message</h1>
          <p className="mt-1 text-sm text-[var(--ccr-muted)]">
            Shared inbox item for contact inquiries and internal operational alerts.
          </p>
        </div>
        <Link
          href={backHref}
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
        >
          Back to messages
        </Link>
      </div>

      <div className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xl font-bold text-[var(--ccr-text)]">{result.item.displayName}</p>
            <p className="text-sm text-[var(--ccr-muted)]">{result.item.displayEmail}</p>
            <p className="mt-1 text-xs text-[var(--ccr-muted)]">
              Received{" "}
              <DateTimeInline value={result.item.createdAt} className="inline-flex text-[var(--ccr-text)]" />
            </p>
          </div>
          <span
            className={`inline-flex rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(
              result.item.status,
            )}`}
          >
            {result.item.status}
          </span>
        </div>

        <dl className="mt-4 grid gap-2 text-xs text-[var(--ccr-muted)] sm:grid-cols-2">
          <div>
            <dt className="font-semibold uppercase tracking-wide">Source</dt>
            <dd className="mt-0.5 text-[var(--ccr-text)]">{result.item.sourceLabel}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wide">Read at</dt>
            <dd className="mt-0.5 text-[var(--ccr-text)]">
              {result.item.readAt ? (
                <DateTimeInline value={result.item.readAt} className="inline-flex" />
              ) : (
                "Not read yet"
              )}
            </dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wide">Inbox state</dt>
            <dd className="mt-0.5 text-[var(--ccr-text)]">{result.item.statusLabel}</dd>
          </div>
          <div>
            <dt className="font-semibold uppercase tracking-wide">Related record</dt>
            <dd className="mt-0.5 text-[var(--ccr-text)]">
              {result.item.relatedEntityLabel ? (
                result.item.relatedEntityHref ? (
                  <Link
                    href={result.item.relatedEntityHref}
                    className="font-semibold text-[var(--ccr-accent)] underline-offset-2 hover:underline"
                  >
                    {result.item.relatedEntityLabel}
                  </Link>
                ) : (
                  result.item.relatedEntityLabel
                )
              ) : (
                "No related record"
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-5 rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Message
          </p>
          <p className="whitespace-pre-wrap text-sm leading-6 text-[var(--ccr-text)]">
            {result.item.message}
          </p>
        </div>

        <div className="mt-5 border-t border-[var(--ccr-border)] pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Actions
          </p>
          <MessageStatusActions
            messageId={result.item.id}
            status={result.item.status}
            canDeletePermanent={canDeletePermanent}
            backHref={backHref}
          />
        </div>
      </div>
    </div>
  );
}
