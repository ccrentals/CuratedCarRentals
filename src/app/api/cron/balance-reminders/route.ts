import { NextResponse } from "next/server";

import { dbQuery, getDbPool } from "@/lib/db";
import {
  sendDropoffReminderEmail,
  sendLateDropoffAlertEmail,
} from "@/lib/notifications/email";
import { writeAuditLog } from "@/lib/audit";
import { computeBookingPricing } from "@/lib/payments/pricing";
import { loadAdminSettings } from "@/lib/adminSettings";

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function toDateKey(value: string) {
  const v = String(value ?? "");
  return v.length >= 10 ? v.slice(0, 10) : v;
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

  const { settings, source } = await loadAdminSettings();
  if (!settings.sendDropoffReminder && !settings.sendLateDropoffAlert) {
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

  const pool = getDbPool();

  for (const booking of bookingsResult.rows) {
    const pricing = booking.pricing_json ?? {};
    const dailyRate = Number(pricing.daily_rate_cents ?? booking.daily_rate_cents ?? 0);
    const deposit = Number(pricing.deposit_cents ?? booking.deposit_cents ?? 0);
    const paidToDate = Number(booking.paid_to_date ?? 0);
    const summary = computeBookingPricing({
      bookingId: booking.id,
      bookingStatus: booking.status,
      startDate: booking.start_date,
      endDate: booking.end_date,
      dailyRate,
      deposit,
      netPaidToDate: paidToDate,
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

    if (isDropoffDay) {
      await sendDropoffReminderEmail({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        vehicleLabel: `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim(),
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location,
        balanceDue,
      });
    } else {
      await sendLateDropoffAlertEmail({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        vehicleLabel: `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim(),
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location,
        balanceDue,
      });
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
        ? "BOOKING_DROPOFF_REMINDER_SENT"
        : "BOOKING_LATE_DROPOFF_ALERT_SENT",
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

  return NextResponse.json({
    ok: true,
    sent: sentDropoff + sentLate,
    sentDropoff,
    sentLate,
    skipped,
    settingsSource: source,
  });
}
