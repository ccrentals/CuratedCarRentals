import { NextResponse } from "next/server";

import { dbQuery } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { getInternalNotesRecipient, sendBookingNoteEmail } from "@/lib/notifications/email";

type BookingRow = {
  id: string;
  start_date: string;
  end_date: string;
  pickup_location: string;
  pricing_json: Record<string, unknown> | null;
  customer_name: string;
  customer_email: string;
  vehicle_make: string;
  vehicle_model: string;
  vehicle_year: number;
};

type NoteTarget = "none" | "customer" | "internal" | "both";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeTarget(value: unknown): NoteTarget {
  const normalized = String(value ?? "none").toLowerCase();
  if (normalized === "customer") return "customer";
  if (normalized === "internal") return "internal";
  if (normalized === "both") return "both";
  return "none";
}

export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 500 });
  }

  const provided = request.headers.get("x-cron-secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const nowMs = now.getTime();

  const bookingsResult = await dbQuery<BookingRow>(
    "select b.id, b.start_date, b.end_date, b.pickup_location, b.pricing_json, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where (b.pricing_json -> 'admin_notes') is not null",
  );

  let bookingsUpdated = 0;
  let dueNotes = 0;
  let emailsSent = 0;
  let emailFailures = 0;

  for (const booking of bookingsResult.rows) {
    const pricing = booking.pricing_json ?? {};
    const notes = Array.isArray((pricing as { admin_notes?: unknown }).admin_notes)
      ? ((pricing as { admin_notes: unknown[] }).admin_notes as unknown[])
      : [];
    if (notes.length === 0) continue;

    let bookingChanged = false;
    const nextNotes = [...notes];
    const vehicleLabel = `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim();

    for (let index = 0; index < nextNotes.length; index += 1) {
      const note = asRecord(nextNotes[index]);
      if (!note) continue;

      const target = normalizeTarget(note.email_target);
      const sendMode = String(note.email_send_mode ?? "").toLowerCase();
      if (target === "none" || sendMode !== "scheduled") continue;

      const scheduledFor = typeof note.email_scheduled_for === "string" ? note.email_scheduled_for : null;
      if (!scheduledFor) continue;

      const scheduledMs = Date.parse(scheduledFor);
      if (Number.isNaN(scheduledMs) || scheduledMs > nowMs) continue;

      dueNotes += 1;

      const message = typeof note.message === "string" ? note.message.trim() : "";
      if (!message) {
        note.email_last_error = "Scheduled note has no message.";
        bookingChanged = true;
        emailFailures += 1;
        nextNotes[index] = note;
        continue;
      }

      const shouldCustomer =
        (target === "customer" || target === "both") && !note.email_customer_sent_at;
      const shouldInternal =
        (target === "internal" || target === "both") && !note.email_internal_sent_at;

      if (!shouldCustomer && !shouldInternal) {
        continue;
      }

      const sentTargets: ("customer" | "internal")[] = [];
      const errors: string[] = [];

      if (shouldCustomer) {
        try {
          const sendResult = await sendBookingNoteEmail({
            bookingId: booking.id,
            recipientEmail: booking.customer_email,
            recipientType: "customer",
            customerName: booking.customer_name,
            customerEmail: booking.customer_email,
            vehicleLabel,
            startDate: booking.start_date,
            endDate: booking.end_date,
            pickupLocation: booking.pickup_location,
            noteMessage: message,
            scheduledFor,
          });
          if (sendResult.ok) {
            note.email_customer_sent_at = new Date().toISOString();
            sentTargets.push("customer");
          } else {
            errors.push(sendResult.error ?? "customer delivery failed");
          }
        } catch {
          errors.push("customer delivery failed");
        }
      }

      if (shouldInternal) {
        try {
          const sendResult = await sendBookingNoteEmail({
            bookingId: booking.id,
            recipientEmail: getInternalNotesRecipient(),
            recipientType: "internal",
            customerName: booking.customer_name,
            customerEmail: booking.customer_email,
            vehicleLabel,
            startDate: booking.start_date,
            endDate: booking.end_date,
            pickupLocation: booking.pickup_location,
            noteMessage: message,
            scheduledFor,
          });
          if (sendResult.ok) {
            note.email_internal_sent_at = new Date().toISOString();
            sentTargets.push("internal");
          } else {
            errors.push(sendResult.error ?? "internal delivery failed");
          }
        } catch {
          errors.push("internal delivery failed");
        }
      }

      emailsSent += sentTargets.length;
      emailFailures += errors.length;
      note.email_last_error = errors.length > 0 ? errors.join(" | ").slice(0, 400) : null;
      bookingChanged = true;
      nextNotes[index] = note;

      if (sentTargets.length > 0) {
        await writeAuditLog({
          userId: "system",
          action: "BOOKING_NOTE_EMAIL_SENT",
          entityType: "booking",
          entityId: booking.id,
          details: {
            targets: sentTargets,
            mode: "scheduled",
            scheduled_for: scheduledFor,
          },
        });
      }

      if (errors.length > 0) {
        await writeAuditLog({
          userId: "system",
          action: "BOOKING_NOTE_EMAIL_FAILED",
          entityType: "booking",
          entityId: booking.id,
          details: {
            mode: "scheduled",
            scheduled_for: scheduledFor,
            error_count: errors.length,
          },
        });
      }
    }

    if (!bookingChanged) continue;

    const updatedPricing = { ...pricing, admin_notes: nextNotes };
    await dbQuery("update bookings set pricing_json = $1, updated_at = now() where id = $2", [
      updatedPricing,
      booking.id,
    ]);
    bookingsUpdated += 1;
  }

  return NextResponse.json({
    ok: true,
    bookingsScanned: bookingsResult.rows.length,
    bookingsUpdated,
    dueNotes,
    emailsSent,
    emailFailures,
  });
}
