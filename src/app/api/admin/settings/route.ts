import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { DEFAULT_ADMIN_SETTINGS } from "@/lib/adminSettings";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";

const SETTINGS_KEY = "settings";
type AdminSettings = typeof DEFAULT_ADMIN_SETTINGS;

function normalizeDayViewBookingLimit(value: unknown): number | "all" {
  if (value === "all") return "all";
  if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 50) {
    return value;
  }
  if (typeof value === "string" && value.trim()) {
    const normalized = value.trim().toLowerCase();
    if (normalized === "all") return "all";
    const parsed = Number(normalized);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 50) {
      return parsed;
    }
  }
  return DEFAULT_ADMIN_SETTINGS.dayViewBookingLimit;
}

function isAdminRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER";
}

function normalizeSettings(raw: unknown): AdminSettings {
  if (typeof raw !== "object" || raw === null) {
    return { ...DEFAULT_ADMIN_SETTINGS };
  }

  const value = raw as Record<string, unknown>;
  const next: AdminSettings = { ...DEFAULT_ADMIN_SETTINGS };

  for (const key of Object.keys(DEFAULT_ADMIN_SETTINGS) as Array<keyof AdminSettings>) {
    if (key === "dayViewBookingLimit") {
      continue;
    }
    if (typeof value[key] === "boolean") {
      next[key] = value[key] as boolean;
    }
  }
  next.dayViewBookingLimit = normalizeDayViewBookingLimit(value.dayViewBookingLimit);

  return next;
}

function parseStoredContent(content: unknown): AdminSettings {
  if (typeof content !== "string" || !content.trim()) {
    return { ...DEFAULT_ADMIN_SETTINGS };
  }

  try {
    return normalizeSettings(JSON.parse(content));
  } catch {
    return { ...DEFAULT_ADMIN_SETTINGS };
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
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await dbQuery<{
      content: string;
      updated_at: string;
      updated_by_email: string | null;
    }>(
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
    if (response) return response;
    logError("api.admin.settings.GET", error, { userId: session.userId });
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAdminRole(session.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const settings = normalizeSettings(body?.settings);

  try {
    const result = await dbQuery<{
      content: string;
      updated_at: string;
      updated_by: string | null;
    }>(
      "insert into admin_documents (key, content, updated_by) values ($1, $2, $3) on conflict (key) do update set content = excluded.content, updated_by = excluded.updated_by, updated_at = now() returning content, updated_at, updated_by",
      [SETTINGS_KEY, JSON.stringify(settings), session.userId],
    );

    return NextResponse.json({
      ok: true,
      settings: parseStoredContent(result.rows[0]?.content),
      updatedAt: result.rows[0]?.updated_at ?? null,
    });
  } catch (error) {
    const response = handleMissingTable(error);
    if (response) return response;
    logError("api.admin.settings.PATCH", error, { userId: session.userId });
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}
