import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";

function parseDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: Request) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const vehicleId = searchParams.get("vehicleId");

  try {
    if (!start || !end) {
      return NextResponse.json({ error: "start and end are required" }, { status: 400 });
    }

    const startAt = parseDate(start);
    const endAt = parseDate(end);
    if (!startAt || !endAt) {
      return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
    }

    const query =
      "select b.id, b.vehicle_id, b.start_at, b.end_at, b.reason, b.notes, b.created_at, b.updated_at, v.make as vehicle_make, v.model as vehicle_model from blockouts b join vehicles v on v.id = b.vehicle_id where b.start_at < $2 and b.end_at > $1 " +
      (vehicleId ? "and b.vehicle_id = $3 " : "") +
      "order by b.start_at asc";

    const values = vehicleId
      ? [startAt.toISOString(), endAt.toISOString(), vehicleId]
      : [startAt.toISOString(), endAt.toISOString()];
    const blockouts = await dbQuery(query, values);

    return NextResponse.json({ blockouts: blockouts.rows });
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
    logError("api.admin.blockouts.GET", error, { userId: session.userId, start, end, vehicleId });
    return NextResponse.json({ error: "Failed to load blockouts" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let vehicleId = "";

  try {
    const body = await request.json().catch(() => null);
    if (!(await requireCsrf(request))) {
      return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
    }
    vehicleId = typeof body?.vehicleId === "string" ? body.vehicleId : "";
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

    const insert = await dbQuery(
      "insert into blockouts (vehicle_id, start_at, end_at, reason, notes, created_by) values ($1, $2, $3, $4, $5, $6) returning *",
      [vehicleId, startAt.toISOString(), endAt.toISOString(), reason, notes || null, session.userId],
    );

    return NextResponse.json({ blockout: insert.rows[0] });
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
    logError("api.admin.blockouts.POST", error, { userId: session.userId, vehicleId });
    return NextResponse.json({ error: "Failed to create blockout" }, { status: 500 });
  }
}
