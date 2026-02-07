import { redirect } from "next/navigation";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { AdminShell } from "@/components/admin/AdminShell";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionFromRequest();

  if (!session) {
    redirect("/admin/login");
  }

  const userResult = await dbQuery<{ email: string; role: string }>(
    "select email, role from users where id = $1 limit 1",
    [session.userId],
  );
  const user = userResult.rows[0] ?? { email: "admin", role: session.role };

  return (
    <AdminShell user={{ email: user.email, role: user.role ?? "Admin" }}>{children}</AdminShell>
  );
}
