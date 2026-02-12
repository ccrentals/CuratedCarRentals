import Link from "next/link";

import { dbQuery } from "@/lib/db";
import { fmtDate } from "@/lib/dateFormat";
import BookingFilters from "@/components/admin/BookingFilters";
import { AdminCreateBookingModal } from "@/components/admin/AdminCreateBookingModal";
import { getSessionFromRequest } from "@/lib/auth/session";

type BookingRow = {
  id: string;
  start_date: string;
  end_date: string;
  created_at: string;
  status: string;
  customer_name: string;
  customer_email: string;
  vehicle_make: string;
  vehicle_model: string;
};

type VehicleOption = {
  id: string;
  year: number;
  make: string;
  model: string;
};

function isAdminRole(role: string | undefined) {
  return String(role ?? "")
    .trim()
    .toUpperCase() === "ADMIN";
}

function isUndefinedColumn(error: unknown, column: string) {
  const code = (error as { code?: string } | null)?.code;
  const message = String((error as { message?: unknown } | null)?.message ?? "");
  if (code !== "42703") return false;
  const haystack = message.toLowerCase();
  const needle = column.toLowerCase();
  return haystack.includes("does not exist") && (haystack.includes(`"${needle}"`) || haystack.includes(`.${needle}`) || haystack.includes(needle));
}

export default async function AdminBookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getSessionFromRequest();
  const canAdmin = isAdminRole(session?.role);

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

  const includeArchived = typeof params.archived === "string" && params.archived === "1";
  if (!includeArchived) {
    whereClauses.push("b.archived_at is null");
  }

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
    "select b.id, b.start_date, b.end_date, b.created_at, b.status, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id " +
    whereSql +
    " order by b.created_at desc";

  let archiveNotConfigured = false;
  const queryTextWithoutArchive =
    "select b.id, b.start_date, b.end_date, b.created_at, b.status, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id " +
    (whereClauses.filter((clause) => clause !== "b.archived_at is null").length
      ? `where ${whereClauses.filter((clause) => clause !== "b.archived_at is null").join(" and ")}`
      : "") +
    " order by b.created_at desc";

  const bookings = await (async () => {
    try {
      return await dbQuery<BookingRow>(queryText, values);
    } catch (error) {
      if (isUndefinedColumn(error, "archived_at")) {
        archiveNotConfigured = true;
        return await dbQuery<BookingRow>(queryTextWithoutArchive, values);
      }
      throw error;
    }
  })();

  const vehicles = await dbQuery<VehicleOption>(
    "select id, year, make, model from vehicles where status <> 'INACTIVE' order by year desc, make asc, model asc",
  );

  const vehicleOptions = vehicles.rows.map((vehicle: VehicleOption) => ({
    id: vehicle.id,
    label: `${vehicle.year} ${vehicle.make} ${vehicle.model}`.trim(),
  }));

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-[var(--ccr-muted)]">Admin</p>
          <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Bookings</h1>
        </div>
        <div className="flex items-center gap-2">
          <AdminCreateBookingModal vehicles={vehicleOptions} />
          {canAdmin ? (
            <Link
              href="/admin/bookings/archive"
              className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
            >
              Archive
            </Link>
          ) : null}
          <Link
            href="/admin/bookings"
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-3 py-2 text-xs font-semibold text-[var(--ccr-text)]"
          >
            Reset
          </Link>
        </div>
      </div>

      {archiveNotConfigured ? (
        <div className="mt-6 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-semibold">Archive not configured</p>
          <p className="mt-1 text-xs text-amber-100/80">
            The archive columns are missing in the connected database. Apply the archive section from
            schema.sql to enable hiding archived bookings.
          </p>
        </div>
      ) : null}

      <BookingFilters canAdmin={canAdmin} />

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
                <th className="px-4 py-3">Created</th>
                <th className="px-4 py-3">Details</th>
              </tr>
            </thead>
            <tbody>
              {bookings.rows.map((booking: BookingRow) => (
                <tr key={booking.id} className="border-b border-[var(--ccr-border)] last:border-b-0">
                  <td className="px-4 py-3 font-mono text-xs text-[var(--ccr-text)]">
                    <Link
                      href={`/admin/bookings/${booking.id}`}
                      className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-[11px] font-bold text-[var(--ccr-accent)] transition hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]"
                      title="Open booking"
                    >
                      {booking.id.slice(0, 8)}
                    </Link>
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
                  <td className="px-4 py-3 text-[var(--ccr-muted)]">{fmtDate(booking.created_at)}</td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/admin/bookings/${booking.id}`}
                      className="text-sm font-semibold text-[var(--ccr-text)]"
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
