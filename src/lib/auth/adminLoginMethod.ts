import {
  ADMIN_LOGIN_METHODS,
  type AdminLoginMethod,
  DEFAULT_ADMIN_LOGIN_METHOD,
  loadAdminSettings,
  normalizeAdminLoginMethod,
} from "@/lib/adminSettings";
import { isDeveloperRole } from "@/lib/auth/roles";

const PRIMARY_ADMIN_LOGIN_PATH_BY_METHOD = {
  clerk: "/sign-in",
  legacy: "/admin/login",
} as const;

export type PrimaryAdminLoginPath =
  (typeof PRIMARY_ADMIN_LOGIN_PATH_BY_METHOD)[AdminLoginMethod];

export type PrimaryAdminLoginMethodSource = "env-override" | "db" | "default";

export type PrimaryAdminLoginMethodResolution = {
  method: AdminLoginMethod;
  source: PrimaryAdminLoginMethodSource;
};

const LOGIN_METHOD_VALUES = new Set<string>(ADMIN_LOGIN_METHODS);

export function resolvePrimaryAdminLoginMethod(
  value: unknown,
): AdminLoginMethod {
  return normalizeAdminLoginMethod(value);
}

export function resolvePrimaryAdminLoginPath(
  value: unknown,
): PrimaryAdminLoginPath {
  const method = resolvePrimaryAdminLoginMethod(value);
  return PRIMARY_ADMIN_LOGIN_PATH_BY_METHOD[method];
}

export function parseAdminLoginMethodOverride(
  value: unknown,
): AdminLoginMethod | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized || !LOGIN_METHOD_VALUES.has(normalized)) {
    return null;
  }
  return normalized as AdminLoginMethod;
}

export function resolvePrimaryAdminLoginMethodResolution(input: {
  envOverrideValue: unknown;
  dbLoginMethodValue: unknown;
  dbSource: "db" | "default";
}): PrimaryAdminLoginMethodResolution {
  const envOverride = parseAdminLoginMethodOverride(input.envOverrideValue);
  if (envOverride) {
    return { method: envOverride, source: "env-override" };
  }

  if (input.dbSource === "db") {
    return {
      method: resolvePrimaryAdminLoginMethod(input.dbLoginMethodValue),
      source: "db",
    };
  }

  return { method: DEFAULT_ADMIN_LOGIN_METHOD, source: "default" };
}

export function canUpdatePrimaryAdminLoginMethod(input: {
  actorRole: string | null | undefined;
  previousMethod: unknown;
  nextMethod: unknown;
}) {
  const previousMethod = resolvePrimaryAdminLoginMethod(input.previousMethod);
  const nextMethod = resolvePrimaryAdminLoginMethod(input.nextMethod);
  if (previousMethod === nextMethod) {
    return true;
  }
  return isDeveloperRole(input.actorRole);
}

export async function loadPrimaryAdminLoginMethod(): Promise<AdminLoginMethod> {
  const envOverrideValue = process.env.AUTH_LOGIN_METHOD_OVERRIDE;
  try {
    const { settings, source } = await loadAdminSettings();
    return resolvePrimaryAdminLoginMethodResolution({
      envOverrideValue,
      dbLoginMethodValue: settings.authLoginMethod,
      dbSource: source,
    }).method;
  } catch {
    return resolvePrimaryAdminLoginMethodResolution({
      envOverrideValue,
      dbLoginMethodValue: DEFAULT_ADMIN_LOGIN_METHOD,
      dbSource: "default",
    }).method;
  }
}

export async function loadPrimaryAdminLoginPath(): Promise<PrimaryAdminLoginPath> {
  const method = await loadPrimaryAdminLoginMethod();
  return PRIMARY_ADMIN_LOGIN_PATH_BY_METHOD[method];
}

export async function loadPrimaryAdminLoginMethodResolution(): Promise<PrimaryAdminLoginMethodResolution> {
  const envOverrideValue = process.env.AUTH_LOGIN_METHOD_OVERRIDE;
  try {
    const { settings, source } = await loadAdminSettings();
    return resolvePrimaryAdminLoginMethodResolution({
      envOverrideValue,
      dbLoginMethodValue: settings.authLoginMethod,
      dbSource: source,
    });
  } catch {
    return resolvePrimaryAdminLoginMethodResolution({
      envOverrideValue,
      dbLoginMethodValue: DEFAULT_ADMIN_LOGIN_METHOD,
      dbSource: "default",
    });
  }
}
