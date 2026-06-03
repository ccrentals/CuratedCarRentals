import { NextResponse } from "next/server";

import {
  normalizeAdminSettingsValue,
  normalizeMinimumRentalDays,
} from "@/lib/adminSettings";
import { requireAdminRole } from "@/lib/auth/adminGuards";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";

type SettingsRow = {
  content: string | null;
};

const SETTINGS_KEY = "settings";

export const dynamic = "force-dynamic";

function parseStoredSettings(content: unknown) {
  if (typeof content !== "string" || !content.trim()) {
    return normalizeAdminSettingsValue({});
  }

  try {
    return normalizeAdminSettingsValue(JSON.parse(content));
  } catch {
    return normalizeAdminSettingsValue({});
  }
}

async function loadSettings() {
  const result = await dbQuery<SettingsRow>(
    "select content from admin_documents where key = $1 limit 1",
    [SETTINGS_KEY],
  );
  return parseStoredSettings(result.rows[0]?.content);
}

async function saveSettings(content: string, actorUserId: string | null) {
  await dbQuery(
    "insert into admin_documents (key, content, updated_by) values ($1, $2, $3::uuid) on conflict (key) do update set content = excluded.content, updated_by = excluded.updated_by, updated_at = now()",
    [SETTINGS_KEY, content, actorUserId],
  );
}

export async function GET() {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  try {
    const settings = await loadSettings();

    return NextResponse.json(
      {
        minimumRentalDays: settings.bookingMinimumRentalDays,
      },
      {
        headers: {
          "Cache-Control": "no-store",
        },
      },
    );
  } catch (error) {
    logError("api.admin.minimum-rental-days.GET", error, { userId: actor.userId });
    return NextResponse.json(
      { error: "Failed to load minimum rental days." },
      { status: 500 },
    );
  }
}

export async function PATCH(request: Request) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  try {
    const settings = await loadSettings();
    const nextMinimumRentalDays = {
      globalDefaultDays: normalizeMinimumRentalDays(body?.minimumDays),
    };

    const nextSettings = normalizeAdminSettingsValue({
      ...settings,
      bookingMinimumRentalDays: nextMinimumRentalDays,
    });
    await saveSettings(JSON.stringify(nextSettings), actor.userId);
    return NextResponse.json({
      ok: true,
      minimumRentalDays: nextSettings.bookingMinimumRentalDays,
    });
  } catch (error) {
    logError("api.admin.minimum-rental-days.PATCH", error, {
      userId: actor.userId,
    });
    return NextResponse.json(
      { error: "Failed to save minimum rental days." },
      { status: 500 },
    );
  }
}
