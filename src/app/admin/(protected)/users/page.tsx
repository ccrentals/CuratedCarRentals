import Link from "next/link";
import { redirect } from "next/navigation";

import { dbQuery } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth/session";
import { fmtDate } from "@/lib/dateFormat";
import { CreateUserForm, UserRowActions } from "@/components/admin/UsersManager";
import { UsersFilters } from "@/components/admin/UsersFilters";

type UserRow = {
  id: string;
  email: string;
  username?: string | null;
  full_name?: string | null;
  role: string;
  is_active?: boolean | null;
  deactivated_at?: string | null;
  locked_at?: string | null;
  created_at: string;
  last_login_at?: string | null;
};

type SessionRoleRow = {
  role: string | null;
};

function isAdminRole(role: string | undefined) {
  const normalized = String(role ?? "")
    .trim()
    .toUpperCase();
  return normalized === "ADMIN" || normalized === "DEVELOPER";
}

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  if (code !== "42703") return false;
  const haystack = message.toLowerCase();
  const needle = column.toLowerCase();
  return haystack.includes("does not exist") && (haystack.includes(`"${needle}"`) || haystack.includes(needle));
}

function statusLabel(user: UserRow) {
  if (user.is_active === false || user.deactivated_at) return "Deactivated";
  if (user.locked_at) return "Locked";
  return "Active";
}

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionFromRequest();
  const sessionRoleResult = session
    ? await dbQuery<SessionRoleRow>("select role from users where id = $1 limit 1", [session.userId])
    : { rows: [] };
  const effectiveSessionRole = sessionRoleResult.rows[0]?.role ?? session?.role ?? null;
  const canAdmin = isAdminRole(effectiveSessionRole ?? undefined);

  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";

  if (!canAdmin) {
    redirect("/admin");
  }

  const values: string[] = [];
  let whereSql = "";
  if (q) {
    values.push(`${q}%`);
    whereSql = "where (email ilike $1 or username ilike $1 or full_name ilike $1)";
  }

  const queryWithLifecycle =
    "select id, email, username, full_name, role, is_active, deactivated_at, locked_at, created_at, last_login_at from users " +
    whereSql +
    " order by created_at desc";
  const queryBasic =
    "select id, email, role, locked_at, created_at from users " + (q ? "where email ilike $1" : "") + " order by created_at desc";

  const usersQuery = await (async (): Promise<{
    result: Awaited<ReturnType<typeof dbQuery<UserRow>>>;
    lifecycleNotConfigured: boolean;
    usernamesNotConfigured: boolean;
  }> => {
    try {
      return {
        result: await dbQuery<UserRow>(queryWithLifecycle, values),
        lifecycleNotConfigured: false,
        usernamesNotConfigured: false,
      };
    } catch (error) {
      if (isUndefinedColumn(error, "username")) {
        return {
          result: await dbQuery<UserRow>(
            "select id, email, full_name, role, is_active, deactivated_at, locked_at, created_at, last_login_at from users " +
              whereSql.replace("username ilike $1 or ", "") +
              " order by created_at desc",
            values,
          ),
          lifecycleNotConfigured: false,
          usernamesNotConfigured: true,
        };
      }
      if (isUndefinedColumn(error, "is_active") || isUndefinedColumn(error, "full_name")) {
        return {
          result: await dbQuery<UserRow>(queryBasic, q ? values : []),
          lifecycleNotConfigured: true,
          usernamesNotConfigured: false,
        };
      }
      throw error;
    }
  })();
  const users = usersQuery.result;
  const lifecycleNotConfigured = usersQuery.lifecycleNotConfigured;
  const usernamesNotConfigured = usersQuery.usernamesNotConfigured;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Users</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--ccr-muted)]">
            Manage staff access (roles and account status). User creation/invites are coming next.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin"
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Back to dashboard
          </Link>
        </div>
      </div>

      {lifecycleNotConfigured ? (
        <div className="mt-6 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">User management not configured</p>
          <p className="mt-1 text-xs text-amber-100/80">
            The users lifecycle columns are missing in the connected database. Apply the users section
            from schema.sql to enable deactivation and invites.
          </p>
        </div>
      ) : null}

      {usernamesNotConfigured ? (
        <div className="mt-4 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">Usernames not configured</p>
          <p className="mt-1 text-xs text-amber-100/80">
            The <span className="font-mono">users.username</span> column is missing in the connected database. Apply the
            users section from schema.sql to enable username login.
          </p>
        </div>
      ) : null}

      <UsersFilters initialQuery={q} />

      <CreateUserForm disabled={lifecycleNotConfigured} actorRole={effectiveSessionRole ?? "USER"} />

      <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
        {users.rows.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[var(--ccr-muted)]">
            No users found.
          </div>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
              <tr>
                <th className="px-4 py-3">User</th>
                <th className="px-4 py-3">Role</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.rows.map((user: UserRow) => (
                <tr key={user.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-[var(--ccr-text)]">
                        {(user.full_name ?? "").trim() || user.email}
                      </p>
                      <details className="relative">
                        <summary className="list-none cursor-pointer rounded-md border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)] hover:border-[var(--ccr-accent)] hover:text-[var(--ccr-text)]">
                          ID
                        </summary>
                        <div className="absolute left-0 top-full z-10 mt-1 w-56 break-all rounded-lg border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-2 py-1 font-mono text-[10px] text-[var(--ccr-text)] shadow-lg">
                          {user.id}
                        </div>
                      </details>
                    </div>
                    <p className="text-xs text-[var(--ccr-muted)]">{user.email}</p>
                    {user.username ? (
                      <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                        Username:{" "}
                        <span className="font-mono text-[var(--ccr-text)]">{user.username}</span>
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">{user.role}</td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">{statusLabel(user)}</td>
                  <td className="px-4 py-3 text-[var(--ccr-muted)]">{fmtDate(user.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <UserRowActions
                      currentUserId={session?.userId ?? ""}
                      userId={user.id}
                      email={user.email}
                      fullName={user.full_name ?? null}
                      username={user.username ?? null}
                      role={user.role}
                      actorRole={effectiveSessionRole ?? "USER"}
                      isActive={user.is_active ?? null}
                      deactivatedAt={user.deactivated_at ?? null}
                      lockedAt={user.locked_at ?? null}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
