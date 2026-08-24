import { dbQuery } from "@/lib/db";
import { logError } from "@/lib/log";
import { sendUpdatedInvoiceEmail } from "@/lib/notifications/email";
import {
  computeDedupeKey,
  markDedupeResult,
  retryFailedDedupe,
  tryAcquireDedupe,
} from "@/lib/notifications/dedupe";
import { recalculateBookingPayments } from "@/lib/payments/recalculateBooking";

export const INVOICE_RETRY_DELAYS_MS = [15, 60, 240, 720, 1_440].map(
  (minutes) => minutes * 60 * 1_000,
);

export function nextInvoiceRetryState(currentCount: number, now = Date.now()) {
  const nextCount = currentCount + 1;
  const exhausted = nextCount >= INVOICE_RETRY_DELAYS_MS.length;
  return {
    nextCount,
    exhausted,
    nextRetryAt: exhausted
      ? null
      : new Date(now + INVOICE_RETRY_DELAYS_MS[nextCount]).toISOString(),
  };
}

type PendingInvoicePayment = {
  id: string;
  booking_id: string;
  provider_ref: string | null;
  metadata_json: Record<string, unknown> | null;
};

type InvoiceBooking = {
  id: string;
  public_id: string | null;
  start_date: string;
  end_date: string;
  pickup_location: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  vehicle_year: number;
  vehicle_make: string;
  vehicle_model: string;
  daily_rate_cents: number;
  deposit_cents: number;
};

function retryCount(metadata: Record<string, unknown> | null) {
  const value = Number(metadata?.invoice_retry_count ?? 0);
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

export async function processPendingPaymentInvoices(limit = 20) {
  const pending = await dbQuery<PendingInvoicePayment>(
    `select id, booking_id, provider_ref, metadata_json
       from payments
      where provider = 'STRIPE'
        and status = 'DEPOSIT_PAID'
        and coalesce(metadata_json->>'invoice_delivery_status', '') = 'pending'
        and coalesce((metadata_json->>'invoice_retry_exhausted')::boolean, false) = false
        and (metadata_json->>'invoice_next_retry_at')::timestamptz <= now()
      order by (metadata_json->>'invoice_next_retry_at')::timestamptz asc
      limit $1`,
    [Math.max(1, Math.min(100, limit))],
  );

  let sent = 0;
  let failed = 0;
  let exhausted = 0;

  for (const payment of pending.rows) {
    const count = retryCount(payment.metadata_json);
    const dedupeKey = computeDedupeKey({
      entityType: "booking",
      entityId: payment.booking_id,
      eventType: "UPDATED_INVOICE",
      extra: payment.id,
    });
    const first = await tryAcquireDedupe({
      dedupeKey,
      entityType: "booking",
      entityId: payment.booking_id,
      eventType: "UPDATED_INVOICE",
      provider: "resend",
    });
    const acquired = first.acquired
      ? first
      : await retryFailedDedupe({ dedupeKey, provider: "resend" });
    if (!acquired.acquired) continue;

    try {
      const bookingResult = await dbQuery<InvoiceBooking>(
        `select b.id, b.public_id, b.start_date, b.end_date, b.pickup_location,
                c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone,
                v.year as vehicle_year, v.make as vehicle_make, v.model as vehicle_model,
                v.daily_rate_cents, v.deposit_cents
           from bookings b
           join customers c on c.id = b.customer_id
           join vehicles v on v.id = b.vehicle_id
          where b.id = $1`,
        [payment.booking_id],
      );
      const booking = bookingResult.rows[0];
      if (!booking) throw new Error("Booking not found for pending invoice delivery.");
      const summary = await recalculateBookingPayments(payment.booking_id);
      const result = await sendUpdatedInvoiceEmail({
        bookingId: booking.id,
        customerEmail: booking.customer_email,
        customerName: booking.customer_name,
        customerPhone: booking.customer_phone ?? "",
        vehicleLabel: `${booking.vehicle_year} ${booking.vehicle_make} ${booking.vehicle_model}`.trim(),
        startDate: booking.start_date,
        endDate: booking.end_date,
        pickupLocation: booking.pickup_location,
        dailyRate: Number(booking.daily_rate_cents || 0),
        deposit: Number(booking.deposit_cents || 0),
        total: summary.totalAmount,
        paidToDate: summary.netPaidToDate,
        balanceDue: summary.balanceDue,
        paymentReference: String(payment.metadata_json?.payment_intent_id ?? payment.provider_ref ?? ""),
        dispatch: {
          triggerSource: "cron",
          relatedTransactionType: "payment",
          relatedTransactionId: payment.id,
        },
      });
      if (!result.ok || !result.invoiceAttached) {
        throw new Error(result.error ?? "Updated invoice email failed.");
      }
      await markDedupeResult({
        dedupeKey,
        status: "SENT",
        provider: "resend",
        providerMessageId: result.providerMessageId,
      });
      await dbQuery(
        "update payments set metadata_json = coalesce(metadata_json, '{}'::jsonb) || $2::jsonb, updated_at = now() where id = $1",
        [payment.id, JSON.stringify({
          invoice_delivery_status: "sent",
          invoice_email_sent: true,
          invoice_sent_at: new Date().toISOString(),
          invoice_retry_count: count + 1,
          invoice_next_retry_at: null,
          invoice_last_error: null,
          invoice_retry_exhausted: false,
        })],
      );
      sent += 1;
    } catch (error) {
      const retryState = nextInvoiceRetryState(count);
      const nextCount = retryState.nextCount;
      const isExhausted = retryState.exhausted;
      const message = error instanceof Error ? error.message : String(error);
      await markDedupeResult({ dedupeKey, status: "FAILED", provider: "resend", error: message });
      await dbQuery(
        "update payments set metadata_json = coalesce(metadata_json, '{}'::jsonb) || $2::jsonb, updated_at = now() where id = $1",
        [payment.id, JSON.stringify({
          invoice_delivery_status: isExhausted ? "failed" : "pending",
          invoice_email_sent: false,
          invoice_retry_count: nextCount,
          invoice_next_retry_at: retryState.nextRetryAt,
          invoice_last_error: message.slice(0, 1000),
          invoice_retry_exhausted: isExhausted,
        })],
      );
      logError("payment_invoice_retry_failed", error, {
        bookingId: payment.booking_id,
        paymentId: payment.id,
        attempt: nextCount,
        exhausted: isExhausted,
      });
      failed += 1;
      if (isExhausted) exhausted += 1;
    }
  }

  return { attempted: pending.rowCount, sent, failed, exhausted };
}
