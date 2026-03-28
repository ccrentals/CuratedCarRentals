/**
 * Authorization source of truth:
 * - Local DB role in `users.role`
 * Identity/auth source:
 * - Clerk session (customer/account)
 * - Legacy admin cookie session or Clerk admin bridge during migration
 *
 * Clerk metadata can mirror roles in the future, but is non-authoritative for app RBAC.
 */
export const APP_ROLES = ["ADMIN", "USER", "DEVELOPER"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const ADMIN_ROLES: readonly AppRole[] = ["ADMIN", "DEVELOPER"] as const;
export type AdminAccessRequirement = "admin" | "developer";

export function normalizeRole(role: string | null | undefined) {
  return String(role ?? "")
    .trim()
    .toUpperCase();
}

export function parseAppRole(role: string | null | undefined): AppRole | null {
  const normalized = normalizeRole(role);
  return APP_ROLES.includes(normalized as AppRole) ? (normalized as AppRole) : null;
}

export function isAdminRole(role: string | null | undefined) {
  const normalized = parseAppRole(role);
  return normalized !== null && ADMIN_ROLES.includes(normalized);
}

export function isDeveloperRole(role: string | null | undefined) {
  return parseAppRole(role) === "DEVELOPER";
}

export function canAccessAdmin(role: string | null | undefined) {
  return isAdminRole(role);
}

export function canPerformAdminWrite(role: string | null | undefined) {
  return canAccessAdmin(role);
}

export function hasRequiredAdminAccess(
  role: string | null | undefined,
  requirement: AdminAccessRequirement,
) {
  if (requirement === "admin") {
    return isAdminRole(role);
  }
  return isDeveloperRole(role);
}
