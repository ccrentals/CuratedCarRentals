import Link from "next/link";

import { dbQuery } from "@/lib/db";
import { fmtDate } from "@/lib/dateFormat";

export default async function AdminDashboardPage() {
  const vehiclesResult = await dbQuery<{ count: string }>("select count(*) from vehicles");
  const availableVehiclesResult = await dbQuery<{ count: string }>(
    "select count(*) from vehicles where status = 'AVAILABLE'",
  );
  const bookingsResult = await dbQuery<{ count: string }>("select count(*) from bookings");
  const pendingResult = await dbQuery<{ count: string }>(
    "select count(*) from bookings where status = 'PENDING_PAYMENT'",
  );
  const confirmedResult = await dbQuery<{ count: string }>(
    "select count(*) from bookings where status = 'CONFIRMED'",
  );

  const recentBookings = await dbQuery<{
    id: string;
    status: string;
    start_date: string;
    end_date: string;
    customer_name: string;
    vehicle_make: string;
    vehicle_model: string;
  }>(
    "select b.id, b.status, b.start_date, b.end_date, c.full_name as customer_name, v.make as vehicle_make, v.model as vehicle_model from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id order by b.created_at desc limit 5",
  );

  const recentVehicles = await dbQuery<{
    id: string;
    make: string;
    model: string;
    year: number;
    status: string;
    created_at: string;
  }>("select id, make, model, year, status, created_at from vehicles order by created_at desc limit 5");

  const cards = [
    {
      label: "Total Bookings",
      value: bookingsResult.rows[0]?.count ?? "0",
      href: "/admin/bookings",
    },
    {
      label: "Pending Payment",
      value: pendingResult.rows[0]?.count ?? "0",
      href: "/admin/bookings?status=pending_payment",
    },
    {
      label: "Confirmed",
      value: confirmedResult.rows[0]?.count ?? "0",
      href: "/admin/bookings?status=confirmed",
    },
    {
      label: "Total Vehicles",
      value: vehiclesResult.rows[0]?.count ?? "0",
      href: "/admin/vehicles",
    },
    {
      label: "Available Vehicles",
      value: availableVehiclesResult.rows[0]?.count ?? "0",
      href: "/admin/vehicles?availability=available",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Admin Dashboard</h1>
        <div className="flex gap-3">
          <Link
            href="/admin/bookings"
            className="rounded-xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)]"
          >
            View Bookings
          </Link>
          <Link
            href="/admin/vehicles"
            className="rounded-xl bg-[var(--ccr-primary)] px-4 py-2 text-sm font-semibold text-white"
          >
            Manage Vehicles
          </Link>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--ccr-primary)] hover:shadow-md"
          >
            <p className="text-sm text-[var(--ccr-muted)]">{card.label}</p>
            <p className="mt-2 text-2xl font-bold text-[var(--ccr-text)]">{card.value}</p>
          </Link>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Recent Bookings</h2>
            <Link href="/admin/bookings" className="text-xs font-semibold text-[var(--ccr-text)]">
              View all
            </Link>
          </div>
          {recentBookings.rows.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ccr-muted)]">No bookings yet.</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              {(recentBookings.rows as Array<{
                id: string;
                status: string;
                start_date: string;
                end_date: string;
                customer_name: string;
                vehicle_make: string;
                vehicle_model: string;
              }>).map((booking) => (
                <li key={booking.id} className="rounded-xl border border-[var(--ccr-border)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        href={`/admin/bookings/${booking.id}`}
                        className="font-semibold text-[var(--ccr-text)]"
                      >
                        {booking.id.slice(0, 8)}
                      </Link>
                      <p className="text-xs text-[var(--ccr-muted)]">
                        {booking.customer_name} • {booking.vehicle_make} {booking.vehicle_model}
                      </p>
                      <p className="text-xs text-[var(--ccr-muted)]">
                        {fmtDate(booking.start_date)} → {fmtDate(booking.end_date)}
                      </p>
                    </div>
                    <span className="rounded-full bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]">
                      {booking.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Recent Vehicles</h2>
            <Link href="/admin/vehicles" className="text-xs font-semibold text-[var(--ccr-text)]">
              View all
            </Link>
          </div>
          {recentVehicles.rows.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ccr-muted)]">No vehicles yet.</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              {(recentVehicles.rows as Array<{
                id: string;
                make: string;
                model: string;
                year: number;
                status: string;
                created_at: string;
              }>).map((vehicle) => (
                <li key={vehicle.id} className="rounded-xl border border-[var(--ccr-border)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Link
                        href={`/admin/vehicles/${vehicle.id}`}
                        className="font-semibold text-[var(--ccr-text)]"
                      >
                        {vehicle.year} {vehicle.make} {vehicle.model}
                      </Link>
                      <p className="text-xs text-[var(--ccr-muted)]">
                        Added {fmtDate(vehicle.created_at)}
                      </p>
                    </div>
                    <span className="rounded-full bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]">
                      {vehicle.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
