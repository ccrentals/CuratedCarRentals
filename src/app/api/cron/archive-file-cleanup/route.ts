import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { isVehicleExtensionsMissingTableError } from "@/lib/vehicles/extensionTables";

const RETENTION_DAYS = 30;

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const provided = request.headers.get("x-cron-secret");
  if (!secret || !provided || provided !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const removed = await dbQuery<{ id: string }>(
      `delete from vehicle_documents
       where archived_at is not null
         and archived_at < now() - make_interval(days => $1::int)
       returning id`,
      [RETENTION_DAYS],
    );

    return NextResponse.json({
      ok: true,
      entity: "vehicle_documents",
      olderThanDays: RETENTION_DAYS,
      deletedCount: removed.rowCount ?? removed.rows.length,
    });
  } catch (error) {
    logError("cron_archive_file_cleanup_failed", error, {
      entity: "vehicle_documents",
      olderThanDays: RETENTION_DAYS,
    });

    if (isVehicleExtensionsMissingTableError(error)) {
      return NextResponse.json(
        { ok: false, error: "Vehicle documents table is not installed." },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { ok: false, error: "Failed to cleanup archived files." },
      { status: 500 },
    );
  }
}
