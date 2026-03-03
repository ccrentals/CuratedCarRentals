import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { canUpdatePrimaryAdminLoginMethod } from "@/lib/auth/adminLoginMethod";
import {
  DEFAULT_ADMIN_SETTINGS,
  normalizeAdminSettingsValue,
} from "@/lib/adminSettings";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";

const SETTINGS_KEY = "settings";
type AdminSettings = typeof DEFAULT_ADMIN_SETTINGS;

type SettingsRecordRow = {
  content: string;
  updated_at: string;
  updated_by_email: string | null;
};

function parseStoredContent(content: unknown): AdminSettings {
  if (typeof content !== "string" || !content.trim()) {
    return normalizeAdminSettingsValue({});
  }

  try {
    return normalizeAdminSettingsValue(JSON.parse(content));
  } catch {
    return normalizeAdminSettingsValue({});
  }
}

function handleMissingTable(error: unknown) {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code)
      : "";
  if (code === "42P01") {
    return NextResponse.json(
      {
        error: "SETTINGS_TABLE_MISSING",
        message: "Settings storage table is not installed. Apply schema.sql changes.",
      },
      { status: 500 },
    );
  }
  return null;
}

export async function GET() {
  const auth = await requireAdminRole();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const result = await dbQuery<SettingsRecordRow>(
      "select d.content, d.updated_at, u.email as updated_by_email from admin_documents d left join users u on u.id = d.updated_by where d.key = $1",
      [SETTINGS_KEY],
    );

    const row = result.rows[0] ?? null;
    return NextResponse.json({
      settings: parseStoredContent(row?.content),
      updatedAt: row?.updated_at ?? null,
      updatedByEmail: row?.updated_by_email ?? null,
    });
  } catch (error) {
    const response = handleMissingTable(error);
    if (response) {
      return response;
    }
    logError("api.admin.settings.GET", error, { userId: auth.actor.userId });
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdminRole();
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const settings = normalizeAdminSettingsValue(body?.settings);

  try {
    const existingResult = await dbQuery<{ content: string }>(
      "select content from admin_documents where key = $1 limit 1",
      [SETTINGS_KEY],
    );
    const existingSettings = parseStoredContent(existingResult.rows[0]?.content);

    if (
      !canUpdatePrimaryAdminLoginMethod({
        actorRole: auth.actor.role,
        previousMethod: existingSettings.authLoginMethod,
        nextMethod: settings.authLoginMethod,
      })
    ) {
      return NextResponse.json(
        {
          error: "Forbidden",
          message:
            "Only DEVELOPER users can change the primary admin login method.",
        },
        { status: 403 },
      );
    }

    const result = await dbQuery<{
      content: string;
      updated_at: string;
      updated_by: string | null;
    }>(
      "insert into admin_documents (key, content, updated_by) values ($1, $2, $3) on conflict (key) do update set content = excluded.content, updated_by = excluded.updated_by, updated_at = now() returning content, updated_at, updated_by",
      [SETTINGS_KEY, JSON.stringify(settings), auth.actor.userId],
    );

    return NextResponse.json({
      ok: true,
      settings: parseStoredContent(result.rows[0]?.content),
      updatedAt: result.rows[0]?.updated_at ?? null,
    });
  } catch (error) {
    const response = handleMissingTable(error);
    if (response) {
      return response;
    }
    logError("api.admin.settings.PATCH", error, { userId: auth.actor.userId });
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
