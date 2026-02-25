import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { writeAuditLog } from "@/lib/audit";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { logError } from "@/lib/log";

const RETENTION_DAYS = 30;

export type AdminMessagesRetentionRouteDeps = {
  getSession: () => Promise<AdminSession | null>;
  requireCsrfCheck: (request: Request, bodyToken?: string | null) => Promise<boolean>;
  runRetention: (olderThanDays: number) => Promise<{ updatedCount: number }>;
  writeAudit: (input: {
    userId?: string | null;
    action: string;
    entityType: string;
    details?: Record<string, unknown>;
  }) => Promise<void>;
};

const DEFAULT_DEPS: AdminMessagesRetentionRouteDeps = {
  getSession: () => getSessionFromRequest(),
  requireCsrfCheck: (request, bodyToken) => requireCsrf(request, bodyToken),
  runRetention: async (olderThanDays) => {
    const result = await dbQuery<{ id: string }>(
      "update contact_messages set status = 'ARCHIVED' where status = 'READ' and coalesce(read_at, created_at) < now() - make_interval(days => $1::int) returning id",
      [olderThanDays],
    );

    return {
      updatedCount: result.rows.length,
    };
  },
  writeAudit: (input) => writeAuditLog(input),
};

export async function handleAdminMessagesRetentionPost(
  request: Request,
  deps: AdminMessagesRetentionRouteDeps = DEFAULT_DEPS,
) {
  const auth = await requireAdminRole({ getSession: deps.getSession });
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = await request.json().catch(() => null);
  if (!(await deps.requireCsrfCheck(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  try {
    const result = await deps.runRetention(RETENTION_DAYS);

    await deps.writeAudit({
      userId: actor.userId,
      action: "CONTACT_MESSAGES_RETENTION_ARCHIVE_RUN",
      entityType: "contact_message",
      details: {
        updatedCount: result.updatedCount,
        olderThanDays: RETENTION_DAYS,
      },
    });

    return NextResponse.json({
      ok: true,
      updatedCount: result.updatedCount,
      olderThanDays: RETENTION_DAYS,
    });
  } catch (error) {
    logError("admin_messages_retention_failed", error, {
      userId: actor.userId,
      olderThanDays: RETENTION_DAYS,
    });
    return NextResponse.json(
      { ok: false, error: "Failed to run retention archive." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return handleAdminMessagesRetentionPost(request);
}
