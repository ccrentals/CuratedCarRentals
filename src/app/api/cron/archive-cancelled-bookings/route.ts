import { NextResponse } from "next/server";

import {
  archiveCancelledBookingsOlderThanDays,
  CANCELLED_BOOKING_AUTO_ARCHIVE_DAYS,
} from "@/lib/bookings/cancelledArchive";
import { logError } from "@/lib/log";

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  const provided = request.headers.get("x-cron-secret");
  if (!secret || !provided || provided !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await archiveCancelledBookingsOlderThanDays();
    if (result.archiveNotConfigured) {
      return NextResponse.json(
        { ok: false, error: "Booking archive columns are not installed." },
        { status: 503 },
      );
    }

    return NextResponse.json({
      ok: true,
      entity: "bookings",
      olderThanDays: CANCELLED_BOOKING_AUTO_ARCHIVE_DAYS,
      archivedCount: result.archivedCount,
    });
  } catch (error) {
    logError("cron_archive_cancelled_bookings_failed", error, {
      entity: "bookings",
      olderThanDays: CANCELLED_BOOKING_AUTO_ARCHIVE_DAYS,
    });

    return NextResponse.json(
      { ok: false, error: "Failed to archive cancelled bookings." },
      { status: 500 },
    );
  }
}
