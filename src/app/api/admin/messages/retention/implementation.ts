import { NextResponse } from "next/server";

import { requireAdminAccess } from "@/lib/auth/adminGuards";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";

export type AdminMessagesRetentionRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
};

const DEFAULT_DEPS: AdminMessagesRetentionRouteDeps = {
  getSession: () => getSessionFromRequest(),
};

export async function handleAdminMessagesRetentionPost(
  request?: Request,
  deps: AdminMessagesRetentionRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminAccess({ getSession: deps.getSession });
  if (!auth.ok) {
    return auth.response;
  }

  void request;
  return NextResponse.json(
    {
      ok: false,
      error: "Manual Trash workflow is enabled. Automatic 30-day trash is disabled.",
    },
    { status: 410 },
  );
}

export async function POST(request: Request) {
  return handleAdminMessagesRetentionPost(request);
}
