import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { dbQuery, getDbPool } from "@/lib/db";
import { logError } from "@/lib/log";
import { requireCsrf } from "@/lib/security/csrf";

type BookingLocationRow = {
  id: string;
  label: string;
  allow_pickup: boolean;
  allow_dropoff: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

function normalizeText(value: unknown) {
  if (typeof value !== "string") return "";
  return value.trim();
}

export async function GET() {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  try {
    const result = await dbQuery<BookingLocationRow>(
      "select id, label, allow_pickup, allow_dropoff, is_active, sort_order, created_at, updated_at from booking_locations order by is_active desc, sort_order asc, label asc",
    );
    return NextResponse.json({ locations: result.rows });
  } catch (error) {
    logError("api.admin.booking-locations.GET", error, { userId: actor.userId });
    return NextResponse.json({ error: "Failed to load booking locations." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const label = normalizeText(body?.label);
  const allowPickup = body?.allowPickup !== false;
  const allowDropoff = body?.allowDropoff !== false;
  const sortOrderRaw = Number(body?.sortOrder);
  const sortOrder = Number.isFinite(sortOrderRaw) ? Math.max(0, Math.round(sortOrderRaw)) : 0;

  if (label.length < 2) {
    return NextResponse.json({ error: "Location label must be at least 2 characters." }, { status: 400 });
  }
  if (!allowPickup && !allowDropoff) {
    return NextResponse.json(
      { error: "Location must allow pickup, dropoff, or both." },
      { status: 400 },
    );
  }

  const pool = getDbPool();
  const client = await pool.connect();
  try {
    await client.query("begin");

    const existing = (await client.query(
      "select id from booking_locations where lower(label) = lower($1) limit 1 for update",
      [label],
    )) as { rowCount: number; rows: Array<{ id: string }> };

    if (existing.rowCount > 0) {
      await client.query(
        "update booking_locations set allow_pickup = $2, allow_dropoff = $3, is_active = true, sort_order = $4, updated_at = now() where id = $1",
        [existing.rows[0].id, allowPickup, allowDropoff, sortOrder],
      );
    } else {
      await client.query(
        "insert into booking_locations (label, allow_pickup, allow_dropoff, is_active, sort_order, created_by) values ($1, $2, $3, true, $4, $5)",
        [label, allowPickup, allowDropoff, sortOrder, actor.userId],
      );
    }

    await client.query("commit");
    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query("rollback");
    logError("api.admin.booking-locations.POST", error, { userId: actor.userId });
    return NextResponse.json({ error: "Failed to save booking location." }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(request: Request) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request, body?.csrfToken ?? null))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const id = normalizeText(body?.id);
  if (!id) {
    return NextResponse.json({ error: "Location id is required." }, { status: 400 });
  }

  try {
    const deleted = await dbQuery<{ id: string }>(
      "delete from booking_locations where id = $1 returning id",
      [id],
    );
    if (deleted.rowCount === 0) {
      return NextResponse.json({ error: "Location not found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("api.admin.booking-locations.DELETE", error, { userId: actor.userId, locationId: id });
    return NextResponse.json({ error: "Failed to delete booking location." }, { status: 500 });
  }
}
