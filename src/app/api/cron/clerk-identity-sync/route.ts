import { NextResponse } from "next/server";

import { generateClerkIdentitySyncReport } from "@/lib/auth/clerkIdentitySync";
import { writeAuditLog } from "@/lib/audit";
import { logError } from "@/lib/log";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const provided = request.headers.get("x-cron-secret");
  if (!secret || !provided || provided !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const report = await generateClerkIdentitySyncReport();
    const rowsNeedingAttention = report.rows.filter((row) => row.status !== "LINKED");

    await writeAuditLog({
      action: "CLERK_IDENTITY_SYNC_RECONCILIATION",
      entityType: "clerk_identity_sync",
      details: {
        generatedAt: report.generatedAt,
        clerkAvailable: report.clerkAvailable,
        counts: report.counts,
        sample: rowsNeedingAttention.slice(0, 20).map((row) => ({
          status: row.status,
          localUserId: row.localUserId,
          localEmail: row.localEmail,
          clerkUserId: row.clerkUserId,
          clerkEmail: row.clerkEmail,
        })),
      },
    });

    return NextResponse.json({
      ok: true,
      generatedAt: report.generatedAt,
      clerkAvailable: report.clerkAvailable,
      counts: report.counts,
    });
  } catch (error) {
    logError("cron_clerk_identity_sync_failed", error, {});
    return NextResponse.json(
      { ok: false, error: "Failed to run Clerk identity reconciliation." },
      { status: 500 },
    );
  }
}
