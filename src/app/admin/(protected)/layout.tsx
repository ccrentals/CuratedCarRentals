import { redirect } from "next/navigation";

import { resolveAdminActor } from "@/lib/auth/adminGuards";
import { dbQuery } from "@/lib/db";
import {
  getUnreadContactMessagesCount,
  isContactMessagesMissingTableError,
} from "@/lib/messages/adminMessages";
import { AdminShell } from "@/components/admin/AdminShell";

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
  const access = await resolveAdminActor({ requirement: "staff" });

  if (!access.ok) {
    if (access.reason === "forbidden") {
      redirect("/admin/login?error=forbidden");
    }
    redirect("/admin/login");
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

  return (
    <AdminShell
      user={{ email: user.email, role: user.role ?? "Admin" }}
      unreadMessagesCount={unreadMessagesCount}
    >
      {children}
    </AdminShell>
  );
}
