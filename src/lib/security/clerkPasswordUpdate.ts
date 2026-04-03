import { randomBytes } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";

import { dbQuery } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { isClerkEnabled } from "@/lib/security/clerk";
import {
  buildClerkUsernameCandidates,
  isClerkUsernameError,
} from "@/lib/security/clerkUsernames";

type QueryResultRow = Record<string, unknown>;
type QueryResult = { rowCount: number; rows: QueryResultRow[] };
export type PasswordQueryClient = {
  query: (sql: string, values?: unknown[]) => Promise<QueryResult>;
};

export type LocalUserForClerkPassword = {
  id: string;
  email: string;
  role: string;
  fullName: string | null;
  username: string | null;
  clerkUserId: string | null;
};

export type ClerkIdentityResolutionResult =
  | {
      ok: true;
      clerkUserId: string;
      resolution: "linked" | "matched_by_email" | "created";
      localLinkWarning?: string;
    }
  | {
      ok: false;
      status: number;
      message: string;
      clerkUserId: null;
    };

export type ClerkPasswordSyncResult =
  | {
      ok: true;
      clerkUserId: string;
    }
  | {
      ok: false;
      status: number;
      stage: "clerk" | "local";
      clerkUserId: string | null;
      message: string;
    };

type SharedPasswordUpdateDeps = {
  getClerk?: typeof clerkClient;
  hashPasswordFn?: typeof hashPassword;
  nowIso?: () => string;
  queryable?: PasswordQueryClient;
};

const defaultQueryable: PasswordQueryClient = {
  query: (sql, values = []) => dbQuery(sql, values) as Promise<QueryResult>,
};

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`"${column}"`) && message.includes("does not exist");
}

function isClerkNotFoundError(error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  const message = String((error as { message?: unknown } | null)?.message ?? "").toLowerCase();
  const details = (error as { errors?: Array<{ code?: string }> } | null)?.errors ?? [];
  return (
    status === 404 ||
    message.includes("not found") ||
    details.some((issue) => String(issue?.code ?? "").toLowerCase().includes("not_found"))
  );
}

export async function updateLegacyPasswordState({
  userId,
  passwordHash,
  queryable = defaultQueryable,
}: {
  userId: string;
  passwordHash: string;
  queryable?: PasswordQueryClient;
}) {
  const sql =
    "update users set password_hash = $2, must_change_password = false, temp_password_expires_at = null, password_updated_at = now() where id = $1";

  try {
    await queryable.query(sql, [userId, passwordHash]);
    return;
  } catch (error) {
    if (
      !isUndefinedColumn(error, "must_change_password") &&
      !isUndefinedColumn(error, "temp_password_expires_at")
    ) {
      throw error;
    }
  }

  await queryable.query("update users set password_hash = $2, password_updated_at = now() where id = $1", [
    userId,
    passwordHash,
  ]);
}

function splitName(fullName: string | null, email: string) {
  const clean = fullName?.trim() ?? "";
  if (clean) {
    const parts = clean.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      return { firstName: parts[0], lastName: "Admin" };
    }
    return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
  }

  const localPart = email.split("@")[0]?.trim() ?? "Admin";
  return { firstName: localPart.slice(0, 64), lastName: "Admin" };
}

function generateBootstrapPassword() {
  return `Ccr!${randomBytes(24).toString("base64url")}Aa9`;
}

async function linkLocalUserToClerkId({
  queryable,
  localUserId,
  clerkUserId,
}: {
  queryable: PasswordQueryClient;
  localUserId: string;
  clerkUserId: string;
}) {
  try {
    const result = await queryable.query(
      "update users set clerk_user_id = $2 where id = $1 and (clerk_user_id is null or clerk_user_id = $2)",
      [localUserId, clerkUserId],
    );
    if (result.rowCount > 0) {
      return null;
    }
    return "users.clerk_user_id is already linked to a different Clerk user. Resolve mapping manually.";
  } catch (error) {
    if (isUndefinedColumn(error, "clerk_user_id")) {
      return "users.clerk_user_id column is missing. Apply schema.sql changes and redeploy.";
    }
    throw error;
  }
}

export async function resolveOrProvisionClerkIdentityForLocalUser(
  {
    localUser,
    flow,
  }: {
    localUser: LocalUserForClerkPassword;
    flow: string;
  },
  deps: SharedPasswordUpdateDeps = {},
): Promise<ClerkIdentityResolutionResult> {
  if (!isClerkEnabled()) {
    return {
      ok: false,
      status: 503,
      message: "Clerk is not configured in this environment.",
      clerkUserId: null,
    };
  }

  const queryable = deps.queryable ?? defaultQueryable;
  const getClerk = deps.getClerk ?? clerkClient;
  const clerk = await getClerk();
  const email = localUser.email.trim().toLowerCase();
  const usernameCandidates = buildClerkUsernameCandidates({
    localUsername: localUser.username,
    email,
    localUserId: localUser.id,
  });

  let resolution: "linked" | "matched_by_email" | "created" = "linked";
  let clerkUser =
    localUser.clerkUserId?.trim()
      ? await clerk.users.getUser(localUser.clerkUserId).catch((error) => {
          if (isClerkNotFoundError(error)) {
            return null;
          }
          throw error;
        })
      : null;

  if (!clerkUser) {
    const existingByEmail = await clerk.users.getUserList({
      emailAddress: [email],
      limit: 2,
    });

    if (existingByEmail.data.length > 1) {
      return {
        ok: false,
        status: 409,
        message: "Multiple Clerk users were found for this email. Resolve the Clerk mapping manually first.",
        clerkUserId: null,
      };
    }

    clerkUser = existingByEmail.data[0] ?? null;
    if (clerkUser) {
      resolution = "matched_by_email";
    }
  }

  if (!clerkUser) {
    const { firstName, lastName } = splitName(localUser.fullName, email);
    let created:
      | Awaited<ReturnType<Awaited<ReturnType<typeof clerkClient>>["users"]["createUser"]>>
      | null = null;

    for (const candidate of [...usernameCandidates, ""]) {
      try {
        created = await clerk.users.createUser({
          emailAddress: [email],
          firstName,
          lastName,
          password: generateBootstrapPassword(),
          skipLegalChecks: true,
          ...(candidate ? { username: candidate } : {}),
          privateMetadata: {
            localUserId: localUser.id,
            localRole: localUser.role,
            authProvisionedBy: flow,
          },
        });
        break;
      } catch (error) {
        if (candidate && isClerkUsernameError(error)) {
          continue;
        }
        throw error;
      }
    }

    if (!created) {
      return {
        ok: false,
        status: 502,
        message: "Failed to provision a Clerk user for this account.",
        clerkUserId: null,
      };
    }

    clerkUser = created;
    resolution = "created";
  }

  const localLinkWarning =
    resolution === "linked"
      ? undefined
      : await linkLocalUserToClerkId({
          queryable,
          localUserId: localUser.id,
          clerkUserId: clerkUser.id,
        });

  return {
    ok: true,
    clerkUserId: clerkUser.id,
    resolution,
    ...(localLinkWarning ? { localLinkWarning } : {}),
  };
}

export async function syncPasswordWithClerkAndLocal(
  {
    localUserId,
    clerkUserId,
    password,
  }: {
    localUserId: string;
    clerkUserId: string;
    password: string;
  },
  deps: SharedPasswordUpdateDeps = {},
): Promise<ClerkPasswordSyncResult> {
  const getClerk = deps.getClerk ?? clerkClient;
  const hashPasswordFn = deps.hashPasswordFn ?? hashPassword;
  const nowIso = deps.nowIso ?? (() => new Date().toISOString());
  const queryable = deps.queryable ?? defaultQueryable;

  try {
    const clerk = await getClerk();
    const clerkUser = await clerk.users.getUser(clerkUserId);
    const currentMetadata =
      clerkUser.publicMetadata && typeof clerkUser.publicMetadata === "object"
        ? (clerkUser.publicMetadata as Record<string, unknown>)
        : {};

    await clerk.users.updateUser(clerkUserId, {
      password,
      publicMetadata: {
        ...currentMetadata,
        forcePasswordChange: false,
        tempPasswordExpiresAt: null,
        passwordChangedAt: nowIso(),
      },
    });
  } catch {
    return {
      ok: false,
      status: 502,
      stage: "clerk",
      clerkUserId,
      message: "Failed to update password in Clerk.",
    };
  }

  try {
    const passwordHash = await hashPasswordFn(password);
    await updateLegacyPasswordState({
      userId: localUserId,
      passwordHash,
      queryable,
    });
    return { ok: true, clerkUserId };
  } catch {
    return {
      ok: false,
      status: 500,
      stage: "local",
      clerkUserId,
      message:
        "Password updated in Clerk, but the local legacy password could not be synced. Clerk login will use the new password.",
    };
  }
}
