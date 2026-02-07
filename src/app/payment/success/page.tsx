import Link from "next/link";

export default async function PaymentSuccessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const bookingId = typeof params.bookingId === "string" ? params.bookingId : "";
  const shortId = bookingId ? bookingId.slice(0, 8) : "";

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-12">
      <div className="rounded-3xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-8 shadow-sm">
        <h1 className="text-3xl font-bold text-[var(--ccr-primary)]">Deposit received</h1>
        <p className="mt-3 text-sm text-[var(--ccr-muted)]">
          Your booking is confirmed. We will follow up with pickup details shortly.
        </p>
        {shortId ? (
          <p className="mt-4 text-sm text-[var(--ccr-text)]">
            Booking reference: <span className="font-semibold">{shortId}</span>
          </p>
        ) : null}
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/fleet"
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
          >
            View Fleet
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
