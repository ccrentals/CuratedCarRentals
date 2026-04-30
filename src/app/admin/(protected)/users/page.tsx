import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdminRole } from "@/lib/auth/roles";

import { TableDateTime } from "@/components/shared/TableDateTime";
import { dbQuery } from "@/lib/db";
import { getSessionFromRequest } from "@/lib/auth/session";
import { CreateUserForm, UserRowActions } from "@/components/admin/UsersManager";
import { LoadMorePaginationControls } from "@/components/admin/LoadMorePaginationControls";
import { UsersFilters } from "@/components/admin/UsersFilters";
import { normalizePageSize, parsePositiveIntParam } from "@/lib/pagination/sharedPagination";
import { lifecycleStatusLabel, type UserLifecycleState } from "@/lib/security/userLifecycle";

type UserRow = {
  id: string;
  public_id: string | null;
  email: string;
  username?: string | null;
  full_name?: string | null;
  role: string;
  is_active?: boolean | null;
  lifecycle_state?: UserLifecycleState | null;
  deactivated_at?: string | null;
  locked_at?: string | null;
  created_at: string;
  updated_at?: string | null;
  last_login_at?: string | null;
};

type SessionRoleRow = {
  role: string | null;
};

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  if (code !== "42703") return false;
  const haystack = message.toLowerCase();
  const needle = column.toLowerCase();
  return haystack.includes("does not exist") && (haystack.includes(`"${needle}"`) || haystack.includes(needle));
}

function statusLabel(user: UserRow) {
  return lifecycleStatusLabel({
    lifecycleState: user.lifecycle_state,
    isActive: user.is_active,
    deactivatedAt: user.deactivated_at,
    lockedAt: user.locked_at,
  });
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
  const rowsPerPage = normalizePageSize(typeof params.rows === "string" ? params.rows : undefined);
  const requestedVisible = parsePositiveIntParam(params.visible);
  const visibleCount = Math.max(rowsPerPage, requestedVisible ?? rowsPerPage);

  if (!canAdmin) {
    redirect("/admin");
  }

  const searchValues: string[] = q ? [`%${q}%`] : [];
  const withLimit = (sql: string, valueCount: number) => `${sql} limit $${valueCount + 1}`;
  const countFromUsers = async (whereSql: string, values: string[]) => {
    const count = await dbQuery<{ total: number }>(
      `select count(*)::int as total from users ${whereSql}`.trim(),
      values,
    );
    return Number(count.rows[0]?.total ?? 0);
  };

  const usersQuery = await (async (): Promise<{
    result: Awaited<ReturnType<typeof dbQuery<UserRow>>>;
    totalCount: number;
    lifecycleNotConfigured: boolean;
    usernamesNotConfigured: boolean;
  }> => {
    const loadUsers = async (
      updatedAtNotConfigured = false,
    ): Promise<{
      result: Awaited<ReturnType<typeof dbQuery<UserRow>>>;
      totalCount: number;
      lifecycleNotConfigured: boolean;
      usernamesNotConfigured: boolean;
    }> => {
      const updatedAtSelect = updatedAtNotConfigured ? "null::text as updated_at" : "updated_at";
      const lifecycleWhereSql = q
        ? "where (email ilike $1 or username ilike $1 or full_name ilike $1 or public_id ilike $1)"
        : "";

      try {
        const lifecycleValues = [...searchValues, visibleCount];
        return {
          result: await dbQuery<UserRow>(
            withLimit(
              `select id, public_id, email, username, full_name, role, is_active, lifecycle_state, deactivated_at, locked_at, created_at, ${updatedAtSelect}, last_login_at
               from users
               ${lifecycleWhereSql}
               order by created_at desc`,
              searchValues.length,
            ),
            lifecycleValues,
          ),
          totalCount: await countFromUsers(lifecycleWhereSql, searchValues),
          lifecycleNotConfigured: false,
          usernamesNotConfigured: false,
        };
      } catch (error) {
        if (!updatedAtNotConfigured && isUndefinedColumn(error, "updated_at")) {
          return loadUsers(true);
        }

        if (isUndefinedColumn(error, "username")) {
          const whereWithoutUsername = q ? "where (email ilike $1 or full_name ilike $1)" : "";
          const valuesWithoutUsername = [...searchValues, visibleCount];
          return {
            result: await dbQuery<UserRow>(
              withLimit(
                `select id, null::text as public_id, email, null::text as username, full_name, role, is_active, null::text as lifecycle_state, deactivated_at, locked_at, created_at, ${updatedAtSelect}, last_login_at
                 from users
                 ${whereWithoutUsername}
                 order by created_at desc`,
                searchValues.length,
              ),
              valuesWithoutUsername,
            ),
            totalCount: await countFromUsers(whereWithoutUsername, searchValues),
            lifecycleNotConfigured: false,
            usernamesNotConfigured: true,
          };
        }
        if (isUndefinedColumn(error, "public_id")) {
          const whereWithoutPublicId = q
            ? "where (email ilike $1 or username ilike $1 or full_name ilike $1)"
            : "";
          const valuesWithoutPublicId = [...searchValues, visibleCount];
          return {
            result: await dbQuery<UserRow>(
              withLimit(
                `select id, null::text as public_id, email, username, full_name, role, is_active, null::text as lifecycle_state, deactivated_at, locked_at, created_at, ${updatedAtSelect}, last_login_at
                 from users
                 ${whereWithoutPublicId}
                 order by created_at desc`,
                searchValues.length,
              ),
              valuesWithoutPublicId,
            ),
            totalCount: await countFromUsers(whereWithoutPublicId, searchValues),
            lifecycleNotConfigured: false,
            usernamesNotConfigured: false,
          };
        }
        if (
          isUndefinedColumn(error, "is_active") ||
          isUndefinedColumn(error, "full_name") ||
          isUndefinedColumn(error, "lifecycle_state")
        ) {
          const fallbackWhereSql = q ? "where (email ilike $1 or username ilike $1)" : "";
          return {
            result: await (async () => {
              try {
                return await dbQuery<UserRow>(
                  withLimit(
                    `select id, null::text as public_id, email, username, null::text as full_name, role, null::boolean as is_active, null::text as lifecycle_state, null::text as deactivated_at, locked_at, created_at, ${updatedAtSelect}, null::text as last_login_at
                     from users
                     ${fallbackWhereSql}
                     order by created_at desc`,
                    searchValues.length,
                  ),
                  [...searchValues, visibleCount],
                );
              } catch (usernameError) {
                if (!isUndefinedColumn(usernameError, "username")) {
                  throw usernameError;
                }
                const emailOnlyWhereSql = q ? "where email ilike $1" : "";
                return dbQuery<UserRow>(
                  withLimit(
                    `select id, null::text as public_id, email, null::text as username, null::text as full_name, role, null::boolean as is_active, null::text as lifecycle_state, null::text as deactivated_at, locked_at, created_at, ${updatedAtSelect}, null::text as last_login_at
                     from users
                     ${emailOnlyWhereSql}
                     order by created_at desc`,
                    searchValues.length,
                  ),
                  [...searchValues, visibleCount],
                );
              }
            })(),
            totalCount: await (async () => {
              try {
                return await countFromUsers(fallbackWhereSql, searchValues);
              } catch (usernameError) {
                if (!isUndefinedColumn(usernameError, "username")) {
                  throw usernameError;
                }
                const emailOnlyWhereSql = q ? "where email ilike $1" : "";
                return countFromUsers(emailOnlyWhereSql, searchValues);
              }
            })(),
            lifecycleNotConfigured: true,
            usernamesNotConfigured: false,
          };
        }
        throw error;
      }
    };

    return loadUsers();
  })();
  const users = usersQuery.result;
  const totalUsers = usersQuery.totalCount;
  const lifecycleNotConfigured = usersQuery.lifecycleNotConfigured;
  const usernamesNotConfigured = usersQuery.usernamesNotConfigured;
  const visibleUsers = users.rows;

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Users</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--ccr-muted)]">
            Manage staff access, roles, and account lifecycle for Clerk-managed sign-in.
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
            from schema.sql to enable setup and external-cleanup lifecycle tracking.
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
        {totalUsers === 0 ? (
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
                <th className="px-4 py-3">Updated</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user: UserRow) => (
                <tr key={user.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold text-[var(--ccr-text)]">
                        {(user.full_name ?? "").trim() || user.email}
                      </p>
                      <span className="rounded-md border border-[var(--ccr-border)] bg-[var(--ccr-bg)] px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
                        {user.public_id ?? "UR pending"}
                      </span>
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
                  <td className="px-4 py-3 text-[var(--ccr-muted)]">
                    <TableDateTime value={user.created_at} />
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-muted)]">
                    <TableDateTime value={user.updated_at ?? user.created_at} />
                  </td>
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
                      lifecycleState={user.lifecycle_state ?? null}
                      deactivatedAt={user.deactivated_at ?? null}
                      lockedAt={user.locked_at ?? null}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {totalUsers > 0 ? (
          <LoadMorePaginationControls
            pageSize={rowsPerPage}
            loadedCount={visibleUsers.length}
            totalCount={totalUsers}
            noMoreLabel="No more users"
          />
        ) : null}
      </div>
    </div>
  );
}
