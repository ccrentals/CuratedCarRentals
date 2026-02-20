import Link from "next/link";
import { notFound } from "next/navigation";

import PrintInvoiceButton from "@/components/payments/PrintInvoiceButton";
import { dbQuery } from "@/lib/db";
import { fmtDateOnly } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";
import {
  computeBookingPricing,
  fetchNetPaidToDate,
  readInsurancePricingFields,
  readPromoPricingFields,
} from "@/lib/payments/pricing";

type PaymentRow = {
  id: string;
  provider: string;
  status: string;
  deposit_amount_cents: number;
  created_at: string;
  metadata_json: Record<string, unknown> | null;
};

export default async function BookingInvoicePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const bookingResult = await dbQuery<{
    id: string;
    start_date: string;
    end_date: string;
    pickup_location: string;
    status: string;
    pricing_json: Record<string, unknown> | null;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    vehicle_make: string;
    vehicle_model: string;
    vehicle_year: number;
    daily_rate_cents: number;
    deposit_cents: number;
  }>(
    "select b.id, b.start_date, b.end_date, b.pickup_location, b.status, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
    [id],
  );

  const booking = bookingResult.rows[0];
  if (!booking) {
    notFound();
  }

  let payments: PaymentRow[] = [];
  try {
    const paymentsResult = await dbQuery<PaymentRow>(
      "select id, provider, status, deposit_amount_cents, created_at, metadata_json from payments where booking_id = $1 and deleted_at is null order by created_at asc",
      [id],
    );
    payments = (paymentsResult.rows as PaymentRow[]) ?? [];
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    const message = String((error as { message?: unknown } | null)?.message ?? "");
    // Graceful fallback if DB hasn't been migrated yet.
    if (code === "42703" && message.includes("\"deleted_at\"") && message.includes("does not exist")) {
      const paymentsResult = await dbQuery<PaymentRow>(
        "select id, provider, status, deposit_amount_cents, created_at, metadata_json from payments where booking_id = $1 order by created_at asc",
        [id],
      );
      payments = (paymentsResult.rows as PaymentRow[]) ?? [];
    } else {
      throw error;
    }
  }

  const pricing = booking.pricing_json ?? {};
  const dailyRate = Number((pricing as Record<string, unknown>).daily_rate_cents ?? booking.daily_rate_cents ?? 0);
  const deposit = Number((pricing as Record<string, unknown>).deposit_cents ?? booking.deposit_cents ?? 0);
  const { promoCode, promoDiscount } = readPromoPricingFields(pricing);
  const { insuranceSelected, insurancePricePerDay, insuranceTotal } = readInsurancePricingFields(pricing);
  const netPaidToDate = await fetchNetPaidToDate(booking.id);
  const summary = computeBookingPricing({
    bookingId: booking.id,
    bookingStatus: booking.status,
    startDate: booking.start_date,
    endDate: booking.end_date,
    dailyRate,
    deposit,
    netPaidToDate,
    promoCode,
    promoDiscount,
    insuranceSelected,
    insurancePricePerDay,
    insuranceTotal,
  });

  return (
    <div className="invoice-page mx-auto w-full max-w-3xl px-6 py-12">
      <div className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-8 shadow-sm print:border-none print:bg-white print:shadow-none">
        <div className="print-hide flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-[var(--ccr-text)]">Invoice</h1>
            <p className="text-xs text-[var(--ccr-muted)]">Booking #{booking.id.slice(0, 8)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <PrintInvoiceButton />
            <Link
              href={`/bookings/${booking.id}`}
              className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
            >
              Back to Booking
            </Link>
          </div>
        </div>

        <div className="invoice-card mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-6 print:border-none print:bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold text-[var(--ccr-text)]">Invoice</h2>
            <span className="text-xs text-[var(--ccr-muted)]">Booking #{booking.id.slice(0, 8)}</span>
          </div>
          <div className="mt-4 grid gap-4 text-sm text-[var(--ccr-text)] sm:grid-cols-2">
            <div>
              <p className="text-xs uppercase text-[var(--ccr-muted)]">Customer</p>
              <p className="font-semibold">{booking.customer_name}</p>
              <p className="text-[var(--ccr-muted)]">{booking.customer_email}</p>
              <p className="text-[var(--ccr-muted)]">{booking.customer_phone}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-[var(--ccr-muted)]">Vehicle</p>
              <p className="font-semibold">
                {booking.vehicle_year} {booking.vehicle_make} {booking.vehicle_model}
              </p>
              <p className="text-[var(--ccr-muted)]">Daily rate: {formatJmd(booking.daily_rate_cents)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-[var(--ccr-muted)]">Rental</p>
              <p>
                {fmtDateOnly(booking.start_date)} → {fmtDateOnly(booking.end_date)} ({summary.days} days)
              </p>
              <p className="text-[var(--ccr-muted)]">Pickup: {booking.pickup_location}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-[var(--ccr-muted)]">Charges</p>
              <p>Total rental: {formatJmd(summary.total)}</p>
              {summary.promoDiscount > 0 ? (
                <p>
                  Promo{summary.promoCode ? ` (${summary.promoCode})` : ""}: -{formatJmd(summary.promoDiscount)}
                </p>
              ) : null}
              <p>Deposit online (required): {formatJmd(summary.deposit)}</p>
              <p>Paid to date: {formatJmd(summary.netPaidToDate)}</p>
              <p className="font-semibold">Balance due: {formatJmd(summary.balanceDue)}</p>
            </div>
          </div>
          <div className="mt-4 border-t border-[var(--ccr-border)] pt-4 text-sm text-[var(--ccr-muted)]">
            <p>Status: {booking.status}</p>
            {payments.length ? (
              <ul className="mt-2 space-y-1 text-xs">
                {payments.map((payment: PaymentRow) => (
                  <li key={payment.id}>
                    {payment.provider} · {payment.status} · {formatJmd(payment.deposit_amount_cents)} · {fmtDateOnly(payment.created_at)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs">No payments recorded yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
