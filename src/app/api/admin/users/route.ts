import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { isDeveloperRole } from "@/lib/auth/roles";
import { dbQuery, getDbPool } from "@/lib/db";
import { isEmail, isNonEmptyString } from "@/lib/validators";
import { hashPassword } from "@/lib/auth/password";
import { writeAuditLog } from "@/lib/audit";
import { requireCsrf } from "@/lib/security/csrf";
import { isClerkUsernameError } from "@/lib/security/clerkUsernames";
import { logError, logWarn } from "@/lib/log";
import { isClerkEnabled } from "@/lib/security/clerk";
import {
  generateStandardUsernameBase,
  resolveUsernameCollision,
} from "@/lib/auth/username";

const ADMIN_CREATED_FORCE_PASSWORD_CHANGE_KEY = "forcePasswordChange";
const ADMIN_CREATED_TEMP_PASSWORD_EXPIRES_AT_KEY = "tempPasswordExpiresAt";

function generateTempPassword() {
  // Short, copy-friendly, URL-safe, and strong enough as a temporary secret.
  return randomBytes(9).toString("base64url"); // ~12 chars
}

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`\"${column}\"`) && message.includes("does not exist");
}

export type AdminUserListRow = {
  id: string;
  public_id: string | null;
  email: string;
  username: string | null;
  full_name: string | null;
  role: string;
  is_active: boolean | null;
  deactivated_at: string | null;
  locked_at: string | null;
  created_at: string;
  last_login_at: string | null;
};

export async function fetchAdminUsers(input: { q?: string } = {}) {
  const q = (input.q ?? "").trim();
  const values = q ? [`%${q}%`] : [];

  try {
    const result = await dbQuery<AdminUserListRow>(
      "select id, public_id, email, username, full_name, role, is_active, deactivated_at, locked_at, created_at, last_login_at from users" +
        (q
          ? " where (email ilike $1 or username ilike $1 or full_name ilike $1 or public_id ilike $1)"
          : "") +
        " order by created_at desc",
      values,
    );
    return result.rows;
  } catch (error) {
    if (!isUndefinedColumn(error, "public_id")) {
      throw error;
    }

    const fallback = await dbQuery<AdminUserListRow>(
      "select id, null::text as public_id, email, username, full_name, role, is_active, deactivated_at, locked_at, created_at, last_login_at from users" +
        (q ? " where (email ilike $1 or username ilike $1 or full_name ilike $1)" : "") +
        " order by created_at desc",
      values,
    );
    return fallback.rows;
  }
}

type ClerkSyncResult =
  | {
      status: "skipped";
      clerkUserId: null;
      message: string;
    }
  | {
      status: "created" | "linked_existing";
      clerkUserId: string;
      message: string;
      localLinkSaved: boolean;
      localLinkWarning?: string;
    }
  | {
      status: "failed";
      clerkUserId: null;
      message: string;
    };

export function buildAdminUserCreateSuccessPayload(input: {
  userId: string;
  userPublicId: string | null;
  username: string;
  tempPassword: string;
  tempPasswordExpiresAt: string;
  clerkSync: ClerkSyncResult;
}) {
  return {
    ok: true as const,
    userId: input.userId,
    userPublicId: input.userPublicId,
    username: input.username,
    tempPassword: input.tempPassword,
    tempPasswordExpiresAt: input.tempPasswordExpiresAt,
    clerkSync: input.clerkSync,
  };
}

type QueryClient = {
  query: (sql: string, values?: unknown[]) => Promise<{ rowCount: number }>;
};

type ClerkUsersApi = Awaited<ReturnType<typeof clerkClient>>["users"];
type ClerkEmailAddressesApi = Awaited<ReturnType<typeof clerkClient>>["emailAddresses"];

export function shouldSkipEmailChallengeForAdminCreatedUsers(input?: {
  nodeEnv?: string;
  envFlag?: string;
}) {
  const nodeEnv = input?.nodeEnv ?? process.env.NODE_ENV ?? "";
  const envFlag = input?.envFlag ?? process.env.CLERK_ADMIN_CREATED_SKIP_EMAIL_CHALLENGE ?? "";
  return nodeEnv !== "production" || envFlag === "1";
}

export function buildAdminCreatedUserPublicMetadata(input: { tempPasswordExpiresAt: string }) {
  return {
    [ADMIN_CREATED_FORCE_PASSWORD_CHANGE_KEY]: true,
    [ADMIN_CREATED_TEMP_PASSWORD_EXPIRES_AT_KEY]: input.tempPasswordExpiresAt,
  } as const;
}

type EmailAddressShape = { id?: string | null; verification?: { status?: string } | null };

export async function ensureAdminCreatedUserEmailVerification(input: {
  clerkEmailAddressesApi: Pick<ClerkEmailAddressesApi, "updateEmailAddress">;
  shouldVerify: boolean;
  primaryEmailAddressId?: string | null;
  emailAddresses?: EmailAddressShape[] | null;
}) {
  if (!input.shouldVerify) {
    return { attempted: false, verified: false };
  }

  const primaryId = input.primaryEmailAddressId?.trim();
  if (!primaryId) {
    return { attempted: true, verified: false };
  }

  const currentPrimary = (input.emailAddresses ?? []).find(
    (item) => item?.id && item.id === primaryId,
  );
  if (currentPrimary?.verification?.status === "verified") {
    return { attempted: true, verified: true };
  }

  await input.clerkEmailAddressesApi.updateEmailAddress(primaryId, { verified: true });
  return { attempted: true, verified: true };
}

async function linkLocalUserToClerkId({
  client,
  localUserId,
  clerkUserId,
}: {
  client: QueryClient;
  localUserId: string;
  clerkUserId: string;
}) {
  try {
    const linkResult = await client.query(
      "update users set clerk_user_id = $2 where id = $1 and (clerk_user_id is null or clerk_user_id = $2)",
      [localUserId, clerkUserId],
    );
    if (linkResult.rowCount > 0) {
      return { linked: true, warning: null as string | null };
    }
    return {
      linked: false,
      warning:
        "Local user was created, but users.clerk_user_id is already set to a different Clerk user. Resolve mapping manually.",
    };
  } catch (error) {
    if (isUndefinedColumn(error, "clerk_user_id")) {
      return {
        linked: false,
        warning:
          "Local user was created and Clerk user was provisioned, but users.clerk_user_id column is missing. Apply migration 020_clerk_user_mapping.sql.",
      };
    }
    throw error;
  }
}

async function resolveLocalUsernameForCreate({
  client,
  baseUsername,
}: {
  client: QueryClient;
  baseUsername: string;
}) {
  return resolveUsernameCollision(baseUsername, async (candidate) => {
    try {
      const usernameDup = await client.query(
        "select id from users where username is not null and lower(username) = lower($1) limit 1",
        [candidate],
      );
      return usernameDup.rowCount > 0;
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      const message = String((error as { message?: unknown } | null)?.message ?? "");
      if (code === "42703" && message.includes("\"username\"") && message.includes("does not exist")) {
        throw new Error("USERNAMES_NOT_CONFIGURED");
      }
      throw error;
    }
  });
}

async function resolveClerkUsernameForCreate({
  clerkUsers,
  baseUsername,
  excludeUserId,
}: {
  clerkUsers: ClerkUsersApi;
  baseUsername: string;
  excludeUserId?: string | null;
}) {
  return resolveUsernameCollision(baseUsername, async (candidate) => {
    const lookup = await clerkUsers.getUserList({
      username: [candidate],
      limit: 1,
    });
    return lookup.data.some((user) => user.id !== excludeUserId);
  });
}

async function provisionClerkUserForAdminInvite({
  email,
  preferredUsername,
  firstName,
  lastName,
  tempPassword,
  tempPasswordExpiresAt,
  role,
  localUserId,
  client,
}: {
  email: string;
  preferredUsername: string;
  firstName: string;
  lastName: string;
  tempPassword: string;
  tempPasswordExpiresAt: string;
  role: string;
  localUserId: string;
  client: QueryClient;
}): Promise<ClerkSyncResult> {
  if (!isClerkEnabled()) {
    return {
      status: "skipped",
      clerkUserId: null,
      message: "Clerk is not configured in this environment.",
    };
  }

  try {
    const clerk = await clerkClient();
    const clerkUsers = clerk.users;
    const shouldVerifyEmailForAdminCreate = shouldSkipEmailChallengeForAdminCreatedUsers();
    const existing = await clerk.users.getUserList({
      emailAddress: [email],
      limit: 1,
    });
    const existingUser = existing.data[0] ?? null;
    let clerkUserId = "";
    let status: "created" | "linked_existing" = "created";
    let finalClerkUsername = preferredUsername;

    if (!existingUser) {
      finalClerkUsername = await resolveClerkUsernameForCreate({
        clerkUsers,
        baseUsername: preferredUsername,
      });

      let created:
        | Awaited<ReturnType<Awaited<ReturnType<typeof clerkClient>>["users"]["createUser"]>>
        | null = null;
      let createError: unknown = null;

      try {
        created = await clerk.users.createUser({
          emailAddress: [email],
          firstName,
          lastName,
          password: tempPassword,
          skipLegalChecks: true,
          username: finalClerkUsername,
          publicMetadata: buildAdminCreatedUserPublicMetadata({
            tempPasswordExpiresAt,
          }),
          privateMetadata: {
            localUserId,
            localRole: role,
            authProvisionedBy: "admin-user-create",
          },
        });
      } catch (error) {
        createError = error;
        if (isClerkUsernameError(error)) {
          finalClerkUsername = await resolveClerkUsernameForCreate({
            clerkUsers,
            baseUsername: preferredUsername,
          });
          created = await clerk.users.createUser({
            emailAddress: [email],
            firstName,
            lastName,
            password: tempPassword,
            skipLegalChecks: true,
            username: finalClerkUsername,
            publicMetadata: buildAdminCreatedUserPublicMetadata({
              tempPasswordExpiresAt,
            }),
            privateMetadata: {
              localUserId,
              localRole: role,
              authProvisionedBy: "admin-user-create",
            },
          });
        } else {
          throw error;
        }
      }

      if (!created) {
        throw createError ?? new Error("Unable to create Clerk user");
      }
      clerkUserId = created.id;
      await ensureAdminCreatedUserEmailVerification({
        clerkEmailAddressesApi: clerk.emailAddresses,
        shouldVerify: shouldVerifyEmailForAdminCreate,
        primaryEmailAddressId: created.primaryEmailAddressId,
        emailAddresses: created.emailAddresses as unknown as EmailAddressShape[],
      });
    } else {
      status = "linked_existing";
      clerkUserId = existingUser.id;
      const updateBase = {
        firstName: existingUser.firstName || firstName,
        lastName: existingUser.lastName || lastName,
        privateMetadata: {
          ...existingUser.privateMetadata,
          localUserId,
          localRole: role,
          authProvisionedBy: "admin-user-link",
        },
      };
      finalClerkUsername = await resolveClerkUsernameForCreate({
        clerkUsers,
        baseUsername: preferredUsername,
        excludeUserId: existingUser.id,
      });
      await clerk.users.updateUser(clerkUserId, {
        ...updateBase,
        username: finalClerkUsername,
      });
    }

    const linkResult = await linkLocalUserToClerkId({
      client,
      localUserId,
      clerkUserId,
    });

    return {
      status,
      clerkUserId,
      message:
        status === "created"
          ? "Clerk account created and linked."
          : "Existing Clerk account linked by email.",
      localLinkSaved: linkResult.linked,
      localLinkWarning: linkResult.warning ?? undefined,
    };
  } catch (error) {
    logWarn("api.admin.users.clerkProvisioningFailed", {
      localUserId,
      email,
      code: (error as { errors?: Array<{ code?: string }> } | null)?.errors?.[0]?.code,
    });
    return {
      status: "failed",
      clerkUserId: null,
      message:
        "Local user created, but Clerk provisioning failed. Create/link this user in Clerk Dashboard and set users.clerk_user_id manually.",
    };
  }
}

export async function GET(request: Request) {
  const auth = await requireAdminRole({ forbiddenMessage: "Forbidden" });
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(request.url);
  const users = await fetchAdminUsers({ q: searchParams.get("q") ?? "" });
  return NextResponse.json({ users });
}

export async function POST(request: Request) {
  const auth = await requireAdminRole({ forbiddenMessage: "Forbidden" });
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  let firstName = typeof body?.firstName === "string" ? body.firstName.trim() : "";
  let lastName = typeof body?.lastName === "string" ? body.lastName.trim() : "";
  let fullName = typeof body?.fullName === "string" ? body.fullName.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const roleRaw = typeof body?.role === "string" ? body.role.trim().toUpperCase() : "USER";
  const role =
    roleRaw === "DEVELOPER"
      ? "DEVELOPER"
      : roleRaw === "ADMIN"
        ? "ADMIN"
        : "USER";
  if (role === "DEVELOPER" && !isDeveloperRole(actor.role)) {
    return NextResponse.json({ error: "Only developers can assign DEVELOPER role." }, { status: 403 });
  }

  if (!firstName || !lastName) {
    // Backwards-compatible parsing if older clients still send a single fullName field.
    const parts = fullName.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      firstName = firstName || parts[0];
      lastName = lastName || parts[parts.length - 1];
      fullName = fullName || parts.join(" ");
    }
  }

  if (!isNonEmptyString(firstName, 1)) {
    return NextResponse.json({ error: "firstName is required" }, { status: 400 });
  }
  if (!isNonEmptyString(lastName, 1)) {
    return NextResponse.json({ error: "lastName is required" }, { status: 400 });
  }
  if (!isEmail(email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  const emailLower = email.toLowerCase();
  const fullNameFinal = `${firstName} ${lastName}`.trim();
  const baseUsername = generateStandardUsernameBase({
    firstName,
    lastName,
    fullName: fullNameFinal,
    email: emailLower,
  });
  if (!isNonEmptyString(baseUsername, 3)) {
    return NextResponse.json(
      { error: "Invalid username. Use 3+ characters: letters, numbers, or underscore." },
      { status: 400 },
    );
  }

  // Temporary password is displayed once to the admin.
  const tempPassword = generateTempPassword();
  const passwordHash = await hashPassword(tempPassword);

  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72h

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const dup = await client.query("select id from users where lower(email) = lower($1) limit 1", [
      emailLower,
    ]);
    if (dup.rowCount > 0) {
      await client.query("rollback");
      return NextResponse.json({ error: "Email already exists" }, { status: 409 });
    }

    const usernameFinal = await (async () => {
      try {
        return await resolveLocalUsernameForCreate({
          client,
          baseUsername,
        });
      } catch (error) {
        if ((error as Error).message === "USERNAMES_NOT_CONFIGURED") {
          await client.query("rollback");
          return null;
        }
        throw error;
      }
    })();

    if (!usernameFinal) {
      return NextResponse.json(
        {
          error: "USERNAMES_NOT_CONFIGURED",
          message: "users.username column is missing. Apply schema.sql changes and redeploy.",
        },
        { status: 500 },
      );
    }

    const insert = await (async () => {
      try {
        return await client.query(
          "insert into users (email, username, full_name, password_hash, role, is_active, must_change_password, temp_password_expires_at, password_updated_at) values ($1, $2, $3, $4, $5, true, true, $6, now()) returning id, public_id",
          [emailLower, usernameFinal, fullNameFinal, passwordHash, role, expiresAt.toISOString()],
        );
      } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        const message = String((error as { message?: unknown } | null)?.message ?? "");
        if (code === "42703" && message.includes("\"username\"") && message.includes("does not exist")) {
          await client.query("rollback");
          return null;
        }
        throw error;
      }
    })();
    if (!insert) {
      return NextResponse.json(
        {
          error: "USERNAMES_NOT_CONFIGURED",
          message: "users.username column is missing. Apply schema.sql changes and redeploy.",
        },
        { status: 500 },
      );
    }
    const newUserId = String(insert.rows[0]?.id);
    const newUserPublicId = String(insert.rows[0]?.public_id ?? "").trim() || null;

    await client.query("commit");

    const clerkSync = await provisionClerkUserForAdminInvite({
      email: emailLower,
      preferredUsername: usernameFinal,
      firstName,
      lastName,
      tempPassword,
      tempPasswordExpiresAt: expiresAt.toISOString(),
      role,
      localUserId: newUserId,
      client,
    });

    await writeAuditLog({
      userId: actor.userId,
      action: "USER_CREATED",
      entityType: "user",
      entityId: newUserId,
      details: {
        role,
        email: emailLower,
        username: usernameFinal,
        clerkSyncStatus: clerkSync.status,
        clerkUserId: clerkSync.clerkUserId,
      },
    });

    return NextResponse.json(
      buildAdminUserCreateSuccessPayload({
        userId: newUserId,
        userPublicId: newUserPublicId,
        username: usernameFinal,
        tempPassword,
        tempPasswordExpiresAt: expiresAt.toISOString(),
        clerkSync,
      }),
    );
  } catch (error) {
    await client.query("rollback").catch(() => {});
    logError("api.admin.users.POST", error, { actorUserId: actor.userId, email: emailLower, role });
    return NextResponse.json({ error: "Failed to create user" }, { status: 500 });
  } finally {
    client.release();
  }
}
