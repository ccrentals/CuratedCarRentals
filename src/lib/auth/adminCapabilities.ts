import { isAdminRole, isDeveloperRole } from "@/lib/auth/roles";

const DEVELOPER_ONLY_ADMIN_BASE_PATHS = [
  "/admin/cron",
  "/admin/health",
  "/admin/documentation",
  "/admin/template-lab",
  "/admin/developer",
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

export function canAccessAdminPath(role: string | null | undefined, path: string) {
  if (!isAdminRole(role)) return false;
  if (!isDeveloperOnlyAdminPath(path)) return true;
  return isDeveloperRole(role);
}

export function canAccessDeveloperAdminTools(role: string | null | undefined) {
  return isDeveloperRole(role);
}
