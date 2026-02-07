import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";

const DOC_KEY = "documentation";

function handleMissingTable(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code)
      : "";
  if (code === "42P01") {
    return NextResponse.json(
      {
        error: "DOCUMENTATION_TABLE_MISSING",
        message: "Documentation table is not installed. Apply schema.sql changes.",
      },
      { status: 500 },
    );
  }
  return null;
}

export async function GET() {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await dbQuery(
      "select d.content, d.updated_at, u.email as updated_by_email from admin_documents d left join users u on u.id = d.updated_by where d.key = $1",
      [DOC_KEY],
    );
    const doc = result.rows[0] ?? null;
    return NextResponse.json({ doc });
  } catch (error) {
    const response = handleMissingTable(error);
    if (response) return response;
    console.error("docs GET failed", error);
    return NextResponse.json({ error: "Failed to load documentation" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => null);
  const content = typeof body?.content === "string" ? body.content.trim() : "";

  if (!content) {
    return NextResponse.json({ error: "Content is required" }, { status: 400 });
  }

  try {
    const result = await dbQuery(
      "insert into admin_documents (key, content, updated_by) values ($1, $2, $3) on conflict (key) do update set content = excluded.content, updated_by = excluded.updated_by, updated_at = now() returning content, updated_at, updated_by",
      [DOC_KEY, content, session.userId],
    );

    return NextResponse.json({ doc: result.rows[0] });
  } catch (error) {
    const response = handleMissingTable(error);
    if (response) return response;
    console.error("docs PATCH failed", error);
    return NextResponse.json({ error: "Failed to update documentation" }, { status: 500 });
  }
}
