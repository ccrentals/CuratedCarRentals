import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import {
  bulkDeleteAdminMessagesPermanently,
  bulkUpdateAdminMessagesStatus,
  isContactMessagesMissingTableError,
  normalizeMessageAction,
  type ContactMessageAction,
  type ContactMessageStatusChange,
} from "@/lib/messages/adminMessages";
import { writeAuditLog } from "@/lib/audit";
import { requireCsrf } from "@/lib/security/csrf";
import { logError } from "@/lib/log";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  const unique = new Set<string>();
  for (const raw of value) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!UUID_RE.test(trimmed)) continue;
    unique.add(trimmed);
  }
  return [...unique];
}

export type AdminMessagesBulkRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  bulkUpdate: (input: {
    ids: string[];
    action: ContactMessageAction;
    actorUserId?: string | null;
  }) => Promise<{
    updatedCount: number;
    changes: ContactMessageStatusChange[];
  }>;
  bulkDelete: (input: { ids: string[] }) => Promise<{
    deletedCount: number;
    deletedIds: string[];
    blockedIds: string[];
  }>;
  writeAudit: (input: {
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string;
    details?: Record<string, unknown>;
  }) => Promise<void>;
};

const DEFAULT_DEPS: AdminMessagesBulkRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  bulkUpdate: (input) => bulkUpdateAdminMessagesStatus(input),
  bulkDelete: (input) => bulkDeleteAdminMessagesPermanently(input),
  writeAudit: (input) => writeAuditLog(input),
};

export async function handleAdminMessagesBulkPost(
  request: Request,
  deps: AdminMessagesBulkRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = await request.json().catch(() => null);

  if (!(await deps.requireCsrfCheck(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const action = normalizeMessageAction(body?.action);
  if (!action) {
    return NextResponse.json({ ok: false, error: "Invalid action" }, { status: 400 });
  }

  const ids = normalizeIds(body?.ids);
  if (ids.length < 1 || ids.length > 200) {
    return NextResponse.json(
      { ok: false, error: "Provide between 1 and 200 message ids." },
      { status: 400 },
    );
  }

  try {
    if (action === "DELETE_PERMANENT") {
      const result = await deps.bulkDelete({ ids });
      if (result.blockedIds.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            error: "Only trashed messages can be permanently deleted.",
            blockedIds: result.blockedIds,
          },
          { status: 400 },
        );
      }

      await Promise.all(
        result.deletedIds.map((messageId) =>
          deps.writeAudit({
            userId: actor.userId,
            action: "CONTACT_MESSAGE_DELETED_PERMANENTLY",
            entityType: "contact_message",
            entityId: messageId,
            details: {
              trigger: "BULK_ACTION",
              action,
            },
          }),
        ),
      );

      return NextResponse.json({
        ok: true,
        updatedCount: result.deletedCount,
      });
    }

    const result = await deps.bulkUpdate({
      ids,
      action,
      actorUserId: actor.userId,
    });

    await Promise.all(
      result.changes.map((change) =>
        deps.writeAudit({
          userId: actor.userId,
          action: "CONTACT_MESSAGE_STATUS_UPDATED",
          entityType: "contact_message",
          entityId: change.id,
          details: {
            trigger: "BULK_ACTION",
            action,
            previousStatus: change.previousStatus,
            nextStatus: change.nextStatus,
          },
        }),
      ),
    );

    return NextResponse.json({
      ok: true,
      updatedCount: result.updatedCount,
    });
  } catch (error) {
    if (isContactMessagesMissingTableError(error)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Messages table is not installed. Apply schema.sql changes.",
        },
        { status: 503 },
      );
    }

    logError("admin_messages_bulk_update_failed", error, {
      idsCount: ids.length,
      action,
    });
    return NextResponse.json(
      { ok: false, error: "Failed to update selected messages." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handleAdminMessagesBulkPost(request);
}
