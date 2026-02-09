import Link from "next/link";

function getMessage(reason?: string | string[]) {
  const r = Array.isArray(reason) ? reason[0] : reason;

  if (r === "overlap") {
    return "Deposit received, but the vehicle is no longer available for those dates. We will contact you shortly.";
  }
  if (r === "bad_hash") {
    return "We couldn't verify the payment. Please contact support.";
  }
  if (r === "notfound") {
    return "We couldn't match this payment to a booking. Please contact support with your order reference.";
  }
  if (r === "payment_failed") {
    return "Payment was not completed. Please try again or contact support.";
  }
  if (r === "invalid_csrf") {
    return "Your session expired. Please try again.";
  }
  if (r === "env_invalid") {
    return "Online payments are temporarily unavailable. Please try again later or contact support.";
  }
  if (r === "already_paid") {
    return "This booking has already been paid. If you think this is incorrect, contact support.";
  }
  if (r === "env_missing") {
    return "Online payments are temporarily unavailable. Please try again later or contact support.";
  }
  if (r === "db_error") {
    return "We ran into a system issue while confirming the payment. Please contact support with your order reference.";
  }
  if (r === "provider_error") {
    return "The payment provider reported an error. Please try again or contact support.";
  }
  return "Payment was not completed. Please try again or contact support.";
}

export default async function PaymentFailedPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const reason = params.reason;
  const bookingId = typeof params.bookingId === "string" ? params.bookingId : "";
  const orderId = typeof params.order_id === "string" ? params.order_id : "";
  const shortBooking = bookingId ? bookingId.slice(0, 8) : "";

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-8 shadow-sm">
        <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Payment issue</h1>
        <p className="mt-3 text-sm text-[var(--ccr-muted)]">{getMessage(reason)}</p>
        {shortBooking ? (
          <p className="mt-4 text-sm text-[var(--ccr-text)]">
            Booking reference: <span className="font-semibold">{shortBooking}</span>
          </p>
        ) : null}
        {orderId ? (
          <p className="mt-1 text-sm text-[var(--ccr-text)]">
            Order reference: <span className="font-semibold">{orderId}</span>
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          {bookingId ? (
            <Link
              href={`/bookings/${encodeURIComponent(bookingId)}/pay`}
              className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white"
            >
              Try Again
            </Link>
          ) : null}
          <Link
            href="/fleet"
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
          >
            Back to Fleet
          </Link>
          <Link
            href="/contact"
            className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white"
          >
            Contact Support
          </Link>
        </div>
      </div>
    </div>
  );
}
