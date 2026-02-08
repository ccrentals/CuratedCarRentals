import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { requireCsrf } from "@/lib/security/csrf";

function isAdminRole(role: string | undefined) {
  return String(role ?? "")
    .trim()
    .toUpperCase() === "ADMIN";
}

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  return code === "42703" && message.includes(`"${column}"`) && message.includes("does not exist");
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const bookingResult = await dbQuery(
    "select b.*, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
    [id],
  );

  if (bookingResult.rowCount === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const paymentsResult = await dbQuery(
    "select id, provider, status, deposit_amount_cents, currency, created_at from payments where booking_id = $1 order by created_at desc",
    [id],
  );

  const booking = bookingResult.rows[0];

  return NextResponse.json({
    booking: {
      id: booking.id,
      start_date: booking.start_date,
      end_date: booking.end_date,
      pickup_location: booking.pickup_location,
      status: booking.status,
      pricing_json: booking.pricing_json,
    },
    customer: {
      full_name: booking.customer_name,
      email: booking.customer_email,
      phone: booking.customer_phone,
    },
    vehicle: {
      make: booking.vehicle_make,
      model: booking.vehicle_model,
      year: booking.vehicle_year,
    },
    payments: paymentsResult.rows,
  });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSessionFromRequest();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!(await requireCsrf(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }
  const action = typeof body?.action === "string" ? body.action : "";

  if (!action) {
    return NextResponse.json({ error: "Action is required" }, { status: 400 });
  }

  if (action === "confirm") {
    const bookingResult = await dbQuery<{ status: string }>(
      "select status from bookings where id = $1",
      [id],
    );

    if (bookingResult.rowCount === 0) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const status = bookingResult.rows[0].status;
    if (!["PENDING_PAYMENT", "PENDING"].includes(status)) {
      return NextResponse.json({ error: "Booking cannot be confirmed" }, { status: 400 });
    }

    await dbQuery("update bookings set status = 'CONFIRMED', updated_at = now() where id = $1", [
      id,
    ]);

    await writeAuditLog({
      userId: session.userId,
      action: "BOOKING_CONFIRMED",
      entityType: "booking",
      entityId: id,
      details: { previous_status: status },
    });

    return NextResponse.json({ ok: true });
  }

  if (action === "complete") {
    const bookingResult = await dbQuery<{ status: string }>(
      "select status from bookings where id = $1",
      [id],
    );

    if (bookingResult.rowCount === 0) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const status = bookingResult.rows[0].status;
    if (!["CONFIRMED", "PICKED_UP"].includes(status)) {
      return NextResponse.json({ error: "Booking cannot be completed" }, { status: 400 });
    }

    try {
      await dbQuery(
        "update bookings set status = 'RETURNED', archived_at = now(), archived_by_user_id = $2, archived_reason = $3, updated_at = now() where id = $1",
        [id, session.userId, "Completed/Returned"],
      );
    } catch (error) {
      // Graceful fallback if DB hasn't been migrated yet.
      if (isUndefinedColumn(error, "archived_at")) {
        await dbQuery("update bookings set status = 'RETURNED', updated_at = now() where id = $1", [
          id,
        ]);
      } else {
        throw error;
      }
    }

    await writeAuditLog({
      userId: session.userId,
      action: "BOOKING_COMPLETED",
      entityType: "booking",
      entityId: id,
      details: { previous_status: status },
    });

    await writeAuditLog({
      userId: session.userId,
      action: "BOOKING_ARCHIVED",
      entityType: "booking",
      entityId: id,
      details: { reason: "Completed/Returned" },
    });

    return NextResponse.json({ ok: true });
  }

  if (action === "archive") {
    if (!isAdminRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
    if (!reason) {
      return NextResponse.json({ error: "Reason is required" }, { status: 400 });
    }

    try {
      await dbQuery(
        "update bookings set archived_at = now(), archived_by_user_id = $2, archived_reason = $3, updated_at = now() where id = $1",
        [id, session.userId, reason],
      );
    } catch (error) {
      if (isUndefinedColumn(error, "archived_at")) {
        return NextResponse.json(
          { error: "ARCHIVE_NOT_CONFIGURED", message: "Archive columns are missing. Apply schema.sql changes." },
          { status: 500 },
        );
      }
      throw error;
    }

    await writeAuditLog({
      userId: session.userId,
      action: "BOOKING_ARCHIVED",
      entityType: "booking",
      entityId: id,
      details: { reason },
    });

    return NextResponse.json({ ok: true });
  }

  if (action === "unarchive") {
    if (!isAdminRole(session.role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    try {
      await dbQuery(
        "update bookings set archived_at = null, archived_by_user_id = null, archived_reason = null, updated_at = now() where id = $1",
        [id],
      );
    } catch (error) {
      if (isUndefinedColumn(error, "archived_at")) {
        return NextResponse.json(
          { error: "ARCHIVE_NOT_CONFIGURED", message: "Archive columns are missing. Apply schema.sql changes." },
          { status: 500 },
        );
      }
      throw error;
    }

    await writeAuditLog({
      userId: session.userId,
      action: "BOOKING_UNARCHIVED",
      entityType: "booking",
      entityId: id,
      details: {},
    });

    return NextResponse.json({ ok: true });
  }

  if (action === "add_note") {
    const note = typeof body?.note === "string" ? body.note.trim() : "";
    if (!note) {
      return NextResponse.json({ error: "Note is required" }, { status: 400 });
    }

    const bookingResult = await dbQuery<{ pricing_json: Record<string, unknown> | null }>(
      "select pricing_json from bookings where id = $1",
      [id],
    );

    if (bookingResult.rowCount === 0) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const pricing = bookingResult.rows[0].pricing_json ?? {};
    const existingNotes = Array.isArray((pricing as { admin_notes?: unknown }).admin_notes)
      ? ((pricing as { admin_notes: unknown[] }).admin_notes as unknown[])
      : [];

    const updatedPricing = {
      ...pricing,
      admin_notes: [
        ...existingNotes,
        { message: note, created_at: new Date().toISOString(), user_id: session.userId },
      ],
    };

    await dbQuery("update bookings set pricing_json = $1, updated_at = now() where id = $2", [
      updatedPricing,
      id,
    ]);

    await writeAuditLog({
      userId: session.userId,
      action: "BOOKING_NOTE_ADDED",
      entityType: "booking",
      entityId: id,
      details: { length: note.length },
    });

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
