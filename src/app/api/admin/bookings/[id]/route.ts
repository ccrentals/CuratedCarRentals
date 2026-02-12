import { NextResponse } from "next/server";

import { getSessionFromRequest } from "@/lib/auth/session";
import { dbQuery } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { getInternalNotesRecipient, sendBookingNoteEmail } from "@/lib/notifications/email";
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

function normalizeNoteTarget(value: unknown): "none" | "customer" | "internal" | "both" {
  if (typeof value !== "string") return "none";
  if (value === "customer" || value === "internal" || value === "both" || value === "none") {
    return value;
  }
  return "none";
}

function normalizeNoteSendMode(value: unknown): "immediate" | "scheduled" {
  if (typeof value === "string" && value === "scheduled") return "scheduled";
  return "immediate";
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

    const noteEmailTarget = normalizeNoteTarget(body?.noteEmailTarget);
    const noteSendMode = noteEmailTarget === "none" ? null : normalizeNoteSendMode(body?.noteSendMode);
    const noteScheduledForRaw =
      noteSendMode === "scheduled" && typeof body?.noteScheduledFor === "string"
        ? body.noteScheduledFor
        : null;
    let noteScheduledFor: string | null = null;
    if (noteSendMode === "scheduled") {
      if (!noteScheduledForRaw) {
        return NextResponse.json(
          { error: "Choose a date/time for the scheduled note email." },
          { status: 400 },
        );
      }
      const scheduledDate = new Date(noteScheduledForRaw);
      if (Number.isNaN(scheduledDate.getTime())) {
        return NextResponse.json({ error: "Invalid scheduled date/time." }, { status: 400 });
      }
      noteScheduledFor = scheduledDate.toISOString();
    }

    const bookingResult = await dbQuery<{
      pricing_json: Record<string, unknown> | null;
      start_date: string;
      end_date: string;
      pickup_location: string;
      customer_name: string;
      customer_email: string;
      vehicle_make: string;
      vehicle_model: string;
      vehicle_year: number;
    }>(
      "select b.pricing_json, b.start_date, b.end_date, b.pickup_location, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
      [id],
    );

    if (bookingResult.rowCount === 0) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const pricing = bookingResult.rows[0].pricing_json ?? {};
    const existingNotes = Array.isArray((pricing as { admin_notes?: unknown }).admin_notes)
      ? ((pricing as { admin_notes: unknown[] }).admin_notes as unknown[])
      : [];

    const createdAt = new Date().toISOString();
    const emailErrors: string[] = [];
    const sentTargets: ("customer" | "internal")[] = [];

    const newNote: Record<string, unknown> = {
      message: note,
      created_at: createdAt,
      user_id: session.userId,
      email_target: noteEmailTarget,
      email_send_mode: noteSendMode,
      email_scheduled_for: noteScheduledFor,
      email_customer_sent_at: null,
      email_internal_sent_at: null,
      email_last_error: null,
    };

    const booking = bookingResult.rows[0];
    const vehicleLabel = `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim();

    if (noteEmailTarget !== "none" && noteSendMode === "immediate") {
      if (noteEmailTarget === "customer" || noteEmailTarget === "both") {
        try {
          const customerSend = await sendBookingNoteEmail({
            bookingId: id,
            recipientEmail: booking.customer_email,
            recipientType: "customer",
            customerName: booking.customer_name,
            customerEmail: booking.customer_email,
            vehicleLabel,
            startDate: booking.start_date,
            endDate: booking.end_date,
            pickupLocation: booking.pickup_location,
            noteMessage: note,
            sentByUserId: session.userId,
          });
          if (customerSend.ok) {
            newNote.email_customer_sent_at = new Date().toISOString();
            sentTargets.push("customer");
          } else {
            emailErrors.push(customerSend.error ?? "customer delivery failed");
          }
        } catch {
          emailErrors.push("customer delivery failed");
        }
      }

      if (noteEmailTarget === "internal" || noteEmailTarget === "both") {
        try {
          const internalSend = await sendBookingNoteEmail({
            bookingId: id,
            recipientEmail: getInternalNotesRecipient(),
            recipientType: "internal",
            customerName: booking.customer_name,
            customerEmail: booking.customer_email,
            vehicleLabel,
            startDate: booking.start_date,
            endDate: booking.end_date,
            pickupLocation: booking.pickup_location,
            noteMessage: note,
            sentByUserId: session.userId,
          });
          if (internalSend.ok) {
            newNote.email_internal_sent_at = new Date().toISOString();
            sentTargets.push("internal");
          } else {
            emailErrors.push(internalSend.error ?? "internal delivery failed");
          }
        } catch {
          emailErrors.push("internal delivery failed");
        }
      }

      if (emailErrors.length > 0) {
        newNote.email_last_error = emailErrors.join(" | ").slice(0, 400);
      }
    }

    const updatedPricing = { ...pricing, admin_notes: [...existingNotes, newNote] };

    await dbQuery("update bookings set pricing_json = $1, updated_at = now() where id = $2", [
      updatedPricing,
      id,
    ]);

    await writeAuditLog({
      userId: session.userId,
      action: "BOOKING_NOTE_ADDED",
      entityType: "booking",
      entityId: id,
      details: {
        length: note.length,
        note_email_target: noteEmailTarget,
        note_send_mode: noteSendMode,
        note_scheduled_for: noteScheduledFor,
        note_email_sent_targets: sentTargets,
        note_email_error_count: emailErrors.length,
      },
    });

    let message = "Note saved.";
    if (noteEmailTarget !== "none" && noteSendMode === "scheduled") {
      message = "Note saved. Email scheduled.";
    } else if (sentTargets.length > 0 && emailErrors.length === 0) {
      message = "Note saved. Email sent.";
    } else if (sentTargets.length > 0 && emailErrors.length > 0) {
      message = "Note saved. Some emails could not be delivered.";
    } else if (noteEmailTarget !== "none" && emailErrors.length > 0) {
      message = "Note saved. Email delivery failed.";
    }

    return NextResponse.json({ ok: true, message });
  }

  return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
}
