import Link from "next/link";

import { dbQuery } from "@/lib/db";
import { fmtDate } from "@/lib/dateFormat";
import BookingFilters from "@/components/admin/BookingFilters";

type BookingRow = {
  id: string;
  start_date: string;
  end_date: string;
  status: string;
  customer_name: string;
  customer_email: string;
  vehicle_make: string;
  vehicle_model: string;
};

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const rawStatus = typeof params.status === "string" ? params.status : undefined;
  const statusKey = rawStatus ? rawStatus.toLowerCase() : undefined;
  const statusMap: Record<string, string[]> = {
    pending_payment: ["PENDING_PAYMENT"],
    confirmed: ["CONFIRMED"],
    completed: ["RETURNED"],
    cancelled: ["CANCELLED"],
  };

  const statusFilter =
    statusKey && statusKey !== "all"
      ? statusMap[statusKey] ?? [statusKey.toUpperCase()]
      : undefined;

  const q = typeof params.q === "string" ? params.q.trim() : "";
  const datePattern = /^\d{4}-\d{2}-\d{2}$/;
  const dateFrom =
    typeof params.dateFrom === "string" && datePattern.test(params.dateFrom)
      ? params.dateFrom
      : undefined;
  const dateTo =
    typeof params.dateTo === "string" && datePattern.test(params.dateTo) ? params.dateTo : undefined;

  const whereClauses: string[] = [];
  const values: Array<string | string[]> = [];
  let index = 1;

  if (statusFilter) {
    if (statusFilter.length === 1) {
      whereClauses.push(`b.status = $${index}`);
      values.push(statusFilter[0]);
      index += 1;
    } else {
      whereClauses.push(`b.status = ANY($${index})`);
      values.push(statusFilter);
      index += 1;
    }
  }

  if (q) {
    whereClauses.push(
      `(c.full_name ilike $${index} or c.email ilike $${index} or c.phone ilike $${index} or b.id::text ilike $${index})`,
    );
    values.push(`%${q}%`);
    index += 1;
  }

  if (dateFrom) {
    whereClauses.push(`b.start_date >= $${index}`);
    values.push(dateFrom);
    index += 1;
  }

  if (dateTo) {
    whereClauses.push(`b.end_date <= $${index}`);
    values.push(dateTo);
    index += 1;
  }

  const whereSql = whereClauses.length ? `where ${whereClauses.join(" and ")}` : "";
  const queryText =
    "select b.id, b.start_date, b.end_date, b.status, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id " +
    whereSql +
    " order by b.created_at desc";

  const bookings = await dbQuery<BookingRow>(queryText, values);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-primary)]">Bookings</h1>
        </div>
        <Link
          href="/admin/bookings"
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
        >
          Reset
        </Link>
      </div>

      <BookingFilters />

      <div className="mt-6 overflow-x-auto rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)]">
        {bookings.rows.length === 0 ? (
          <div className="px-6 py-10 text-center text-sm text-[var(--ccr-muted)]">
            No bookings found for these filters.
          </div>
        ) : (
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
              <tr>
                <th className="px-4 py-3">Booking</th>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Vehicle</th>
                <th className="px-4 py-3">Dates</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {bookings.rows.map((booking: BookingRow) => (
                <tr key={booking.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                  <td className="px-4 py-3 font-mono text-xs text-[var(--ccr-text)]">
                    {booking.id.slice(0, 8)}
                  </td>
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[var(--ccr-text)]">{booking.customer_name}</p>
                    <p className="text-xs text-[var(--ccr-muted)]">{booking.customer_email}</p>
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">
                    {booking.vehicle_make} {booking.vehicle_model}
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-muted)]">
                    {fmtDate(booking.start_date)} → {fmtDate(booking.end_date)}
                  </td>
                  <td className="px-4 py-3 text-[var(--ccr-text)]">{booking.status}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/bookings/${booking.id}`}
                      className="text-sm font-semibold text-[var(--ccr-primary)]"
                    >
                      View
                    </Link>
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
