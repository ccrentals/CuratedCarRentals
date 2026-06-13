import Link from "next/link";
import { notFound } from "next/navigation";

import PrintInvoiceButton from "@/components/payments/PrintInvoiceButton";
import { hasPublicBookingAccessForPage } from "@/lib/bookings/publicAccess";
import { DateRangeArrow } from "@/components/shared/DateRangeArrow";
import { dbQuery } from "@/lib/db";
import { fmtDateOnly } from "@/lib/dateFormat";
import { formatBookingDateOnly } from "@/lib/bookings/bookingDateTime";
import { formatJmd } from "@/lib/money";
import { formatPaymentStatus } from "@/lib/payments/formatPaymentStatus";
import {
  computeBookingPricingFromStoredSnapshot,
  fetchNetPaidToDate,
} from "@/lib/payments/pricing";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type BookingRow = {
  id: string;
  public_id: string | null;
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
};

type PaymentRow = {
  id: string;
  provider: string;
  status: string;
  deposit_amount_cents: number;
  created_at: string;
  metadata_json: Record<string, unknown> | null;
};

type InvoiceDocumentRow = {
  download_url: string | null;
};

type InvoiceSnapshotCardProps = {
  booking: BookingRow;
  bookingRef: string;
  dailyRate: number;
  days: number;
  subtotal: number;
  total: number;
  depositPaid: number;
  paidToDate: number;
  balanceDue: number;
  promoCode: string | null;
  promoDiscount: number;
  payments: PaymentRow[];
};

function InvoiceSnapshotCard({
  booking,
  bookingRef,
  dailyRate,
  days,
  subtotal,
  total,
  depositPaid,
  paidToDate,
  balanceDue,
  promoCode,
  promoDiscount,
  payments,
}: InvoiceSnapshotCardProps) {
  return (
    <div className="invoice-card rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-6 print:border-none print:bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-[var(--ccr-text)]">Invoice</h2>
        <span className="text-xs text-[var(--ccr-muted)]">Booking #{bookingRef || "—"}</span>
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
          <p className="text-[var(--ccr-muted)]">Daily rate: {formatJmd(dailyRate)}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-[var(--ccr-muted)]">Rental</p>
          <p>
            <span className="inline-flex items-center">
              {formatBookingDateOnly(booking.start_date)}
              <DateRangeArrow />
              {formatBookingDateOnly(booking.end_date)}
            </span>{" "}
            ({days} days)
          </p>
          <p className="text-[var(--ccr-muted)]">Pickup: {booking.pickup_location}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-[var(--ccr-muted)]">Charges</p>
          <p>Subtotal: {formatJmd(subtotal)}</p>
          {promoDiscount > 0 ? (
            <p>
              Promo{promoCode ? ` (${promoCode})` : ""}: -{formatJmd(promoDiscount)}
            </p>
          ) : null}
          <p>Total: {formatJmd(total)}</p>
          <p>Deposit paid: {formatJmd(depositPaid)}</p>
          <p>Paid to date: {formatJmd(paidToDate)}</p>
          <p className="font-semibold">Balance on pickup: {formatJmd(balanceDue)}</p>
        </div>
      </div>
      <div className="mt-4 border-t border-[var(--ccr-border)] pt-4 text-sm text-[var(--ccr-muted)]">
        <p>Status: {booking.status}</p>
        {payments.length ? (
          <ul className="mt-2 space-y-1 text-xs">
            {payments.map((payment: PaymentRow) => (
              <li key={payment.id}>
                {payment.provider} ·{" "}
                {formatPaymentStatus(payment.status, {
                  paymentType:
                    typeof payment.metadata_json?.payment_type === "string"
                      ? String(payment.metadata_json.payment_type)
                      : null,
                })}{" "}
                · {formatJmd(payment.deposit_amount_cents)} · {fmtDateOnly(payment.created_at)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-xs">No payments recorded yet.</p>
        )}
      </div>
    </div>
  );
}

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const bookingId = typeof params.bookingId === "string" ? params.bookingId : "";

  if (bookingId) {
    const accessResult = await dbQuery<{
      id: string;
      pricing_json: Record<string, unknown> | null;
    }>("select id, pricing_json from bookings where id = $1", [bookingId]);
    const bookingAccess = accessResult.rows[0] ?? null;
    if (!bookingAccess) {
      notFound();
    }
    const isAuthorized = await hasPublicBookingAccessForPage(
      bookingAccess.id,
      bookingAccess.pricing_json,
    );
    if (!isAuthorized) {
      notFound();
    }
  }

  const bookingResult = bookingId
    ? await dbQuery<BookingRow>(
        "select b.id, b.public_id, b.start_date, b.end_date, b.pickup_location, b.status, b.pricing_json, c.full_name as customer_name, c.email as customer_email, c.phone as customer_phone, v.make as vehicle_make, v.model as vehicle_model, v.year as vehicle_year, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.id = $1",
        [bookingId],
      )
    : null;

  const booking = bookingResult?.rowCount ? bookingResult.rows[0] : null;
  const bookingRef = (booking?.public_id ?? "").trim();

  let invoicePdfUrl: string | null = null;
  let invoicePreviewRoute: string | null = null;
  if (bookingId) {
    try {
      const invoiceDocResult = await dbQuery<InvoiceDocumentRow>(
        "select download_url from booking_invoice_documents where booking_id = $1 and download_url is not null order by generated_at desc limit 1",
        [bookingId],
      );
      invoicePdfUrl = invoiceDocResult.rows[0]?.download_url ?? null;
      invoicePreviewRoute = `/bookings/${bookingId}/invoice/preview`;
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      // Graceful fallback if the invoice ledger table does not exist yet.
      if (code !== "42P01") {
        throw error;
      }
    }
  }

  let payments: PaymentRow[] = [];
  if (bookingId) {
    try {
      const paymentsResult = await dbQuery<PaymentRow>(
        "select id, provider, status, deposit_amount_cents, created_at, metadata_json from payments where booking_id = $1 and deleted_at is null order by created_at asc",
        [bookingId],
      );
      payments = (paymentsResult.rows as PaymentRow[]) ?? [];
    } catch (error) {
      const code = (error as { code?: string } | null)?.code;
      const message = String((error as { message?: unknown } | null)?.message ?? "");
      if (code === "42703" && message.includes("\"deleted_at\"") && message.includes("does not exist")) {
        const paymentsResult = await dbQuery<PaymentRow>(
          "select id, provider, status, deposit_amount_cents, created_at, metadata_json from payments where booking_id = $1 order by created_at asc",
          [bookingId],
        );
        payments = (paymentsResult.rows as PaymentRow[]) ?? [];
      } else {
        throw error;
      }
    }
  }

  const pricing = booking?.pricing_json ?? {};
  const netPaidToDate = booking ? await fetchNetPaidToDate(booking.id) : 0;
  const summary = booking
    ? computeBookingPricingFromStoredSnapshot({
        bookingId: booking.id,
        bookingStatus: booking.status,
        startDate: booking.start_date,
        endDate: booking.end_date,
        pricing,
        fallbackDailyRate: booking.daily_rate_cents,
        fallbackDeposit: booking.deposit_cents,
        netPaidToDate,
      })
    : null;

  const days = summary?.days ?? 0;
  const total = summary?.total ?? 0;
  const paidToDate = summary?.netPaidToDate ?? 0;
  const balanceDue = summary?.balanceDue ?? 0;

  const depositPaid = payments.reduce((sum: number, payment: PaymentRow) => {
    if (payment.status !== "DEPOSIT_PAID") return sum;
    const metadata = payment.metadata_json ?? {};
    const paymentType = typeof metadata.payment_type === "string" ? String(metadata.payment_type) : "";
    if (paymentType !== "deposit") return sum;
    return sum + Number(payment.deposit_amount_cents || 0);
  }, 0);

  const latestSuccessfulPayment = [...payments].reverse().find((payment) => payment.status === "DEPOSIT_PAID");
  const latestPaymentType =
    latestSuccessfulPayment?.metadata_json &&
    typeof latestSuccessfulPayment.metadata_json.payment_type === "string"
      ? String(latestSuccessfulPayment.metadata_json.payment_type)
      : "";
  const headline = latestPaymentType === "deposit" ? "Deposit received" : "Payment received";
  const subheadline =
    balanceDue === 0
      ? "Your booking is now paid in full."
      : "Your booking is confirmed. We will follow up with pickup details shortly.";
  const invoicePreviewSrc = invoicePreviewRoute
    ? `${invoicePreviewRoute}#pagemode=none&navpanes=0&zoom=100`
    : null;
  return (
    <div className="invoice-page mx-auto w-full max-w-[90rem] px-3 py-12 md:px-6">
      <div className="mx-auto rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm print:border-none print:bg-white print:shadow-none md:p-8">
        <div className="print-hide">
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">{headline}</h1>
          <p className="mt-3 text-sm text-[var(--ccr-muted)]">{subheadline}</p>
          {bookingRef ? (
            <p className="mt-4 text-sm text-[var(--ccr-text)]">
              Booking reference: <span className="font-semibold">{bookingRef}</span>
            </p>
          ) : null}
        </div>

        {booking && summary ? (
          <>
            <div className="mx-auto mt-8 max-w-[80rem] print-hide">
              <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-bg)] p-2 md:p-4">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Invoice preview</h2>
                  <span className="text-xs text-[var(--ccr-muted)]">Booking #{bookingRef || "—"}</span>
                </div>
                <div className="overflow-hidden rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
                  {invoicePreviewSrc ? (
                    <iframe
                      src={invoicePreviewSrc}
                      title={`Invoice preview for booking ${bookingRef || booking.id}`}
                      className="h-[1400px] w-full bg-white"
                    />
                  ) : (
                    <div className="mx-auto min-w-[720px] max-w-[960px] p-3">
                      <InvoiceSnapshotCard
                        booking={booking}
                        bookingRef={bookingRef}
                        dailyRate={summary.dailyRate}
                        days={days}
                        subtotal={summary.subtotal}
                        total={total}
                        depositPaid={depositPaid}
                        paidToDate={paidToDate}
                        balanceDue={balanceDue}
                        promoCode={summary.promoCode}
                        promoDiscount={summary.promoDiscount}
                        payments={payments}
                      />
                    </div>
                  )}
                </div>
                {!invoicePreviewRoute ? (
                  <p className="mt-3 text-xs text-[var(--ccr-muted)]">
                    PDF preview is unavailable right now. Showing the live invoice page instead.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="mt-8 hidden print:block">
              <InvoiceSnapshotCard
                booking={booking}
                bookingRef={bookingRef}
                dailyRate={summary.dailyRate}
                days={days}
                subtotal={summary.subtotal}
                total={total}
                depositPaid={depositPaid}
                paidToDate={paidToDate}
                balanceDue={balanceDue}
                promoCode={summary.promoCode}
                promoDiscount={summary.promoDiscount}
                payments={payments}
              />
            </div>
          </>
        ) : null}

        <div className="mt-6 flex flex-nowrap items-center gap-3 overflow-x-auto pb-1 print-hide">
          {booking ? (
            <Link
              href={`/bookings/${booking.id}/invoice`}
              className="shrink-0 whitespace-nowrap rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] transition hover:border-[var(--ccr-accent)] hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]"
            >
              View Invoice
            </Link>
          ) : null}
          <PrintInvoiceButton className="shrink-0 whitespace-nowrap rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] transition hover:border-[var(--ccr-accent)] hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]" />
          {booking ? (
            <Link
              href={invoicePdfUrl ?? `/bookings/${booking.id}/invoice?autoprint=1`}
              target={invoicePdfUrl ? "_blank" : undefined}
              rel={invoicePdfUrl ? "noreferrer" : undefined}
              className="shrink-0 whitespace-nowrap rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] transition hover:border-[var(--ccr-accent)] hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]"
            >
              Download PDF
            </Link>
          ) : null}
          <Link
            href="/fleet"
            className="shrink-0 whitespace-nowrap rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] transition hover:border-[var(--ccr-accent)] hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]"
          >
            View Fleet
          </Link>
          <Link
            href="/contact"
            className="shrink-0 whitespace-nowrap rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] transition hover:border-[var(--ccr-accent)] hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]"
          >
            Contact Support
          </Link>
        </div>
      </div>
    </div>
  );
}
