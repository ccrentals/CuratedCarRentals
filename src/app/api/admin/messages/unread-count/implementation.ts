import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import {
  getUnreadContactMessagesCount,
  isContactMessagesMissingTableError,
} from "@/lib/messages/adminMessages";
import { logError } from "@/lib/log";

export type AdminMessagesUnreadCountRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  getUnreadCount: () => Promise<number>;
};

const DEFAULT_DEPS: AdminMessagesUnreadCountRouteDeps = {
  getSession: () => getSessionFromRequest(),
  getUnreadCount: () => getUnreadContactMessagesCount(),
};

export async function handleAdminMessagesUnreadCountGet(
  _request: Request,
  deps: AdminMessagesUnreadCountRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  try {
    const count = await deps.getUnreadCount();
    return NextResponse.json({ ok: true, count });
  } catch (error) {
    if (isContactMessagesMissingTableError(error)) {
      return NextResponse.json({ ok: true, count: 0 });
    }

    logError("admin_messages_unread_count_failed", error);
    return NextResponse.json({ ok: false, error: "Failed to load unread count." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleAdminMessagesUnreadCountGet(request);
}
