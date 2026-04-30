export const USER_LIFECYCLE_STATES = [
  "setup_pending",
  "active",
  "delete_pending_external_cleanup",
] as const;

export type UserLifecycleState = (typeof USER_LIFECYCLE_STATES)[number];

export function normalizeUserLifecycleState(value: unknown): UserLifecycleState | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "setup_pending") return "setup_pending";
  if (normalized === "active") return "active";
  if (normalized === "delete_pending_external_cleanup") return "delete_pending_external_cleanup";
  return null;
}

export function lifecycleCreateConflictMessage(state: UserLifecycleState | null) {
  if (state === "setup_pending") {
    return "This email already has a setup-pending account. Complete setup or delete that pending account first.";
  }
  if (state === "delete_pending_external_cleanup") {
    return "This email is pending external cleanup and cannot be recreated yet.";
  }
  return "Email already exists";
}

export function lifecycleStatusLabel(input: {
  lifecycleState?: string | null;
  isActive?: boolean | null;
  deactivatedAt?: string | null;
  lockedAt?: string | null;
}) {
  const lifecycleState = normalizeUserLifecycleState(input.lifecycleState);
  if (lifecycleState === "setup_pending") return "Setup pending";
  if (lifecycleState === "delete_pending_external_cleanup") return "Pending external cleanup";
  if (input.isActive === false || input.deactivatedAt) return "Deactivated";
  if (input.lockedAt) return "Locked";
  return "Active";
}
