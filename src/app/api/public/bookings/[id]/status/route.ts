import { NextResponse } from "next/server";

import { hasPublicBookingAccessForRequest } from "@/lib/bookings/publicAccess";
import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";

type BookingStatusRow = {
  id: string;
  public_id: string | null;
  status: string;
  pricing_json: Record<string, unknown> | null;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function money(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });
  }
  try {
    const result = await dbQuery<BookingStatusRow>(
      "select id, public_id, status, pricing_json from bookings where id = $1::uuid limit 1",
      [id],
    );
    const booking = result.rows[0];
    if (!booking) return NextResponse.json({ ok: false, error: "Booking not found" }, { status: 404 });

    if (!(await hasPublicBookingAccessForRequest(request, booking.id, booking.pricing_json))) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    const pricing = booking.pricing_json ?? {};
    return NextResponse.json({
      ok: true,
      booking: {
        id: booking.id,
        reference: booking.public_id,
        status: booking.status,
        paymentStatus: String(pricing.payment_status ?? "UNPAID"),
        total: money(pricing.total_cents ?? pricing.total_amount),
        paidToDate: money(pricing.paid_to_date ?? pricing.amount_paid),
        balanceDue: money(pricing.balance_due),
      },
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    logError("api.public.bookings.status.GET", error, { bookingId: id });
    return NextResponse.json({ ok: false, error: "Unable to load booking status" }, { status: 500 });
  }
}
