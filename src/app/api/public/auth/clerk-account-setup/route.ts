import { NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { clerkClient } from "@clerk/nextjs/server";

import { parseAppRole } from "@/lib/auth/roles";
import { dbQuery } from "@/lib/db";
import { logWarn } from "@/lib/log";
import { isClerkEnabled } from "@/lib/security/clerk";
import {
  categorizeTurnstileFailure,
  extractTurnstileToken,
  getClientIpFromRequest,
  verifyTurnstileToken,
} from "@/lib/security/turnstile";
import { buildClerkUsernameCandidates, isClerkUsernameError } from "@/lib/security/clerkUsernames";
import { isEmail } from "@/lib/validators";

type LocalUserRow = {
  id: string;
  email: string;
  role: string;
  full_name: string | null;
  username: string | null;
  clerk_user_id: string | null;
};

const GENERIC_SETUP_MESSAGE =
  "If this email is eligible for admin access, setup is ready. Return to sign in and continue with SSO.";

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`\"${column}\"`) && message.includes("does not exist");
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

function generateClerkBootstrapPassword() {
  return `Ccr!${randomBytes(24).toString("base64url")}Aa9`;
}

async function loadLocalUserByEmail(email: string) {
  try {
    const result = await dbQuery<LocalUserRow>(
      "select id, email, role, full_name, username, clerk_user_id from users where lower(email) = lower($1) limit 1",
      [email],
    );
    return result.rows[0] ?? null;
  } catch (error) {
    if (
      isUndefinedColumn(error, "full_name") ||
      isUndefinedColumn(error, "username") ||
      isUndefinedColumn(error, "clerk_user_id")
    ) {
      const fallback = await dbQuery<Pick<LocalUserRow, "id" | "email" | "role">>(
        "select id, email, role from users where lower(email) = lower($1) limit 1",
        [email],
      );
      const row = fallback.rows[0];
      if (!row) {
        return null;
      }
      return {
        id: row.id,
        email: row.email,
        role: row.role,
        full_name: null,
        username: null,
        clerk_user_id: null,
      };
    }
    throw error;
  }
}

async function linkLocalUserToClerkId(localUserId: string, clerkUserId: string) {
  try {
    await dbQuery(
      "update users set clerk_user_id = $2 where id = $1 and (clerk_user_id is null or clerk_user_id = $2)",
      [localUserId, clerkUserId],
    );
    return null;
  } catch (error) {
    if (isUndefinedColumn(error, "clerk_user_id")) {
      return "users.clerk_user_id column is missing. Apply migration 020_clerk_user_mapping.sql.";
    }
    throw error;
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  const turnstileToken = extractTurnstileToken(body, request);
  const ip = getClientIpFromRequest(request) ?? "unknown";

  const turnstileResult = await verifyTurnstileToken({
    token: turnstileToken,
    remoteIp: ip,
    expectedAction: "public_clerk_account_setup",
  });
  if (!turnstileResult.ok) {
    logWarn("api.public.auth.clerkAccountSetup.turnstile_failed", {
      route: "/api/public/auth/clerk-account-setup",
      failureCategory: categorizeTurnstileFailure(turnstileResult.errorCodes),
      status: turnstileResult.status,
      ip,
    });
    return NextResponse.json({ error: turnstileResult.userMessage }, { status: turnstileResult.status });
  }

  if (!isEmail(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  if (!isClerkEnabled()) {
    return NextResponse.json(
      { error: "Clerk is not configured in this environment. Use legacy admin login for now." },
      { status: 503 },
    );
  }

  const localUser = await loadLocalUserByEmail(email);
  if (!localUser || !parseAppRole(localUser.role)) {
    return NextResponse.json({
      ok: true,
      message: `${GENERIC_SETUP_MESSAGE} If your account is still not linked, use legacy admin login once and retry.`,
    });
  }

  try {
    const clerk = await clerkClient();
    const usernameCandidates = buildClerkUsernameCandidates({
      localUsername: localUser.username,
      email: localUser.email,
      localUserId: localUser.id,
    });

    let clerkUser =
      localUser.clerk_user_id?.trim() && localUser.clerk_user_id
        ? await clerk.users.getUser(localUser.clerk_user_id).catch(() => null)
        : null;

    if (!clerkUser) {
      const existing = await clerk.users.getUserList({
        emailAddress: [localUser.email],
        limit: 1,
      });
      clerkUser = existing.data[0] ?? null;
    }

    if (!clerkUser) {
      const { firstName, lastName } = splitName(localUser.full_name, localUser.email);
      const password = generateClerkBootstrapPassword();
      let created:
        | Awaited<ReturnType<Awaited<ReturnType<typeof clerkClient>>["users"]["createUser"]>>
        | null = null;
      let createError: unknown = null;

      for (const candidate of [...usernameCandidates, ""]) {
        try {
          created = await clerk.users.createUser({
            emailAddress: [localUser.email],
            password,
            firstName,
            lastName,
            skipLegalChecks: true,
            ...(candidate ? { username: candidate } : {}),
            privateMetadata: {
              localUserId: localUser.id,
              localRole: localUser.role,
              authProvisionedBy: "self-service-account-setup",
            },
          });
          break;
        } catch (error) {
          createError = error;
          if (candidate && isClerkUsernameError(error)) {
            continue;
          }
          throw error;
        }
      }

      if (!created) {
        throw createError ?? new Error("Unable to provision Clerk user");
      }

      clerkUser = created;
      await clerk.users.setPasswordCompromised(clerkUser.id, {
        revokeAllSessions: true,
      });
    } else {
      const currentMetadata = (clerkUser.privateMetadata ?? {}) as Record<string, unknown>;
      const updatePayload: {
        privateMetadata: Record<string, unknown>;
        username?: string;
      } = {
        privateMetadata: {
          ...currentMetadata,
          localUserId: localUser.id,
          localRole: localUser.role,
          authProvisionedBy: "self-service-account-setup-link",
        },
      };

      if (!clerkUser.username) {
        for (const candidate of usernameCandidates) {
          try {
            await clerk.users.updateUser(clerkUser.id, {
              ...updatePayload,
              username: candidate,
            });
            updatePayload.username = candidate;
            break;
          } catch (error) {
            if (isClerkUsernameError(error)) {
              continue;
            }
            throw error;
          }
        }
      }

      await clerk.users.updateUser(clerkUser.id, updatePayload);
    }

    const mappingWarning = await linkLocalUserToClerkId(localUser.id, clerkUser.id);

    return NextResponse.json({
      ok: true,
      message: mappingWarning ? `${GENERIC_SETUP_MESSAGE} ${mappingWarning}` : GENERIC_SETUP_MESSAGE,
    });
  } catch (error) {
    logWarn("api.public.auth.clerkAccountSetup", {
      email,
      code: (error as { errors?: Array<{ code?: string }> } | null)?.errors?.[0]?.code,
    });
    return NextResponse.json(
      {
        error:
          "Could not complete Clerk setup right now. Use legacy admin login once, then retry Clerk sign in.",
      },
      { status: 500 },
    );
  }
}
