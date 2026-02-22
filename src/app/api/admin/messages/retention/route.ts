import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { requireCsrf } from "@/lib/security/csrf";
import { logError } from "@/lib/log";

const RETENTION_DAYS = 30;

function isAdminRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER";
}

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
  const session = await deps.getSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminRole(session.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!(await deps.requireCsrfCheck(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  try {
    const result = await deps.runRetention(RETENTION_DAYS);

    await deps.writeAudit({
      userId: session.userId,
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
      userId: session.userId,
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
