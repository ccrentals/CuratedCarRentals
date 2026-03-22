import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import {
  deleteAdminMessagePermanently,
  fetchAdminMessageByIdWithOptionalMarkRead,
  isContactMessagesMissingTableError,
  normalizeMessageAction,
  updateAdminMessageStatus,
  type AdminMessageDetailItem,
  type ContactMessageAction,
  type ContactMessageStatus,
} from "@/lib/messages/adminMessages";
import { writeAuditLog } from "@/lib/audit";
import { requireCsrf } from "@/lib/security/csrf";
import { logError } from "@/lib/log";

type MessageRouteContext = {
  params: Promise<{ id: string }>;
};

export type AdminMessageRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  getMessage: (input: {
    id: string;
    markRead?: boolean;
    actorUserId?: string | null;
  }) => Promise<{
    item: AdminMessageDetailItem | null;
    statusChanged: boolean;
    previousStatus: ContactMessageStatus | null;
  }>;
  patchMessage: (input: {
    id: string;
    action: ContactMessageAction;
    actorUserId?: string | null;
  }) => Promise<{
    item: AdminMessageDetailItem | null;
    previousStatus: ContactMessageStatus | null;
  }>;
  deleteMessage: (input: { id: string }) => Promise<AdminMessageDetailItem | null>;
  writeAudit: (input: {
    userId?: string | null;
    action: string;
    entityType: string;
    entityId?: string;
    details?: Record<string, unknown>;
  }) => Promise<void>;
};

const DEFAULT_DEPS: AdminMessageRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  getMessage: (input) => fetchAdminMessageByIdWithOptionalMarkRead(input),
  patchMessage: (input) => updateAdminMessageStatus(input),
  deleteMessage: (input) => deleteAdminMessagePermanently(input),
  writeAudit: (input) => writeAuditLog(input),
};

export async function handleAdminMessageGet(
  request: Request,
  context: MessageRouteContext,
  deps: AdminMessageRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const { id } = await context.params;
  const { searchParams } = new URL(request.url);
  const markRead = searchParams.get("markRead") === "1";

  try {
    const result = await deps.getMessage({
      id,
      markRead,
      actorUserId: actor.userId,
    });

    if (!result.item) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    if (markRead && result.statusChanged && result.previousStatus === "NEW") {
      await deps.writeAudit({
        userId: actor.userId,
        action: "CONTACT_MESSAGE_MARKED_READ",
        entityType: "contact_message",
        entityId: id,
        details: {
          trigger: "GET_MARK_READ",
          previousStatus: "NEW",
          nextStatus: result.item.status,
        },
      });
    }

    return NextResponse.json({ ok: true, item: result.item });
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

    logError("admin_message_get_failed", error, { messageId: id });
    return NextResponse.json({ ok: false, error: "Failed to load message." }, { status: 500 });
  }
}

export async function handleAdminMessagePatch(
  request: Request,
  context: MessageRouteContext,
  deps: AdminMessageRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const { id } = await context.params;
  const body = await request.json().catch(() => null);

  if (!(await deps.requireCsrfCheck(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const action = normalizeMessageAction(body?.action);
  if (!action) {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid action",
      },
      { status: 400 },
    );
  }

  try {
    if (action === "DELETE_PERMANENT") {
      const existing = await deps.getMessage({
        id,
        markRead: false,
        actorUserId: actor.userId,
      });

      if (!existing.item) {
        return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
      }

      if (existing.item.status !== "ARCHIVED") {
        return NextResponse.json(
          { ok: false, error: "Only trashed messages can be permanently deleted." },
          { status: 400 },
        );
      }

      const deleted = await deps.deleteMessage({ id });
      if (!deleted) {
        return NextResponse.json(
          { ok: false, error: "Unable to permanently delete message." },
          { status: 500 },
        );
      }

      await deps.writeAudit({
        userId: actor.userId,
        action: "CONTACT_MESSAGE_DELETED_PERMANENTLY",
        entityType: "contact_message",
        entityId: id,
        details: {
          trigger: "PATCH_ACTION",
          action,
          previousStatus: existing.item.status,
          source: deleted.sourceKey,
        },
      });

      return NextResponse.json({ ok: true, item: deleted, deleted: true });
    }

    const result = await deps.patchMessage({
      id,
      action,
      actorUserId: actor.userId,
    });

    if (!result.item) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    await deps.writeAudit({
      userId: actor.userId,
      action: "CONTACT_MESSAGE_STATUS_UPDATED",
      entityType: "contact_message",
      entityId: id,
      details: {
        trigger: "PATCH_ACTION",
        action,
        previousStatus: result.previousStatus,
        nextStatus: result.item.status,
      },
    });

    return NextResponse.json({ ok: true, item: result.item });
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

    logError("admin_message_patch_failed", error, { messageId: id, action });
    return NextResponse.json(
      { ok: false, error: "Failed to update message status." },
      { status: 500 },
    );
  }
}

export async function GET(request: Request, context: MessageRouteContext) {
  return handleAdminMessageGet(request, context);
}

export async function PATCH(request: Request, context: MessageRouteContext) {
  return handleAdminMessagePatch(request, context);
}
