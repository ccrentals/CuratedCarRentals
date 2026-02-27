import { NextResponse } from "next/server";

import { writeAuditLog } from "@/lib/audit";
import { loadAdminSettings } from "@/lib/adminSettings";
import { requireStaffOrAdminRole } from "@/lib/auth/adminGuards";
import { dbQuery, getDbPool } from "@/lib/db";
import { logError } from "@/lib/log";
import {
  getInternalNotesRecipient,
  sendBookingCancelledByBlockoutEmail,
} from "@/lib/notifications/email";
import {
  buildBookingBlocksAvailabilitySql,
  buildBookingWindowEndSql,
  buildBookingWindowStartSql,
  isBookingBlockingAvailability,
} from "@/lib/bookings/bookingBlocking";
import { recalculateBookingPayments } from "@/lib/payments/recalculateBooking";
import { requireCsrf } from "@/lib/security/csrf";
import { createBlockout, listBlockouts } from "@/lib/blockouts/shared";

function parseDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function GET(request: Request) {
  const auth = await requireStaffOrAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  const { searchParams } = new URL(request.url);
  const start = searchParams.get("start");
  const end = searchParams.get("end");
  const vehicleId = searchParams.get("vehicleId");

  try {
    const hasStart = Boolean(start);
    const hasEnd = Boolean(end);
    if (hasStart !== hasEnd) {
      return NextResponse.json({ error: "start and end must be provided together" }, { status: 400 });
    }
    if (!hasStart && !vehicleId) {
      return NextResponse.json({ error: "Provide vehicleId or start/end range." }, { status: 400 });
    }

    let rangeStartIso: string | null = null;
    let rangeEndIso: string | null = null;
    if (hasStart && hasEnd) {
      const startAt = parseDate(start as string);
      const endAt = parseDate(end as string);
      if (!startAt || !endAt) {
        return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
      }
      rangeStartIso = startAt.toISOString();
      rangeEndIso = endAt.toISOString();
    }

    const blockouts = await listBlockouts({
      rangeStartIso,
      rangeEndIso,
      vehicleId,
      limit: hasStart && hasEnd ? null : 250,
    });

    return NextResponse.json({ blockouts });
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
    logError("api.admin.blockouts.GET", error, { userId: actor.userId, start, end, vehicleId });
    return NextResponse.json({ error: "Failed to load blockouts" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const auth = await requireStaffOrAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

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

    const overlapWindowStartSql = buildBookingWindowStartSql("b");
    const overlapWindowEndSql = buildBookingWindowEndSql("b");
    const overlapBlocksAvailabilitySql = buildBookingBlocksAvailabilitySql("b");
    const overlap = await dbQuery<{
      id: string;
      start_date: string;
      end_date: string;
      start_at: string | null;
      end_at: string | null;
      status: string;
      pickup_location: string;
      pricing_json: Record<string, unknown> | null;
      customer_name: string;
      customer_email: string;
      vehicle_make: string;
      vehicle_model: string;
    }>(
      "select b.id, b.start_date, b.end_date, " +
        `${overlapWindowStartSql} as start_at, ${overlapWindowEndSql} as end_at, ` +
        "b.status, b.pickup_location, b.pricing_json, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model " +
        "from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id " +
        "where b.vehicle_id = $1 and " +
        overlapBlocksAvailabilitySql +
        " and " +
        overlapWindowStartSql +
        " < $3::timestamptz and " +
        overlapWindowEndSql +
        " > $2::timestamptz order by " +
        overlapWindowStartSql +
        " asc",
      [vehicleId, startAt.toISOString(), endAt.toISOString()],
    );
    const blockingOverlapRows = overlap.rows.filter(
      (booking: { status: string; pricing_json: Record<string, unknown> | null }) =>
        isBookingBlockingAvailability({
          status: booking.status,
          pricing_json: booking.pricing_json,
        }),
    );

    const { settings } = await loadAdminSettings();

    if (blockingOverlapRows.length > 0) {
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
            [vehicleId, startAt.toISOString(), endAt.toISOString(), reason, notes || null, actor.userId],
          );

          const updateBlocksAvailabilitySql = buildBookingBlocksAvailabilitySql("bookings");
          for (const booking of blockingOverlapRows) {
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
              "update bookings set status = 'CANCELLED', pricing_json = $1, updated_at = now() where id = $2 and " +
                updateBlocksAvailabilitySql,
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
              userId: actor.userId,
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

      const booking = blockingOverlapRows[0];
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

    const insert = await createBlockout({
      vehicleId,
      startAtIso: startAt.toISOString(),
      endAtIso: endAt.toISOString(),
      reason,
      notes: notes || null,
      createdByUserId: actor.userId,
    });

    return NextResponse.json({ blockout: insert });
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
    logError("api.admin.blockouts.POST", error, { userId: actor.userId, vehicleId });
    return NextResponse.json({ error: "Failed to create blockout" }, { status: 500 });
  }
}
