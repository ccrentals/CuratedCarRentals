import { NextResponse } from "next/server";

import { requireOperationsAccess } from "@/lib/auth/adminGuards";
import { bookingDateTimeToUtcIso } from "@/lib/bookings/bookingDateTime";
import {
  BookingItineraryChangeError,
  evaluateBookingItineraryChange,
} from "@/lib/bookings/bookingItineraryChange";
import { getDbPool } from "@/lib/db";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireOperationsAccess();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const startDate = String(body?.startDate ?? "").trim();
  const endDate = String(body?.endDate ?? "").trim();
  const pickupTime = String(body?.pickupTime ?? "").trim();
  const dropoffTime = String(body?.dropoffTime ?? "").trim();
  const vehicleId = String(body?.vehicleId ?? "").trim();
  const startAt = bookingDateTimeToUtcIso(startDate, pickupTime);
  const endAt = bookingDateTimeToUtcIso(endDate, dropoffTime);
  if (!vehicleId || !startAt || !endAt || endAt <= startAt) {
    return NextResponse.json({ error: "Valid vehicle, pickup, and drop-off details are required." }, { status: 400 });
  }

  const client = await getDbPool().connect();
  try {
    const result = await client.query(
      "select b.id, b.status, b.customer_id, b.pricing_json, c.email as customer_email from bookings b join customers c on c.id = b.customer_id where b.id = $1 limit 1",
      [id],
    );
    if (result.rowCount === 0) {
      return NextResponse.json({ error: "Booking not found." }, { status: 404 });
    }
    const evaluated = await evaluateBookingItineraryChange({
      client,
      booking: result.rows[0],
      vehicleId,
      startAt,
      endAt,
      startDate,
      endDate,
      customerEmail: typeof body?.customerEmail === "string" ? body.customerEmail : null,
      insuranceSelected:
        typeof body?.insuranceSelected === "boolean" ? body.insuranceSelected : undefined,
      promoCode:
        typeof body?.promoCode === "string" ? body.promoCode.trim() || null : undefined,
    });
    return NextResponse.json({
      ok: true,
      preview: {
        vehicleId: evaluated.vehicle.id,
        vehicleLabel: evaluated.vehicleLabel,
        days: evaluated.summary.days,
        baseTotal: evaluated.summary.baseTotal,
        insuranceSelected: evaluated.summary.insuranceSelected,
        insurancePricePerDay: evaluated.summary.insurancePricePerDay,
        insuranceTotal: evaluated.summary.insuranceTotal,
        promoCode: evaluated.summary.promoCode,
        promoDiscount: evaluated.summary.promoDiscount,
        total: evaluated.summary.total,
        depositRequired: evaluated.summary.depositRequired,
        paidToDate: evaluated.summary.netPaidToDate,
        balanceDue: evaluated.summary.balanceDue,
        refundRequired: evaluated.summary.refundRequired,
      },
    });
  } catch (error) {
    if (error instanceof BookingItineraryChangeError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to preview booking changes." }, { status: 500 });
  } finally {
    client.release();
  }
}
