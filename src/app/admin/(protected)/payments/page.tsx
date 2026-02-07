import Link from "next/link";

import { dbQuery } from "@/lib/db";
import { fmtDate } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";

type PaymentRow = {
  id: string;
  booking_id: string;
  provider: string;
  status: string;
  deposit_amount_cents: number;
  created_at: string;
  customer_name: string;
  customer_email: string;
  vehicle_make: string;
  vehicle_model: string;
};

export default async function AdminPaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const bookingId = typeof params.bookingId === "string" ? params.bookingId.trim() : "";

  const queryText =
    "select p.id, p.booking_id, p.provider, p.status, p.deposit_amount_cents, p.created_at, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model from payments p join bookings b on b.id = p.booking_id join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id " +
    (bookingId ? "where p.booking_id = $1 " : "") +
    "order by p.created_at desc";

  const payments = await dbQuery<PaymentRow>(queryText, bookingId ? [bookingId] : []);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-primary)]">Payments</h1>
          {bookingId ? (
            <p className="mt-2 text-xs text-[var(--ccr-muted)]">
              Filtered by booking: <span className="font-semibold text-[var(--ccr-text)]">{bookingId}</span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {bookingId ? (
            <Link
              href="/admin/payments"
              className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
            >
              Clear filter
            </Link>
          ) : null}
          <Link
            href="/admin/bookings"
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            View Bookings
          </Link>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
        {payments.rows.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[var(--ccr-muted)]">
            No payments yet.
          </div>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
              <tr>
                <th className="px-4 py-3">Payment</th>
                <th className="px-4 py-3">Booking</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Provider</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Amount</th>
                <th className="px-4 py-3">Created</th>
              </tr>
            </thead>
            <tbody>
              {payments.rows.map((payment: PaymentRow) => (
                <tr key={payment.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                  <td className="px-4 py-3 font-mono text-xs text-[var(--ccr-text)]">
                    {payment.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/bookings/${payment.booking_id}`}
                      className="text-sm font-semibold text-[var(--ccr-primary)]"
                    >
                      {payment.booking_id.slice(0, 8)}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[var(--ccr-text)]">{payment.customer_name}</p>
                    <p className="text-xs text-[var(--ccr-muted)]">{payment.customer_email}</p>
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">
                    {payment.vehicle_make} {payment.vehicle_model}
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">{payment.provider}</td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">{payment.status}</td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">
                    {formatJmd(payment.deposit_amount_cents)}
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-muted)]">
                    {fmtDate(payment.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
