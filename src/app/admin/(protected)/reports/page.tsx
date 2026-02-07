import Link from "next/link";

import { dbQuery } from "@/lib/db";
import { formatJmd } from "@/lib/money";

type VehicleRow = {
  id: string;
  make: string;
  model: string;
};

type BookingRow = {
  id: string;
  status: string;
  start_date: string;
  end_date: string;
  created_at: string;
  pricing_json: Record<string, unknown> | null;
  customer_name: string;
  vehicle_id: string;
  vehicle_make: string;
  vehicle_model: string;
  daily_rate_cents: number;
  deposit_cents: number;
};

type PaymentRow = {
  booking_id: string;
  deposit_amount_cents: number;
  status: string;
  created_at: string;
};

function formatDateKey(date: Date) {
  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDateParam(value: string | undefined, fallback: Date) {
  if (!value) return fallback;
  const match = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!match) return fallback;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function daysInclusive(start: Date, end: Date) {
  const s = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const e = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const diff = Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24));
  return diff >= 0 ? diff + 1 : 0;
}

function overlapDays(rangeStart: Date, rangeEnd: Date, bookingStart: Date, bookingEnd: Date) {
  const start = bookingStart > rangeStart ? bookingStart : rangeStart;
  const end = bookingEnd < rangeEnd ? bookingEnd : rangeEnd;
  return daysInclusive(start, end);
}

export default async function AdminReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const today = new Date();
  const defaultFrom = startOfMonth(today);
  const defaultTo = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const dateFrom = parseDateParam(typeof params.dateFrom === "string" ? params.dateFrom : undefined, defaultFrom);
  const dateTo = parseDateParam(typeof params.dateTo === "string" ? params.dateTo : undefined, defaultTo);
  const vehicleId = typeof params.vehicleId === "string" ? params.vehicleId : "";

  const fromKey = formatDateKey(dateFrom);
  const toKey = formatDateKey(dateTo);

  const vehicles = await dbQuery<VehicleRow>("select id, make, model from vehicles order by make, model");

  const bookingClauses: string[] = ["b.start_date <= $2", "b.end_date >= $1"];
  const bookingValues: Array<string> = [fromKey, toKey];
  let bookingIndex = 3;

  if (vehicleId) {
    bookingClauses.push(`b.vehicle_id = $${bookingIndex}`);
    bookingValues.push(vehicleId);
    bookingIndex += 1;
  }

  const bookings = await dbQuery<BookingRow>(
    "select b.id, b.status, b.start_date, b.end_date, b.created_at, b.pricing_json, c.full_name as customer_name, v.id as vehicle_id, v.make as vehicle_make, v.model as vehicle_model, v.daily_rate_cents, v.deposit_cents from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where " +
      bookingClauses.join(" and ") +
      " order by b.start_date asc",
    bookingValues,
  );

  const paymentsInRange = await dbQuery<PaymentRow>(
    "select p.booking_id, p.deposit_amount_cents, p.status, p.created_at from payments p join bookings b on b.id = p.booking_id where p.status <> 'REFUNDED' and p.created_at::date between $1 and $2 " +
      (vehicleId ? "and b.vehicle_id = $3 " : "") +
      "order by p.created_at asc",
    vehicleId ? [fromKey, toKey, vehicleId] : [fromKey, toKey],
  );

  const bookingRows = bookings.rows as BookingRow[];
  const bookingIds = bookingRows.map((booking: BookingRow) => booking.id);
  const paymentsAll = bookingIds.length
    ? await dbQuery<PaymentRow>(
        "select booking_id, deposit_amount_cents, status, created_at from payments where status <> 'REFUNDED' and booking_id = any($1::uuid[])",
        [bookingIds],
      )
    : { rows: [] };

  const paidByBooking = new Map<string, number>();
  const paymentsAllRows = paymentsAll.rows as PaymentRow[];
  paymentsAllRows.forEach((payment: PaymentRow) => {
    const current = paidByBooking.get(payment.booking_id) ?? 0;
    paidByBooking.set(payment.booking_id, current + Number(payment.deposit_amount_cents ?? 0));
  });

  const daysInRange = daysInclusive(dateFrom, dateTo);
  const utilizationByVehicle = new Map<string, number>();

  bookingRows.forEach((booking: BookingRow) => {
    if (booking.status === "CANCELLED") return;
    const bookingStart = new Date(`${booking.start_date}T00:00:00`);
    const bookingEnd = new Date(`${booking.end_date}T00:00:00`);
    const bookedDays = overlapDays(dateFrom, dateTo, bookingStart, bookingEnd);
    if (bookedDays <= 0) return;
    const current = utilizationByVehicle.get(booking.vehicle_id) ?? 0;
    utilizationByVehicle.set(booking.vehicle_id, current + bookedDays);
  });

  const statusCounts = {
    pending: 0,
    confirmed: 0,
    returned: 0,
    cancelled: 0,
  };

  let bookingsCreatedCount = 0;
  let depositDueCount = 0;
  let depositDueSum = 0;
  let outstandingBalanceSum = 0;
  const outstandingBookings: Array<{
    id: string;
    customer_name: string;
    vehicle_label: string;
    total: number;
    paid: number;
    balance: number;
    status: string;
  }> = [];

  const revenueByDate = new Map<string, { bookings: number; revenue: number }>();
  for (let cursor = new Date(dateFrom); cursor <= dateTo; ) {
    const key = formatDateKey(cursor);
    revenueByDate.set(key, { bookings: 0, revenue: 0 });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
  }

  bookingRows.forEach((booking: BookingRow) => {
    const createdDate = formatDateKey(new Date(booking.created_at));
    if (revenueByDate.has(createdDate)) {
      revenueByDate.get(createdDate)!.bookings += 1;
      bookingsCreatedCount += 1;
    }

    const pricing = booking.pricing_json ?? {};
    const days =
      Number((pricing as { days?: number }).days ?? 0) ||
      daysInclusive(new Date(`${booking.start_date}T00:00:00`), new Date(`${booking.end_date}T00:00:00`));
    const dailyRate = Number(
      (pricing as { daily_rate_cents?: number }).daily_rate_cents ?? booking.daily_rate_cents ?? 0,
    );
    const total = Number(
      (pricing as { subtotal_cents?: number }).subtotal_cents ?? dailyRate * days,
    );
    const deposit = Number(
      (pricing as { deposit_cents?: number }).deposit_cents ?? booking.deposit_cents ?? 0,
    );
    const paid = paidByBooking.get(booking.id) ?? 0;

    if (paid === 0 && ["CONFIRMED", "RETURNED"].includes(booking.status) && revenueByDate.has(createdDate)) {
      revenueByDate.get(createdDate)!.revenue += total;
    }

    const balance = Math.max(0, total - paid);
    if (booking.status !== "CANCELLED" && balance > 0) {
      outstandingBalanceSum += balance;
      outstandingBookings.push({
        id: booking.id,
        customer_name: booking.customer_name,
        vehicle_label: `${booking.vehicle_make} ${booking.vehicle_model}`,
        total,
        paid,
        balance,
        status: booking.status,
      });
    }

    if (["PENDING_PAYMENT", "PENDING"].includes(booking.status) && deposit > paid) {
      depositDueCount += 1;
      depositDueSum += Math.max(0, deposit - paid);
    }

    if (booking.status === "PENDING_PAYMENT") statusCounts.pending += 1;
    if (booking.status === "CONFIRMED") statusCounts.confirmed += 1;
    if (booking.status === "RETURNED") statusCounts.returned += 1;
    if (booking.status === "CANCELLED") statusCounts.cancelled += 1;
  });

  const paymentsInRangeRows = paymentsInRange.rows as PaymentRow[];
  paymentsInRangeRows.forEach((payment: PaymentRow) => {
    const dateKey = formatDateKey(new Date(payment.created_at));
    if (!revenueByDate.has(dateKey)) return;
    revenueByDate.get(dateKey)!.revenue += Number(payment.deposit_amount_cents ?? 0);
  });

  const revenueRows = Array.from(revenueByDate.entries()).map(([date, data]) => ({
    date,
    bookings: data.bookings,
    revenue: data.revenue,
  }));

  const totalRevenue = revenueRows.reduce((sum, row) => sum + row.revenue, 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-primary)]">Reports</h1>
        </div>
        <Link
          href="/admin/bookings"
          className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
        >
          View Bookings
        </Link>
      </div>

      <form className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
        <div className="grid gap-4 md:grid-cols-[1fr_1fr_1.5fr_auto_auto]">
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Date From
            <input
              type="date"
              name="dateFrom"
              defaultValue={fromKey}
              className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Date To
            <input
              type="date"
              name="dateTo"
              defaultValue={toKey}
              className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            />
          </label>
          <label className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">
            Vehicle
            <select
              name="vehicleId"
              defaultValue={vehicleId}
              className="mt-2 w-full rounded-xl border border-[var(--ccr-border)] bg-transparent px-3 py-2 text-sm text-[var(--ccr-text)]"
            >
              <option value="">All vehicles</option>
              {(vehicles.rows as VehicleRow[]).map((vehicle: VehicleRow) => (
                <option key={vehicle.id} value={vehicle.id}>
                  {vehicle.make} {vehicle.model}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="mt-6 rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-xs font-semibold text-white"
          >
            Apply
          </button>
          <Link
            href="/admin/reports"
            className="mt-6 rounded-xl border border-[var(--ccr-border)] px-4 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Reset
          </Link>
        </div>
      </form>

      <p className="mt-3 text-xs text-[var(--ccr-muted)]">
        Revenue uses payment dates when available (otherwise booking created date for confirmed/returned
        bookings with no payments). Utilization uses pickup/return overlap.
      </p>

      <div className="mt-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Total Revenue</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ccr-primary)]">{formatJmd(totalRevenue)}</p>
        </div>
        <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Bookings Count</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ccr-primary)]">{bookingsCreatedCount}</p>
        </div>
        <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Outstanding Balance</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ccr-primary)]">
            {formatJmd(outstandingBalanceSum)}
          </p>
        </div>
        <div className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4">
          <p className="text-xs uppercase tracking-wide text-[var(--ccr-muted)]">Deposits Due</p>
          <p className="mt-2 text-2xl font-bold text-[var(--ccr-primary)]">
            {depositDueCount}
          </p>
          <p className="text-xs text-[var(--ccr-muted)]">{formatJmd(depositDueSum)}</p>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <h2 className="text-lg font-bold text-[var(--ccr-primary)]">Revenue Breakdown</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Bookings</th>
                  <th className="px-3 py-2">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {revenueRows.map((row) => (
                  <tr key={row.date} className="border-b border-[var(--ccr-border)] last:border-b-0">
                    <td className="px-3 py-2 text-[var(--ccr-text)]">{row.date}</td>
                    <td className="px-3 py-2 text-[var(--ccr-text)]">{row.bookings}</td>
                    <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(row.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
          <h2 className="text-lg font-bold text-[var(--ccr-primary)]">Booking Funnel</h2>
          <div className="mt-4 grid gap-3 text-sm">
            <div className="flex items-center justify-between">
              <span>Pending payment</span>
              <span className="font-semibold text-[var(--ccr-text)]">{statusCounts.pending}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Confirmed</span>
              <span className="font-semibold text-[var(--ccr-text)]">{statusCounts.confirmed}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Returned / Completed</span>
              <span className="font-semibold text-[var(--ccr-text)]">{statusCounts.returned}</span>
            </div>
            <div className="flex items-center justify-between">
              <span>Cancelled</span>
              <span className="font-semibold text-[var(--ccr-text)]">{statusCounts.cancelled}</span>
            </div>
          </div>

          <h2 className="mt-6 text-lg font-bold text-[var(--ccr-primary)]">Utilization by Vehicle</h2>
          <div className="mt-4 space-y-3 text-sm">
            {(
              vehicleId
                ? (vehicles.rows as VehicleRow[]).filter((v: VehicleRow) => v.id === vehicleId)
                : (vehicles.rows as VehicleRow[])
            ).map((vehicle: VehicleRow) => {
                const booked = utilizationByVehicle.get(vehicle.id) ?? 0;
                const utilization = daysInRange > 0 ? (booked / daysInRange) * 100 : 0;
                return (
                  <div key={vehicle.id} className="rounded-xl border border-[var(--ccr-border)] px-3 py-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--ccr-text)]">
                        {vehicle.make} {vehicle.model}
                      </span>
                      <span className="text-xs text-[var(--ccr-muted)]">
                        {booked} / {daysInRange} days
                      </span>
                    </div>
                    <div className="mt-2 h-2 w-full rounded-full bg-[var(--ccr-surface-soft)]">
                      <div
                        className="h-2 rounded-full bg-[var(--ccr-primary)]"
                        style={{ width: `${Math.min(100, utilization).toFixed(0)}%` }}
                      />
                    </div>
                    <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                      Utilization: {utilization.toFixed(0)}%
                    </p>
                  </div>
                );
              },
            )}
          </div>
        </section>
      </div>

      <section className="mt-6 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6">
        <h2 className="text-lg font-bold text-[var(--ccr-primary)]">Outstanding Balances</h2>
        {outstandingBookings.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--ccr-muted)]">No outstanding balances.</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="border-b border-[var(--ccr-border)] text-xs uppercase tracking-wide text-[var(--ccr-muted)]">
                <tr>
                  <th className="px-3 py-2">Booking</th>
                  <th className="px-3 py-2">Customer</th>
                  <th className="px-3 py-2">Vehicle</th>
                  <th className="px-3 py-2">Total</th>
                  <th className="px-3 py-2">Paid</th>
                  <th className="px-3 py-2">Balance Due</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {outstandingBookings.map((booking) => (
                  <tr key={booking.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/bookings/${booking.id}`}
                        className="text-sm font-semibold text-[var(--ccr-primary)]"
                      >
                        {booking.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-[var(--ccr-text)]">{booking.customer_name}</td>
                    <td className="px-3 py-2 text-[var(--ccr-text)]">{booking.vehicle_label}</td>
                    <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(booking.total)}</td>
                    <td className="px-3 py-2 text-[var(--ccr-text)]">{formatJmd(booking.paid)}</td>
                    <td className="px-3 py-2 text-[var(--ccr-text)]">
                      {formatJmd(booking.balance)}
                    </td>
                    <td className="px-3 py-2 text-[var(--ccr-text)]">{booking.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
