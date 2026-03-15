import { NextResponse } from "next/server";

import { bookingAccessForbiddenResponse, hasPublicBookingAccessForRequest } from "@/lib/bookings/publicAccess";
import { getDbPool } from "@/lib/db";
import { writeAuditLog } from "@/lib/audit";
import { logError } from "@/lib/log";
import {
  computeBookingPricingFromStoredSnapshot,
  fetchNetPaidToDate,
  normalizePaymentStatus,
} from "@/lib/payments/pricing";
import { requireCsrf } from "@/lib/security/csrf";

type BookingRow = {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  pricing_json: Record<string, unknown> | null;
  daily_rate_cents: number;
  deposit_cents: number;
};

function buildPricingSnapshot(
  existingPricing: Record<string, unknown> | null,
  summary: ReturnType<typeof computeBookingPricingFromStoredSnapshot>,
) {
  return {
    ...(existingPricing ?? {}),
    daily_rate_cents: summary.dailyRate,
    deposit_cents: summary.deposit,
    days: summary.days,
    subtotal_cents: summary.subtotal,
    base_total_cents: summary.baseTotal,
    extra_fees_cents: summary.extraFeesTotal,
    insurance_selected: summary.insuranceSelected,
    insurance_price_per_day_cents: summary.insurancePricePerDay,
    insurance_total_cents: summary.insuranceTotal,
    promo_code: summary.promoCode,
    promo_discount_cents: summary.promoDiscount,
    discount_total_cents: summary.discountTotal,
    total_cents: summary.total,
    total_amount: summary.total,
    amount_due_cents: summary.amountDue,
    amount_paid: summary.netPaidToDate,
    paid_to_date: summary.netPaidToDate,
    balance_due: summary.balanceDue,
    payment_status: summary.paymentStatus,
    payment_option_selected: summary.paymentOption,
    paid_in_full: summary.paymentStatus === "PAID_IN_FULL",
    refund_required: summary.refundRequired,
    currency: "JMD",
  };
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireCsrf(request))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id: bookingId } = await params;
  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");

    const bookingResult = (await client.query(
      "select b.id, b.status, b.start_date, b.end_date, b.pricing_json, v.daily_rate_cents, v.deposit_cents from bookings b join vehicles v on v.id = b.vehicle_id where b.id = $1 for update",
      [bookingId],
    )) as { rows: BookingRow[]; rowCount: number };

    if (bookingResult.rowCount === 0) {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
    }

    const booking = bookingResult.rows[0];
    const isAuthorized = await hasPublicBookingAccessForRequest(
      request,
      booking.id,
      booking.pricing_json,
    );
    if (!isAuthorized) {
      await client.query("rollback");
      return bookingAccessForbiddenResponse();
    }

    if (["CANCELLED", "RETURNED"].includes(String(booking.status).toUpperCase())) {
      await client.query("rollback");
      return NextResponse.json(
        { ok: false, error: "Booking cannot be updated for pay on pickup." },
        { status: 400 },
      );
    }

    const pricing = booking.pricing_json ?? {};
    const currentSummary = computeBookingPricingFromStoredSnapshot({
      bookingId: booking.id,
      bookingStatus: booking.status,
      startDate: booking.start_date,
      endDate: booking.end_date,
      pricing,
      fallbackDailyRate: booking.daily_rate_cents,
      fallbackDeposit: booking.deposit_cents,
      netPaidToDate: 0,
    });
    const currentPaymentOption = currentSummary.paymentOption;
    const currentPaymentStatus = normalizePaymentStatus(pricing.payment_status);

    const netPaidToDate = await fetchNetPaidToDate(booking.id, { client });

    if (netPaidToDate > 0) {
      await client.query("rollback");
      return NextResponse.json(
        { ok: false, error: "This booking already has payment activity." },
        { status: 409 },
      );
    }

    const alreadySelected =
      currentPaymentOption === "NONE" &&
      currentPaymentStatus === "DUE_ON_PICKUP" &&
      String(booking.status).toUpperCase() === "CONFIRMED";

    if (alreadySelected) {
      await client.query("commit");
      return NextResponse.json({
        ok: true,
        duplicate: true,
        bookingId: booking.id,
        status: booking.status,
      });
    }

    const summary = computeBookingPricingFromStoredSnapshot({
      bookingId: booking.id,
      bookingStatus: booking.status,
      startDate: booking.start_date,
      endDate: booking.end_date,
      pricing,
      fallbackDailyRate: booking.daily_rate_cents,
      fallbackDeposit: booking.deposit_cents,
      paymentOption: "NONE",
      netPaidToDate,
    });

    const nextStatus = String(booking.status).toUpperCase() === "PENDING_PAYMENT" ? "CONFIRMED" : booking.status;
    const pricingSnapshot = buildPricingSnapshot(booking.pricing_json, summary);

    await client.query(
      "update bookings set status = $2, pricing_json = $3, updated_at = now() where id = $1",
      [booking.id, nextStatus, pricingSnapshot],
    );

    await client.query("commit");

    await writeAuditLog({
      action: "BOOKING_PAY_ON_PICKUP_SELECTED",
      entityType: "booking",
      entityId: booking.id,
      details: {
        previousStatus: booking.status,
        nextStatus,
        paymentOption: "NONE",
        paymentStatus: summary.paymentStatus,
        total: summary.total,
        balanceDue: summary.balanceDue,
      },
    });

    return NextResponse.json({
      ok: true,
      bookingId: booking.id,
      status: nextStatus,
      paymentOption: "NONE",
      paymentStatus: summary.paymentStatus,
      balanceDue: summary.balanceDue,
    });
  } catch (error) {
    await client.query("rollback");
    logError("public_booking_pay_on_pickup_failed", error, { bookingId });
    return NextResponse.json({ ok: false, error: "Unable to select pay on pickup." }, { status: 500 });
  } finally {
    client.release();
  }
}
