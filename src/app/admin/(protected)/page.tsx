import Link from "next/link";

import { dbQuery } from "@/lib/db";
import { fmtDate } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";

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
  const upcomingPickupsResult = await dbQuery<{ count: string }>(
    "select count(*) from bookings where start_date between current_date and (current_date + interval '7 days') and status not in ('CANCELLED','RETURNED')",
  );

  const pickupsToday = await dbQuery<{
    id: string;
    status: string;
    start_date: string;
    end_date: string;
    customer_name: string;
    vehicle_make: string;
    vehicle_model: string;
  }>(
    "select b.id, b.status, b.start_date, b.end_date, c.full_name as customer_name, v.make as vehicle_make, v.model as vehicle_model from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.start_date = current_date and b.status not in ('CANCELLED','RETURNED') order by b.created_at desc limit 5",
  );

  const outstandingBalances = await dbQuery<{
    id: string;
    status: string;
    start_date: string;
    end_date: string;
    customer_name: string;
    customer_email: string;
    vehicle_make: string;
    vehicle_model: string;
    balance_due: string;
  }>(
    "select b.id, b.status, b.start_date, b.end_date, c.full_name as customer_name, c.email as customer_email, v.make as vehicle_make, v.model as vehicle_model, coalesce((b.pricing_json->>'balance_due')::numeric, 0) as balance_due from bookings b join customers c on c.id = b.customer_id join vehicles v on v.id = b.vehicle_id where b.status not in ('CANCELLED','RETURNED') and coalesce((b.pricing_json->>'balance_due')::numeric, 0) > 0 order by balance_due desc, b.created_at desc limit 5",
  );

  const maintenanceVehicles = await dbQuery<{
    id: string;
    make: string;
    model: string;
    year: number;
    status: string;
    updated_at: string;
  }>(
    "select id, make, model, year, status, updated_at from vehicles where status = 'MAINTENANCE' order by updated_at desc limit 5",
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
    {
      label: "Upcoming Pickups (7d)",
      value: upcomingPickupsResult.rows[0]?.count ?? "0",
      href: "/admin/bookings",
    },
  ];

  return (
    <div className="mx-auto w-full max-w-6xl px-6 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold text-[var(--ccr-text)]">Admin Dashboard</h1>
        <div className="flex gap-3">
          <Link
            href="/admin/bookings"
            className="rounded-full bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] shadow-sm ring-2 ring-[var(--ccr-accent)] ring-offset-2 ring-offset-[var(--ccr-bg)] transition hover:bg-[var(--ccr-surface-soft)] hover:ring-[var(--ccr-accent-strong)]"
          >
            View Bookings
          </Link>
          <Link
            href="/admin/vehicles"
            className="rounded-full bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] shadow-sm ring-2 ring-[var(--ccr-accent)] ring-offset-2 ring-offset-[var(--ccr-bg)] transition hover:bg-[var(--ccr-surface-soft)] hover:ring-[var(--ccr-accent-strong)]"
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
            className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--ccr-accent)] hover:shadow-md"
          >
            <p className="text-sm text-[var(--ccr-muted)]">{card.label}</p>
            <p className="mt-2 text-2xl font-bold text-[var(--ccr-text)]">{card.value}</p>
          </Link>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Upcoming pickups today</h2>
            <Link
              href={`/admin/bookings?dateFrom=${new Date().toISOString().slice(0, 10)}&dateTo=${new Date().toISOString().slice(0, 10)}`}
              className="text-xs font-semibold text-[var(--ccr-text)]"
            >
              View all
            </Link>
          </div>
          {pickupsToday.rows.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ccr-muted)]">No pickups today.</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              {(pickupsToday.rows as Array<{
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
                        className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-bold text-[var(--ccr-accent)] transition hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]"
                        title="Open booking"
                      >
                        {booking.id.slice(0, 8)}
                      </Link>
                      <p className="mt-1 text-xs text-[var(--ccr-muted)]">
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
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Outstanding balances</h2>
            <Link href="/admin/bookings" className="text-xs font-semibold text-[var(--ccr-text)]">
              View bookings
            </Link>
          </div>
          {outstandingBalances.rows.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ccr-muted)]">No outstanding balances.</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              {(outstandingBalances.rows as Array<{
                id: string;
                status: string;
                start_date: string;
                end_date: string;
                customer_name: string;
                customer_email: string;
                vehicle_make: string;
                vehicle_model: string;
                balance_due: string;
              }>).map((booking) => {
                const balanceDue = Number(booking.balance_due ?? 0);
                return (
                  <li key={booking.id} className="rounded-xl border border-[var(--ccr-border)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <Link
                          href={`/admin/bookings/${booking.id}`}
                          className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-bold text-[var(--ccr-accent)] transition hover:bg-[var(--ccr-accent)] hover:text-[var(--ccr-primary)]"
                          title="Open booking"
                        >
                          {booking.id.slice(0, 8)}
                        </Link>
                        <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                          {booking.customer_name} • {booking.vehicle_make} {booking.vehicle_model}
                        </p>
                        <p className="text-xs text-[var(--ccr-muted)]">
                          {fmtDate(booking.start_date)} → {fmtDate(booking.end_date)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-xs font-semibold text-[var(--ccr-muted)]">Balance</p>
                        <p className="font-bold text-[var(--ccr-text)]">{formatJmd(balanceDue)}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Vehicles in maintenance</h2>
            <Link href="/admin/vehicles" className="text-xs font-semibold text-[var(--ccr-text)]">
              View vehicles
            </Link>
          </div>
          {maintenanceVehicles.rows.length === 0 ? (
            <p className="mt-3 text-sm text-[var(--ccr-muted)]">No vehicles in maintenance.</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              {(maintenanceVehicles.rows as Array<{
                id: string;
                make: string;
                model: string;
                year: number;
                status: string;
                updated_at: string;
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
                        Updated {fmtDate(vehicle.updated_at)}
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

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Quick actions</h2>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              href="/admin/bookings?create=1"
              className="rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] shadow-sm transition hover:border-[var(--ccr-accent-strong)] hover:bg-[var(--ccr-surface-soft)]"
            >
              Quick create booking
            </Link>
            <Link
              href="/admin/calendar"
              className="rounded-full bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] shadow-sm ring-2 ring-[var(--ccr-accent)] ring-offset-2 ring-offset-[var(--ccr-surface)] transition hover:bg-[var(--ccr-surface-soft)] hover:ring-[var(--ccr-accent-strong)]"
            >
              Add blockout
            </Link>
          </div>
        </section>

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
                <li key={booking.id}>
                  <Link
                    href={`/admin/bookings/${booking.id}`}
                    className="group block rounded-xl border border-[var(--ccr-border)] p-3 transition hover:border-[var(--ccr-accent)] hover:bg-[var(--ccr-surface-soft)]"
                    title="Open booking"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-bold text-[var(--ccr-accent)] transition group-hover:bg-[var(--ccr-accent)] group-hover:text-[var(--ccr-primary)]">
                          {booking.id.slice(0, 8)}
                          <span className="ml-1 text-[10px] font-black opacity-70">&gt;</span>
                        </span>
                        <p className="mt-1 text-xs text-[var(--ccr-muted)]">
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
                  </Link>
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
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-semibold ${
                        vehicle.status === "ACTIVE"
                          ? "bg-[var(--ccr-surface-soft)] text-[var(--ccr-accent)] ring-2 ring-[var(--ccr-accent)] ring-offset-2 ring-offset-[var(--ccr-surface)]"
                          : "bg-[var(--ccr-surface-soft)] text-[var(--ccr-text)]"
                      }`}
                    >
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
