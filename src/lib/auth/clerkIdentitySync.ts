import { clerkClient } from "@clerk/nextjs/server";

import { writeAuditLog } from "@/lib/audit";
import { getDbPool } from "@/lib/db";
import { logWarn } from "@/lib/log";

type QueryResultRow = Record<string, unknown>;
type QueryResult = { rowCount: number; rows: QueryResultRow[] };
type QueryClient = {
  query: (sql: string, values?: unknown[]) => Promise<QueryResult>;
  release?: () => void;
};

export type ClerkIdentityRecord = {
  clerkUserId: string;
  email: string | null;
  username: string | null;
  deleted: boolean;
};

export type LocalIdentityRecord = {
  id: string;
  email: string;
  username: string | null;
  clerkUserId: string | null;
  role: string;
  isActive: boolean;
  deactivatedAt: string | null;
};

export type ClerkIdentityDriftStatus =
  | "LINKED"
  | "MISMATCH"
  | "MISSING_CLERK_USER"
  | "MISSING_LOCAL_USER"
  | "NEEDS_RELINK"
  | "CLERK_UNAVAILABLE";

export type ClerkIdentitySyncReportRow = {
  status: ClerkIdentityDriftStatus;
  reason: string;
  canAutoRepair: boolean;
  localUserId: string | null;
  localEmail: string | null;
  localUsername: string | null;
  localRole: string | null;
  localIsActive: boolean | null;
  clerkUserId: string | null;
  clerkEmail: string | null;
  clerkUsername: string | null;
};

export type ClerkIdentitySyncReport = {
  generatedAt: string;
  counts: Record<ClerkIdentityDriftStatus, number>;
  rows: ClerkIdentitySyncReportRow[];
  clerkAvailable: boolean;
  error: string | null;
};

export type ClerkIdentityApplyResult =
  | {
      ok: true;
      status: "applied" | "deactivated" | "already_inactive" | "noop";
      localUserId: string | null;
      clerkUserId: string;
      message: string;
    }
  | {
      ok: false;
      status:
        | "missing_local_user"
        | "ambiguous_email_match"
        | "clerk_id_conflict"
        | "local_identity_conflict";
      localUserId: string | null;
      clerkUserId: string;
      message: string;
    };

type ApplyClerkIdentityInput = {
  identity: ClerkIdentityRecord;
  actorUserId?: string | null;
  source: "webhook" | "repair";
  sourceEventId?: string | null;
  sourceEventType?: string | null;
};

type ReportDeps = {
  listClerkUsers?: () => Promise<ClerkIdentityRecord[]>;
  getLocalUsers?: () => Promise<LocalIdentityRecord[]>;
};

type ApplyDeps = {
  getDbPoolFn?: typeof getDbPool;
};

type RepairInput = {
  actorUserId?: string | null;
  localUserId?: string | null;
  clerkUserId?: string | null;
};

function emptyCounts(): Record<ClerkIdentityDriftStatus, number> {
  return {
    LINKED: 0,
    MISMATCH: 0,
    MISSING_CLERK_USER: 0,
    MISSING_LOCAL_USER: 0,
    NEEDS_RELINK: 0,
    CLERK_UNAVAILABLE: 0,
  };
}

function normalizeEmail(value: string | null | undefined) {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return normalized || null;
}

function normalizeUsername(value: string | null | undefined) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized || null;
}

function asRecord(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function extractPrimaryEmailFromAddresses(
  addresses: unknown,
  primaryEmailAddressId: string | null,
) {
  if (!Array.isArray(addresses) || !primaryEmailAddressId) {
    return null;
  }

  for (const item of addresses) {
    const record = asRecord(item);
    if (!record) continue;
    const id = asString(record.id);
    if (!id || id !== primaryEmailAddressId) continue;
    return normalizeEmail(asString(record.emailAddress) ?? asString(record.email_address));
  }

  return null;
}

export function toClerkIdentityRecord(input: unknown): ClerkIdentityRecord | null {
  const record = asRecord(input);
  if (!record) return null;

  const clerkUserId = asString(record.id);
  if (!clerkUserId) {
    return null;
  }

  const primaryEmailAddressId =
    asString(record.primaryEmailAddressId) ?? asString(record.primary_email_address_id);
  const email =
    extractPrimaryEmailFromAddresses(record.emailAddresses, primaryEmailAddressId) ??
    extractPrimaryEmailFromAddresses(record.email_addresses, primaryEmailAddressId) ??
    normalizeEmail(asString(record.email));

  return {
    clerkUserId,
    email,
    username: normalizeUsername(asString(record.username)),
    deleted: Boolean(record.deleted),
  };
}

export function buildClerkIdentitySyncReport(input: {
  localUsers: LocalIdentityRecord[];
  clerkUsers: ClerkIdentityRecord[];
  generatedAt?: string;
  clerkAvailable?: boolean;
  error?: string | null;
}): ClerkIdentitySyncReport {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const clerkAvailable = input.clerkAvailable ?? true;
  const rows: ClerkIdentitySyncReportRow[] = [];
  const counts = emptyCounts();

  if (!clerkAvailable) {
    rows.push({
      status: "CLERK_UNAVAILABLE",
      reason: input.error ?? "Clerk users could not be loaded.",
      canAutoRepair: false,
      localUserId: null,
      localEmail: null,
      localUsername: null,
      localRole: null,
      localIsActive: null,
      clerkUserId: null,
      clerkEmail: null,
      clerkUsername: null,
    });
    counts.CLERK_UNAVAILABLE = 1;
    return { generatedAt, counts, rows, clerkAvailable: false, error: input.error ?? null };
  }

  const clerkById = new Map<string, ClerkIdentityRecord>();
  const clerkByEmail = new Map<string, ClerkIdentityRecord[]>();
  for (const clerkUser of input.clerkUsers) {
    clerkById.set(clerkUser.clerkUserId, clerkUser);
    if (clerkUser.email) {
      const key = clerkUser.email;
      const current = clerkByEmail.get(key) ?? [];
      current.push(clerkUser);
      clerkByEmail.set(key, current);
    }
  }

  const matchedClerkIds = new Set<string>();

  for (const localUser of input.localUsers) {
    const localEmail = normalizeEmail(localUser.email);
    const localUsername = normalizeUsername(localUser.username);

    if (localUser.clerkUserId) {
      const clerkUser = clerkById.get(localUser.clerkUserId);
      if (!clerkUser) {
        rows.push({
          status: "MISSING_CLERK_USER",
          reason: "Local user is linked to a Clerk user that no longer exists.",
          canAutoRepair: false,
          localUserId: localUser.id,
          localEmail,
          localUsername,
          localRole: localUser.role,
          localIsActive: localUser.isActive,
          clerkUserId: localUser.clerkUserId,
          clerkEmail: null,
          clerkUsername: null,
        });
        counts.MISSING_CLERK_USER += 1;
        continue;
      }

      matchedClerkIds.add(clerkUser.clerkUserId);

      if (localEmail !== clerkUser.email || localUsername !== clerkUser.username) {
        rows.push({
          status: "MISMATCH",
          reason: "Local username or email differs from Clerk.",
          canAutoRepair: true,
          localUserId: localUser.id,
          localEmail,
          localUsername,
          localRole: localUser.role,
          localIsActive: localUser.isActive,
          clerkUserId: clerkUser.clerkUserId,
          clerkEmail: clerkUser.email,
          clerkUsername: clerkUser.username,
        });
        counts.MISMATCH += 1;
      } else {
        rows.push({
          status: "LINKED",
          reason: "Local identity matches Clerk.",
          canAutoRepair: false,
          localUserId: localUser.id,
          localEmail,
          localUsername,
          localRole: localUser.role,
          localIsActive: localUser.isActive,
          clerkUserId: clerkUser.clerkUserId,
          clerkEmail: clerkUser.email,
          clerkUsername: clerkUser.username,
        });
        counts.LINKED += 1;
      }
      continue;
    }

    if (localEmail) {
      const emailMatches = clerkByEmail.get(localEmail) ?? [];
      if (emailMatches.length === 1) {
        const clerkUser = emailMatches[0];
        rows.push({
          status: "NEEDS_RELINK",
          reason: "Local user matches a Clerk user by email but is not linked.",
          canAutoRepair: true,
          localUserId: localUser.id,
          localEmail,
          localUsername,
          localRole: localUser.role,
          localIsActive: localUser.isActive,
          clerkUserId: clerkUser.clerkUserId,
          clerkEmail: clerkUser.email,
          clerkUsername: clerkUser.username,
        });
        counts.NEEDS_RELINK += 1;
        continue;
      }

      if (emailMatches.length > 1) {
        rows.push({
          status: "NEEDS_RELINK",
          reason: "Multiple Clerk users share this email match. Manual relinking is required.",
          canAutoRepair: false,
          localUserId: localUser.id,
          localEmail,
          localUsername,
          localRole: localUser.role,
          localIsActive: localUser.isActive,
          clerkUserId: null,
          clerkEmail: localEmail,
          clerkUsername: null,
        });
        counts.NEEDS_RELINK += 1;
      }
    }
  }

  for (const clerkUser of input.clerkUsers) {
    if (matchedClerkIds.has(clerkUser.clerkUserId)) {
      continue;
    }

    if (clerkUser.email) {
      const matchedLocal = input.localUsers.some(
        (localUser) =>
          normalizeEmail(localUser.email) === clerkUser.email &&
          !localUser.clerkUserId,
      );
      if (matchedLocal) {
        continue;
      }
    }

    rows.push({
      status: "MISSING_LOCAL_USER",
      reason: "Clerk user exists but no local user is linked or matched by email.",
      canAutoRepair: false,
      localUserId: null,
      localEmail: null,
      localUsername: null,
      localRole: null,
      localIsActive: null,
      clerkUserId: clerkUser.clerkUserId,
      clerkEmail: clerkUser.email,
      clerkUsername: clerkUser.username,
    });
    counts.MISSING_LOCAL_USER += 1;
  }

  return { generatedAt, counts, rows, clerkAvailable: true, error: null };
}

export async function fetchLocalIdentityRecords() {
  const result = await getDbPool().query(
    "select id, email, username, clerk_user_id, role, is_active, deactivated_at from users order by created_at asc",
  );

  return result.rows.map((row: QueryResultRow) => ({
    id: String(row.id),
    email: String(row.email),
    username: normalizeUsername(asString(row.username)),
    clerkUserId: asString(row.clerk_user_id),
    role: String(row.role),
    isActive: row.is_active !== false,
    deactivatedAt: asString(row.deactivated_at),
  })) as LocalIdentityRecord[];
}

export async function listClerkIdentityRecords() {
  const clerk = await clerkClient();
  const users: ClerkIdentityRecord[] = [];
  const pageSize = 100;
  let offset = 0;

  while (true) {
    const response = await clerk.users.getUserList({ limit: pageSize, offset });
    const batch = response.data
      .map((user) => toClerkIdentityRecord(user))
      .filter((user): user is ClerkIdentityRecord => Boolean(user));
    users.push(...batch);

    if (response.data.length < pageSize) {
      break;
    }
    offset += response.data.length;
  }

  return users;
}

export async function generateClerkIdentitySyncReport(deps: ReportDeps = {}) {
  const generatedAt = new Date().toISOString();
  const localUsers = await (deps.getLocalUsers ? deps.getLocalUsers() : fetchLocalIdentityRecords());

  try {
    const clerkUsers = await (deps.listClerkUsers ? deps.listClerkUsers() : listClerkIdentityRecords());
    return buildClerkIdentitySyncReport({ localUsers, clerkUsers, generatedAt });
  } catch (error) {
    logWarn("auth.clerkIdentitySync.reportFailed", {
      code: (error as { code?: string } | null)?.code,
      message: String((error as { message?: unknown } | null)?.message ?? "Unknown Clerk error"),
    });
    return buildClerkIdentitySyncReport({
      localUsers,
      clerkUsers: [],
      generatedAt,
      clerkAvailable: false,
      error: "Clerk users could not be loaded.",
    });
  }
}

async function loadLinkedLocalUser(client: QueryClient, clerkUserId: string) {
  const result = await client.query(
    "select id, email, username, clerk_user_id, role, is_active, deactivated_at from users where clerk_user_id = $1 limit 1 for update",
    [clerkUserId],
  );
  const row = result.rows[0];
  if (!row) return null;

  return {
    id: String(row.id),
    email: String(row.email),
    username: normalizeUsername(asString(row.username)),
    clerkUserId: asString(row.clerk_user_id),
    role: String(row.role),
    isActive: row.is_active !== false,
    deactivatedAt: asString(row.deactivated_at),
  } satisfies LocalIdentityRecord;
}

async function loadLocalUsersByEmail(client: QueryClient, email: string) {
  const result = await client.query(
    "select id, email, username, clerk_user_id, role, is_active, deactivated_at from users where lower(email) = lower($1) order by created_at asc for update",
    [email],
  );

  return result.rows.map((row: QueryResultRow) => ({
    id: String(row.id),
    email: String(row.email),
    username: normalizeUsername(asString(row.username)),
    clerkUserId: asString(row.clerk_user_id),
    role: String(row.role),
    isActive: row.is_active !== false,
    deactivatedAt: asString(row.deactivated_at),
  })) as LocalIdentityRecord[];
}

async function updateLocalIdentity({
  client,
  localUserId,
  email,
  username,
  clerkUserId,
}: {
  client: QueryClient;
  localUserId: string;
  email: string | null;
  username: string | null;
  clerkUserId: string;
}) {
  return client.query(
    "update users set email = coalesce($2, email), username = $3, clerk_user_id = $4, updated_at = now() where id = $1",
    [localUserId, email, username, clerkUserId],
  );
}

async function markLocalUserInactive({
  client,
  localUserId,
}: {
  client: QueryClient;
  localUserId: string;
}) {
  return client.query(
    "update users set is_active = false, deactivated_at = coalesce(deactivated_at, now()), updated_at = now() where id = $1",
    [localUserId],
  );
}

export async function applyClerkIdentityToLocal(
  input: ApplyClerkIdentityInput,
  deps: ApplyDeps = {},
): Promise<ClerkIdentityApplyResult> {
  const pool = (deps.getDbPoolFn ?? getDbPool)();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const linkedLocalUser = await loadLinkedLocalUser(client, input.identity.clerkUserId);

    if (input.identity.deleted) {
      if (!linkedLocalUser) {
        await client.query("rollback");
        return {
          ok: false,
          status: "missing_local_user",
          localUserId: null,
          clerkUserId: input.identity.clerkUserId,
          message: "No local user is linked to this deleted Clerk user.",
        };
      }

      if (!linkedLocalUser.isActive || linkedLocalUser.deactivatedAt) {
        await client.query("commit");
        await writeAuditLog({
          userId: input.actorUserId ?? null,
          action: "CLERK_IDENTITY_SYNC_ALREADY_INACTIVE",
          entityType: "user",
          entityId: linkedLocalUser.id,
          details: {
            source: input.source,
            sourceEventId: input.sourceEventId ?? null,
            sourceEventType: input.sourceEventType ?? null,
            clerkUserId: input.identity.clerkUserId,
          },
        });
        return {
          ok: true,
          status: "already_inactive",
          localUserId: linkedLocalUser.id,
          clerkUserId: input.identity.clerkUserId,
          message: "Local user was already inactive.",
        };
      }

      await markLocalUserInactive({ client, localUserId: linkedLocalUser.id });
      await client.query("commit");

      await writeAuditLog({
        userId: input.actorUserId ?? null,
        action: "CLERK_IDENTITY_SYNC_DEACTIVATED",
        entityType: "user",
        entityId: linkedLocalUser.id,
        details: {
          source: input.source,
          sourceEventId: input.sourceEventId ?? null,
          sourceEventType: input.sourceEventType ?? null,
          clerkUserId: input.identity.clerkUserId,
        },
      });

      return {
        ok: true,
        status: "deactivated",
        localUserId: linkedLocalUser.id,
        clerkUserId: input.identity.clerkUserId,
        message: "Local user was marked inactive after Clerk deletion.",
      };
    }

    let localUser = linkedLocalUser;

    if (!localUser && input.identity.email) {
      const emailMatches = await loadLocalUsersByEmail(client, input.identity.email);
      if (emailMatches.length > 1) {
        await client.query("rollback");
        return {
          ok: false,
          status: "ambiguous_email_match",
          localUserId: null,
          clerkUserId: input.identity.clerkUserId,
          message: "Multiple local users matched this Clerk email. Repair manually.",
        };
      }
      const candidate = emailMatches[0] ?? null;
      if (candidate?.clerkUserId && candidate.clerkUserId !== input.identity.clerkUserId) {
        await client.query("rollback");
        return {
          ok: false,
          status: "clerk_id_conflict",
          localUserId: candidate.id,
          clerkUserId: input.identity.clerkUserId,
          message: "Local user email is already linked to a different Clerk user.",
        };
      }
      localUser = candidate;
    }

    if (!localUser) {
      await client.query("rollback");
      return {
        ok: false,
        status: "missing_local_user",
        localUserId: null,
        clerkUserId: input.identity.clerkUserId,
        message: "No local user exists for this Clerk identity.",
      };
    }

    const nextEmail = input.identity.email ?? normalizeEmail(localUser.email);
    const nextUsername = input.identity.username;
    const currentEmail = normalizeEmail(localUser.email);
    const currentUsername = normalizeUsername(localUser.username);

    if (currentEmail === nextEmail && currentUsername === nextUsername && localUser.clerkUserId === input.identity.clerkUserId) {
      await client.query("commit");
      return {
        ok: true,
        status: "noop",
        localUserId: localUser.id,
        clerkUserId: input.identity.clerkUserId,
        message: "Local user already matches Clerk.",
      };
    }

    try {
      await updateLocalIdentity({
        client,
        localUserId: localUser.id,
        email: nextEmail,
        username: nextUsername,
        clerkUserId: input.identity.clerkUserId,
      });
    } catch (error) {
      await client.query("rollback");
      const code = (error as { code?: string } | null)?.code;
      if (code === "23505") {
        return {
          ok: false,
          status: "local_identity_conflict",
          localUserId: localUser.id,
          clerkUserId: input.identity.clerkUserId,
          message: "Local username or email would conflict with another user.",
        };
      }
      throw error;
    }

    await client.query("commit");

    await writeAuditLog({
      userId: input.actorUserId ?? null,
      action: "CLERK_IDENTITY_SYNC_APPLIED",
      entityType: "user",
      entityId: localUser.id,
      details: {
        source: input.source,
        sourceEventId: input.sourceEventId ?? null,
        sourceEventType: input.sourceEventType ?? null,
        clerkUserId: input.identity.clerkUserId,
        email: nextEmail,
        username: nextUsername,
      },
    });

    return {
      ok: true,
      status: "applied",
      localUserId: localUser.id,
      clerkUserId: input.identity.clerkUserId,
      message: "Local identity synchronized from Clerk.",
    };
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release?.();
  }
}

export async function repairClerkIdentityDrift(input: RepairInput, deps: ReportDeps & ApplyDeps = {}) {
  const report = await generateClerkIdentitySyncReport(deps);
  if (!report.clerkAvailable) {
    return {
      ok: false as const,
      message: report.error ?? "Clerk is unavailable.",
      repaired: null,
      report,
    };
  }

  const row = report.rows.find((entry) => {
    if (input.localUserId && entry.localUserId === input.localUserId) return true;
    if (input.clerkUserId && entry.clerkUserId === input.clerkUserId) return true;
    return false;
  });

  if (!row) {
    return {
      ok: false as const,
      message: "No matching identity drift entry was found.",
      repaired: null,
      report,
    };
  }

  if (!row.canAutoRepair || !row.clerkUserId) {
    return {
      ok: false as const,
      message: "This entry requires manual intervention and cannot be auto-repaired.",
      repaired: row,
      report,
    };
  }

  const clerkUsers = await (deps.listClerkUsers ? deps.listClerkUsers() : listClerkIdentityRecords());
  const identity = clerkUsers.find((entry) => entry.clerkUserId === row.clerkUserId) ?? null;
  if (!identity) {
    return {
      ok: false as const,
      message: "Clerk user could not be loaded for repair.",
      repaired: row,
      report,
    };
  }

  const result = await applyClerkIdentityToLocal(
    {
      identity,
      actorUserId: input.actorUserId ?? null,
      source: "repair",
    },
    deps,
  );

  return {
    ok: result.ok,
    message: result.message,
    repaired: row,
    report,
    result,
  };
}

export async function repairAllSafeClerkIdentityDrift(
  input: { actorUserId?: string | null } = {},
  deps: ReportDeps & ApplyDeps = {},
) {
  const report = await generateClerkIdentitySyncReport(deps);
  if (!report.clerkAvailable) {
    return {
      ok: false as const,
      message: report.error ?? "Clerk is unavailable.",
      attempted: 0,
      repaired: 0,
      failed: 0,
      report,
    };
  }

  const clerkUsers = await (deps.listClerkUsers ? deps.listClerkUsers() : listClerkIdentityRecords());
  const clerkById = new Map(clerkUsers.map((entry) => [entry.clerkUserId, entry]));

  let attempted = 0;
  let repaired = 0;
  let failed = 0;

  for (const row of report.rows) {
    if (!row.canAutoRepair || !row.clerkUserId) continue;
    const identity = clerkById.get(row.clerkUserId);
    if (!identity) {
      failed += 1;
      continue;
    }
    attempted += 1;
    const result = await applyClerkIdentityToLocal(
      {
        identity,
        actorUserId: input.actorUserId ?? null,
        source: "repair",
      },
      deps,
    );
    if (result.ok) {
      repaired += 1;
    } else {
      failed += 1;
    }
  }

  await writeAuditLog({
    userId: input.actorUserId ?? null,
    action: "CLERK_IDENTITY_SYNC_REPAIR_ALL",
    entityType: "clerk_identity_sync",
    details: {
      attempted,
      repaired,
      failed,
    },
  });

  return {
    ok: true as const,
    attempted,
    repaired,
    failed,
    report,
  };
}
