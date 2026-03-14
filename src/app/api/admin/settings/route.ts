import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import {
  canUpdatePrimaryAdminLoginMethod,
  evaluatePrimaryAdminLoginMethodPersistence,
} from "@/lib/auth/adminLoginMethod";
import {
  type AdminSettingsFieldErrors,
  DEFAULT_ADMIN_SETTINGS,
  normalizeAdminSettingsValue,
  validateAdminSettingsValue,
} from "@/lib/adminSettings";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";

const SETTINGS_KEY = "settings";
type AdminSettings = typeof DEFAULT_ADMIN_SETTINGS;
type RequireAdminRoleResult = Awaited<ReturnType<typeof requireAdminRole>>;

type SettingsRecordRow = {
  content: string | null;
  updated_at: string | null;
  updated_by: string | null;
  updated_by_email: string | null;
};

type AdminSettingsRouteDeps = {
  requireAdmin?: () => Promise<RequireAdminRoleResult>;
  requireCsrfCheck?: typeof requireCsrf;
  query?: typeof dbQuery;
  log?: typeof logError;
  envOverrideValue?: string | undefined;
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

async function loadSettingsRecord(query: typeof dbQuery) {
  const result = await query<SettingsRecordRow>(
    "select d.content, d.updated_at, d.updated_by, u.email as updated_by_email from admin_documents d left join users u on u.id = d.updated_by where d.key = $1",
    [SETTINGS_KEY],
  );

  return result.rows[0] ?? null;
}

function normalizeUpdatedAtToken(value: unknown) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString();
  }
  if (typeof value === "number") {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toISOString();
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString();
}

function buildConflictResponse(row: SettingsRecordRow | null) {
  return NextResponse.json(
    {
      error: "SETTINGS_CONFLICT",
      message:
        "Settings changed since you loaded this page. Latest values were reloaded. Review them and save again.",
      settings: parseStoredContent(row?.content),
      updatedAt: row?.updated_at ?? null,
      updatedByEmail: row?.updated_by_email ?? null,
    },
    { status: 409 },
  );
}

function buildValidationResponse(fieldErrors: AdminSettingsFieldErrors) {
  return NextResponse.json(
    {
      error: "SETTINGS_VALIDATION_FAILED",
      message: "Fix the highlighted settings and save again.",
      fieldErrors,
    },
    { status: 422 },
  );
}

export async function handleAdminSettingsGet(
  _request: Request,
  deps: AdminSettingsRouteDeps = {},
) {
  const requireAdmin = deps.requireAdmin ?? requireAdminRole;
  const query = deps.query ?? dbQuery;
  const logger = deps.log ?? logError;
  const auth = await requireAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const row = await loadSettingsRecord(query);
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
    logger("api.admin.settings.GET", error, { userId: auth.actor.userId });
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function handleAdminSettingsPatch(
  request: Request,
  deps: AdminSettingsRouteDeps = {},
) {
  const requireAdmin = deps.requireAdmin ?? requireAdminRole;
  const requireCsrfCheck = deps.requireCsrfCheck ?? requireCsrf;
  const query = deps.query ?? dbQuery;
  const logger = deps.log ?? logError;
  const envOverrideValue = deps.envOverrideValue ?? process.env.AUTH_LOGIN_METHOD_OVERRIDE;

  const auth = await requireAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  const body = await request.json().catch(() => null);
  if (!(await requireCsrfCheck(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }
  if (!body || typeof body !== "object" || !("settings" in body)) {
    return NextResponse.json(
      {
        error: "INVALID_SETTINGS_PAYLOAD",
        message: "Invalid settings payload.",
      },
      { status: 400 },
    );
  }
  const rawSettings = (body as { settings?: unknown }).settings;
  if (!rawSettings || typeof rawSettings !== "object" || Array.isArray(rawSettings)) {
    return NextResponse.json(
      {
        error: "INVALID_SETTINGS_PAYLOAD",
        message: "Invalid settings payload.",
      },
      { status: 400 },
    );
  }

  const baseUpdatedAt = normalizeUpdatedAtToken(
    "baseUpdatedAt" in body ? (body as { baseUpdatedAt?: unknown }).baseUpdatedAt : null,
  );
  const { settings, fieldErrors } = validateAdminSettingsValue(rawSettings);

  try {
    const currentRow = await loadSettingsRecord(query);
    const currentUpdatedAt = normalizeUpdatedAtToken(currentRow?.updated_at);

    if (currentRow) {
      if (!baseUpdatedAt || baseUpdatedAt !== currentUpdatedAt) {
        return buildConflictResponse(currentRow);
      }
    } else if (baseUpdatedAt) {
      return buildConflictResponse(currentRow);
    }

    if (Object.keys(fieldErrors).length > 0) {
      return buildValidationResponse(fieldErrors);
    }

    const existingSettings = parseStoredContent(currentRow?.content);
    const loginMethodPersistence = evaluatePrimaryAdminLoginMethodPersistence({
      envOverrideValue,
      previousMethod: existingSettings.authLoginMethod,
      nextMethod: settings.authLoginMethod,
    });

    if (!loginMethodPersistence.ok) {
      return NextResponse.json(
        {
          error: "AUTH_LOGIN_METHOD_OVERRIDE_ACTIVE",
          message:
            "Primary admin login method is locked by AUTH_LOGIN_METHOD_OVERRIDE. Remove the override to switch modes from Admin Settings.",
          effectiveMethod: loginMethodPersistence.effectiveMethod,
        },
        { status: 409 },
      );
    }

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

    const serializedSettings = JSON.stringify(settings);
    let savedRow: SettingsRecordRow | null = null;

    if (currentRow) {
      const result = await query<SettingsRecordRow>(
        `with updated as (
            update admin_documents
              set content = $2,
                  updated_by = $3,
                  updated_at = now()
            where key = $1
              and date_trunc('milliseconds', updated_at) = $4::timestamptz
          returning content, updated_at, updated_by
         )
         select updated.content, updated.updated_at, updated.updated_by, u.email as updated_by_email
           from updated
           left join users u on u.id = updated.updated_by`,
        [SETTINGS_KEY, serializedSettings, auth.actor.userId, currentUpdatedAt],
      );
      savedRow = result.rows[0] ?? null;
      if (!savedRow) {
        return buildConflictResponse(await loadSettingsRecord(query));
      }
    } else {
      const result = await query<SettingsRecordRow>(
        `with inserted as (
           insert into admin_documents (key, content, updated_by)
           values ($1, $2, $3)
           on conflict (key) do nothing
           returning content, updated_at, updated_by
         )
         select inserted.content, inserted.updated_at, inserted.updated_by, u.email as updated_by_email
           from inserted
           left join users u on u.id = inserted.updated_by`,
        [SETTINGS_KEY, serializedSettings, auth.actor.userId],
      );
      savedRow = result.rows[0] ?? null;
      if (!savedRow) {
        return buildConflictResponse(await loadSettingsRecord(query));
      }
    }

    return NextResponse.json({
      ok: true,
      settings: parseStoredContent(savedRow.content),
      updatedAt: savedRow.updated_at ?? null,
      updatedByEmail: savedRow.updated_by_email ?? null,
    });
  } catch (error) {
    const response = handleMissingTable(error);
    if (response) {
      return response;
    }
    logger("api.admin.settings.PATCH", error, { userId: auth.actor.userId });
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return handleAdminSettingsGet(request);
}

export async function PATCH(request: Request) {
  return handleAdminSettingsPatch(request);
}
