import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { loadAdminSettings } from "@/lib/adminSettings";
import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery, getDbPool } from "@/lib/db";
import { logError } from "@/lib/log";
import {
  getInternalNotesRecipient,
  sendBookingCancelledByBlockoutEmail,
} from "@/lib/notifications/email";
import { recalculateBookingPayments } from "@/lib/payments/recalculateBooking";
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

    const overlap = await dbQuery<{
      id: string;
      start_date: string;
      end_date: string;
      status: string;
      pickup_location: string;
      pricing_json: Record<string, unknown> | null;
      customer_name: string;
      customer_email: string;
      vehicle_make: string;
      vehicle_model: string;
    }>(
      "select b.id, b.start_date, b.end_date, b.status, b.pickup_location, b.pricing_json, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.vehicle_id = $1 and b.status not in ('CANCELLED','RETURNED') and tstzrange($2::timestamptz, $3::timestamptz, '[)') && tstzrange(b.start_date::timestamptz, (b.end_date + interval '1 day')::timestamptz, '[)') order by b.start_date asc",
      [vehicleId, startAt.toISOString(), endAt.toISOString()],
    );

    const { settings } = await loadAdminSettings();

    if (overlap.rowCount > 0) {
      if (settings.blockoutSupersedesBookings) {
        const db = getDbPool();
        const client = await db.connect();
        const nowIso = new Date().toISOString();
        const cancellationReason = `Cancelled automatically due to blockout (${reason}) ${startAt.toISOString()} to ${endAt.toISOString()}`;
        const cancelledBookings: Array<{
          id: string;
          customerName: string;
          customerEmail: string;
          vehicleLabel: string;
          startDate: string;
          endDate: string;
          pickupLocation: string;
        }> = [];

        try {
          await client.query("begin");

          const insert = await client.query(
            "insert into blockouts (vehicle_id, start_at, end_at, reason, notes, created_by) values ($1, $2, $3, $4, $5, $6) returning *",
            [vehicleId, startAt.toISOString(), endAt.toISOString(), reason, notes || null, session.userId],
          );

          for (const booking of overlap.rows) {
            const pricing = booking.pricing_json ?? {};
            const existingNotes = Array.isArray(pricing.admin_notes)
              ? pricing.admin_notes.filter(
                  (value: unknown): value is string => typeof value === "string",
                )
              : [];
            const updatedPricing = {
              ...pricing,
              cancelled_by_blockout: true,
              cancelled_by_blockout_at: nowIso,
              cancelled_by_blockout_reason: cancellationReason,
              admin_notes: [...existingNotes, `[${nowIso}] ${cancellationReason}`],
            };

            await client.query(
              "update bookings set status = 'CANCELLED', pricing_json = $1, updated_at = now() where id = $2",
              [updatedPricing, booking.id],
            );

            await recalculateBookingPayments(booking.id, { client });

            cancelledBookings.push({
              id: booking.id,
              customerName: booking.customer_name,
              customerEmail: booking.customer_email,
              vehicleLabel: `${booking.vehicle_make} ${booking.vehicle_model}`,
              startDate: booking.start_date,
              endDate: booking.end_date,
              pickupLocation: booking.pickup_location,
            });
          }

          await client.query("commit");

          for (const booking of cancelledBookings) {
            await writeAuditLog({
              userId: session.userId,
              action: "BOOKING_CANCELLED_BY_BLOCKOUT",
              entityType: "booking",
              entityId: booking.id,
              details: {
                reason: cancellationReason,
                blockoutVehicleId: vehicleId,
                blockoutStartAt: startAt.toISOString(),
                blockoutEndAt: endAt.toISOString(),
              },
            });

            await sendBookingCancelledByBlockoutEmail({
              recipientType: "customer",
              recipientEmail: booking.customerEmail,
              bookingId: booking.id,
              customerName: booking.customerName,
              customerEmail: booking.customerEmail,
              vehicleLabel: booking.vehicleLabel,
              startDate: booking.startDate,
              endDate: booking.endDate,
              pickupLocation: booking.pickupLocation,
              blockoutReason: reason,
              blockoutStart: startAt.toISOString(),
              blockoutEnd: endAt.toISOString(),
            });

            await sendBookingCancelledByBlockoutEmail({
              recipientType: "internal",
              recipientEmail: getInternalNotesRecipient(),
              bookingId: booking.id,
              customerName: booking.customerName,
              customerEmail: booking.customerEmail,
              vehicleLabel: booking.vehicleLabel,
              startDate: booking.startDate,
              endDate: booking.endDate,
              pickupLocation: booking.pickupLocation,
              blockoutReason: reason,
              blockoutStart: startAt.toISOString(),
              blockoutEnd: endAt.toISOString(),
            });
          }

          return NextResponse.json({
            blockout: insert.rows[0],
            autoCancelledBookings: cancelledBookings.length,
          });
        } catch (error) {
          await client.query("rollback");
          throw error;
        } finally {
          client.release();
        }
      }

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
