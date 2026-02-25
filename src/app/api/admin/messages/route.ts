import { NextResponse } from "next/server";

import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import {
  fetchAdminMessagesPage,
  isContactMessagesMissingTableError,
  type AdminMessagesPage,
} from "@/lib/messages/adminMessages";
import { logError } from "@/lib/log";

export type AdminMessagesListRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  getPage: (input: {
    status?: string | null;
    q?: string | null;
    sortBy?: string | null;
    sortDir?: string | null;
    limit?: unknown;
    cursor?: unknown;
  }) => Promise<AdminMessagesPage>;
};

const DEFAULT_DEPS: AdminMessagesListRouteDeps = {
  getSession: () => getSessionFromRequest(),
  getPage: (input) => fetchAdminMessagesPage(input),
};

export async function handleAdminMessagesListGet(
  request: Request,
  deps: AdminMessagesListRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireStaffOrAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);

  try {
    const page = await deps.getPage({
      status: searchParams.get("status"),
      q: searchParams.get("q"),
      sortBy: searchParams.get("sortBy"),
      sortDir: searchParams.get("sortDir"),
      limit: searchParams.get("limit"),
      cursor: searchParams.get("cursor"),
    });

    return NextResponse.json({ ok: true, ...page });
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

    logError("admin_messages_list_failed", error);
    return NextResponse.json({ ok: false, error: "Failed to load messages." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleAdminMessagesListGet(request);
}
