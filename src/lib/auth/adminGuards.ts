import { NextResponse } from "next/server";

import { type AdminAccessRequirement, hasRequiredAdminAccess, parseAppRole } from "@/lib/auth/roles";
import { type AdminSession, getSessionFromRequest } from "@/lib/auth/session";

export type AdminActor = {
  userId: string;
  role: string;
  appRole: ReturnType<typeof parseAppRole>;
  authSource: "legacy" | "clerk-bridge";
  clerkUserId: string | null;
  issuedAt: number;
  expiresAt: number;
};

type GuardFailureReason = "unauthorized" | "forbidden";
type ErrorResponseFormat = "json" | "text";

export type ResolveAdminActorResult =
  | { ok: true; session: AdminSession; actor: AdminActor }
  | { ok: false; reason: GuardFailureReason; session: AdminSession | null; actor: AdminActor | null };

export type RequireAdminGuardOptions = {
  requirement?: AdminAccessRequirement;
  getSession?: () => Promise<AdminSession | null>;
  unauthorizedMessage?: string;
  forbiddenMessage?: string;
  responseFormat?: ErrorResponseFormat;
};

export type RequireAdminApiSessionResult =
  | { ok: true; session: AdminSession; actor: AdminActor }
  | { ok: false; reason: GuardFailureReason; response: Response };

function mapAuthSource(session: AdminSession): AdminActor["authSource"] {
  return session.source === "clerk" ? "clerk-bridge" : "legacy";
}

function makeErrorResponse(
  reason: GuardFailureReason,
  {
    responseFormat = "json",
    unauthorizedMessage = "Unauthorized",
    forbiddenMessage = "Forbidden",
  }: Omit<RequireAdminGuardOptions, "getSession" | "requirement"> = {},
) {
  const status = reason === "unauthorized" ? 401 : 403;
  const message = reason === "unauthorized" ? unauthorizedMessage : forbiddenMessage;

  if (responseFormat === "text") {
    return new Response(message, { status });
  }

  return NextResponse.json({ ok: false, error: message }, { status });
}

export function toAdminActor(session: AdminSession): AdminActor {
  return {
    userId: session.userId,
    role: session.role,
    appRole: parseAppRole(session.role),
    authSource: mapAuthSource(session),
    clerkUserId: session.clerkUserId ?? null,
    issuedAt: session.issuedAt,
    expiresAt: session.expiresAt,
  };
}

export async function resolveAdminActor({
  requirement = "admin",
  // Use `any-local-user` so non-admin Clerk-mapped users get a proper 403 instead of 401.
  getSession = () => getSessionFromRequest({ clerkBridgeMode: "any-local-user" }),
}: Pick<RequireAdminGuardOptions, "requirement" | "getSession"> = {}): Promise<ResolveAdminActorResult> {
  const session = await getSession();
  if (!session) {
    return { ok: false, reason: "unauthorized", session: null, actor: null };
  }

  const actor = toAdminActor(session);
  if (!hasRequiredAdminAccess(actor.role, requirement)) {
    return { ok: false, reason: "forbidden", session, actor };
  }

  return { ok: true, session, actor };
}

export async function requireAdminApiSession(
  options: RequireAdminGuardOptions = {},
): Promise<RequireAdminApiSessionResult> {
  const result = await resolveAdminActor(options);
  if (result.ok) {
    return result;
  }

  return {
    ok: false,
    reason: result.reason,
    response: makeErrorResponse(result.reason, options),
  };
}

export async function requireAdminAccess(
  options: Omit<RequireAdminGuardOptions, "requirement"> = {},
) {
  return requireAdminApiSession({ ...options, requirement: "admin" });
}

export async function requireAdminRole(
  options: Omit<RequireAdminGuardOptions, "requirement"> = {},
) {
  return requireAdminApiSession({ ...options, requirement: "admin" });
}

export async function requireDeveloperRole(
  options: Omit<RequireAdminGuardOptions, "requirement"> = {},
) {
  return requireAdminApiSession({ ...options, requirement: "developer" });
}
