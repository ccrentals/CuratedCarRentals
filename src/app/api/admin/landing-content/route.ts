import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { requireAdminRole } from "@/lib/auth/adminGuards";
import { dbQuery } from "@/lib/db";
import {
  LANDING_CONTENT_DOCUMENT_KEY,
  LANDING_CONTENT_MAX_BYTES,
  normalizeLandingContentValue,
  parseLandingContentDocument,
} from "@/lib/landingContent";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";
import { consumeRouteRateLimit, withRateLimitHeaders } from "@/lib/security/rate-limit";

const LANDING_CONTENT_LIMIT = 20;
const LANDING_CONTENT_WINDOW_SECONDS = 10 * 60;
const MAX_LANDING_CONTENT_REQUEST_BYTES = LANDING_CONTENT_MAX_BYTES + 10_000;

type LandingContentRow = {
  content: string | null;
  updated_at: string | null;
  updated_by_email: string | null;
};

function normalizeUpdatedAtToken(value: unknown) {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

async function loadLandingContentRecord() {
  const result = await dbQuery<LandingContentRow>(
    `select d.content, d.updated_at, u.email as updated_by_email
       from admin_documents d
       left join users u on u.id = d.updated_by
      where d.key = $1
      limit 1`,
    [LANDING_CONTENT_DOCUMENT_KEY],
  );
  return result.rows[0] ?? null;
}

function buildPayload(row: LandingContentRow | null, source: "db" | "default" = "db") {
  return {
    content: parseLandingContentDocument(row?.content),
    updatedAt: row?.updated_at ?? null,
    updatedByEmail: row?.updated_by_email ?? null,
    source: row?.content ? source : "default",
  };
}

function handleMissingTable(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code)
      : "";
  if (code === "42P01") {
    return NextResponse.json(
      {
        error: "LANDING_CONTENT_TABLE_MISSING",
        message: "Landing content storage is unavailable because admin_documents is missing.",
      },
      { status: 500 },
    );
  }
  return null;
}

export async function GET() {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json(buildPayload(await loadLandingContentRecord()));
  } catch (error) {
    const missing = handleMissingTable(error);
    if (missing) return missing;
    logError("api.admin.landing-content.GET", error, { userId: auth.actor.userId });
    return NextResponse.json({ error: "Failed to load landing content." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_LANDING_CONTENT_REQUEST_BYTES) {
    return NextResponse.json(
      { error: "Landing content request is too large. Reduce the amount of text or list items and try again." },
      { status: 413 },
    );
  }

  const rawBody = await request.text().catch(() => "");
  if (new TextEncoder().encode(rawBody).byteLength > MAX_LANDING_CONTENT_REQUEST_BYTES) {
    return NextResponse.json(
      { error: "Landing content request is too large. Reduce the amount of text or list items and try again." },
      { status: 413 },
    );
  }
  const body = (() => {
    try {
      return rawBody ? JSON.parse(rawBody) : null;
    } catch {
      return null;
    }
  })();
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const rateLimit = await consumeRouteRateLimit({
    scope: "ADMIN_SETTINGS_USER",
    route: "/api/admin/landing-content:patch",
    limit: LANDING_CONTENT_LIMIT,
    windowSeconds: LANDING_CONTENT_WINDOW_SECONDS,
    keyParts: [auth.actor.userId],
  });
  if (!rateLimit.allowed) {
    return withRateLimitHeaders(
      NextResponse.json(
        { error: "Too many landing content updates. Please try again later." },
        { status: 429 },
      ),
      rateLimit,
    );
  }

  if (!body || typeof body !== "object" || !("content" in body)) {
    return NextResponse.json({ error: "Invalid landing content payload." }, { status: 400 });
  }

  const nextContent = normalizeLandingContentValue((body as { content?: unknown }).content);
  const baseUpdatedAt = normalizeUpdatedAtToken(
    "baseUpdatedAt" in body ? (body as { baseUpdatedAt?: unknown }).baseUpdatedAt : null,
  );

  try {
    const currentRow = await loadLandingContentRecord();
    const currentUpdatedAt = normalizeUpdatedAtToken(currentRow?.updated_at);

    if (currentRow) {
      if (!baseUpdatedAt || baseUpdatedAt !== currentUpdatedAt) {
        return NextResponse.json(
          {
            error: "LANDING_CONTENT_CONFLICT",
            message:
              "Landing content changed since you loaded this page. Latest values were reloaded.",
            ...buildPayload(currentRow),
          },
          { status: 409 },
        );
      }
    } else if (baseUpdatedAt) {
      return NextResponse.json(
        {
          error: "LANDING_CONTENT_CONFLICT",
          message: "Landing content storage changed since you loaded this page.",
          ...buildPayload(currentRow),
        },
        { status: 409 },
      );
    }

    const serialized = JSON.stringify(nextContent);
    if (new TextEncoder().encode(serialized).byteLength > LANDING_CONTENT_MAX_BYTES) {
      return NextResponse.json(
        { error: "Landing content is too large. Reduce the amount of text or list items and try again." },
        { status: 413 },
      );
    }
    let savedRow: LandingContentRow | null = null;

    if (currentRow) {
      const result = await dbQuery<LandingContentRow>(
        `with updated as (
            update admin_documents
               set content = $2,
                   updated_by = $3,
                   updated_at = now()
             where key = $1
               and date_trunc('milliseconds', updated_at) = $4::timestamptz
          returning content, updated_at, updated_by
         )
         select updated.content, updated.updated_at, u.email as updated_by_email
           from updated
           left join users u on u.id = updated.updated_by`,
        [LANDING_CONTENT_DOCUMENT_KEY, serialized, auth.actor.userId, currentUpdatedAt],
      );
      savedRow = result.rows[0] ?? null;
      if (!savedRow) {
        const latestRow = await loadLandingContentRecord();
        return NextResponse.json(
          {
            error: "LANDING_CONTENT_CONFLICT",
            message:
              "Landing content changed while saving. Latest values were reloaded.",
            ...buildPayload(latestRow),
          },
          { status: 409 },
        );
      }
    } else {
      const result = await dbQuery<LandingContentRow>(
        `with inserted as (
           insert into admin_documents (key, content, updated_by)
           values ($1, $2, $3)
           on conflict (key) do nothing
           returning content, updated_at, updated_by
         )
         select inserted.content, inserted.updated_at, u.email as updated_by_email
           from inserted
           left join users u on u.id = inserted.updated_by`,
        [LANDING_CONTENT_DOCUMENT_KEY, serialized, auth.actor.userId],
      );
      savedRow = result.rows[0] ?? null;
      if (!savedRow) {
        const latestRow = await loadLandingContentRecord();
        return NextResponse.json(
          {
            error: "LANDING_CONTENT_CONFLICT",
            message:
              "Landing content was created by another session. Latest values were reloaded.",
            ...buildPayload(latestRow),
          },
          { status: 409 },
        );
      }
    }

    try {
      await writeAuditLog({
        userId: auth.actor.userId,
        action: "landing_content.update",
        entityType: "admin_document",
        entityId: LANDING_CONTENT_DOCUMENT_KEY,
        details: {
          updatedAt: savedRow.updated_at,
        },
      });
    } catch (auditError) {
      logError("api.admin.landing-content.audit", auditError, { userId: auth.actor.userId });
    }

    return NextResponse.json({ ok: true, ...buildPayload(savedRow) });
  } catch (error) {
    const missing = handleMissingTable(error);
    if (missing) return missing;
    logError("api.admin.landing-content.PATCH", error, { userId: auth.actor.userId });
    return NextResponse.json({ error: "Failed to save landing content." }, { status: 500 });
  }
}
