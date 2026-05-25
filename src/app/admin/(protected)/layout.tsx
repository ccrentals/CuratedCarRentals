import { redirect } from "next/navigation";
import { clerkClient } from "@clerk/nextjs/server";

import { resolveAdminActor } from "@/lib/auth/adminGuards";
import { parseAppRole } from "@/lib/auth/roles";
import { dbQuery } from "@/lib/db";
import {
  getUnreadContactMessagesCount,
  isContactMessagesMissingTableError,
} from "@/lib/messages/adminMessages";
import { isClerkEnabled } from "@/lib/security/clerk";
import { AdminShell } from "@/components/admin/AdminShell";
import { ForcePasswordChangeGate } from "@/components/security/ForcePasswordChangeGate";

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`\"${column}\"`) && message.includes("does not exist");
}

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const access = await resolveAdminActor({ requirement: "operations" });

  if (!access.ok) {
    if (access.reason === "forbidden") {
      redirect("/admin/auth?error=forbidden");
    }
    redirect("/admin/auth");
  }
  const { session, actor } = access;

  type UserRow = {
    email: string;
    role: string | null;
    must_change_password?: boolean | null;
  };

  const userResult: { rows: UserRow[] } = await (async () => {
    try {
      return await dbQuery<UserRow>(
        "select email, role, must_change_password from users where id = $1 limit 1",
        [actor.userId],
      );
    } catch (error) {
      // If the DB isn't migrated yet, skip the must-change gate to avoid crashing admin pages.
      if (isUndefinedColumn(error, "must_change_password")) {
        return await dbQuery<UserRow>("select email, role from users where id = $1 limit 1", [
          actor.userId,
        ]);
      }
      throw error;
    }
  })();

  const user = userResult.rows[0] ?? { email: "admin", role: session.role };
  const normalizedRole = parseAppRole(user.role ?? session.role);
  const roleLabel =
    normalizedRole === "OPERATIONS"
      ? "Operations"
      : normalizedRole === "DEVELOPER"
        ? "Developer"
        : normalizedRole === "ADMIN"
          ? "Admin"
          : user.role ?? "Admin";
  const unreadMessagesCount = await (async () => {
    try {
      return await getUnreadContactMessagesCount();
    } catch (error) {
      if (isContactMessagesMissingTableError(error)) {
        return 0;
      }
      throw error;
    }
  })();

  if (session.source !== "clerk" && user.must_change_password) {
    redirect("/admin/set-password");
  }

  let forcePasswordChangeRequired = false;
  let tempPasswordExpiresAt: string | null = null;
  if (session.source === "clerk" && session.clerkUserId && isClerkEnabled()) {
    try {
      const clerk = await clerkClient();
      const clerkUser = await clerk.users.getUser(session.clerkUserId);
      const metadata =
        clerkUser.publicMetadata && typeof clerkUser.publicMetadata === "object"
          ? (clerkUser.publicMetadata as Record<string, unknown>)
          : {};
      forcePasswordChangeRequired = metadata.forcePasswordChange === true;
      tempPasswordExpiresAt =
        typeof metadata.tempPasswordExpiresAt === "string" ? metadata.tempPasswordExpiresAt : null;
    } catch {
      forcePasswordChangeRequired = false;
      tempPasswordExpiresAt = null;
    }
  }

  return (
    <AdminShell
      user={{ email: user.email, role: roleLabel }}
      unreadMessagesCount={unreadMessagesCount}
    >
      <ForcePasswordChangeGate
        required={forcePasswordChangeRequired}
        expiresAt={tempPasswordExpiresAt}
      >
        {children}
      </ForcePasswordChangeGate>
    </AdminShell>
  );
}
