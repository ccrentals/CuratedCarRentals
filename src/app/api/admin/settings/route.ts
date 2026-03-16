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
import {
  buildNotificationConfigurationHealth,
  loadNotificationOwnershipDirectory,
  loadOperationalNotificationRoutingSummary,
} from "@/lib/notifications/operationalRouting";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";

const SETTINGS_KEY = "settings";
type AdminSettings = typeof DEFAULT_ADMIN_SETTINGS;
type RequireAdminRoleResult = Awaited<ReturnType<typeof requireAdminRole>>;
type NotificationOwnershipResult = Awaited<ReturnType<typeof loadNotificationOwnershipDirectory>>;
type OperationalRoutingResult = Awaited<ReturnType<typeof loadOperationalNotificationRoutingSummary>>;
type ResolveNotificationOwnership = (
  settings: Pick<AdminSettings, "primaryAdminUserId" | "primaryDeveloperUserId">,
) => Promise<NotificationOwnershipResult>;
type ResolveOperationalRouting = (
  settings: Pick<
    AdminSettings,
    | "primaryAdminUserId"
    | "primaryDeveloperUserId"
    | "defaultOperationalNotificationEmail"
    | "additionalOperationalNotificationEmails"
  >,
  options?: Parameters<typeof loadOperationalNotificationRoutingSummary>[1],
) => Promise<OperationalRoutingResult>;

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
  resolveNotificationOwnership?: ResolveNotificationOwnership;
  resolveOperationalRouting?: ResolveOperationalRouting;
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

async function buildConflictResponse(
  row: SettingsRecordRow | null,
  input?: {
    resolveNotificationOwnership: ResolveNotificationOwnership;
    resolveOperationalRouting: ResolveOperationalRouting;
  },
) {
  const settings = parseStoredContent(row?.content);
  return NextResponse.json(
    {
      error: "SETTINGS_CONFLICT",
      message:
        "Settings changed since you loaded this page. Latest values were reloaded. Review them and save again.",
      settings,
      ...(input ? await buildSettingsPayload(settings, input) : {}),
      updatedAt: row?.updated_at ?? null,
      updatedByEmail: row?.updated_by_email ?? null,
    },
    { status: 409 },
  );
}

function buildValidationResponse(
  fieldErrors: AdminSettingsFieldErrors,
  extras?: Partial<Awaited<ReturnType<typeof buildSettingsPayload>>>,
) {
  return NextResponse.json(
    {
      error: "SETTINGS_VALIDATION_FAILED",
      message: "Fix the highlighted settings and save again.",
      fieldErrors,
      ...extras,
    },
    { status: 422 },
  );
}

function applyOwnershipFieldErrors(
  fieldErrors: AdminSettingsFieldErrors,
  ownership: NotificationOwnershipResult,
) {
  const next = { ...fieldErrors };
  if (ownership.primaryAdmin.userId && ownership.primaryAdmin.status !== "valid") {
    next.primaryAdminUserId = ownership.primaryAdmin.message;
  }
  if (ownership.primaryDeveloper.userId && ownership.primaryDeveloper.status !== "valid") {
    next.primaryDeveloperUserId = ownership.primaryDeveloper.message;
  }
  return next;
}

async function buildSettingsPayload(
  settings: AdminSettings,
  input: {
    resolveNotificationOwnership: ResolveNotificationOwnership;
    resolveOperationalRouting: ResolveOperationalRouting;
  },
) {
  const ownership = await input.resolveNotificationOwnership(settings);
  const operationalRouting = await input.resolveOperationalRouting(settings, { ownership });
  const configurationHealth = buildNotificationConfigurationHealth({
    ownership,
    routing: operationalRouting,
    warningEmailsEnabled: settings.sendVehicleInspectionWarningEmails,
  });
  return { ownership, operationalRouting, configurationHealth };
}

export async function handleAdminSettingsGet(
  _request: Request,
  deps: AdminSettingsRouteDeps = {},
) {
  const requireAdmin = deps.requireAdmin ?? requireAdminRole;
  const query = deps.query ?? dbQuery;
  const logger = deps.log ?? logError;
  const resolveNotificationOwnership =
    deps.resolveNotificationOwnership ??
    ((settings: Pick<AdminSettings, "primaryAdminUserId" | "primaryDeveloperUserId">) =>
      loadNotificationOwnershipDirectory(settings, query));
  const resolveOperationalRouting =
    deps.resolveOperationalRouting ??
    ((
      settings: Pick<
        AdminSettings,
        | "primaryAdminUserId"
        | "primaryDeveloperUserId"
        | "defaultOperationalNotificationEmail"
        | "additionalOperationalNotificationEmails"
      >,
      options?: Parameters<typeof loadOperationalNotificationRoutingSummary>[1],
    ) =>
      loadOperationalNotificationRoutingSummary(settings, { query, ...options }));
  const auth = await requireAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const row = await loadSettingsRecord(query);
    const settings = parseStoredContent(row?.content);
    const { ownership, operationalRouting } = await buildSettingsPayload(settings, {
      resolveNotificationOwnership,
      resolveOperationalRouting,
    });
    return NextResponse.json({
      settings,
      ownership,
      operationalRouting,
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
  const resolveNotificationOwnership =
    deps.resolveNotificationOwnership ??
    ((settings: Pick<AdminSettings, "primaryAdminUserId" | "primaryDeveloperUserId">) =>
      loadNotificationOwnershipDirectory(settings, query));
  const resolveOperationalRouting =
    deps.resolveOperationalRouting ??
    ((
      settings: Pick<
        AdminSettings,
        | "primaryAdminUserId"
        | "primaryDeveloperUserId"
        | "defaultOperationalNotificationEmail"
        | "additionalOperationalNotificationEmails"
      >,
      options?: Parameters<typeof loadOperationalNotificationRoutingSummary>[1],
    ) =>
      loadOperationalNotificationRoutingSummary(settings, { query, ...options }));

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
  const validation = validateAdminSettingsValue(rawSettings);
  const settings = validation.settings;

  try {
    const currentRow = await loadSettingsRecord(query);
    const currentUpdatedAt = normalizeUpdatedAtToken(currentRow?.updated_at);

    if (currentRow) {
      if (!baseUpdatedAt || baseUpdatedAt !== currentUpdatedAt) {
        return buildConflictResponse(currentRow, {
          resolveNotificationOwnership,
          resolveOperationalRouting,
        });
      }
    } else if (baseUpdatedAt) {
      return buildConflictResponse(currentRow, {
        resolveNotificationOwnership,
        resolveOperationalRouting,
      });
    }

    const ownership = await resolveNotificationOwnership(settings);
    const operationalRouting = await resolveOperationalRouting(settings, { ownership });
    const fieldErrors = applyOwnershipFieldErrors(validation.fieldErrors, ownership);

    if (
      settings.sendVehicleInspectionWarningEmails &&
      operationalRouting.effectiveRecipients.length === 0
    ) {
      fieldErrors.sendVehicleInspectionWarningEmails =
        "Enable vehicle inspection warning emails only after at least one valid operational recipient resolves.";
    }

    if (Object.keys(fieldErrors).length > 0) {
      return buildValidationResponse(fieldErrors, {
        ownership,
        operationalRouting,
        configurationHealth: buildNotificationConfigurationHealth({
          ownership,
          routing: operationalRouting,
          warningEmailsEnabled: settings.sendVehicleInspectionWarningEmails,
        }),
      });
    }

    const existingSettings = parseStoredContent(currentRow?.content);
    const isPrimaryDeveloperChanged =
      existingSettings.primaryDeveloperUserId !== settings.primaryDeveloperUserId;

    if (isPrimaryDeveloperChanged && auth.actor.appRole !== "DEVELOPER") {
      return NextResponse.json(
        {
          error: "Forbidden",
          message: "Only DEVELOPER users can change the primary developer account.",
        },
        { status: 403 },
      );
    }

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
        return buildConflictResponse(await loadSettingsRecord(query), {
          resolveNotificationOwnership,
          resolveOperationalRouting,
        });
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
        return buildConflictResponse(await loadSettingsRecord(query), {
          resolveNotificationOwnership,
          resolveOperationalRouting,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      settings: parseStoredContent(savedRow.content),
      ...(await buildSettingsPayload(parseStoredContent(savedRow.content), {
        resolveNotificationOwnership,
        resolveOperationalRouting,
      })),
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
