import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";

function parseDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json().catch(() => null);
    if (!(await requireCsrf(request))) {
      return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
    }
    const vehicleId = typeof body?.vehicleId === "string" ? body.vehicleId : "";
    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const notes = typeof body?.notes === "string" ? body.notes.trim() : "";
    const startAtRaw = typeof body?.startAt === "string" ? body.startAt : "";
    const endAtRaw = typeof body?.endAt === "string" ? body.endAt : "";

    if (!vehicleId || !reason || !startAtRaw || !endAtRaw) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const startAt = parseDate(startAtRaw);
    const endAt = parseDate(endAtRaw);
    if (!startAt || !endAt || endAt <= startAt) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }

    const overlap = await dbQuery(
      "select id, start_date, end_date from bookings where vehicle_id = $1 and status <> 'CANCELLED' and tstzrange($2::timestamptz, $3::timestamptz, '[)') && tstzrange(start_date::timestamptz, (end_date + interval '1 day')::timestamptz, '[)')",
      [vehicleId, startAt.toISOString(), endAt.toISOString()],
    );

    if (overlap.rowCount > 0) {
      const booking = overlap.rows[0];
      return NextResponse.json(
        {
          error: "This blockout overlaps an existing booking.",
          booking: {
            id: booking.id,
            start_date: booking.start_date,
            end_date: booking.end_date,
          },
        },
        { status: 409 },
      );
    }

    const updated = await dbQuery(
      "update blockouts set vehicle_id = $1, start_at = $2, end_at = $3, reason = $4, notes = $5, updated_at = now() where id = $6 returning *",
      [vehicleId, startAt.toISOString(), endAt.toISOString(), reason, notes || null, id],
    );

    if (updated.rowCount === 0) {
      return NextResponse.json({ error: "Blockout not found" }, { status: 404 });
    }

    return NextResponse.json({ blockout: updated.rows[0] });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "42P01") {
      return NextResponse.json(
        {
          error: "BLOCKOUTS_TABLE_MISSING",
          message: "Blockouts table is not installed. Apply schema.sql changes.",
        },
        { status: 500 },
      );
    }
    logError("api.admin.blockouts.PATCH", error, { userId: session.userId });
    return NextResponse.json({ error: "Failed to update blockout" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    if (!(await requireCsrf(request))) {
      return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
    }
    const { id } = await params;
    await dbQuery("delete from blockouts where id = $1", [id]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "42P01") {
      return NextResponse.json(
        {
          error: "BLOCKOUTS_TABLE_MISSING",
          message: "Blockouts table is not installed. Apply schema.sql changes.",
        },
        { status: 500 },
      );
    }
    logError("api.admin.blockouts.DELETE", error, { userId: session.userId });
    return NextResponse.json({ error: "Failed to delete blockout" }, { status: 500 });
  }
}
