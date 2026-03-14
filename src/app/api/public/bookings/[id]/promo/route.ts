import { NextResponse } from "next/server";

import { getDbPool } from "@/lib/db";
import { logError } from "@/lib/log";
import { clearPromoRedemptionForBooking, normalizePromoInputCode, upsertPromoRedemption, validatePromoForBooking } from "@/lib/promos";
import {
  computeBookingPricingFromStoredSnapshot,
  fetchNetPaidToDate,
} from "@/lib/payments/pricing";
import { requireCsrf } from "@/lib/security/csrf";

type BookingRow = {
  id: string;
  status: string;
  vehicle_id: string;
  customer_id: string;
  customer_email: string;
  start_date: string;
  end_date: string;
  pricing_json: Record<string, unknown> | null;
  daily_rate_cents: number;
  deposit_cents: number;
};

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>;
};

function mapSummaryForResponse(summary: ReturnType<typeof computeBookingPricingFromStoredSnapshot>) {
  return {
    days: summary.days,
    subtotal: summary.subtotal,
    total: summary.total,
    deposit: summary.deposit,
    netPaidToDate: summary.netPaidToDate,
    balanceDue: summary.balanceDue,
    promoCode: summary.promoCode,
    promoDiscount: summary.promoDiscount,
    paymentStatus: summary.paymentStatus,
    paymentOption: summary.paymentOption,
  };
}

function buildPricingSnapshot(
  existingPricing: Record<string, unknown> | null,
  summary: ReturnType<typeof computeBookingPricingFromStoredSnapshot>,
  promoCodeId: string | null,
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
    promo_code_id: promoCodeId,
    promo_discount_cents: summary.promoDiscount,
    discount_total_cents: summary.discountTotal,
    total_cents: summary.total,
    total_amount: summary.total,
    amount_due_cents: summary.amountDue,
    amount_paid: summary.netPaidToDate,
    balance_due: summary.balanceDue,
    payment_status: summary.paymentStatus,
    payment_option_selected: summary.paymentOption,
    currency: "JMD",
  };
}

async function loadBookingForUpdate(db: Queryable, bookingId: string) {
  const result = await db.query(
    "select b.id, b.status, b.vehicle_id, b.customer_id, b.start_date, b.end_date, b.pricing_json, c.email as customer_email, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1 for update",
    [bookingId],
  );
  if (result.rowCount === 0) return null;
  return result.rows[0] as BookingRow;
}

async function computeCurrentSummary(db: Queryable, booking: BookingRow) {
  const netPaidToDate = await fetchNetPaidToDate(booking.id, { client: db });
  return computeBookingPricingFromStoredSnapshot({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    pricing: booking.pricing_json,
    fallbackDailyRate: booking.daily_rate_cents,
    fallbackDeposit: booking.deposit_cents,
    netPaidToDate,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!(await requireCsrf(request))) {
    return NextResponse.json({ ok: false, error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id: bookingId } = await params;
  const body = await request.json().catch(() => null);
  const promoCode = normalizePromoInputCode(typeof body?.code === "string" ? body.code : "");
  if (!promoCode) {
    return NextResponse.json({ ok: false, error: "Enter a promo code." }, { status: 400 });
  }

  const pool = getDbPool();
  const client = await pool.connect();

  try {
    await client.query("begin");
    const booking = await loadBookingForUpdate(client, bookingId);
    if (!booking) {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "Booking not found." }, { status: 404 });
    }

    if (["CANCELLED", "RETURNED"].includes(booking.status)) {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "Promo codes cannot be changed for this booking." }, { status: 400 });
    }

    const currentSummary = await computeCurrentSummary(client, booking);
    const validation = await validatePromoForBooking({
      code: promoCode,
      vehicleId: booking.vehicle_id,
      startDate: booking.start_date,
      endDate: booking.end_date,
      subtotalCents: currentSummary.subtotal,
      baseTotalCents: currentSummary.baseTotal,
      customerId: booking.customer_id,
      customerEmail: booking.customer_email,
      client,
    });

    if (!validation.ok) {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: validation.message, reason: validation.reason }, { status: 400 });
    }

    const nextSummary = computeBookingPricingFromStoredSnapshot({
      bookingId: booking.id,
      bookingStatus: booking.status,
      startDate: booking.start_date,
      endDate: booking.end_date,
      pricing: booking.pricing_json,
      fallbackDailyRate: booking.daily_rate_cents,
      fallbackDeposit: booking.deposit_cents,
      paymentOption: currentSummary.paymentOption,
      netPaidToDate: currentSummary.netPaidToDate,
      promoCode: validation.code,
      promoDiscount: validation.discountAmountCents,
    });

    const pricingSnapshot = buildPricingSnapshot(booking.pricing_json, nextSummary, validation.promoId);
    await client.query("update bookings set pricing_json = $2 where id = $1", [booking.id, pricingSnapshot]);
    await upsertPromoRedemption({
      bookingId: booking.id,
      promoId: validation.promoId,
      customerId: booking.customer_id,
      customerEmail: booking.customer_email,
      discountAmountCents: validation.discountAmountCents,
      client,
    });

    await client.query("commit");
    return NextResponse.json({
      ok: true,
      summary: mapSummaryForResponse(nextSummary),
      promo: {
        code: validation.code,
        discountAmountCents: validation.discountAmountCents,
      },
    });
  } catch (error) {
    await client.query("rollback");
    logError("public_booking_apply_promo_failed", error, { bookingId });
    return NextResponse.json({ ok: false, error: "Unable to apply promo code." }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(
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
    const booking = await loadBookingForUpdate(client, bookingId);
    if (!booking) {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "Booking not found." }, { status: 404 });
    }

    if (["CANCELLED", "RETURNED"].includes(booking.status)) {
      await client.query("rollback");
      return NextResponse.json({ ok: false, error: "Promo codes cannot be changed for this booking." }, { status: 400 });
    }

    const currentSummary = await computeCurrentSummary(client, booking);
    const nextSummary = computeBookingPricingFromStoredSnapshot({
      bookingId: booking.id,
      bookingStatus: booking.status,
      startDate: booking.start_date,
      endDate: booking.end_date,
      pricing: booking.pricing_json,
      fallbackDailyRate: booking.daily_rate_cents,
      fallbackDeposit: booking.deposit_cents,
      paymentOption: currentSummary.paymentOption,
      netPaidToDate: currentSummary.netPaidToDate,
      promoCode: null,
      promoDiscount: 0,
    });

    const pricingSnapshot = buildPricingSnapshot(booking.pricing_json, nextSummary, null);
    await client.query("update bookings set pricing_json = $2 where id = $1", [booking.id, pricingSnapshot]);
    await clearPromoRedemptionForBooking(booking.id, { client });

    await client.query("commit");
    return NextResponse.json({
      ok: true,
      summary: mapSummaryForResponse(nextSummary),
    });
  } catch (error) {
    await client.query("rollback");
    logError("public_booking_remove_promo_failed", error, { bookingId });
    return NextResponse.json({ ok: false, error: "Unable to remove promo code." }, { status: 500 });
  } finally {
    client.release();
  }
}
