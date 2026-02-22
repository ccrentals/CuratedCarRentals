import { NextResponse } from "next/server";

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
  const session = await deps.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

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
