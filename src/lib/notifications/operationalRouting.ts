import type { AdminSettings } from "@/lib/adminSettings";
import { parseAppRole } from "@/lib/auth/roles";
import { dbQuery } from "@/lib/db";

type DbQueryFn = typeof dbQuery;

type NotificationOwnershipUserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  username: string | null;
  role: string | null;
  is_active: boolean | null;
  deactivated_at: string | null;
  locked_at: string | null;
};

export type NotificationOwnershipRole = "ADMIN" | "DEVELOPER";
export type NotificationOwnershipKind = "primaryAdmin" | "primaryDeveloper";
export type NotificationOwnershipStatus = "missing" | "valid" | "not_found" | "inactive" | "wrong_role";

export type NotificationOwnershipOption = {
  id: string;
  email: string | null;
  fullName: string | null;
  username: string | null;
  role: string | null;
  roleLabel: string;
  label: string;
};

export type NotificationOwnershipResolution = {
  kind: NotificationOwnershipKind;
  userId: string | null;
  status: NotificationOwnershipStatus;
  email: string | null;
  fullName: string | null;
  username: string | null;
  role: string | null;
  roleLabel: string;
  label: string;
  isLocked: boolean;
  message: string;
};

export type NotificationOwnershipDirectory = {
  primaryAdmin: NotificationOwnershipResolution;
  primaryDeveloper: NotificationOwnershipResolution;
  primaryAdminOptions: NotificationOwnershipOption[];
  primaryDeveloperOptions: NotificationOwnershipOption[];
};

export type OperationalNotificationRecipientSource =
  | "configured-default"
  | "configured-additional"
  | "primary-admin"
  | "primary-developer"
  | "env-admin-notify"
  | "env-internal-notes";

export type OperationalNotificationRecipient = {
  email: string;
  source: OperationalNotificationRecipientSource;
  label: string;
};

export type OperationalNotificationRoutingSummary = {
  configuredRecipients: string[];
  effectiveRecipients: string[];
  recipients: OperationalNotificationRecipient[];
  hasConfiguredRecipients: boolean;
  usesFallback: boolean;
  warnings: string[];
};

export type NotificationConfigurationHealth = {
  status: "ready" | "needs-review";
  warnings: string[];
};

function normalizeNullableId(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function normalizeEmailAddress(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized : null;
}

function isValidEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function splitEmails(value: unknown) {
  const rawList = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;\n]/)
      : [];

  return rawList
    .map((entry) => normalizeEmailAddress(entry))
    .filter((entry): entry is string => Boolean(entry))
    .filter((entry) => isValidEmailAddress(entry));
}

function isLifecycleActiveUser(row: Pick<NotificationOwnershipUserRow, "is_active" | "deactivated_at">) {
  return row.is_active !== false && !row.deactivated_at;
}

function isEligibleForOwnership(kind: NotificationOwnershipKind, role: string | null | undefined) {
  const normalized = parseAppRole(role);
  if (kind === "primaryAdmin") {
    return normalized === "ADMIN" || normalized === "DEVELOPER";
  }
  return normalized === "DEVELOPER";
}

function toRoleLabel(role: string | null | undefined) {
  const normalized = parseAppRole(role);
  if (normalized === "ADMIN") return "Admin";
  if (normalized === "DEVELOPER") return "Developer";
  if (normalized === "OPERATIONS") return "Operations";
  return "Unknown role";
}

function buildDisplayName(row: Pick<NotificationOwnershipUserRow, "full_name" | "email" | "username">) {
  return row.full_name?.trim() || row.email?.trim() || row.username?.trim() || "Unnamed user";
}

function buildOptionLabel(row: NotificationOwnershipUserRow) {
  const name = buildDisplayName(row);
  const email = row.email?.trim();
  const details = email && email !== name ? `${name} (${email})` : name;
  return `${details} — ${toRoleLabel(row.role)}`;
}

function buildMissingResolution(kind: NotificationOwnershipKind): NotificationOwnershipResolution {
  return {
    kind,
    userId: null,
    status: "missing",
    email: null,
    fullName: null,
    username: null,
    role: null,
    roleLabel: "Not set",
    label: "Not selected",
    isLocked: false,
    message:
      kind === "primaryAdmin"
        ? "No primary admin account selected."
        : "No primary developer account selected.",
  };
}

function buildResolution(
  kind: NotificationOwnershipKind,
  userId: string | null,
  row: NotificationOwnershipUserRow | null,
): NotificationOwnershipResolution {
  if (!userId) {
    return buildMissingResolution(kind);
  }

  if (!row) {
    return {
      kind,
      userId,
      status: "not_found",
      email: null,
      fullName: null,
      username: null,
      role: null,
      roleLabel: "Unavailable",
      label: `Missing user (${userId.slice(0, 8)})`,
      isLocked: false,
      message:
        kind === "primaryAdmin"
          ? "The selected primary admin account no longer exists."
          : "The selected primary developer account no longer exists.",
    };
  }

  const label = buildOptionLabel(row);
  const base = {
    kind,
    userId,
    email: row.email?.trim() || null,
    fullName: row.full_name?.trim() || null,
    username: row.username?.trim() || null,
    role: row.role?.trim() || null,
    roleLabel: toRoleLabel(row.role),
    label,
    isLocked: Boolean(row.locked_at),
  };

  if (!isLifecycleActiveUser(row)) {
    return {
      ...base,
      status: "inactive",
      message:
        kind === "primaryAdmin"
          ? "The selected primary admin account is inactive."
          : "The selected primary developer account is inactive.",
    };
  }

  if (!isEligibleForOwnership(kind, row.role)) {
    return {
      ...base,
      status: "wrong_role",
      message:
        kind === "primaryAdmin"
          ? "Primary admin must be an active ADMIN or DEVELOPER account."
          : "Primary developer must be an active DEVELOPER account.",
    };
  }

  return {
    ...base,
    status: "valid",
    message:
      kind === "primaryAdmin"
        ? "Primary admin account is valid."
        : "Primary developer account is valid.",
  };
}

function mapOption(row: NotificationOwnershipUserRow): NotificationOwnershipOption {
  return {
    id: row.id,
    email: row.email?.trim() || null,
    fullName: row.full_name?.trim() || null,
    username: row.username?.trim() || null,
    role: row.role?.trim() || null,
    roleLabel: toRoleLabel(row.role),
    label: buildOptionLabel(row),
  };
}

export async function loadNotificationOwnershipDirectory(
  settings: Pick<AdminSettings, "primaryAdminUserId" | "primaryDeveloperUserId">,
  query: DbQueryFn = dbQuery,
): Promise<NotificationOwnershipDirectory> {
  const primaryAdminUserId = normalizeNullableId(settings.primaryAdminUserId);
  const primaryDeveloperUserId = normalizeNullableId(settings.primaryDeveloperUserId);
  const selectedIds = [primaryAdminUserId, primaryDeveloperUserId].filter(
    (value): value is string => Boolean(value),
  );

  const optionsResult = await query<NotificationOwnershipUserRow>(
    `select id, email, full_name, username, role, is_active, deactivated_at, locked_at
       from users
      where coalesce(is_active, true) = true
        and deactivated_at is null
        and role in ('ADMIN', 'DEVELOPER')
      order by
        case upper(role)
          when 'DEVELOPER' then 0
          when 'ADMIN' then 1
          else 2
        end,
        lower(coalesce(full_name, email, username, '')) asc,
        lower(coalesce(email, '')) asc`,
  );

  const selectedRowsById = new Map<string, NotificationOwnershipUserRow>();
  if (selectedIds.length > 0) {
    const selectedResult = await query<NotificationOwnershipUserRow>(
      `select id, email, full_name, username, role, is_active, deactivated_at, locked_at
         from users
        where id = any($1::uuid[])`,
      [selectedIds],
    );
    for (const row of selectedResult.rows) {
      selectedRowsById.set(row.id, row);
    }
  }

  const activeOptions = optionsResult.rows.map(mapOption);
  return {
    primaryAdmin: buildResolution(
      "primaryAdmin",
      primaryAdminUserId,
      primaryAdminUserId ? selectedRowsById.get(primaryAdminUserId) ?? null : null,
    ),
    primaryDeveloper: buildResolution(
      "primaryDeveloper",
      primaryDeveloperUserId,
      primaryDeveloperUserId ? selectedRowsById.get(primaryDeveloperUserId) ?? null : null,
    ),
    primaryAdminOptions: activeOptions.filter((option: NotificationOwnershipOption) => {
      const normalized = parseAppRole(option.role);
      return normalized === "ADMIN" || normalized === "DEVELOPER";
    }),
    primaryDeveloperOptions: activeOptions.filter(
      (option: NotificationOwnershipOption) => parseAppRole(option.role) === "DEVELOPER",
    ),
  };
}

export async function loadOperationalNotificationRoutingSummary(
  settings: Pick<
    AdminSettings,
    | "primaryAdminUserId"
    | "primaryDeveloperUserId"
    | "defaultOperationalNotificationEmail"
    | "additionalOperationalNotificationEmails"
  >,
  options: {
    query?: DbQueryFn;
    ownership?: NotificationOwnershipDirectory;
    adminNotifyEmailsEnv?: string | undefined;
    internalNotesEmailEnv?: string | undefined;
  } = {},
): Promise<OperationalNotificationRoutingSummary> {
  const query = options.query ?? dbQuery;
  const ownership =
    options.ownership ??
    (await loadNotificationOwnershipDirectory(
      {
        primaryAdminUserId: settings.primaryAdminUserId,
        primaryDeveloperUserId: settings.primaryDeveloperUserId,
      },
      query,
    ));

  const configuredDefault = splitEmails(settings.defaultOperationalNotificationEmail);
  const configuredAdditional = splitEmails(settings.additionalOperationalNotificationEmails);
  const configuredRecipients = [...new Set([...configuredDefault, ...configuredAdditional])];
  const recipients: OperationalNotificationRecipient[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  function pushRecipient(
    email: string | null,
    source: OperationalNotificationRecipientSource,
    label: string,
  ) {
    if (!email || !isValidEmailAddress(email) || seen.has(email)) return;
    seen.add(email);
    recipients.push({ email, source, label });
  }

  for (const email of configuredDefault) {
    pushRecipient(email, "configured-default", "Default operational email");
  }
  for (const email of configuredAdditional) {
    pushRecipient(email, "configured-additional", "Additional operational recipient");
  }

  if (recipients.length === 0) {
    if (ownership.primaryAdmin.status === "valid") {
      pushRecipient(
        normalizeEmailAddress(ownership.primaryAdmin.email),
        "primary-admin",
        "Primary admin fallback",
      );
    } else if (ownership.primaryAdmin.userId) {
      warnings.push(ownership.primaryAdmin.message);
    }

    if (recipients.length === 0) {
      if (ownership.primaryDeveloper.status === "valid") {
        pushRecipient(
          normalizeEmailAddress(ownership.primaryDeveloper.email),
          "primary-developer",
          "Primary developer fallback",
        );
      } else if (ownership.primaryDeveloper.userId) {
        warnings.push(ownership.primaryDeveloper.message);
      }
    }

    if (recipients.length === 0) {
      for (const email of splitEmails(options.adminNotifyEmailsEnv ?? process.env.ADMIN_NOTIFY_EMAILS)) {
        pushRecipient(email, "env-admin-notify", "ADMIN_NOTIFY_EMAILS fallback");
      }
    }

    if (recipients.length === 0) {
      for (const email of splitEmails(options.internalNotesEmailEnv ?? process.env.INTERNAL_NOTES_EMAIL)) {
        pushRecipient(email, "env-internal-notes", "INTERNAL_NOTES_EMAIL fallback");
      }
    }
  }

  if (recipients.length === 0) {
    warnings.push("No valid operational notification recipients are configured.");
  }

  return {
    configuredRecipients,
    effectiveRecipients: recipients.map((recipient) => recipient.email),
    recipients,
    hasConfiguredRecipients: configuredRecipients.length > 0,
    usesFallback: configuredRecipients.length === 0 && recipients.length > 0,
    warnings,
  };
}

export function buildNotificationConfigurationHealth(input: {
  ownership: NotificationOwnershipDirectory;
  routing: OperationalNotificationRoutingSummary;
  warningEmailsEnabled?: boolean;
}): NotificationConfigurationHealth {
  const warnings: string[] = [];
  const seen = new Set<string>();

  function pushWarning(value: string | null | undefined) {
    const normalized = value?.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    warnings.push(normalized);
  }

  for (const resolution of [input.ownership.primaryAdmin, input.ownership.primaryDeveloper]) {
    if (resolution.status !== "valid") {
      pushWarning(resolution.message);
      continue;
    }

    if (resolution.isLocked) {
      pushWarning(
        resolution.kind === "primaryAdmin"
          ? "Primary admin account is locked. Review the ownership assignment before relying on fallback delivery."
          : "Primary developer account is locked. Review the ownership assignment before relying on developer fallback delivery.",
      );
    }

    if (!normalizeEmailAddress(resolution.email)) {
      pushWarning(
        resolution.kind === "primaryAdmin"
          ? "Primary admin account does not have a valid email address for notification fallback."
          : "Primary developer account does not have a valid email address for notification fallback.",
      );
    }
  }

  for (const warning of input.routing.warnings) {
    pushWarning(warning);
  }

  if (input.warningEmailsEnabled && input.routing.effectiveRecipients.length === 0) {
    pushWarning(
      "Enable vehicle inspection warning emails only after at least one valid operational recipient resolves.",
    );
  }

  return {
    status: warnings.length === 0 ? "ready" : "needs-review",
    warnings,
  };
}
