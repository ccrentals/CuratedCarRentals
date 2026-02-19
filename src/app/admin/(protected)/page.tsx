import Link from "next/link";

import { dbQuery } from "@/lib/db";
import { fmtDate } from "@/lib/dateFormat";
import { formatJmd } from "@/lib/money";

export default async function AdminDashboardPage() {
  const hoverTextClass = "hover:text-[var(--ccr-muted)]";
  // Shared gold-ring quick action treatment for visual consistency.
  const quickActionClass =
    `rounded-full bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] shadow-sm ring-1 ring-[var(--ccr-accent)] ring-offset-1 ring-offset-[var(--ccr-surface)] transition hover:bg-[var(--ccr-surface-soft)] hover:ring-[var(--ccr-accent-strong)] ${hoverTextClass}`;

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
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold text-[var(--ccr-text)] sm:text-3xl">Admin Dashboard</h1>
        <div className="flex w-full flex-wrap gap-4 sm:w-auto sm:justify-end sm:gap-5">
          <Link
            href="/admin/bookings"
            className={`inline-flex w-full items-center justify-center rounded-full bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] shadow-sm ring-2 ring-[var(--ccr-accent)] ring-offset-2 ring-offset-[var(--ccr-bg)] transition hover:bg-[var(--ccr-surface-soft)] hover:ring-[var(--ccr-accent-strong)] sm:w-auto ${hoverTextClass}`}
          >
            View Bookings
          </Link>
          <Link
            href="/admin/vehicles"
            className={`inline-flex w-full items-center justify-center rounded-full bg-[var(--ccr-surface)] px-4 py-2 text-sm font-semibold text-[var(--ccr-text)] shadow-sm ring-2 ring-[var(--ccr-accent)] ring-offset-2 ring-offset-[var(--ccr-bg)] transition hover:bg-[var(--ccr-surface-soft)] hover:ring-[var(--ccr-accent-strong)] sm:w-auto ${hoverTextClass}`}
          >
            Manage Vehicles
          </Link>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className={`min-w-0 rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-[var(--ccr-accent)] hover:shadow-md sm:p-5 ${hoverTextClass}`}
          >
            <p className="break-words text-xs text-[var(--ccr-muted)] sm:text-sm">{card.label}</p>
            <p className="mt-2 text-xl font-bold text-[var(--ccr-text)] sm:text-2xl">{card.value}</p>
          </Link>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Upcoming pickups today</h2>
            <Link
              href={`/admin/bookings?dateFrom=${new Date().toISOString().slice(0, 10)}&dateTo=${new Date().toISOString().slice(0, 10)}`}
              className={`text-xs font-semibold text-[var(--ccr-text)] ${hoverTextClass}`}
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
                    <div className="min-w-0">
                      <Link
                        href={`/admin/bookings/${booking.id}`}
                        className={`inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-bold text-[var(--ccr-accent)] transition hover:border-[var(--ccr-accent-strong)] hover:bg-[var(--ccr-surface)] ${hoverTextClass}`}
                        title="Open booking"
                      >
                        {booking.id.slice(0, 8)}
                      </Link>
                      <p className="mt-1 break-words text-xs text-[var(--ccr-muted)]">
                        {booking.customer_name} • {booking.vehicle_make} {booking.vehicle_model}
                      </p>
                      <p className="text-xs text-[var(--ccr-muted)]">
                        {fmtDate(booking.start_date)} → {fmtDate(booking.end_date)}
                      </p>
                    </div>
                    <span className="shrink-0 rounded-full bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]">
                      {booking.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Outstanding balances</h2>
            <Link href="/admin/bookings" className={`text-xs font-semibold text-[var(--ccr-text)] ${hoverTextClass}`}>
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
                  <li key={booking.id} className="rounded-xl border border-[var(--ccr-border)]">
                    <details className="group">
                      <summary className="list-none cursor-pointer p-3 [&::-webkit-details-marker]:hidden">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <span className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-bold text-[var(--ccr-accent)]">
                              {booking.id.slice(0, 8)}
                            </span>
                            <p className="mt-1 text-xs text-[var(--ccr-muted)]">Booking details</p>
                          </div>
                          <div className="flex shrink-0 items-start gap-3 text-right">
                            <div>
                              <p className="text-xs font-semibold text-[var(--ccr-muted)]">Balance</p>
                              <p className="font-bold text-[var(--ccr-text)]">{formatJmd(balanceDue)}</p>
                            </div>
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--ccr-border)] text-[var(--ccr-text)] transition-transform group-open:rotate-180">
                              <svg
                                viewBox="0 0 20 20"
                                className="h-3.5 w-3.5"
                                aria-hidden="true"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M5 7l5 6 5-6" />
                              </svg>
                            </span>
                          </div>
                        </div>
                      </summary>
                      <div className="border-t border-[var(--ccr-border)] px-3 pb-3 pt-2">
                        <p className="break-words text-xs text-[var(--ccr-muted)]">
                          {booking.customer_name} • {booking.vehicle_make} {booking.vehicle_model}
                        </p>
                        <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                          {fmtDate(booking.start_date)} → {fmtDate(booking.end_date)}
                        </p>
                        <Link
                          href={`/admin/bookings/${booking.id}`}
                          className={`mt-2 inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-bold text-[var(--ccr-accent)] transition hover:border-[var(--ccr-accent-strong)] hover:bg-[var(--ccr-surface)] ${hoverTextClass}`}
                          title="Open booking"
                        >
                          Open booking
                        </Link>
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Vehicles in maintenance</h2>
            <Link href="/admin/vehicles" className={`text-xs font-semibold text-[var(--ccr-text)] ${hoverTextClass}`}>
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
                        className={`font-semibold text-[var(--ccr-text)] ${hoverTextClass}`}
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
              className={`${quickActionClass} inline-flex w-full items-center justify-center sm:w-auto`}
            >
              Quick create booking
            </Link>
            <Link
              href="/admin/calendar"
              className={`${quickActionClass} inline-flex w-full items-center justify-center sm:w-auto`}
            >
              Add blockout
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Recent Bookings</h2>
            <Link href="/admin/bookings" className={`text-xs font-semibold text-[var(--ccr-text)] ${hoverTextClass}`}>
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
                <li key={booking.id} className="rounded-xl border border-[var(--ccr-border)]">
                  <details className="group">
                    <summary className="list-none cursor-pointer p-3 [&::-webkit-details-marker]:hidden">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <span className="inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-bold text-[var(--ccr-accent)]">
                            {booking.id.slice(0, 8)}
                          </span>
                          <p className="mt-1 text-xs text-[var(--ccr-muted)]">Booking details</p>
                        </div>
                        <div className="flex shrink-0 items-start gap-3">
                          <span className="rounded-full bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-semibold text-[var(--ccr-text)]">
                            {booking.status}
                          </span>
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-[var(--ccr-border)] text-[var(--ccr-text)] transition-transform group-open:rotate-180">
                            <svg
                              viewBox="0 0 20 20"
                              className="h-3.5 w-3.5"
                              aria-hidden="true"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M5 7l5 6 5-6" />
                            </svg>
                          </span>
                        </div>
                      </div>
                    </summary>
                    <div className="border-t border-[var(--ccr-border)] px-3 pb-3 pt-2">
                      <p className="break-words text-xs text-[var(--ccr-muted)]">
                        {booking.customer_name} • {booking.vehicle_make} {booking.vehicle_model}
                      </p>
                      <p className="mt-1 text-xs text-[var(--ccr-muted)]">
                        {fmtDate(booking.start_date)} → {fmtDate(booking.end_date)}
                      </p>
                      <Link
                        href={`/admin/bookings/${booking.id}`}
                        className={`mt-2 inline-flex items-center rounded-full border border-[var(--ccr-accent)] bg-[var(--ccr-surface-soft)] px-3 py-1 text-xs font-bold text-[var(--ccr-accent)] transition hover:border-[var(--ccr-accent-strong)] hover:bg-[var(--ccr-surface)] ${hoverTextClass}`}
                        title="Open booking"
                      >
                        Open booking
                      </Link>
                    </div>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-2xl border border-[var(--ccr-border)] bg-[var(--ccr-surface)] p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-[var(--ccr-text)]">Recent Vehicles</h2>
            <Link href="/admin/vehicles" className={`text-xs font-semibold text-[var(--ccr-text)] ${hoverTextClass}`}>
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
                        className={`font-semibold text-[var(--ccr-text)] ${hoverTextClass}`}
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
