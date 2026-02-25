import { NextResponse } from "next/server";

import { requireDeveloperRole } from "@/lib/auth/adminGuards";
import {
  mergeChecklistEntries,
  normalizeDeveloperChecklistDocument,
} from "@/lib/developerChecklist";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";

const DOC_KEY = "developer_checklist";

function handleMissingTable(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code)
      : "";
  if (code === "42P01") {
    return NextResponse.json(
      {
        error: "SETTINGS_TABLE_MISSING",
        message: "Developer checklist storage is not installed. Apply schema.sql changes.",
      },
      { status: 500 },
    );
  }
  return null;
}

export async function GET() {
  const auth = await requireDeveloperRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  try {
    const result = await dbQuery<{
      content: string;
      updated_at: string;
      updated_by_email: string | null;
    }>(
      "select d.content, d.updated_at, u.email as updated_by_email from admin_documents d left join users u on u.id = d.updated_by where d.key = $1",
      [DOC_KEY],
    );

    const row = result.rows[0] ?? null;
    const parsedContent = typeof row?.content === "string" && row.content.trim()
      ? JSON.parse(row.content)
      : {};
    const normalized = normalizeDeveloperChecklistDocument(parsedContent);

    return NextResponse.json({
      doc: {
        ...normalized,
        updatedAt: row?.updated_at ?? null,
        updatedByEmail: row?.updated_by_email ?? null,
      },
    });
  } catch (error) {
    const response = handleMissingTable(error);
    if (response) return response;
    logError("api.admin.developer-checklist.GET", error, { userId: actor.userId });
    return NextResponse.json({ error: "Failed to load developer checklist." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireDeveloperRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const items = mergeChecklistEntries(body?.items);
  const generalNotes = typeof body?.generalNotes === "string" ? body.generalNotes : "";

  try {
    const result = await dbQuery<{
      content: string;
      updated_at: string;
      updated_by: string | null;
    }>(
      "insert into admin_documents (key, content, updated_by) values ($1, $2, $3) on conflict (key) do update set content = excluded.content, updated_by = excluded.updated_by, updated_at = now() returning content, updated_at, updated_by",
      [DOC_KEY, JSON.stringify({ items, generalNotes }), actor.userId],
    );

    const updatedBy = result.rows[0]?.updated_by ?? null;
    let updatedByEmail: string | null = null;
    if (updatedBy) {
      const userResult = await dbQuery<{ email: string }>("select email from users where id = $1 limit 1", [updatedBy]);
      updatedByEmail = userResult.rows[0]?.email ?? null;
    }

    return NextResponse.json({
      ok: true,
      doc: {
        items,
        generalNotes,
        updatedAt: result.rows[0]?.updated_at ?? null,
        updatedByEmail,
      },
    });
  } catch (error) {
    const response = handleMissingTable(error);
    if (response) return response;
    logError("api.admin.developer-checklist.PATCH", error, { userId: actor.userId });
    return NextResponse.json({ error: "Failed to save developer checklist." }, { status: 500 });
  }
}
