import { NextResponse } from "next/server";

import { requireAdminRole } from "@/lib/auth/adminGuards";
import { requireCsrf } from "@/lib/security/csrf";
import { dbQuery } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { writeReminderRun } from "@/lib/cron/reminderRuns";
import {
  REMINDER_EVENTS,
  type ReminderEventType,
  type ReminderRunStatus,
} from "@/lib/cron/reminderTypes";

type SimulateMode = "pickup" | "balance" | "notes" | "all";

type BookingContext = {
  id: string;
  customer_name: string;
  customer_email: string;
  vehicle_make: string;
  vehicle_model: string;
  start_date: string;
  end_date: string;
};

function normalizeMode(value: unknown): SimulateMode {
  const normalized = String(value ?? "all").trim().toLowerCase();
  if (normalized === "pickup") return "pickup";
  if (normalized === "balance") return "balance";
  if (normalized === "notes") return "notes";
  return "all";
}

function runStatusForEventType(eventType: ReminderEventType): ReminderRunStatus {
  if (eventType.endsWith("_FAILED")) return "FAILED";
  if (eventType.endsWith("_CANCELLED")) return "CANCELLED";
  return "SUCCESS";
}

function countsForEventType(eventType: ReminderEventType) {
  const status = runStatusForEventType(eventType);
  return {
    attemptedCount: 1,
    sentCount: status === "SUCCESS" ? 1 : 0,
    failedCount: status === "FAILED" ? 1 : 0,
    cancelledCount: status === "CANCELLED" ? 1 : 0,
    skippedCount: 0,
  };
}

async function loadBookingContext() {
  const result = await dbQuery<BookingContext>(
    "select b.id, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model, b.start_date, b.end_date from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id order by b.created_at desc limit 1",
  );
  return result.rows[0] ?? null;
}

export async function POST(request: Request) {
  const auth = await requireAdminRole();
  if (!auth.ok) return auth.response;
  const { actor } = auth;

  if (!(await requireCsrf(request))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const body = await request.json().catch(() => null);
  const mode = normalizeMode(body?.mode);

  const booking = await loadBookingContext();
  const now = new Date();

  const eventTypes: ReminderEventType[] = [];
  if (mode === "pickup" || mode === "all") {
    eventTypes.push(REMINDER_EVENTS.PICKUP_SENT, REMINDER_EVENTS.PICKUP_FAILED);
  }
  if (mode === "balance" || mode === "all") {
    eventTypes.push(
      REMINDER_EVENTS.BALANCE_SENT,
      REMINDER_EVENTS.BALANCE_FAILED,
      REMINDER_EVENTS.DROPOFF_SENT,
      REMINDER_EVENTS.DROPOFF_FAILED,
      REMINDER_EVENTS.LATE_DROPOFF_SENT,
      REMINDER_EVENTS.LATE_DROPOFF_FAILED,
    );
  }
  if (mode === "notes" || mode === "all") {
    eventTypes.push(REMINDER_EVENTS.NOTE_SENT, REMINDER_EVENTS.NOTE_FAILED, REMINDER_EVENTS.NOTE_CANCELLED);
  }

  for (const eventType of eventTypes) {
    const runStatus = runStatusForEventType(eventType);
    const finishedAt = new Date();
    const details = {
      simulated: true,
      mode,
      run_status: runStatus,
      booking_id: booking?.id ?? null,
      customer_name: booking?.customer_name ?? null,
      customer_email: booking?.customer_email ?? null,
      vehicle: booking ? `${booking.vehicle_make} ${booking.vehicle_model}`.trim() : null,
      start_date: booking?.start_date ?? null,
      end_date: booking?.end_date ?? null,
      created_by_user_id: actor.userId,
      created_at: finishedAt.toISOString(),
    };

    await writeAuditLog({
      userId: actor.userId,
      action: eventType,
      entityType: "booking",
      entityId: booking?.id,
      details,
    });

    await writeReminderRun({
      eventType,
      status: runStatus,
      startedAt: now,
      finishedAt,
      source: "diagnostic",
      ...countsForEventType(eventType),
    });
  }

  return NextResponse.json({
    ok: true,
    mode,
    simulatedEvents: eventTypes.length,
    bookingContext: booking
      ? {
          bookingId: booking.id,
          customerName: booking.customer_name,
          customerEmail: booking.customer_email,
          vehicle: `${booking.vehicle_make} ${booking.vehicle_model}`.trim(),
          startDate: booking.start_date,
          endDate: booking.end_date,
        }
      : null,
  });
}
