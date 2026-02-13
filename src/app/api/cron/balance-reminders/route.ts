import { NextResponse } from "next/server";

import { dbQuery, getDbPool } from "@/lib/db";
import {
  sendDropoffReminderEmail,
  sendLateDropoffAlertEmail,
} from "@/lib/notifications/email";
import { writeAuditLog } from "@/lib/audit";
import { computeBookingPricing, readPromoPricingFields } from "@/lib/payments/pricing";
import { loadAdminSettings } from "@/lib/adminSettings";
import { logError } from "@/lib/log";
import { writeReminderRun } from "@/lib/cron/reminderRuns";
import { BALANCE_REMINDER_EVENT_TYPES, REMINDER_EVENTS } from "@/lib/cron/reminderTypes";

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function toDateKey(value: string) {
  const v = String(value ?? "");
  return v.length >= 10 ? v.slice(0, 10) : v;
}

export async function POST(request: Request) {
  const runStartedAt = new Date();
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 500 });
  }

  const provided = request.headers.get("x-cron-secret");
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { settings, source } = await loadAdminSettings();
  if (!settings.sendDropoffReminder && !settings.sendLateDropoffAlert) {
    const runFinishedAt = new Date();
    for (const eventType of BALANCE_REMINDER_EVENT_TYPES) {
      await writeReminderRun({
        eventType,
        status: "CANCELLED",
        startedAt: runStartedAt,
        finishedAt: runFinishedAt,
        attemptedCount: 0,
        sentCount: 0,
        failedCount: 0,
        skippedCount: 0,
        errorSummary: "Dropoff and late-dropoff reminders are disabled in admin settings",
        source: "cron",
      });
    }
    return NextResponse.json({
      ok: true,
      sent: 0,
      skipped: 0,
      reason: "Dropoff and late-dropoff reminders are disabled in admin settings",
      settingsSource: source,
    });
  }

  const today = getTodayKey();

  const bookingsResult = await dbQuery<{
    id: string;
    status: string;
    start_date: string;
    end_date: string;
    pickup_location: string;
    pricing_json: Record<string, unknown> | null;
    customer_name: string;
    customer_email: string;
    vehicle_make: string;
    vehicle_model: string;
    vehicle_year: number;
    daily_rate_cents: number;
    deposit_cents: number;
    paid_to_date: number;
  }>(
    "select b.id, b.status, b.start_date, b.end_date, b.pickup_location, b.pricing_json, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents, coalesce(sum(p.deposit_amount_cents), 0) as paid_to_date from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id left join payments p on p.booking_id = b.id and p.deleted_at is null and p.status in ('DEPOSIT_PAID','REFUNDED') where b.end_date <= $1 and b.status in ('CONFIRMED','PICKED_UP') group by b.id, c.full_name, c.email, v.make, v.model, v.year, v.daily_rate_cents, v.deposit_cents",
    [today],
  );

  let sentDropoff = 0;
  let sentLate = 0;
  let skipped = 0;
  let failures = 0;
  let attemptedBalance = 0;
  let attemptedDropoff = 0;
  let attemptedLate = 0;
  let failedDropoff = 0;
  let failedLate = 0;

  const pool = getDbPool();
  try {
    for (const booking of bookingsResult.rows) {
      const pricing = booking.pricing_json ?? {};
      const dailyRate = Number(pricing.daily_rate_cents ?? booking.daily_rate_cents ?? 0);
      const deposit = Number(pricing.deposit_cents ?? booking.deposit_cents ?? 0);
      const { promoCode, promoDiscount } = readPromoPricingFields(pricing);
      const paidToDate = Number(booking.paid_to_date ?? 0);
      const summary = computeBookingPricing({
        bookingId: booking.id,
        bookingStatus: booking.status,
        startDate: booking.start_date,
        endDate: booking.end_date,
        dailyRate,
        deposit,
        netPaidToDate: paidToDate,
        promoCode,
        promoDiscount,
      });
      const balanceDue = summary.balanceDue;
      const endDateKey = toDateKey(booking.end_date);
      const isDropoffDay = endDateKey === today;
      const isLate = endDateKey < today;

      if (balanceDue <= 0 || (!isDropoffDay && !isLate)) {
        skipped += 1;
        continue;
      }

      if (isDropoffDay && !settings.sendDropoffReminder) {
        skipped += 1;
        continue;
      }

      if (isLate && !settings.sendLateDropoffAlert) {
        skipped += 1;
        continue;
      }

      const lastDropoffReminder = (pricing as Record<string, unknown>).dropoff_reminder_sent_at;
      const lastLateReminder = (pricing as Record<string, unknown>).late_dropoff_alert_sent_at;
      if (
        isDropoffDay &&
        typeof lastDropoffReminder === "string" &&
        lastDropoffReminder.slice(0, 10) === today
      ) {
        skipped += 1;
        continue;
      }

      if (isLate && typeof lastLateReminder === "string" && lastLateReminder.slice(0, 10) === today) {
        skipped += 1;
        continue;
      }

      attemptedBalance += 1;

      if (isDropoffDay) {
        attemptedDropoff += 1;
        const sendResult = await sendDropoffReminderEmail({
          bookingId: booking.id,
          customerEmail: booking.customer_email,
          customerName: booking.customer_name,
          vehicleLabel: `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim(),
          startDate: booking.start_date,
          endDate: booking.end_date,
          pickupLocation: booking.pickup_location,
          balanceDue,
        });
        if (!sendResult.ok) {
          await writeAuditLog({
            userId: "system",
            action: REMINDER_EVENTS.DROPOFF_FAILED,
            entityType: "booking",
            entityId: booking.id,
            details: {
              balance_due: balanceDue,
              dropoff_date: booking.end_date,
              reminder_type: "dropoff",
              error: sendResult.error ?? "delivery failed",
            },
          });
          await writeAuditLog({
            userId: "system",
            action: REMINDER_EVENTS.BALANCE_FAILED,
            entityType: "booking",
            entityId: booking.id,
            details: {
              balance_due: balanceDue,
              dropoff_date: booking.end_date,
              reminder_type: "dropoff",
              error: sendResult.error ?? "delivery failed",
            },
          });
          failures += 1;
          failedDropoff += 1;
          continue;
        }
      } else {
        attemptedLate += 1;
        const sendResult = await sendLateDropoffAlertEmail({
          bookingId: booking.id,
          customerEmail: booking.customer_email,
          customerName: booking.customer_name,
          vehicleLabel: `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim(),
          startDate: booking.start_date,
          endDate: booking.end_date,
          pickupLocation: booking.pickup_location,
          balanceDue,
        });
        if (!sendResult.ok) {
          await writeAuditLog({
            userId: "system",
            action: REMINDER_EVENTS.LATE_DROPOFF_FAILED,
            entityType: "booking",
            entityId: booking.id,
            details: {
              balance_due: balanceDue,
              dropoff_date: booking.end_date,
              reminder_type: "late_dropoff",
              error: sendResult.error ?? "delivery failed",
            },
          });
          await writeAuditLog({
            userId: "system",
            action: REMINDER_EVENTS.BALANCE_FAILED,
            entityType: "booking",
            entityId: booking.id,
            details: {
              balance_due: balanceDue,
              dropoff_date: booking.end_date,
              reminder_type: "late_dropoff",
              error: sendResult.error ?? "delivery failed",
            },
          });
          failures += 1;
          failedLate += 1;
          continue;
        }
      }

      const updatedPricing = {
        ...pricing,
        ...(isDropoffDay
          ? { dropoff_reminder_sent_at: new Date().toISOString() }
          : { late_dropoff_alert_sent_at: new Date().toISOString() }),
      };

      const client = await pool.connect();
      try {
        await client.query("update bookings set pricing_json = $1 where id = $2", [
          updatedPricing,
          booking.id,
        ]);
      } finally {
        client.release();
      }

      await writeAuditLog({
        userId: "system",
        action: isDropoffDay
          ? REMINDER_EVENTS.DROPOFF_SENT
          : REMINDER_EVENTS.LATE_DROPOFF_SENT,
        entityType: "booking",
        entityId: booking.id,
        details: {
          balance_due: balanceDue,
          dropoff_date: booking.end_date,
          reminder_type: isDropoffDay ? "dropoff" : "late_dropoff",
        },
      });
      await writeAuditLog({
        userId: "system",
        action: REMINDER_EVENTS.BALANCE_SENT,
        entityType: "booking",
        entityId: booking.id,
        details: {
          balance_due: balanceDue,
          dropoff_date: booking.end_date,
          reminder_type: isDropoffDay ? "dropoff" : "late_dropoff",
        },
      });

      if (isDropoffDay) {
        sentDropoff += 1;
      } else {
        sentLate += 1;
      }
    }

    const runFinishedAt = new Date();
    const sentBalance = sentDropoff + sentLate;
    const failedBalance = failedDropoff + failedLate;

    await writeReminderRun({
      eventType: REMINDER_EVENTS.BALANCE_SENT,
      status: "SUCCESS",
      startedAt: runStartedAt,
      finishedAt: runFinishedAt,
      attemptedCount: attemptedBalance,
      sentCount: sentBalance,
      failedCount: failedBalance,
      skippedCount: skipped,
      source: "cron",
    });
    await writeReminderRun({
      eventType: REMINDER_EVENTS.BALANCE_FAILED,
      status: failedBalance > 0 ? "FAILED" : "SUCCESS",
      startedAt: runStartedAt,
      finishedAt: runFinishedAt,
      attemptedCount: attemptedBalance,
      sentCount: sentBalance,
      failedCount: failedBalance,
      skippedCount: skipped,
      source: "cron",
    });

    await writeReminderRun({
      eventType: REMINDER_EVENTS.DROPOFF_SENT,
      status: settings.sendDropoffReminder ? "SUCCESS" : "CANCELLED",
      startedAt: runStartedAt,
      finishedAt: runFinishedAt,
      attemptedCount: attemptedDropoff,
      sentCount: sentDropoff,
      failedCount: failedDropoff,
      skippedCount: skipped,
      errorSummary: settings.sendDropoffReminder ? null : "Dropoff reminders disabled in admin settings",
      source: "cron",
    });
    await writeReminderRun({
      eventType: REMINDER_EVENTS.DROPOFF_FAILED,
      status: settings.sendDropoffReminder
        ? failedDropoff > 0
          ? "FAILED"
          : "SUCCESS"
        : "CANCELLED",
      startedAt: runStartedAt,
      finishedAt: runFinishedAt,
      attemptedCount: attemptedDropoff,
      sentCount: sentDropoff,
      failedCount: failedDropoff,
      skippedCount: skipped,
      errorSummary: settings.sendDropoffReminder ? null : "Dropoff reminders disabled in admin settings",
      source: "cron",
    });

    await writeReminderRun({
      eventType: REMINDER_EVENTS.LATE_DROPOFF_SENT,
      status: settings.sendLateDropoffAlert ? "SUCCESS" : "CANCELLED",
      startedAt: runStartedAt,
      finishedAt: runFinishedAt,
      attemptedCount: attemptedLate,
      sentCount: sentLate,
      failedCount: failedLate,
      skippedCount: skipped,
      errorSummary: settings.sendLateDropoffAlert ? null : "Late dropoff reminders disabled in admin settings",
      source: "cron",
    });
    await writeReminderRun({
      eventType: REMINDER_EVENTS.LATE_DROPOFF_FAILED,
      status: settings.sendLateDropoffAlert
        ? failedLate > 0
          ? "FAILED"
          : "SUCCESS"
        : "CANCELLED",
      startedAt: runStartedAt,
      finishedAt: runFinishedAt,
      attemptedCount: attemptedLate,
      sentCount: sentLate,
      failedCount: failedLate,
      skippedCount: skipped,
      errorSummary: settings.sendLateDropoffAlert
        ? null
        : "Late dropoff reminders disabled in admin settings",
      source: "cron",
    });

    return NextResponse.json({
      ok: true,
      sent: sentDropoff + sentLate,
      sentDropoff,
      sentLate,
      skipped,
      failures,
      settingsSource: source,
    });
  } catch (error) {
    const runFinishedAt = new Date();
    const safeError = error instanceof Error ? error.message : "Balance reminder job failed";

    for (const eventType of BALANCE_REMINDER_EVENT_TYPES) {
      await writeReminderRun({
        eventType,
        status: "FAILED",
        startedAt: runStartedAt,
        finishedAt: runFinishedAt,
        attemptedCount: attemptedBalance,
        sentCount: sentDropoff + sentLate,
        failedCount: failures,
        skippedCount: skipped,
        errorSummary: safeError,
        source: "cron",
      });
    }

    logError("cron_balance_reminders_failed", error, {
      attemptedBalance,
      attemptedDropoff,
      attemptedLate,
      sentDropoff,
      sentLate,
      failures,
      skipped,
    });
    return NextResponse.json({ ok: false, error: "Failed to run balance reminders" }, { status: 500 });
  }
}
