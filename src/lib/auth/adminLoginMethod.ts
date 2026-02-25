import {
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
  try {
    const { settings } = await loadAdminSettings();
    return resolvePrimaryAdminLoginMethod(settings.authLoginMethod);
  } catch {
    return DEFAULT_ADMIN_LOGIN_METHOD;
  }
}

export async function loadPrimaryAdminLoginPath(): Promise<PrimaryAdminLoginPath> {
  const method = await loadPrimaryAdminLoginMethod();
  return PRIMARY_ADMIN_LOGIN_PATH_BY_METHOD[method];
}
