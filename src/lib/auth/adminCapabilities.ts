import { canAccessAdmin, isAdminRole, isDeveloperRole } from "@/lib/auth/roles";

const DEVELOPER_ONLY_ADMIN_BASE_PATHS = [
  "/admin/cron",
  "/admin/health",
  "/admin/documentation",
  "/admin/template-lab",
  "/admin/developer",
] as const;

const PRIVILEGED_ADMIN_ONLY_BASE_PATHS = [
  "/admin/messages",
  "/admin/emails",
  "/admin/payments",
  "/admin/promo-codes",
  "/admin/vehicles",
  "/admin/media",
  "/admin/maintenance",
  "/admin/depreciation",
  "/admin/reports",
  "/admin/settings",
  "/admin/users",
] as const;

function normalizeAdminPath(path: string) {
  return path.split("?")[0] ?? path;
}

export function isDeveloperOnlyAdminPath(path: string) {
  const normalized = normalizeAdminPath(path);
  return DEVELOPER_ONLY_ADMIN_BASE_PATHS.some(
    (basePath) => normalized === basePath || normalized.startsWith(`${basePath}/`),
  );
}

export function isPrivilegedAdminOnlyPath(path: string) {
  const normalized = normalizeAdminPath(path);
  return PRIVILEGED_ADMIN_ONLY_BASE_PATHS.some(
    (basePath) => normalized === basePath || normalized.startsWith(`${basePath}/`),
  );
}

export function canAccessAdminPath(role: string | null | undefined, path: string) {
  if (!canAccessAdmin(role)) return false;
  if (isPrivilegedAdminOnlyPath(path)) return isAdminRole(role);
  if (!isDeveloperOnlyAdminPath(path)) return true;
  return isDeveloperRole(role);
}

export function canAccessDeveloperAdminTools(role: string | null | undefined) {
  return isDeveloperRole(role);
}

export function canAccessPrivilegedAdminTools(role: string | null | undefined) {
  return isAdminRole(role);
}
