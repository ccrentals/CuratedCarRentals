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

export const STAFF_ROLES = APP_ROLES;
export const ADMIN_ROLES: readonly AppRole[] = ["ADMIN", "DEVELOPER"] as const;

export type AdminAccessRequirement = "staff" | "admin" | "developer";

export function normalizeRole(role: string | null | undefined) {
  return String(role ?? "")
    .trim()
    .toUpperCase();
}

export function parseAppRole(role: string | null | undefined): AppRole | null {
  const normalized = normalizeRole(role);
  return APP_ROLES.includes(normalized as AppRole) ? (normalized as AppRole) : null;
}

export function isStaffRole(role: string | null | undefined) {
  return parseAppRole(role) !== null;
}

export function isAdminRole(role: string | null | undefined) {
  const normalized = parseAppRole(role);
  return normalized === "ADMIN" || normalized === "DEVELOPER";
}

export function isDeveloperRole(role: string | null | undefined) {
  return parseAppRole(role) === "DEVELOPER";
}

export function canAccessAdmin(role: string | null | undefined) {
  return isStaffRole(role);
}

/**
 * Current model allows all staff roles to perform operational admin writes.
 * Endpoint-specific guards can still require stronger roles (`admin` or `developer`).
 */
export function canPerformAdminWrite(role: string | null | undefined) {
  return isStaffRole(role);
}

export function hasRequiredAdminAccess(
  role: string | null | undefined,
  requirement: AdminAccessRequirement,
) {
  if (requirement === "staff") {
    return canAccessAdmin(role);
  }
  if (requirement === "admin") {
    return isAdminRole(role);
  }
  return isDeveloperRole(role);
}
